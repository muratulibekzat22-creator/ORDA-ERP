import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, idempotencyConflict, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import { createPartnerPayoutForOrder, PartnerManagementError } from "@/lib/services/partner-management.service";
import { enterTenantFromSession } from "@/lib/tenant-context";

export async function POST(request: Request) {
  const auth = await requirePermission("partners");
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  if (!enterTenantFromSession(auth.session)) return NextResponse.json({ error: "Сессия завершена" }, { status: 401 });
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const orderId = Number(body.orderId); const amount = Number(body.amount);
    if (!Number.isInteger(orderId) || orderId <= 0 || !Number.isFinite(amount) || amount <= 0 || typeof body.method !== "string" || !body.method.trim()) return NextResponse.json({ error: "Некорректная выплата цеху" }, { status: 400 });
    const operationDate = typeof body.operationDate === "string" && body.operationDate ? new Date(`${body.operationDate}T12:00:00+05:00`) : new Date();
    if (Number.isNaN(operationDate.getTime())) return NextResponse.json({ error: "Некорректная дата" }, { status: 400 });
    const requestHash = createRequestHash({ orderId, amount, method: body.method, account: body.account ?? null, comment: body.comment ?? null, operationDate: operationDate.toISOString() });
    const result = await createPartnerPayoutForOrder({
      orderId,
      amount,
      method: body.method.trim(),
      account: typeof body.account === "string" ? body.account.trim() || undefined : undefined,
      comment: typeof body.comment === "string" ? body.comment.trim() || undefined : undefined,
      operationDate,
      idempotencyKey: idempotency.key,
      requestHash,
    }, {
      userId: Number(auth.session!.user.id),
      role: Role.DIRECTOR,
      name: auth.session!.user.name?.trim() || "Директор",
    });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") return idempotencyConflict();
    if (error instanceof PartnerManagementError) {
      if (["PAYOUT_EXCEEDS_PARTNER_BALANCE", "PARTNER_PAYMENT_EXCEEDS_BALANCE"].includes(error.message))
        return NextResponse.json({ error: "Выплата превышает остаток по заказу" }, { status: 409 });
      if (error.message === "ORDER_NOT_FOUND") return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Не удалось создать выплату цеху", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return NextResponse.json({ error: "Не удалось создать выплату цеху" }, { status: 500 });
  }
}
