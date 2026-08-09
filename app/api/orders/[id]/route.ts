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
import { assignPartnerToOrder } from "@/lib/services/partner.service";
import { adjustOrderAmount } from "@/lib/services/payment.service";
import { requirePermission } from "@/lib/server-auth";
import { canAccessOrder360 } from "@/lib/services/order360.service";
import { buildOrderSettlement } from "@/lib/services/order-settlement.service";

type Context = { params: Promise<{ id: string }> };
const include = {
  client: true,
  partner: true,
  measurements: true,
  payments: { include: { partner: true }, orderBy: [{ operationDate: "desc" as const }, { id: "desc" as const }] },
  partnerAssignmentHistory: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "desc" as const } },
  productions: true,
  documents: true,
  calculations: { orderBy: { createdAt: "desc" as const } },
  statusHistory: { orderBy: { createdAt: "desc" as const } },
  events: { orderBy: { createdAt: "desc" as const } },
} satisfies Prisma.OrderInclude;
const idOf = (value: string) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const text = (value: unknown, max = 1000) =>
  typeof value === "string" ? value.trim().slice(0, max) : null;

async function canAccess(id: number, role: Role, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: Number(userId) }, select: { name: true } });
  return !!user && canAccessOrder360(id, { userId: Number(userId), role, name: user.name });
}

function redactForRole<T extends Record<string, unknown>>(
  order: T,
  role: Role,
) {
  if (role === Role.DIRECTOR) return order;
  const result: Record<string, unknown> = { ...order };
  if (role === Role.ACCOUNTANT) {
    delete result.companyProfit;
    if (Array.isArray(result.calculations)) result.calculations = result.calculations.map((value) => {
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
    if (result.settlement && typeof result.settlement === "object") {
      const settlement = result.settlement as Record<string, unknown>;
      delete settlement.client;
      if (settlement.partner && typeof settlement.partner === "object") {
        const partner = settlement.partner as Record<string, unknown>;
        partner.payouts = Array.isArray(partner.payouts) ? partner.payouts.filter((item) => (item as Record<string, unknown>).partnerId === result.partnerId) : [];
        delete partner.assignments;
      }
    }
    return result;
  }
  for (const field of [
    "companyProfit",
    "partnerPrice",
    "partnerAgreedAt",
    "partnerPaid",
    "partnerBalance",
  ] as const)
    delete result[field];
  delete result.payments;
  delete result.partnerAssignmentHistory;
  if (result.settlement && typeof result.settlement === "object") delete (result.settlement as Record<string, unknown>).partner;
  if (role === Role.PRODUCTION || role === Role.INSTALLER || role === Role.MEASURER) {
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
  if (!(await canAccess(id, role, auth.session!.user.id)))
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  const order = await prisma.order.findUnique({ where: { id }, include });
  return order
    ? NextResponse.json(redactForRole({ ...order, settlement: buildOrderSettlement(order) }, role))
    : NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
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
    const commandOnly = ["lifecycle", "version", "managerUserId", "contractConfirmedAt", "controlMeasurementCompletedAt", "drawingApprovedAt", "specificationDefinedAt", "workshopConfirmedAt", "productionDeadline", "materialsReadyAt", "qaApprovedAt", "completenessConfirmedAt", "operationalAcceptedAt", "completedAt"];
    if (commandOnly.some((field) => field in body)) return NextResponse.json({ error: "Критические поля изменяются только domain-командами" }, { status: 400 });
    if (body.action === "commercialAdjustment") {
      if (role !== Role.DIRECTOR) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
      const newAmount = Number(body.newAmount), reason = text(body.reason, 1000);
      if (!Number.isFinite(newAmount) || newAmount < 0 || !reason) return NextResponse.json({ error: "Укажите новую сумму и причину" }, { status: 400 });
      const idempotency = readIdempotencyKey(request); if ("response" in idempotency) return idempotency.response;
      const payload = { orderId: id, newAmount, reason };
      const result = await adjustOrderAmount({ ...payload, authorId: Number(auth.session!.user.id), author: auth.session!.user.name ?? "System", idempotencyKey: idempotency.key, requestHash: createRequestHash(payload) });
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
      if (role !== Role.DIRECTOR)
        return NextResponse.json(
          { error: "Недостаточно прав" },
          { status: 403 },
        );
      const partnerId = Number(body.partnerId),
        partnerPrice = Number(body.partnerPrice);
      if (
        !Number.isInteger(partnerId) ||
        partnerId <= 0 ||
        !Number.isFinite(partnerPrice) ||
        partnerPrice < 0
      )
        return NextResponse.json(
          { error: "Некорректные данные цеха" },
          { status: 400 },
        );
      const updated = await assignPartnerToOrder({
        orderId: id,
        partnerId,
        partnerPrice,
        manager: auth.session!.user.name ?? undefined,
        authorId: Number(auth.session!.user.id),
        reason: text(body.reason, 1000) ?? "Назначение производственного партнёра",
        directorConfirmed: role === Role.DIRECTOR && body.directorConfirmed === true,
      });
      return updated
        ? NextResponse.json(
            redactForRole({ ...updated, settlement: buildOrderSettlement(updated) } as unknown as Record<string, unknown>, role),
          )
        : NextResponse.json(
            { error: "Заказ или цех не найден" },
            { status: 404 },
          );
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
        const hasFinancialHistory = await tx.payment.count({ where: { orderId: id } });
        if (hasFinancialHistory) throw new Error("COMMERCIAL_ADJUSTMENT_REQUIRED");
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
        const activeReservations = await tx.materialReservation.findMany({ where: { orderId: id, status: "ACTIVE", quantity: { gt: 0 } } });
        for (const reservation of activeReservations) {
          await tx.material.update({ where: { id: reservation.materialId }, data: { reserved: { decrement: reservation.quantity } } });
          await tx.materialReservation.update({ where: { id: reservation.id }, data: { quantity: 0, status: "RELEASED" } });
          await tx.materialMovement.create({ data: { materialId: reservation.materialId, orderId: id, type: "release", quantity: reservation.quantity, reserveDelta: -reservation.quantity, employeeId: Number(auth.session!.user.id) || null, comment: "Автоматическое освобождение при отмене заказа" } });
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
      ? NextResponse.json(redactForRole({ ...updated, settlement: buildOrderSettlement(updated) }, role))
      : NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  } catch (error) {
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT")
      return idempotencyConflict();
    if (error instanceof Error && error.message === "TRANSITION_FORBIDDEN")
      return NextResponse.json(
        { error: "Переход статуса запрещён" },
        { status: 409 },
      );
    if (error instanceof Error && ["COMMERCIAL_ADJUSTMENT_REQUIRED", "DIRECTOR_CONFIRMATION_REQUIRED", "PARTNER_PRICE_BELOW_PAID"].includes(error.message))
      return NextResponse.json({ error: "Изменение требует контролируемой финансовой операции и подтверждения директора" }, { status: 409 });
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

export async function DELETE(_: Request, { params }: Context) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  if ((auth.session!.user.role as Role) !== Role.DIRECTOR)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const id = idOf((await params).id);
  if (!id)
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const protectedOrder = await prisma.order.findUnique({ where: { id }, select: { _count: { select: { payments: true, calculations: true, events: true, materialMovements: true, materialReservations: true, productions: true, statusHistory: true, documents: true } } } });
  if (!protectedOrder) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  if (Object.values(protectedOrder._count).some((count) => count > 0)) return NextResponse.json({ error: "Финансово или операционно проведённый заказ нельзя удалить; используйте отмену или архив" }, { status: 409 });
  const deleted = await prisma.order.delete({ where: { id } }).catch(() => null);
  return deleted
    ? NextResponse.json(deleted)
    : NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
}
