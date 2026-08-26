import { Prisma, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  createRequestHash,
  idempotencyConflict,
  readIdempotencyKey,
} from "@/lib/idempotency";
import {
  canTransitionOrderStatus,
  normalizeOrderStatus,
  ORDER_STATUSES,
} from "@/lib/orders/lifecycle";
import { prisma } from "@/lib/prisma";
import {
  PartnerManagementError,
  setOrderPartnerAgreement,
} from "@/lib/services/partner-management.service";
import { adjustOrderAmount } from "@/lib/services/payment.service";
import { requirePermission } from "@/lib/server-auth";
import { canAccessOrder360 } from "@/lib/services/order360.service";
import { buildOrderSettlement } from "@/lib/services/order-settlement.service";
import {
  deleteOrderFromWork,
  OrderDeletionError,
} from "@/lib/services/order-deletion.service";
import {
  OrderDetailsError,
  updateOrderDetails,
} from "@/lib/services/order-details.service";

type Context = { params: Promise<{ id: string }> };
const include = {
  client: true,
  partner: true,
  deletedBy: { select: { id: true, name: true } },
  managerUser: { include: { payrollProfile: { select: { id: true } } } },
  measurements: {
    include: {
      measurerUser: { include: { payrollProfile: { select: { id: true } } } },
    },
  },
  payments: {
    include: { partner: true },
    orderBy: [{ operationDate: "desc" as const }, { id: "desc" as const }],
  },
  partnerAssignmentHistory: {
    include: { author: { select: { name: true } } },
    orderBy: { createdAt: "desc" as const },
  },
  payrollAccruals: {
    include: {
      employee: { include: { user: { select: { name: true } } } },
      payments: true,
      reversedBy: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" as const },
  },
  productions: true,
  documents: true,
  calculations: { orderBy: { createdAt: "desc" as const } },
  statusHistory: { orderBy: { createdAt: "desc" as const } },
  events: { orderBy: { createdAt: "desc" as const } },
  _count: {
    select: {
      payments: true,
      companyLedgerEntries: true,
      financeAuditEvents: true,
      payrollAccruals: true,
    },
  },
} satisfies Prisma.OrderInclude;
const idOf = (value: string) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const text = (value: unknown, max = 1000) =>
  typeof value === "string" ? value.trim().slice(0, max) : null;

async function canAccess(
  id: number,
  role: Role,
  userId: string,
  includeDeleted = false,
) {
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: { name: true },
  });
  return (
    !!user &&
    canAccessOrder360(
      id,
      { userId: Number(userId), role, name: user.name },
      { includeDeleted },
    )
  );
}

function redactForRole<T extends Record<string, unknown>>(
  order: T,
  role: Role,
) {
  if (role === Role.DIRECTOR) return order;
  const result: Record<string, unknown> = { ...order };
  if (role === Role.ACCOUNTANT) {
    delete result.companyProfit;
    if (Array.isArray(result.calculations))
      result.calculations = result.calculations.map((value) => {
        const calculation = { ...(value as Record<string, unknown>) };
        delete calculation.grossDifference;
        delete calculation.grossProfit;
        return calculation;
      });
    return result;
  }
  if (role === Role.PARTNER) {
    delete result.amount;
    delete result.prepayment;
    delete result.balance;
    delete result.companyProfit;
    delete result.payments;
    delete result.partnerAssignmentHistory;
    delete result.calculations;
    delete result.payrollAccruals;
    delete result.managerUser;
    if (result.settlement && typeof result.settlement === "object") {
      const settlement = result.settlement as Record<string, unknown>;
      delete settlement.client;
      if (settlement.partner && typeof settlement.partner === "object") {
        const partner = settlement.partner as Record<string, unknown>;
        partner.payouts = Array.isArray(partner.payouts)
          ? partner.payouts.filter(
              (item) =>
                (item as Record<string, unknown>).partnerId ===
                result.partnerId,
            )
          : [];
        delete partner.assignments;
      }
    }
    return result;
  }
  delete result.companyProfit;
  if (role !== Role.MANAGER)
    for (const field of [
      "partnerPrice",
      "partnerAgreedAt",
      "partnerPaid",
      "partnerBalance",
    ] as const)
      delete result[field];
  delete result.payments;
  delete result.partnerAssignmentHistory;
  delete result.payrollAccruals;
  delete result.managerUser;
  if (Array.isArray(result.measurements))
    result.measurements = result.measurements.map((value) => {
      const measurement = { ...(value as Record<string, unknown>) };
      delete measurement.measurerUser;
      return measurement;
    });
  if (result.settlement && typeof result.settlement === "object") {
    const settlement = result.settlement as Record<string, unknown>;
    if (role !== Role.MANAGER) {
      delete settlement.partner;
      delete settlement.manager;
      delete settlement.measurer;
    } else if (settlement.partner && typeof settlement.partner === "object") {
      const partner = settlement.partner as Record<string, unknown>;
      partner.assignments = [];
      partner.history = null;
    }
  }
  if (
    role === Role.PRODUCTION ||
    role === Role.INSTALLER ||
    role === Role.MEASURER
  ) {
    delete result.amount;
    delete result.prepayment;
    delete result.balance;
    delete result.settlement;
  }
  if (Array.isArray(result.calculations)) {
    result.calculations = result.calculations.map((value) => {
      const calculation = { ...(value as Record<string, unknown>) };
      for (const field of [
        "workshopCost",
        "baseWorkshopCost",
        "workshopRate",
        "workshopAdjustment",
        "grossDifference",
        "materialCost",
        "installationCost",
        "deliveryCost",
        "otherDirectCosts",
        "totalCost",
        "grossProfit",
      ])
        delete calculation[field];
      if (Array.isArray(calculation.lines))
        calculation.lines = calculation.lines.map((value) => {
          const line = { ...(value as Record<string, unknown>) };
          delete line.unitCost;
          delete line.totalCost;
          return line;
        });
      return calculation;
    });
  }
  return result;
}

export async function GET(_: Request, { params }: Context) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const id = idOf((await params).id);
  if (!id)
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const role = auth.session!.user.role as Role;
  if (
    !(await canAccess(id, role, auth.session!.user.id, role === Role.DIRECTOR))
  )
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  const order = await prisma.order.findUnique({ where: { id }, include });
  if (!order)
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  const { _count, ...source } = order;
  return NextResponse.json(
    redactForRole(
      {
        ...source,
        deletionImpact: {
          hasFinancialHistory:
            _count.payments > 0 ||
            _count.companyLedgerEntries > 0 ||
            _count.financeAuditEvents > 0 ||
            _count.payrollAccruals > 0,
        },
        settlement: buildOrderSettlement(order),
      },
      role,
    ),
  );
}

export async function PATCH(request: Request, { params }: Context) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const id = idOf((await params).id);
  if (!id)
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const role = auth.session!.user.role as Role;
  if (!(await canAccess(id, role, auth.session!.user.id)))
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const commandOnly = [
      "lifecycle",
      "version",
      "managerUserId",
      "contractConfirmedAt",
      "controlMeasurementCompletedAt",
      "drawingApprovedAt",
      "specificationDefinedAt",
      "workshopConfirmedAt",
      "productionDeadline",
      "materialsReadyAt",
      "qaApprovedAt",
      "completenessConfirmedAt",
      "operationalAcceptedAt",
      "completedAt",
    ];
    if (commandOnly.some((field) => field in body))
      return NextResponse.json(
        { error: "Критические поля изменяются только domain-командами" },
        { status: 400 },
      );
    if (body.action === "updateDetails") {
      if (role !== Role.DIRECTOR && role !== Role.MANAGER)
        return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
      const idempotency = readIdempotencyKey(request);
      if ("response" in idempotency) return idempotency.response;
      const promisedAt = body.promisedAt
        ? new Date(String(body.promisedAt))
        : null;
      const orderReceivedAt = body.orderReceivedAt
        ? new Date(String(body.orderReceivedAt))
        : undefined;
      const amount = Number(body.amount);
      if (
        (promisedAt && Number.isNaN(promisedAt.getTime())) ||
        (orderReceivedAt && Number.isNaN(orderReceivedAt.getTime())) ||
        !Number.isFinite(amount) ||
        amount <= 0
      )
        return NextResponse.json(
          { error: "Проверьте дату и сумму заказа" },
          { status: 400 },
        );
      const payload = {
        orderId: id,
        clientName: body.clientName,
        phone: body.phone,
        whatsapp: body.whatsapp,
        city: body.city,
        clientAddress: body.clientAddress,
        iin: body.iin,
        clientComment: body.clientComment,
        orderAddress: body.orderAddress,
        mapUrl: body.mapUrl,
        staircase: body.staircase,
        material: body.material,
        frameComment: body.frameComment,
        railingType: body.railingType,
        supportType: body.supportType,
        color: body.color,
        lighting: body.lighting,
        lightingDetails: body.lightingDetails,
        cladding: body.cladding,
        claddingDetails: body.claddingDetails,
        additionalDetails: body.additionalDetails,
        paymentMethod: body.paymentMethod,
        promisedAt: promisedAt?.toISOString() ?? null,
        orderReceivedAt: orderReceivedAt?.toISOString() ?? null,
        amount: body.amount,
        reason: body.reason,
      };
      const result = await updateOrderDetails(id, {
        clientName: text(body.clientName, 300) ?? "",
        phone: text(body.phone, 100) ?? "",
        whatsapp: text(body.whatsapp, 100) ?? "",
        city: text(body.city, 200) ?? "",
        clientAddress: text(body.clientAddress, 1000) ?? "",
        iin: text(body.iin, 32) ?? "",
        clientComment: text(body.clientComment, 2000) ?? "",
        orderAddress: text(body.orderAddress, 1000) ?? "",
        mapUrl: text(body.mapUrl, 2000) ?? "",
        staircase: text(body.staircase, 500) ?? "",
        material: text(body.material, 300) ?? "",
        frameComment: text(body.frameComment, 2000) ?? "",
        railingType: text(body.railingType, 500) ?? "",
        supportType: text(body.supportType, 500) ?? "",
        color: text(body.color, 300) ?? "",
        lighting: body.lighting === true,
        lightingDetails: text(body.lightingDetails, 1000) ?? "",
        cladding: body.cladding === true,
        claddingDetails: text(body.claddingDetails, 1000) ?? "",
        additionalDetails: text(body.additionalDetails, 3000) ?? "",
        paymentMethod: text(body.paymentMethod, 100) ?? "",
        orderReceivedAt,
        promisedAt,
        amount,
        reason: text(body.reason, 1000) ?? "",
        idempotencyKey: idempotency.key,
        requestHash: createRequestHash(payload),
      }, {
        userId: Number(auth.session!.user.id),
        role,
        name: auth.session!.user.name ?? "Сотрудник",
      });
      return NextResponse.json(result, { status: 200 });
    }
    if (body.action === "commercialAdjustment") {
      if (role !== Role.DIRECTOR)
        return NextResponse.json(
          { error: "Недостаточно прав" },
          { status: 403 },
        );
      const newAmount = Number(body.newAmount),
        reason = text(body.reason, 1000);
      if (!Number.isFinite(newAmount) || newAmount < 0 || !reason)
        return NextResponse.json(
          { error: "Укажите новую сумму и причину" },
          { status: 400 },
        );
      const idempotency = readIdempotencyKey(request);
      if ("response" in idempotency) return idempotency.response;
      const payload = { orderId: id, newAmount, reason };
      const result = await adjustOrderAmount({
        ...payload,
        authorId: Number(auth.session!.user.id),
        author: auth.session!.user.name ?? "System",
        idempotencyKey: idempotency.key,
        requestHash: createRequestHash(payload),
      });
      return NextResponse.json(result, { status: result.created ? 201 : 200 });
    }
    const financial = [
      "prepayment",
      "balance",
      "partnerPaid",
      "partnerBalance",
      "partnerAgreedAt",
      "companyProfit",
    ];
    if (financial.some((key) => key in body))
      return NextResponse.json(
        {
          error:
            "Расчётные финансовые поля меняются только через финансовые операции",
        },
        { status: 400 },
      );
    if (role === Role.PARTNER) {
      const allowed = new Set([
        "status",
        "partnerPlannedReadyAt",
        "partnerComment",
        "readyForInstallation",
        "installationCompleted",
        "comment",
      ]);
      if (Object.keys(body).some((key) => !allowed.has(key)))
        return NextResponse.json(
          { error: "Цеху запрещено менять эти данные заказа" },
          { status: 403 },
        );
    }
    if (body.action === "assignPartner") {
      if (role !== Role.DIRECTOR && role !== Role.MANAGER)
        return NextResponse.json(
          { error: "Недостаточно прав" },
          { status: 403 },
        );
      const partnerId = Number(body.partnerId),
        partnerPrice = Number(body.partnerPrice);
      const partnerAgreedAt = body.partnerAgreedAt
        ? new Date(String(body.partnerAgreedAt))
        : new Date();
      const partnerReason = text(body.reason, 1000);
      if (
        !Number.isInteger(partnerId) ||
        partnerId <= 0 ||
        !Number.isFinite(partnerPrice) ||
        partnerPrice < 0 ||
        Number.isNaN(partnerAgreedAt.getTime()) ||
        !partnerReason
      )
        return NextResponse.json(
          { error: "Некорректные данные цеха" },
          { status: 400 },
        );
      const workDueAt = body.workDueAt ? new Date(String(body.workDueAt)) : null;
      const paymentDueAt = body.paymentDueAt
        ? new Date(String(body.paymentDueAt))
        : null;
      if (
        (workDueAt && Number.isNaN(workDueAt.getTime())) ||
        (paymentDueAt && Number.isNaN(paymentDueAt.getTime()))
      )
        return NextResponse.json(
          { error: "Некорректный срок" },
          { status: 400 },
        );
      const updated = await setOrderPartnerAgreement({
        orderId: id,
        partnerId,
        amount: partnerPrice,
        agreedAt: partnerAgreedAt,
        workDueAt,
        paymentDueAt,
        comment: partnerReason,
      }, {
        userId: Number(auth.session!.user.id),
        role,
        name: auth.session!.user.name ?? "Директор",
      });
      return NextResponse.json(updated);
    }

    const idempotency = readIdempotencyKey(request);
    if ("response" in idempotency) return idempotency.response;
    const status =
      typeof body.status === "string"
        ? normalizeOrderStatus(body.status)
        : null;
    const comment = text(body.comment);
    const payload = {
      id,
      status,
      comment,
      partnerPlannedReadyAt: body.partnerPlannedReadyAt ?? null,
      partnerComment: body.partnerComment ?? null,
      readyForInstallation: body.readyForInstallation,
      installationCompleted: body.installationCompleted,
    };
    const requestHash = createRequestHash(payload);
    const historyKey =
      status && idempotency.key
        ? `order-status:${id}:${idempotency.key}`
        : null;
    const commentKey =
      !status && comment && idempotency.key
        ? `order-comment:${id}:${idempotency.key}`
        : null;

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!current) return null;
      if (commentKey) {
        const existing = await tx.orderEvent.findUnique({
          where: { idempotencyKey: commentKey },
          select: { requestHash: true },
        });
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw new Error("IDEMPOTENCY_CONFLICT");
          return tx.order.findUnique({ where: { id }, include });
        }
      }
      if (historyKey) {
        const existing = await tx.orderStatusHistory.findUnique({
          where: { idempotencyKey: historyKey },
          select: { requestHash: true },
        });
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw new Error("IDEMPOTENCY_CONFLICT");
          return tx.order.findUnique({ where: { id }, include });
        }
      }
      const data: Prisma.OrderUpdateInput = {};
      if (status) {
        if (!canTransitionOrderStatus(role, current.status, status))
          throw new Error("TRANSITION_FORBIDDEN");
        data.status = status;
      } else if ("status" in body) throw new Error("INVALID_STATUS");
      if (role !== Role.PARTNER)
        for (const key of [
          "address",
          "material",
          "staircase",
          "manager",
        ] as const)
          if (typeof body[key] === "string")
            data[key] = text(body[key], 500) ?? "";
      if (role !== Role.PARTNER && "amount" in body) {
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount < 0)
          throw new Error("INVALID_AMOUNT");
        const hasFinancialHistory = await tx.payment.count({
          where: { orderId: id },
        });
        if (hasFinancialHistory)
          throw new Error("COMMERCIAL_ADJUSTMENT_REQUIRED");
        data.amount = amount;
      }
      if ("partnerPlannedReadyAt" in body)
        data.partnerPlannedReadyAt = body.partnerPlannedReadyAt
          ? new Date(String(body.partnerPlannedReadyAt))
          : null;
      if (typeof body.partnerComment === "string")
        data.partnerComment = text(body.partnerComment) ?? "";
      if (typeof body.readyForInstallation === "boolean")
        data.readyForInstallation = body.readyForInstallation;
      if (typeof body.installationCompleted === "boolean")
        data.installationCompleted = body.installationCompleted;
      await tx.order.update({ where: { id }, data });
      if (status === ORDER_STATUSES[ORDER_STATUSES.length - 1]) {
        const activeReservations = await tx.materialReservation.findMany({
          where: { orderId: id, status: "ACTIVE", quantity: { gt: 0 } },
        });
        for (const reservation of activeReservations) {
          await tx.material.update({
            where: { id: reservation.materialId },
            data: { reserved: { decrement: reservation.quantity } },
          });
          await tx.materialReservation.update({
            where: { id: reservation.id },
            data: { quantity: 0, status: "RELEASED" },
          });
          await tx.materialMovement.create({
            data: {
              materialId: reservation.materialId,
              orderId: id,
              type: "release",
              quantity: reservation.quantity,
              reserveDelta: -reservation.quantity,
              employeeId: Number(auth.session!.user.id) || null,
              comment: "Автоматическое освобождение при отмене заказа",
            },
          });
        }
      }
      if (status) {
        await tx.orderStatusHistory.create({
          data: {
            orderId: id,
            fromStatus: normalizeOrderStatus(current.status) ?? current.status,
            toStatus: status,
            changedByUserId: Number(auth.session!.user.id) || null,
            changedByName: auth.session!.user.name ?? "Система",
            changedByRole: role,
            comment,
            idempotencyKey: historyKey,
            requestHash,
          },
        });
        await tx.orderEvent.create({
          data: {
            orderId: id,
            title: "Клиентский статус изменён",
            description: `${normalizeOrderStatus(current.status) ?? current.status} → ${status}${comment ? ` · ${comment}` : ""}`,
            user: auth.session!.user.name ?? "Система",
          },
        });
      } else if (role === Role.PARTNER)
        await tx.orderEvent.create({
          data: {
            orderId: id,
            title: "Цех обновил рабочие данные",
            description:
              text(body.partnerComment) ??
              comment ??
              "Обновлены сроки или отметки готовности",
            user: auth.session!.user.name ?? "Цех",
          },
        });
      else if (comment)
        await tx.orderEvent.create({
          data: {
            orderId: id,
            title: "Добавлен комментарий",
            description: comment,
            user: auth.session!.user.name ?? "Система",
            idempotencyKey: commentKey,
            requestHash,
          },
        });
      return tx.order.findUnique({ where: { id }, include });
    });
    return updated
      ? NextResponse.json(
          redactForRole(
            { ...updated, settlement: buildOrderSettlement(updated) },
            role,
          ),
        )
      : NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  } catch (error) {
    if (error instanceof PartnerManagementError) {
      if (error.message === "FORBIDDEN")
        return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
      if (error.message === "DIRECTOR_CONFIRMATION_REQUIRED")
        return NextResponse.json(
          { error: "После первой выплаты изменение стоимости подтверждает директор" },
          { status: 409 },
        );
      const conflict = [
        "PARTNER_REASSIGNMENT_WITH_PAYMENTS",
        "PARTNER_REASSIGNMENT_WITH_PENDING_PAYOUT",
        "PARTNER_REASSIGNMENT_REASON_REQUIRED",
        "PARTNER_COST_BELOW_PAID_OR_PENDING",
      ].includes(error.message);
      return NextResponse.json(
        { error: conflict ? "Сначала урегулируйте выплаты прежнему цеху" : "Не удалось передать заказ в цех" },
        { status: conflict ? 409 : 400 },
      );
    }
    if (error instanceof OrderDetailsError) {
      if (error.message === "FORBIDDEN")
        return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
      if (error.message === "ORDER_NOT_FOUND")
        return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
      if (error.message === "IDEMPOTENCY_CONFLICT") return idempotencyConflict();
      if (error.message.startsWith("DUPLICATE_CLIENT:")) {
        const [, clientId, clientName] = error.message.split(":");
        return NextResponse.json(
          { error: `Этот телефон уже указан у клиента ${clientName} (№${clientId})` },
          { status: 409 },
        );
      }
      if (error.message.startsWith("AMOUNT_BELOW_RECEIVED:"))
        return NextResponse.json(
          { error: `Сумма заказа не может быть меньше уже полученной оплаты (${error.message.split(":")[1]} ₸)` },
          { status: 409 },
        );
      return NextResponse.json(
        { error: "Проверьте обязательные поля, телефон, сумму и основание изменения" },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT")
      return idempotencyConflict();
    if (error instanceof Error && error.message === "TRANSITION_FORBIDDEN")
      return NextResponse.json(
        { error: "Переход статуса запрещён" },
        { status: 409 },
      );
    if (
      error instanceof Error &&
      [
        "COMMERCIAL_ADJUSTMENT_REQUIRED",
        "DIRECTOR_CONFIRMATION_REQUIRED",
        "PARTNER_PRICE_BELOW_PAID",
      ].includes(error.message)
    )
      return NextResponse.json(
        {
          error:
            "Изменение требует контролируемой финансовой операции и подтверждения директора",
        },
        { status: 409 },
      );
    if (
      error instanceof Error &&
      ["INVALID_STATUS", "INVALID_AMOUNT"].includes(error.message)
    )
      return NextResponse.json(
        { error: "Некорректные данные заказа" },
        { status: 400 },
      );
    return NextResponse.json(
      { error: "Не удалось обновить заказ" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const id = idOf((await params).id);
  if (!id)
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    return NextResponse.json(
      await deleteOrderFromWork(
        {
          userId: Number(auth.session!.user.id),
          role,
          name: auth.session!.user.name ?? "Сотрудник",
        },
        id,
        typeof body.reason === "string" ? body.reason : undefined,
      ),
    );
  } catch (error) {
    if (error instanceof OrderDeletionError && error.message === "FORBIDDEN")
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    if (error instanceof OrderDeletionError && error.message === "NOT_FOUND")
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    return NextResponse.json(
      { error: "Не удалось удалить заказ из рабочего списка" },
      { status: 500 },
    );
  }
}
