import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import { calculateOrder } from "@/lib/services/calculator.service";
import { createOrder, getOrders } from "@/lib/services/order.service";

function requiredText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nonNegativeNumber(value: unknown) {
  if (typeof value === "string" && !value.trim()) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function positiveInteger(value: unknown) {
  const number = nonNegativeNumber(value);
  return number !== null && Number.isInteger(number) && number > 0 ? number : null;
}

export async function GET() {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  try {
    const partner = auth.session!.user.role === Role.PARTNER
      ? await prisma.partner.findUnique({ where: { userId: Number(auth.session!.user.id) }, select: { id: true } })
      : null;
    const orders = partner
      ? await prisma.order.findMany({ where: { partnerId: partner.id }, include: { client: true, partner: true, payments: true }, orderBy: { createdAt: "desc" } })
      : await getOrders();
    return NextResponse.json(orders);
  } catch {
    return NextResponse.json({ error: "Ошибка получения заказов" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  if (auth.session!.user.role === Role.PARTNER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  try {
    const body = await req.json();
    const number = requiredText(body.number);
    const clientId = positiveInteger(body.clientId);
    const address = requiredText(body.address);
    const staircase = requiredText(body.staircase);
    const material = requiredText(body.material);
    const steps = positiveInteger(body.steps);
    const platforms = nonNegativeNumber(body.platforms);
    const partnerStepPrice = nonNegativeNumber(body.partnerStepPrice ?? 0);
    const partnerId = body.partnerId == null || body.partnerId === "" ? null : positiveInteger(body.partnerId);

    if (!number || !clientId || !address || !staircase || !material || !steps || platforms === null || !Number.isInteger(platforms) || partnerStepPrice === null || (body.partnerId != null && body.partnerId !== "" && !partnerId)) {
      return NextResponse.json({ error: "Некорректные данные заказа" }, { status: 400 });
    }

    const [client, partner] = await Promise.all([
      prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }),
      partnerId ? prisma.partner.findUnique({ where: { id: partnerId }, select: { id: true } }) : null,
    ]);
    if (!client || (partnerId && !partner)) return NextResponse.json({ error: "Клиент или партнер не найден" }, { status: 400 });

    const calc = await calculateOrder({
      material,
      steps,
      platforms,
      railing: body.railing,
      led: Boolean(body.led),
      painting: Boolean(body.painting),
      installation: Boolean(body.installation),
      partnerStepPrice,
    });
    if (![calc.clientPrice, calc.balance, calc.partnerPrice, calc.companyProfit].every(Number.isFinite)) {
      return NextResponse.json({ error: "Некорректный расчет заказа" }, { status: 400 });
    }

    const order = await createOrder({
      number,
      clientId,
      partnerId,
      address,
      staircase,
      material,
      amount: String(calc.clientPrice),
      prepayment: "0",
      balance: String(calc.balance),
      partnerPrice: String(calc.partnerPrice),
      companyProfit: String(calc.companyProfit),
      partnerPaid: "0",
      partnerBalance: String(calc.partnerPrice),
      manager: requiredText(body.manager) ?? "Менеджер",
      status: "Новая заявка",
    });

    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Заказ с таким номером уже существует" }, { status: 409 });
    }
    return NextResponse.json({ error: "Ошибка создания заказа" }, { status: 500 });
  }
}
