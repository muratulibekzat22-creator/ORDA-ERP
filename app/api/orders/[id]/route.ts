import {
  OrderResponsibleType,
  PayrollAccrualType,
  PayrollDirection,
  PayrollPeriodStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { NextResponse } from "next/server";

import {
  compareRequestHash,
  createRequestHash,
  idempotencyConflict,
  readIdempotencyKey,
} from "@/lib/idempotency";
import { companyYearMonth } from "@/lib/company-calendar";
import {
  canTransitionOrderStatus,
  normalizeOrderStatus,
  ORDER_STATUSES,
} from "@/lib/orders/lifecycle";
import { PAYMENT_METHODS } from "@/lib/orders/registration";
import { hasProductionPrice, isProductionPriceAmount } from "@/lib/orders/production-price";
import { partnerOnlySettlement, stripPartnerAllocation } from "@/lib/orders/settlement-redaction";
import { prisma } from "@/lib/prisma";
import {
  assignPartnerToOrder,
  setProductionPrice,
} from "@/lib/services/partner.service";
import { adjustOrderAmount } from "@/lib/services/payment.service";
import { requirePermission } from "@/lib/server-auth";
import { canAccessOrder360 } from "@/lib/services/order360.service";
import { buildOrderSettlement } from "@/lib/services/order-settlement.service";
import {
  deleteOrderFromWork,
  OrderDeletionError,
} from "@/lib/services/order-deletion.service";

type Context = { params: Promise<{ id: string }> };
const include = {
  client: true,
  partner: {
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      city: true,
      active: true,
    },
  },
  deletedBy: { select: { id: true, name: true } },
  managerUser: {
    select: {
      id: true,
      name: true,
      role: true,
      payrollProfile: { select: { id: true } },
    },
  },
  measurements: {
    include: {
      measurerUser: {
        select: {
          id: true,
          name: true,
          role: true,
          payrollProfile: { select: { id: true } },
        },
      },
    },
  },
  payments: {
    include: { partner: { select: { id: true, name: true } } },
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
const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;
const paymentMethods = new Set<string>(PAYMENT_METHODS.map((item) => item.value));
const text = (value: unknown, max = 1000) =>
  typeof value === "string" ? value.trim().slice(0, max) : null;
const dateValue = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : parsed;
};
const todayAtAlmaty = () =>
  new Date(Date.now() + ALMATY_OFFSET_MS).toISOString().slice(0, 10);
const isDirector = (role: Role) =>
  role === Role.DIRECTOR || role === Role.OPERATIONS_DIRECTOR;

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
  const result: Record<string, unknown> = {
    ...order,
    productionPrice: hasProductionPrice(order.partnerPrice, order.partnerAgreedAt) ? order.partnerPrice : null,
  };
  if (role === Role.DIRECTOR) return result;
  if (role === Role.OPERATIONS_DIRECTOR) {
    delete result.companyProfit;
    delete result.payrollAccruals;
    result.settlement = stripPartnerAllocation(result.settlement);
    if (result.settlement && typeof result.settlement === "object") {
      const settlement = result.settlement as Record<string, unknown>;
      delete settlement.manager;
      delete settlement.measurer;
    }
    if (Array.isArray(result.calculations))
      result.calculations = result.calculations.map((value) => {
        const calculation = { ...(value as Record<string, unknown>) };
        delete calculation.grossDifference;
        delete calculation.grossProfit;
        return calculation;
      });
    return result;
  }
  if (role === Role.ACCOUNTANT) {
    delete result.companyProfit;
    result.settlement = stripPartnerAllocation(result.settlement);
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
    result.settlement = partnerOnlySettlement(result.settlement, result.partnerId);
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
    delete settlement.partner;
    delete settlement.manager;
    delete settlement.measurer;
  }
  if (
    role === Role.PRODUCTION ||
    role === Role.INSTALLER ||
    role === Role.MEASURER
  ) {
    delete result.productionPrice;
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
  const role = (auth.session!.user.accountRole || auth.session!.user.role) as Role;
  if (
    !(await canAccess(id, role, auth.session!.user.id, isDirector(role)))
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
  const role = (auth.session!.user.accountRole || auth.session!.user.role) as Role;
  if (!(await canAccess(id, role, auth.session!.user.id)))
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const commandOnly = [
      "lifecycle",
      "version",
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
    if (body.action === "commercialAdjustment") {
      if (!isDirector(role) && role !== Role.MANAGER)
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
    if (body.action === "setProductionPrice") {
      if (!isDirector(role) && role !== Role.MANAGER)
        return NextResponse.json(
          { error: "Недостаточно прав" },
          { status: 403 },
        );
      const amount = Number(body.productionPrice);
      if (!isProductionPriceAmount(amount))
        return NextResponse.json(
          { error: "Укажите реальную цену производства, не менее 10 000 ₸" },
          { status: 400 },
        );
      const idempotency = readIdempotencyKey(request);
      if ("response" in idempotency) return idempotency.response;
      const payload = { orderId: id, productionPrice: amount };
      const result = await setProductionPrice({
        orderId: id,
        amount,
        actor: {
          id: Number(auth.session!.user.id),
          name: auth.session!.user.name ?? "Сотрудник",
          role,
        },
        idempotencyKey: idempotency.key,
        requestHash: createRequestHash(payload),
      });
      return NextResponse.json(
        redactForRole(result.order as unknown as Record<string, unknown>, role),
        { status: result.created ? 201 : 200 },
      );
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
    const designFields = ["designStyle", "designNotes"];
    if (
      designFields.some((key) => key in body) &&
      !(new Set<Role>([Role.DIRECTOR, Role.OPERATIONS_DIRECTOR, Role.MANAGER])).has(role)
    )
      return NextResponse.json(
        { error: "Недостаточно прав для изменения 3D-брифа" },
        { status: 403 },
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
      if (!isDirector(role) && role !== Role.MANAGER)
        return NextResponse.json(
          { error: "Недостаточно прав" },
          { status: 403 },
        );
      const partnerId = Number(body.partnerId);
      const partnerPrice =
        body.partnerPrice === undefined || body.partnerPrice === ""
          ? undefined
          : Number(body.partnerPrice);
      if (
        !Number.isInteger(partnerId) ||
        partnerId <= 0 ||
        (partnerPrice !== undefined &&
          !isProductionPriceAmount(partnerPrice))
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
        directorConfirmed:
          isDirector(role) && body.directorConfirmed === true,
      });
      return updated
        ? NextResponse.json(
            redactForRole(
              {
                ...updated,
                settlement: buildOrderSettlement(updated),
              } as unknown as Record<string, unknown>,
              role,
            ),
          )
        : NextResponse.json(
            { error: "Заказ или цех не найден" },
            { status: 404 },
          );
    }

    const changesOrderDate = Object.hasOwn(body, "orderReceivedAt");
    if (changesOrderDate && !isDirector(role) && role !== Role.MANAGER)
      return NextResponse.json(
        { error: "Фактическую дату заказа подтверждает менеджер или директор" },
        { status: 403 },
      );
    const changesResponsible =
      Object.hasOwn(body, "responsibleType") ||
      Object.hasOwn(body, "managerUserId");
    if (changesResponsible && !isDirector(role))
      return NextResponse.json(
        { error: "Ответственного меняет директор" },
        { status: 403 },
      );
    const requestedResponsibleType = changesResponsible
      ? String(body.responsibleType ?? "")
      : null;
    const requestedManagerUserId =
      changesResponsible && body.managerUserId != null
        ? Number(body.managerUserId)
        : null;
    if (
      changesResponsible &&
      requestedResponsibleType !== OrderResponsibleType.COMPANY &&
      requestedResponsibleType !== OrderResponsibleType.EMPLOYEE
    )
      return NextResponse.json(
        { error: "Укажите тип ответственного" },
        { status: 400 },
      );
    if (
      requestedResponsibleType === OrderResponsibleType.EMPLOYEE &&
      (!Number.isInteger(requestedManagerUserId) || requestedManagerUserId! <= 0)
    )
      return NextResponse.json(
        { error: "Выберите ответственного сотрудника" },
        { status: 400 },
      );
    const nextOrderDate = changesOrderDate
      ? dateValue(body.orderReceivedAt)
      : null;
    if (
      changesOrderDate &&
      (!nextOrderDate || nextOrderDate.toISOString().slice(0, 10) > todayAtAlmaty())
    )
      return NextResponse.json(
        { error: "Укажите фактическую дату заказа, не позднее сегодняшнего дня" },
        { status: 400 },
      );
    const changesPromisedAt = Object.hasOwn(body, "promisedAt");
    if (changesPromisedAt && !isDirector(role) && role !== Role.MANAGER)
      return NextResponse.json(
        { error: "Срок заказа указывает менеджер или директор" },
        { status: 403 },
      );
    const nextPromisedAt = changesPromisedAt
      ? dateValue(body.promisedAt)
      : null;
    if (!nextPromisedAt && changesPromisedAt)
      return NextResponse.json(
        { error: "Укажите обещанный срок заказа" },
        { status: 400 },
      );
    if (
      nextPromisedAt &&
      nextOrderDate &&
      nextPromisedAt.toISOString().slice(0, 10) <
        nextOrderDate.toISOString().slice(0, 10)
    )
      return NextResponse.json(
        { error: "Срок заказа не может быть раньше даты заказа" },
        { status: 400 },
      );

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
      designStyle: body.designStyle ?? null,
      designNotes: body.designNotes ?? null,
      orderReceivedAt: nextOrderDate?.toISOString() ?? null,
      promisedAt: nextPromisedAt?.toISOString() ?? null,
      responsibleType: requestedResponsibleType,
      managerUserId: requestedManagerUserId,
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
    const orderDateKey = changesOrderDate
      ? `order-date:${id}:${idempotency.key}`
      : null;
    const promisedAtKey = changesPromisedAt
      ? `order-promised-at:${id}:${idempotency.key}`
      : null;
    const responsibleKey = changesResponsible
      ? `order-responsible:${id}:${idempotency.key}`
      : null;

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({
        where: { id },
        select: {
          status: true,
          companyId: true,
          clientId: true,
          amount: true,
          prepayment: true,
          balance: true,
          partnerPrice: true,
          companyProfit: true,
          orderReceivedAt: true,
          promisedAt: true,
          manager: true,
          managerUserId: true,
          responsibleType: true,
        },
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
      if (orderDateKey) {
        const existing = await tx.orderEvent.findUnique({
          where: { idempotencyKey: orderDateKey },
          select: { requestHash: true },
        });
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw new Error("IDEMPOTENCY_CONFLICT");
          return tx.order.findUnique({ where: { id }, include });
        }
      }
      if (promisedAtKey) {
        const existing = await tx.orderEvent.findUnique({
          where: { idempotencyKey: promisedAtKey },
          select: { requestHash: true },
        });
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw new Error("IDEMPOTENCY_CONFLICT");
          return tx.order.findUnique({ where: { id }, include });
        }
      }
      if (responsibleKey) {
        const existing = await tx.orderEvent.findUnique({
          where: { idempotencyKey: responsibleKey },
          select: { requestHash: true },
        });
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw new Error("IDEMPOTENCY_CONFLICT");
          return tx.order.findUnique({ where: { id }, include });
        }
      }
      const data: Prisma.OrderUpdateInput = {};
      if (role !== Role.PARTNER && "clientName" in body) {
        const clientName = text(body.clientName, 200);
        if (!clientName) throw new Error("INVALID_CLIENT_NAME");
        await tx.client.update({
          where: { id: current.clientId },
          data: { name: clientName },
        });
      }
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
        ] as const)
          if (typeof body[key] === "string")
            data[key] = text(body[key], 500) ?? "";
      if (changesResponsible) {
        if (requestedResponsibleType === OrderResponsibleType.COMPANY) {
          data.responsibleType = OrderResponsibleType.COMPANY;
          data.manager = "Компания";
          data.managerUser = { disconnect: true };
        } else {
          const responsible = await tx.user.findFirst({
            where: {
              id: requestedManagerUserId!,
              active: true,
              role: {
                in: [Role.MANAGER, Role.DIRECTOR, Role.OPERATIONS_DIRECTOR],
              },
            },
            select: { id: true, name: true },
          });
          if (!responsible) throw new Error("RESPONSIBLE_NOT_FOUND");
          data.responsibleType = OrderResponsibleType.EMPLOYEE;
          data.manager = responsible.name;
          data.managerUser = { connect: { id: responsible.id } };
        }
      }
      if (role !== Role.PARTNER && "paymentMethod" in body) {
        const paymentMethod = text(body.paymentMethod, 40);
        if (!paymentMethod || !paymentMethods.has(paymentMethod))
          throw new Error("INVALID_PAYMENT_METHOD");
        data.paymentMethod = paymentMethod;
      }
      if (role !== Role.PARTNER && typeof body.designStyle === "string")
        data.designStyle = text(body.designStyle, 120) ?? "";
      if (role !== Role.PARTNER && typeof body.designNotes === "string")
        data.designNotes = text(body.designNotes, 2000) ?? "";
      if (role !== Role.PARTNER && changesOrderDate && nextOrderDate) {
        if (
          role === Role.MANAGER &&
          (current.responsibleType !== OrderResponsibleType.EMPLOYEE ||
            current.managerUserId !== Number(auth.session!.user.id))
        )
          throw new Error("FORBIDDEN");
        data.orderReceivedAt = nextOrderDate;
        data.orderDateNeedsReview = false;
        if (current.orderReceivedAt.getTime() !== nextOrderDate.getTime()) {
          const decisions = await tx.payrollOrderBonusDecision.findMany({
            where: { orderId: id, companyId: current.companyId },
            select: {
              id: true,
              employeeId: true,
              periodId: true,
              earnedAt: true,
              manualAmount: true,
              period: { select: { status: true, year: true, month: true } },
            },
            orderBy: { id: "asc" },
          });
          const measurementBonuses = await tx.payrollAccrual.findMany({
            where: {
              orderId: id,
              type: PayrollAccrualType.MEASUREMENT_BONUS,
              reversalOfId: null,
              reversedBy: null,
              employee: { companyId: current.companyId },
            },
            select: {
              id: true,
              employeeId: true,
              periodId: true,
              amount: true,
              period: { select: { status: true, year: true, month: true } },
            },
            orderBy: { id: "asc" },
          });
          if (decisions.length || measurementBonuses.length) {
            const targetMonth = companyYearMonth(nextOrderDate);
            const targetPeriod = await tx.payrollPeriod.upsert({
              where: {
                companyId_year_month: {
                  companyId: current.companyId,
                  year: targetMonth.year,
                  month: targetMonth.month,
                },
              },
              create: {
                companyId: current.companyId,
                year: targetMonth.year,
                month: targetMonth.month,
              },
              update: {},
              select: { id: true, status: true, year: true, month: true },
            });
            if (role === Role.MANAGER) {
              const protectedCalculation =
                await tx.payrollCalculationSnapshot.findFirst({
                  where: {
                    companyId: current.companyId,
                    employeeId: {
                      in: [
                        ...decisions.map((decision) => decision.employeeId),
                        ...measurementBonuses.map((accrual) => accrual.employeeId),
                      ],
                    },
                    periodId: {
                      in: [
                        targetPeriod.id,
                        ...decisions.map((decision) => decision.periodId),
                        ...measurementBonuses.map((accrual) => accrual.periodId),
                      ],
                    },
                  },
                  select: { id: true },
                });
              if (
                targetPeriod.status !== PayrollPeriodStatus.OPEN ||
                decisions.some(
                  (decision) =>
                    decision.period.status !== PayrollPeriodStatus.OPEN,
                ) ||
                measurementBonuses.some(
                  (accrual) =>
                    accrual.period.status !== PayrollPeriodStatus.OPEN,
                ) ||
                protectedCalculation
              )
                throw new Error("FORBIDDEN");
            }
            for (const decision of decisions) {
              await tx.payrollOrderBonusDecision.update({
                where: { id: decision.id },
                data: {
                  periodId: targetPeriod.id,
                  earnedAt: nextOrderDate,
                  updatedById: Number(auth.session!.user.id),
                },
              });
              await tx.payrollAuditEvent.create({
                data: {
                  action: "ORDER_BONUS_PERIOD_REALIGNED",
                  actorId: Number(auth.session!.user.id),
                  periodId: targetPeriod.id,
                  employeeId: decision.employeeId,
                  before: {
                    orderId: id,
                    decisionId: decision.id,
                    year: decision.period.year,
                    month: decision.period.month,
                    periodId: decision.periodId,
                    earnedAt: decision.earnedAt.toISOString(),
                    manualBonus:
                      decision.manualAmount == null
                        ? null
                        : Number(decision.manualAmount),
                  },
                  after: {
                    orderId: id,
                    decisionId: decision.id,
                    year: targetPeriod.year,
                    month: targetPeriod.month,
                    periodId: targetPeriod.id,
                    earnedAt: nextOrderDate.toISOString(),
                    manualBonus:
                      decision.manualAmount == null
                        ? null
                        : Number(decision.manualAmount),
                    requestHash,
                  },
                  reason:
                    "Фактическая дата заказа изменена; бонус перенесён в фактический расчётный период",
                  idempotencyKey: `${orderDateKey}:payroll-bonus-period:${decision.id}`,
                },
              });
            }
            for (const accrual of measurementBonuses) {
              await tx.payrollAccrual.update({
                where: { id: accrual.id },
                data: {
                  periodId: targetPeriod.id,
                  earnedPeriodId: targetPeriod.id,
                },
              });
              await tx.payrollAuditEvent.create({
                data: {
                  action: "MEASUREMENT_BONUS_PERIOD_REALIGNED",
                  actorId: Number(auth.session!.user.id),
                  periodId: targetPeriod.id,
                  employeeId: accrual.employeeId,
                  before: {
                    orderId: id,
                    accrualId: accrual.id,
                    year: accrual.period.year,
                    month: accrual.period.month,
                    periodId: accrual.periodId,
                    amount: Number(accrual.amount),
                  },
                  after: {
                    orderId: id,
                    accrualId: accrual.id,
                    year: targetPeriod.year,
                    month: targetPeriod.month,
                    periodId: targetPeriod.id,
                    earnedAt: nextOrderDate.toISOString(),
                    amount: Number(accrual.amount),
                    requestHash,
                  },
                  reason:
                    "Фактическая дата заказа изменена; бонус замерщика перенесён в фактический расчётный период",
                  idempotencyKey: `${orderDateKey}:measurement-bonus-period:${accrual.id}`,
                },
              });
            }
          }
        }
      }
      if (role !== Role.PARTNER && changesPromisedAt && nextPromisedAt) {
        const effectiveOrderDate = nextOrderDate ?? current.orderReceivedAt;
        if (
          nextPromisedAt.toISOString().slice(0, 10) <
          effectiveOrderDate.toISOString().slice(0, 10)
        )
          throw new Error("ORDER_DEADLINE_BEFORE_ORDER_DATE");
        data.promisedAt = nextPromisedAt;
      }
      if (role !== Role.PARTNER && "amount" in body) {
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount < 0)
          throw new Error("INVALID_AMOUNT");
        const nextAmount = new Prisma.Decimal(amount);
        if (!nextAmount.equals(current.amount)) {
          const reason = text(body.adjustmentReason, 1000) ||
            "Изменение суммы продажи при редактировании заказа";
          const adjustmentKey = `order-edit-amount:${id}:${idempotency.key}`;
          const adjustmentHash = createRequestHash({ orderId: id, newAmount: amount });
          const existing = await tx.commercialAdjustment.findUnique({
            where: { idempotencyKey: adjustmentKey },
            select: { requestHash: true },
          });
          if (existing && !compareRequestHash(existing.requestHash, adjustmentHash))
            throw new Error("IDEMPOTENCY_CONFLICT");
          const nextBalance = nextAmount.sub(current.prepayment);
          const nextProfit = nextAmount.sub(current.partnerPrice);
          if (!existing) {
            await tx.commercialAdjustment.create({
              data: {
                orderId: id,
                previousAmount: current.amount,
                newAmount: nextAmount,
                balanceImpact: nextAmount.sub(current.amount),
                reason,
                authorId: Number(auth.session!.user.id),
                idempotencyKey: adjustmentKey,
                requestHash: adjustmentHash,
              },
            });
            await tx.financeAuditEvent.create({
              data: {
                orderId: id,
                action: "COMMERCIAL_ADJUSTMENT",
                entityType: "Order",
                entityId: id,
                before: {
                  amount: current.amount.toString(),
                  balance: current.balance.toString(),
                  companyProfit: current.companyProfit.toString(),
                },
                after: {
                  amount: nextAmount.toString(),
                  balance: nextBalance.toString(),
                  companyProfit: nextProfit.toString(),
                },
                reason,
                authorId: Number(auth.session!.user.id),
              },
            });
            await tx.orderEvent.create({
              data: {
                orderId: id,
                title: "Коммерческая корректировка",
                description: `${current.amount.toString()} → ${nextAmount.toString()} · ${reason}`,
                user: auth.session!.user.name ?? "Сотрудник",
              },
            });
          }
          data.amount = nextAmount;
          data.balance = nextBalance;
          data.companyProfit = nextProfit;
        }
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
      const nextResponsibleManagerId =
        requestedResponsibleType === OrderResponsibleType.EMPLOYEE
          ? requestedManagerUserId
          : null;
      const responsibilityActuallyChanged =
        changesResponsible &&
        (current.responsibleType !== requestedResponsibleType ||
          current.managerUserId !== nextResponsibleManagerId);
      if (responsibilityActuallyChanged) {
        // A bonus decision belongs to the assignment that produced it. Remove
        // that binding when the current responsible changes so it cannot be
        // resurrected by later assigning the order back to the same person.
        // The immutable audit row retains the complete financial history.
        const staleDecisions = await tx.payrollOrderBonusDecision.findMany({
          where: { orderId: id },
          select: {
            id: true,
            employeeId: true,
            periodId: true,
            earnedAt: true,
            manualAmount: true,
          },
          orderBy: { id: "asc" },
        });
        for (const decision of staleDecisions) {
          await tx.payrollAuditEvent.create({
            data: {
              action: "ORDER_BONUS_DECISION_INVALIDATED",
              actorId: Number(auth.session!.user.id),
              periodId: decision.periodId,
              employeeId: decision.employeeId,
              before: {
                orderId: id,
                decisionId: decision.id,
                periodId: decision.periodId,
                earnedAt: decision.earnedAt.toISOString(),
                manualBonus:
                  decision.manualAmount == null
                    ? null
                    : Number(decision.manualAmount),
                effectiveBonus:
                  decision.manualAmount == null
                    ? 0
                    : Number(decision.manualAmount),
                responsibleType: current.responsibleType,
                managerUserId: current.managerUserId,
              },
              after: {
                orderId: id,
                decisionId: null,
                manualBonus: null,
                effectiveBonus: 0,
                responsibleType: requestedResponsibleType,
                managerUserId: nextResponsibleManagerId,
                requestHash,
              },
              reason:
                "Ответственный заказа изменён; прежнее решение по бонусу исключено из зарплаты",
              idempotencyKey: `${responsibleKey}:payroll-bonus:${decision.id}`,
            },
          });
        }
        if (staleDecisions.length)
          await tx.payrollOrderBonusDecision.deleteMany({
            where: { id: { in: staleDecisions.map((row) => row.id) } },
          });

        const staleMeasurementBonuses = requestedResponsibleType ===
          OrderResponsibleType.COMPANY
          ? await tx.payrollAccrual.findMany({
          where: {
            orderId: id,
            type: PayrollAccrualType.MEASUREMENT_BONUS,
            reversalOfId: null,
            reversedBy: null,
          },
          select: {
            id: true,
            employeeId: true,
            periodId: true,
            amount: true,
            approvedById: true,
            createdById: true,
          },
          orderBy: { id: "asc" },
        })
          : [];
        for (const original of staleMeasurementBonuses) {
          const reversalKey = `${responsibleKey}:measurement-bonus:${original.id}`;
          const reversal = await tx.payrollAccrual.create({
            data: {
              employeeId: original.employeeId,
              periodId: original.periodId,
              earnedPeriodId: original.periodId,
              type: PayrollAccrualType.BONUS_REVERSAL,
              direction: PayrollDirection.DECREASE,
              amount: original.amount,
              orderId: id,
              reason:
                "Ответственный заказа изменён; бонус замерщика исключён из зарплаты",
              approvedById: Number(auth.session!.user.id),
              createdById: Number(auth.session!.user.id),
              reversalOfId: original.id,
              idempotencyKey: reversalKey,
              requestHash,
            },
          });
          await tx.companyLedgerEntry.create({
            data: {
              type: "PAYROLL_ACCRUAL",
              category: "SALARY",
              direction: "INCOME",
              amount: reversal.amount,
              operationDate: reversal.createdAt,
              comment: reversal.reason,
              orderId: id,
              employeeId: original.employeeId,
              authorId: Number(auth.session!.user.id),
              idempotencyKey: `payroll-accrual:${reversal.id}`,
              requestHash,
              affectsProfit: false,
              payrollAccrualId: reversal.id,
            },
          });
          await tx.payrollAuditEvent.create({
            data: {
              action: "MEASUREMENT_BONUS_INVALIDATED",
              actorId: Number(auth.session!.user.id),
              periodId: original.periodId,
              employeeId: original.employeeId,
              before: {
                accrualId: original.id,
                orderId: id,
                amount: Number(original.amount),
                responsibleType: current.responsibleType,
              },
              after: {
                reversalId: reversal.id,
                responsibleType: requestedResponsibleType,
                requestHash,
              },
              reason:
                "Ответственный заказа изменён; бонус замерщика исключён из зарплаты",
              idempotencyKey: `${reversalKey}:audit`,
            },
          });
        }
      }
      await tx.order.update({ where: { id }, data });
      if (orderDateKey && nextOrderDate) {
        const format = (value: Date) =>
          new Intl.DateTimeFormat("ru-RU", {
            timeZone: "Asia/Almaty",
          }).format(value);
        await tx.orderEvent.create({
          data: {
            orderId: id,
            title: "Фактическая дата заказа подтверждена",
            description: `Подтверждено: ${format(nextOrderDate)}. Отчёты продаж обновлены; бонус менеджера будет рассчитан в фактическом месяце заказа.`,
            user: auth.session!.user.name ?? "Сотрудник",
            idempotencyKey: orderDateKey,
            requestHash,
          },
        });
      }
      if (promisedAtKey && nextPromisedAt) {
        const format = (value: Date) =>
          new Intl.DateTimeFormat("ru-RU", {
            timeZone: "Asia/Almaty",
          }).format(value);
        await tx.orderEvent.create({
          data: {
            orderId: id,
            title: "Обещанный срок заказа указан",
            description: `${current.promisedAt ? `${format(current.promisedAt)} → ` : ""}${format(nextPromisedAt)}. Контроль срока заказа обновлён.`,
            user: auth.session!.user.name ?? "Сотрудник",
            idempotencyKey: promisedAtKey,
            requestHash,
          },
        });
      }
      if (responsibleKey) {
        const nextManager =
          requestedResponsibleType === OrderResponsibleType.COMPANY
            ? "Компания"
            : await tx.user.findUnique({
                where: { id: requestedManagerUserId! },
                select: { name: true },
              });
        await tx.orderEvent.create({
          data: {
            orderId: id,
            title: "Ответственный изменён",
            description: `${current.manager || "Не назначен"} → ${typeof nextManager === "string" ? nextManager : nextManager?.name ?? "Сотрудник"}`,
            user: auth.session!.user.name ?? "Система",
            idempotencyKey: responsibleKey,
            requestHash,
          },
        });
      }
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
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT")
      return idempotencyConflict();
    if (error instanceof Error && error.message === "FORBIDDEN")
      return NextResponse.json(
        { error: "Подтверждённый или закрытый расчёт может исправлять только руководитель" },
        { status: 403 },
      );
    if (error instanceof Error && error.message === "TRANSITION_FORBIDDEN")
      return NextResponse.json(
        { error: "Переход статуса запрещён" },
        { status: 409 },
      );
    if (error instanceof Error && error.message === "RESPONSIBLE_NOT_FOUND")
      return NextResponse.json(
        { error: "Ответственный сотрудник не найден" },
        { status: 400 },
      );
    if (
      error instanceof Error &&
      error.message === "ORDER_DEADLINE_BEFORE_ORDER_DATE"
    )
      return NextResponse.json(
        { error: "Срок заказа не может быть раньше даты заказа" },
        { status: 400 },
      );
    if (
      error instanceof Error &&
      [
        "COMMERCIAL_ADJUSTMENT_REQUIRED",
        "DIRECTOR_CONFIRMATION_REQUIRED",
        "PARTNER_PRICE_BELOW_PAID",
        "PARTNER_PRICE_REQUIRED",
        "PRODUCTION_PRICE_BELOW_PAID",
      ].includes(error.message)
    )
      return NextResponse.json(
        {
          error:
            error.message === "PRODUCTION_PRICE_BELOW_PAID"
              ? "Цена производства не может быть меньше уже выплаченной суммы цеху"
              : error.message === "PARTNER_PRICE_REQUIRED"
                ? "Сначала укажите цену производства для цеха с выплатами"
              : "Изменение требует контролируемой финансовой операции и подтверждения директора",
        },
        { status: 409 },
      );
    if (
      error instanceof Error &&
      ["INVALID_STATUS", "INVALID_AMOUNT", "INVALID_CLIENT_NAME", "INVALID_PAYMENT_METHOD"].includes(error.message)
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
  const role = (auth.session!.user.accountRole || auth.session!.user.role) as Role;
  if (!isDirector(role) && role !== Role.MANAGER)
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
