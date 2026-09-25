import { OrderLifecycle, Prisma, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  createRequestHash,
  idempotencyConflict,
  readIdempotencyKey,
} from "@/lib/idempotency";
import { productionLog } from "@/lib/observability";
import {
  LIFECYCLE_USER_STATUS,
  USER_ORDER_STATUSES,
  type UserOrderStatus,
} from "@/lib/orders/presentation";
import { PAYMENT_METHODS } from "@/lib/orders/registration";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import { countOrders, createOrder, getOrders } from "@/lib/services/order.service";

const MAX_MONEY = 9_999_999_999.99;
const paymentMethods = new Set<string>(PAYMENT_METHODS.map((item) => item.value));
const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const positiveInteger = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
const money = (value: unknown, fallback?: number) => {
  if ((value === undefined || value === "") && fallback !== undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_MONEY
    ? parsed
    : null;
};
const dateValue = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

function lifecycleWhere(status: UserOrderStatus): Prisma.OrderWhereInput {
  const values = (Object.entries(LIFECYCLE_USER_STATUS) as Array<
    [OrderLifecycle, UserOrderStatus]
  >)
    .filter(([, projected]) => projected === status)
    .map(([lifecycle]) => lifecycle);
  return { lifecycle: { in: values } };
}

export async function GET(request: Request) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  try {
    const role = auth.session!.user.role as Role;
    const userId = Number(auth.session!.user.id);
    const params = new URL(request.url).searchParams;
    const page = Number(params.get("page") ?? 1);
    const limit = Number(params.get("limit") ?? 30);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      return NextResponse.json({ error: "Некорректная пагинация" }, { status: 400 });

    const deletedOnly = params.get("deletedOnly") === "true";
    const includeDeleted = params.get("includeDeleted") === "true";
    if (role !== Role.DIRECTOR && (deletedOnly || includeDeleted))
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

    const partner = role === Role.PARTNER
      ? await prisma.partner.findUnique({ where: { userId }, select: { id: true } })
      : null;
    const roleScope: Prisma.OrderWhereInput = partner
      ? { partnerId: partner.id }
      : role === Role.MANAGER
        ? { OR: [
            { managerUserId: userId },
            { managerUserId: null, manager: auth.session!.user.name ?? "" },
            { leadConversion: { managerId: userId } },
          ] }
        : role === Role.PRODUCTION
          ? { productions: { some: { masterUserId: userId, archivedAt: null } } }
          : role === Role.INSTALLER
            ? { installation: { installerUserId: userId } }
            : role === Role.MEASURER
              ? { measurements: { some: { measurerUserId: userId } } }
              : {};
    const query = params.get("query")?.trim().slice(0, 120);
    const tab = params.get("tab") ?? (params.get("filter") === "completed" ? "completed" : "active");
    if (!["active", "completed", "all"].includes(tab))
      return NextResponse.json({ error: "Некорректная вкладка" }, { status: 400 });
    const status = params.get("status");
    if (status && !USER_ORDER_STATUSES.includes(status as UserOrderStatus))
      return NextResponse.json({ error: "Некорректный статус" }, { status: 400 });
    const now = new Date();
    const lifecycleScope: Prisma.OrderWhereInput =
      tab === "completed"
        ? { lifecycle: { in: [OrderLifecycle.COMPLETED, OrderLifecycle.CANCELLED] } }
        : tab === "active"
          ? { lifecycle: { notIn: [OrderLifecycle.COMPLETED, OrderLifecycle.CANCELLED] } }
          : {};
    const attention = params.get("attention") ?? "";
    if (attention && !["overdue", "missing-production-price"].includes(attention))
      return NextResponse.json({ error: "Некорректный фильтр" }, { status: 400 });
    const attentionScope: Prisma.OrderWhereInput = attention === "overdue"
      ? {
          lifecycle: { notIn: [OrderLifecycle.COMPLETED, OrderLifecycle.CANCELLED] },
          OR: [
            { promisedAt: { lt: now } },
            { promisedAt: null, productionDeadline: { lt: now } },
            { promisedAt: null, productionDeadline: null, installation: { scheduledAt: { lt: now } } },
          ],
        }
      : attention === "missing-production-price"
        ? {
            lifecycle: { notIn: [OrderLifecycle.COMPLETED, OrderLifecycle.CANCELLED] },
            OR: [
              { partnerAgreedAt: null },
              { partnerPrice: { lte: 0 } },
            ],
          }
        : {};
    const where: Prisma.OrderWhereInput = {
      AND: [
        roleScope,
        lifecycleScope,
        attentionScope,
        ...(status ? [lifecycleWhere(status as UserOrderStatus)] : []),
        ...(query ? [{ OR: [
          { number: { contains: query, mode: "insensitive" as const } },
          { client: { name: { contains: query, mode: "insensitive" as const } } },
          { client: { phone: { contains: query } } },
        ] }] : []),
      ],
      ...(deletedOnly
        ? { deletedAt: { not: null } }
        : includeDeleted
          ? {}
          : { deletedAt: null }),
    };
    const [orders, total] = await Promise.all([
      getOrders(where, {
        includeDeleted,
        skip: (page - 1) * limit,
        take: limit,
      }),
      countOrders(where),
    ]);

    const data = orders.map((order) => {
      if (role === Role.DIRECTOR || role === Role.ACCOUNTANT) return order;
      const safe = { ...order } as Partial<typeof order>;
      delete safe.netProfit;
      delete safe.netMargin;
      delete safe.costDataComplete;
      if (role !== Role.PARTNER) {
        delete safe.partnerPrice;
        delete safe.partnerPaid;
        delete safe.partnerBalance;
        delete safe.partnerAgreedAt;
      } else if (!order.partnerAgreedAt) {
        delete safe.partnerPrice;
        delete safe.partnerPaid;
        delete safe.partnerBalance;
      }
      if (
        role === Role.PRODUCTION ||
        role === Role.INSTALLER ||
        role === Role.MEASURER ||
        role === Role.PARTNER
      ) {
        delete safe.amount;
        delete safe.received;
        delete safe.balance;
        if (role !== Role.PARTNER) {
          delete safe.productionPrice;
          delete safe.productionPriceMissing;
        }
      }
      return safe;
    });
    return NextResponse.json({
      data,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    productionLog("error", "orders.list_failed", { error });
    return NextResponse.json({ error: "Ошибка получения заказов" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (
      role !== Role.DIRECTOR &&
      ["partnerId", "partnerPrice", "partnerPaid", "companyProfit"].some((key) => key in body)
    )
      return NextResponse.json(
        { error: "Внутренние суммы производства доступны только директору" },
        { status: 403 },
      );

    const clientId = positiveInteger(body.clientId);
    const clientName = text(body.clientName);
    const phone = text(body.phone);
    const location = text(body.location);
    const city = text(body.city) ?? location;
    const address = text(body.address) ?? location ?? "Адрес уточняется";
    const amount = money(body.amount);
    const prepayment = money(body.initialPayment ?? body.prepayment, 0);
    const managerUserId = role === Role.MANAGER
      ? Number(auth.session!.user.id)
      : positiveInteger(body.managerUserId);
    const partnerId = role === Role.DIRECTOR && body.partnerId
      ? positiveInteger(body.partnerId)
      : null;
    const partnerPrice = role === Role.DIRECTOR ? money(body.partnerPrice, 0) : 0;
    const partnerPaid = role === Role.DIRECTOR ? money(body.partnerPaid, 0) : 0;
    const orderReceivedAt = dateValue(body.orderReceivedAt) ?? new Date();
    const promisedAt = dateValue(body.readinessDate ?? body.promisedAt);
    const paymentMethod = text(body.paymentMethod) ?? "BANK_TRANSFER";
    const initialPaymentDate = dateValue(body.paymentDate) ?? new Date();

    if (
      (!clientId && (!clientName || !phone || !city)) ||
      !managerUserId ||
      amount === null ||
      amount <= 0 ||
      prepayment === null ||
      prepayment > amount ||
      partnerPrice === null ||
      partnerPaid === null ||
      partnerPaid > partnerPrice ||
      !paymentMethods.has(paymentMethod)
    )
      return NextResponse.json({ error: "Проверьте обязательные поля заказа" }, { status: 400 });

    const [manager, partner] = await Promise.all([
      prisma.user.findFirst({
        where: { id: managerUserId, active: true, role: { in: [Role.MANAGER, Role.DIRECTOR] } },
        select: { id: true, name: true },
      }),
      partnerId
        ? prisma.partner.findFirst({
            where: { id: partnerId, active: true, archived: false, isTest: false },
            select: { id: true },
          })
        : null,
    ]);
    if (!manager)
      return NextResponse.json({ error: "Ответственный не найден" }, { status: 400 });
    if (partnerId && !partner)
      return NextResponse.json({ error: "Подрядчик не найден" }, { status: 404 });

    const payload = {
      clientId: clientId ?? undefined,
      ...(!clientId
        ? { client: { name: clientName!, phone: phone!, city: city!, address } }
        : {}),
      partnerId,
      address,
      staircase: text(body.frameType ?? body.staircase) ?? "Не указано",
      material: text(body.materialOther ?? body.material) ?? "Не указано",
      mapUrl: text(body.mapUrl) ?? "",
      orderReceivedAt,
      promisedAt,
      frameComment: text(body.frameComment) ?? "",
      railingType: text(body.railingType) ?? "",
      supportType: text(body.supportType) ?? "",
      color: text(body.color) ?? "",
      lighting: body.lighting === true,
      lightingDetails: text(body.lightingDetails) ?? "",
      cladding: body.cladding === true,
      claddingDetails: text(body.claddingDetails) ?? "",
      additionalDetails: text(body.comment ?? body.additionalDetails) ?? "",
      paymentMethod,
      initialPaymentDate,
      initialPaymentComment: text(body.paymentComment) ?? "",
      amount,
      prepayment,
      partnerPrice,
      partnerPriceSet: role === Role.DIRECTOR && Boolean(partnerId) && Object.hasOwn(body, "partnerPrice"),
      partnerPaid,
      manager: manager.name,
      managerUserId: manager.id,
    };
    const idempotency = readIdempotencyKey(request);
    if ("response" in idempotency) return idempotency.response;
    const hashPayload = {
      ...payload,
      orderReceivedAt: body.orderReceivedAt ? orderReceivedAt : null,
      initialPaymentDate: body.paymentDate ? initialPaymentDate : null,
    };
    const result = await createOrder({
      ...payload,
      actorRole: role,
      enforceClientOwnership: true,
      idempotencyKey: idempotency.key,
      requestHash: createRequestHash(hashPayload),
    });
    const responseOrder = { ...result.order } as Record<string, unknown>;
    if (role !== Role.DIRECTOR)
      for (const field of ["companyProfit", "partnerPrice", "partnerAgreedAt", "partnerPaid", "partnerBalance"])
        delete responseOrder[field];
    return NextResponse.json(responseOrder, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT")
      return idempotencyConflict();
    if (error instanceof Error && error.message === "ORDER_NUMBER_CONFLICT")
      return NextResponse.json({ error: "Не удалось создать номер заказа" }, { status: 409 });
    if (error instanceof Error && error.message === "CLIENT_NOT_FOUND")
      return NextResponse.json({ error: "Клиент не найден" }, { status: 404 });
    if (
      error instanceof Error &&
      ["FORBIDDEN_CLIENT_OWNERSHIP", "CLIENT_PHONE_MISMATCH"].includes(error.message)
    )
      return NextResponse.json({ error: "Телефон уже связан с клиентом другого менеджера" }, { status: 409 });
    productionLog("error", "orders.create_failed", { error });
    return NextResponse.json({ error: "Ошибка создания заказа" }, { status: 500 });
  }
}
