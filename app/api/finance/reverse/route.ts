import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, idempotencyConflict, readIdempotencyKey } from "@/lib/idempotency";
import { reverseFinanceOperation } from "@/lib/services/payment.service";
import { requirePermission } from "@/lib/server-auth";

export async function POST(request: Request) {
  const auth = await requirePermission("finance");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.ACCOUNTANT) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const idempotency = readIdempotencyKey(request); if ("response" in idempotency) return idempotency.response;
  try {
    const body = await request.json() as Record<string, unknown>, paymentId = Number(body.paymentId), reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
    if (!Number.isInteger(paymentId) || paymentId <= 0 || !reason) return NextResponse.json({ error: "Укажите операцию и причину" }, { status: 400 });
    const requestHash = createRequestHash({ paymentId, reason });
    return NextResponse.json(await reverseFinanceOperation({ paymentId, reason, authorId: Number(auth.session!.user.id), author: auth.session!.user.name ?? "System", idempotencyKey: idempotency.key, requestHash }), { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") return idempotencyConflict();
    if (error instanceof Error && ["ALREADY_REVERSED", "OPERATION_NOT_FOUND"].includes(error.message)) return NextResponse.json({ error: "Операция не найдена или уже сторнирована" }, { status: 409 });
    return NextResponse.json({ error: "Не удалось сторнировать операцию" }, { status: 500 });
  }
}
