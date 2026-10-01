import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, idempotencyConflict, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import { createPaymentFollowUp, listPaymentFollowUps } from "@/lib/services/payment-follow-up.service";

function actor(session: { user: { id: string; name?: string | null; role?: string; accountRole?: string } }) {
  return {
    userId: Number(session.user.id),
    name: session.user.name ?? "Пользователь",
    role: (session.user.accountRole || session.user.role) as Role,
  };
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const orderId = Number((await params).id);
  if (!Number.isInteger(orderId) || orderId <= 0)
    return NextResponse.json({ error: "Некорректный заказ" }, { status: 400 });
  try {
    return NextResponse.json({ items: await listPaymentFollowUps(orderId, actor(auth.session!)) });
  } catch (error) {
    if (error instanceof Error && error.message === "ORDER_NOT_FOUND")
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    throw error;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const orderId = Number((await params).id);
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const amount = Number(body.amount);
    const dueAt = new Date(String(body.dueAt ?? ""));
    if (!Number.isInteger(orderId) || orderId <= 0 || !Number.isFinite(amount) || amount <= 0 || Number.isNaN(dueAt.getTime()))
      return NextResponse.json({ error: "Укажите сумму и дату обещанной доплаты" }, { status: 400 });
    const requestHash = createRequestHash({ orderId, amount, dueAt: dueAt.toISOString() });
    const item = await createPaymentFollowUp({ orderId, amount, dueAt, actor: actor(auth.session!), idempotencyKey: idempotency.key, requestHash });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") return idempotencyConflict();
    if (error instanceof Error && error.message === "ORDER_NOT_FOUND")
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    if (error instanceof Error && error.message === "ORDER_MANAGER_REQUIRED")
      return NextResponse.json({ error: "Сначала назначьте ответственного менеджера" }, { status: 409 });
    if (error instanceof Error && error.message === "PAYMENT_FOLLOW_UP_EXCEEDS_BALANCE")
      return NextResponse.json({ error: "Обещанная сумма превышает остаток клиента" }, { status: 409 });
    if (error instanceof Error && error.message.startsWith("INVALID_PAYMENT_FOLLOW_UP"))
      return NextResponse.json({ error: "Проверьте сумму и дату обещанной доплаты" }, { status: 400 });
    throw error;
  }
}
