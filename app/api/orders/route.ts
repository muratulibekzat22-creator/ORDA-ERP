import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, idempotencyConflict, readIdempotencyKey } from "@/lib/idempotency";
import { PAYMENT_METHODS } from "@/lib/orders/registration";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import { createOrder, getOrders } from "@/lib/services/order.service";

const MAX_MONEY = 9_999_999_999.99;
const paymentMethods = new Set<string>(PAYMENT_METHODS.map((item) => item.value));

const requiredText = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const positiveInteger = (value: unknown) => {
  if (typeof value === "string" && !value.trim()) return null;
  const result = typeof value === "number" ? value : Number(value);
  return Number.isInteger(result) && result > 0 ? result : null;
};
const money = (value: unknown, fallback?: number) => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value === "string" && !value.trim()) return null;
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) && result >= 0 && result <= MAX_MONEY ? result : null;
};
const dateValue = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const result = new Date(value);
  return Number.isNaN(result.getTime()) ? null : result;
};
const optionalUrl = (value: unknown) => {
  const result = requiredText(value);
  if (!result) return "";
  try {
    const parsed = new URL(result);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? result : null;
  } catch {
    return null;
  }
};

export async function GET() {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  try {
    const role = auth.session!.user.role as Role;
    const userId = Number(auth.session!.user.id);
    const partner = role === Role.PARTNER
      ? await prisma.partner.findUnique({ where: { userId }, select: { id: true } })
      : null;
    const orders = await getOrders(
      partner
        ? { partnerId: partner.id }
        : role === Role.MANAGER
          ? { OR: [{ managerUserId: userId }, { managerUserId: null, manager: auth.session!.user.name ?? "" }, { leadConversion: { managerId: userId } }] }
          : role === Role.PRODUCTION
            ? { productions: { some: { masterUserId: userId } } }
            : role === Role.INSTALLER
              ? { installation: { installerUserId: userId } }
              : role === Role.MEASURER
                ? { measurements: { some: { measurerUserId: userId } } }
                : {},
    );
    if (role !== Role.DIRECTOR && role !== Role.ACCOUNTANT) {
      return NextResponse.json(orders.map((order) => {
        const result = { ...order } as Record<string, unknown>;
        delete result.companyProfit;
        if (role !== Role.PARTNER) for (const field of ["partnerPrice", "partnerPaid", "partnerBalance"]) delete result[field];
        if (([Role.PRODUCTION, Role.INSTALLER, Role.MEASURER, Role.PARTNER] as Role[]).includes(role))
          for (const field of ["amount", "prepayment", "balance"]) delete result[field];
        return result;
      }));
    }
    return NextResponse.json(orders);
  } catch {
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
    const body = await request.json() as Record<string, unknown>;
    if (role !== Role.DIRECTOR && ("partnerId" in body || "partnerPrice" in body || "partnerPaid" in body || "companyProfit" in body))
      return NextResponse.json({ error: "Внутренние суммы цеха доступны только директору" }, { status: 403 });

    const enhanced = role === Role.MANAGER || "phone" in body || "orderReceivedAt" in body || "frameType" in body;
    const clientId = positiveInteger(body.clientId);
    const phone = requiredText(body.phone);
    const city = requiredText(body.city);
    const address = requiredText(body.address) ?? (enhanced ? "Адрес уточняется" : null);
    const staircase = requiredText(body.frameType) ?? requiredText(body.staircase);
    const selectedMaterial = requiredText(body.material);
    const material = selectedMaterial === "Другое" ? requiredText(body.materialOther) : selectedMaterial;
    const amount = money(body.amount);
    const prepayment = money(body.initialPayment ?? body.prepayment, 0);
    const partnerId = role === Role.DIRECTOR && body.partnerId != null && body.partnerId !== "" ? positiveInteger(body.partnerId) : null;
    const partnerPrice = role === Role.DIRECTOR ? money(body.partnerPrice, 0) : 0;
    const partnerPaid = role === Role.DIRECTOR ? money(body.partnerPaid, 0) : 0;
    const orderReceivedAt = dateValue(body.orderReceivedAt) ?? (!enhanced ? new Date() : null);
    const readinessDate = dateValue(body.readinessDate);
    const calendarDays = body.calendarDays == null || body.calendarDays === "" ? null : Number(body.calendarDays);
    const mapUrl = optionalUrl(body.mapUrl);
    const paymentMethod = requiredText(body.paymentMethod) ?? (enhanced ? null : "initial_order_posting");
    const initialPaymentDate = body.paymentDate == null || body.paymentDate === "" ? undefined : dateValue(body.paymentDate) ?? null;
    const managerUserId = role === Role.MANAGER
      ? Number(auth.session!.user.id)
      : positiveInteger(body.managerUserId) ?? (!enhanced ? Number(auth.session!.user.id) : null);

    if (
      (!enhanced && !clientId) ||
      (enhanced && (!phone || !city || !orderReceivedAt || !managerUserId)) ||
      !address || !staircase || !material || amount === null || amount <= 0 || prepayment === null ||
      partnerPrice === null || partnerPaid === null || mapUrl === null || !paymentMethod ||
      (enhanced && !paymentMethods.has(paymentMethod)) || initialPaymentDate === null ||
      (calendarDays !== null && (!Number.isInteger(calendarDays) || calendarDays < 0 || calendarDays > 3650)) ||
      (role === Role.DIRECTOR && body.partnerId != null && body.partnerId !== "" && !partnerId)
    ) return NextResponse.json({ error: "Проверьте обязательные поля заказа" }, { status: 400 });
    if (prepayment > amount)
      return NextResponse.json({ error: "Полученная сумма не может превышать сумму заказа" }, { status: 400 });
    if (partnerPaid > partnerPrice)
      return NextResponse.json({ error: "Выплата партнёру не может превышать его стоимость" }, { status: 400 });

    const [managerUser, partner] = await Promise.all([
      managerUserId ? prisma.user.findFirst({
        where: { id: managerUserId, active: true, role: enhanced ? Role.MANAGER : { in: [Role.MANAGER, Role.DIRECTOR] } },
        select: { id: true, name: true },
      }) : null,
      partnerId ? prisma.partner.findUnique({ where: { id: partnerId }, select: { id: true } }) : null,
    ]);
    if (!managerUser) return NextResponse.json({ error: "Ответственный менеджер не найден" }, { status: 400 });
    if (partnerId && !partner) return NextResponse.json({ error: "Партнёр не найден" }, { status: 404 });

    const promisedAt = readinessDate ?? (calendarDays !== null && orderReceivedAt
      ? new Date(orderReceivedAt.getTime() + calendarDays * 86_400_000)
      : null);
    const payload = {
      clientId: clientId ?? undefined,
      ...(enhanced ? { client: { name: requiredText(body.clientName) ?? "", phone: phone!, city: city!, address: requiredText(body.address) ?? "" } } : {}),
      partnerId,
      address,
      staircase,
      material,
      mapUrl,
      orderReceivedAt: orderReceivedAt!,
      promisedAt,
      frameComment: requiredText(body.frameComment) ?? "",
      railingType: requiredText(body.railingType) ?? "",
      supportType: requiredText(body.supportType) ?? "",
      color: requiredText(body.color) ?? "",
      lighting: body.lighting === true,
      lightingDetails: requiredText(body.lightingDetails) ?? "",
      cladding: body.cladding === true,
      claddingDetails: requiredText(body.claddingDetails) ?? "",
      additionalDetails: requiredText(body.additionalDetails) ?? "",
      paymentMethod,
      initialPaymentDate: initialPaymentDate ?? undefined,
      initialPaymentComment: requiredText(body.paymentComment) ?? "",
      amount,
      prepayment,
      partnerPrice,
      partnerPaid,
      manager: managerUser.name,
      managerUserId: managerUser.id,
    };
    const idempotency = readIdempotencyKey(request);
    if ("response" in idempotency) return idempotency.response;
    const result = await createOrder({
      ...payload,
      actorRole: role,
      enforceClientOwnership: enhanced,
      idempotencyKey: idempotency.key,
      requestHash: createRequestHash(payload),
    });
    const responseOrder = { ...result.order } as Record<string, unknown>;
    if (role !== Role.DIRECTOR)
      for (const field of ["companyProfit", "partnerPrice", "partnerPaid", "partnerBalance"]) delete responseOrder[field];
    return NextResponse.json(responseOrder, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") return idempotencyConflict();
    if (error instanceof Error && error.message === "ORDER_NUMBER_CONFLICT")
      return NextResponse.json({ error: "Не удалось сгенерировать уникальный номер заказа" }, { status: 409 });
    if (error instanceof Error && error.message === "CLIENT_NOT_FOUND")
      return NextResponse.json({ error: "Клиент не найден" }, { status: 404 });
    if (error instanceof Error && ["FORBIDDEN_CLIENT_OWNERSHIP", "CLIENT_PHONE_MISMATCH"].includes(error.message))
      return NextResponse.json({ error: "Этот телефон уже связан с клиентом другого менеджера", code: error.message }, { status: 409 });
    if (error instanceof Error && ["INVALID_CLIENT_PHONE", "CLIENT_REQUIRED", "MANAGER_REQUIRED"].includes(error.message))
      return NextResponse.json({ error: "Некорректные данные клиента или менеджера" }, { status: 400 });
    return NextResponse.json({ error: "Ошибка создания заказа" }, { status: 500 });
  }
}
