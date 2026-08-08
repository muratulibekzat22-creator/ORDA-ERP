import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  createRequestHash,
  idempotencyConflict,
  readIdempotencyKey,
} from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import { createOrder, getOrders } from "@/lib/services/order.service";

const MAX_MONEY = 9_999_999_999.99;

function requiredText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function money(value: unknown, fallback?: number) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value === "string" && !value.trim()) return null;
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) && result >= 0 && result <= MAX_MONEY
    ? result
    : null;
}

function positiveInteger(value: unknown) {
  if (typeof value === "string" && !value.trim()) return null;
  const result = typeof value === "number" ? value : Number(value);
  return Number.isInteger(result) && result > 0 ? result : null;
}

export async function GET() {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  try {
    const partner =
      auth.session!.user.role === Role.PARTNER
        ? await prisma.partner.findUnique({
            where: { userId: Number(auth.session!.user.id) },
            select: { id: true },
          })
        : null;
    const orders = await getOrders(
      partner
        ? { partnerId: partner.id }
        : auth.session!.user.role === Role.MANAGER
          ? { OR: [{ managerUserId: Number(auth.session!.user.id) }, { managerUserId: null, manager: auth.session!.user.name ?? "" }, { leadConversion: { managerId: Number(auth.session!.user.id) } }] }
          : auth.session!.user.role === Role.PRODUCTION
            ? { productions: { some: { masterUserId: Number(auth.session!.user.id) } } }
            : auth.session!.user.role === Role.INSTALLER
              ? { installation: { installerUserId: Number(auth.session!.user.id) } }
              : auth.session!.user.role === Role.MEASURER
                ? { measurements: { some: { measurerUserId: Number(auth.session!.user.id) } } }
                : {},
    );
    if (auth.session!.user.role !== Role.DIRECTOR && auth.session!.user.role !== Role.ACCOUNTANT) {
      return NextResponse.json(orders.map((order) => {
        const result = { ...order } as Record<string, unknown>;
        for (const field of ["companyProfit", "partnerPrice", "partnerPaid", "partnerBalance"]) delete result[field];
        if (([Role.PRODUCTION, Role.INSTALLER, Role.MEASURER, Role.PARTNER] as Role[]).includes(auth.session!.user.role as Role))
          for (const field of ["amount", "prepayment", "balance"]) delete result[field];
        return result;
      }));
    }
    return NextResponse.json(orders);
  } catch {
    return NextResponse.json(
      { error: "Ошибка получения заказов" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (
      auth.session!.user.role !== Role.DIRECTOR &&
      ("partnerPrice" in body || "partnerPaid" in body)
    )
      return NextResponse.json(
        { error: "Внутренние суммы цеха доступны только директору" },
        { status: 403 },
      );
    const clientId = positiveInteger(body.clientId);
    const partnerId =
      body.partnerId == null || body.partnerId === ""
        ? null
        : positiveInteger(body.partnerId);
    const address = requiredText(body.address);
    const staircase = requiredText(body.staircase);
    const material = requiredText(body.material);
    const amount = money(body.amount);
    const prepayment = money(body.prepayment, 0);
    const partnerPrice = money(body.partnerPrice, 0);
    const partnerPaid = money(body.partnerPaid, 0);

    if (
      !clientId ||
      !address ||
      !staircase ||
      !material ||
      amount === null ||
      amount <= 0 ||
      prepayment === null ||
      partnerPrice === null ||
      partnerPaid === null ||
      (body.partnerId != null && body.partnerId !== "" && !partnerId)
    ) {
      return NextResponse.json(
        { error: "Некорректные данные заказа" },
        { status: 400 },
      );
    }
    if (prepayment > amount)
      return NextResponse.json(
        { error: "Предоплата не может превышать сумму заказа" },
        { status: 400 },
      );
    if (partnerPaid > partnerPrice)
      return NextResponse.json(
        { error: "Выплата партнеру не может превышать его стоимость" },
        { status: 400 },
      );

    const [client, partner] = await Promise.all([
      prisma.client.findUnique({
        where: { id: clientId },
        select: { id: true },
      }),
      partnerId
        ? prisma.partner.findUnique({
            where: { id: partnerId },
            select: { id: true },
          })
        : null,
    ]);
    if (!client)
      return NextResponse.json({ error: "Клиент не найден" }, { status: 404 });
    if (partnerId && !partner)
      return NextResponse.json({ error: "Партнер не найден" }, { status: 404 });

    const idempotency = readIdempotencyKey(request);
    if ("response" in idempotency) return idempotency.response;
    const payload = {
      clientId,
      partnerId,
      address,
      staircase,
      material,
      amount,
      prepayment,
      partnerPrice,
      partnerPaid,
      manager:
        requiredText(body.manager) ?? auth.session!.user.name ?? "Система",
      managerUserId: Number(auth.session!.user.id),
    };
    const result = await createOrder({
      ...payload,
      actorRole: auth.session!.user.role as Role,
      idempotencyKey: idempotency.key,
      requestHash: createRequestHash(payload),
    });
    const responseOrder = { ...result.order } as Record<string, unknown>;
    if (auth.session!.user.role !== Role.DIRECTOR && auth.session!.user.role !== Role.ACCOUNTANT)
      for (const field of ["companyProfit", "partnerPrice", "partnerPaid", "partnerBalance"]) delete responseOrder[field];
    return NextResponse.json(responseOrder, {
      status: result.created ? 201 : 200,
    });
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT")
      return idempotencyConflict();
    if (error instanceof Error && error.message === "ORDER_NUMBER_CONFLICT")
      return NextResponse.json(
        { error: "Не удалось сгенерировать уникальный номер заказа" },
        { status: 409 },
      );
    return NextResponse.json(
      { error: "Ошибка создания заказа" },
      { status: 500 },
    );
  }
}
