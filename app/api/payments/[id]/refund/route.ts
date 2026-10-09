import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import { createPaymentRefund } from "@/lib/services/refund.service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("finance");
  if (auth.response) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const amount = Number(body.amount);
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
    const parts = Array.isArray(body.parts) ? body.parts.map((raw) => {
      const part = raw as Record<string, unknown>;
      return { method: String(part.method ?? ""), amount: Number(part.amount), reference: typeof part.reference === "string" ? part.reference.slice(0, 160) : undefined };
    }) : [];
    const payload = { originalPaymentId: id, amount, parts, reason };
    const result = await createPaymentRefund({ ...payload, key: idempotency.key, requestHash: createRequestHash(payload), actor: { userId: Number(auth.session!.user.id), role: auth.session!.user.role as Role, name: auth.session!.user.name ?? "Сотрудник ORDA" } });
    return NextResponse.json({ paymentId: result.payment.id, document: result.document, pdfStatus: result.pdfStatus }, { status: result.created ? 201 : 200 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "FORBIDDEN") return NextResponse.json({ error: "Возврат денег может оформить только директор или основатель" }, { status: 403 });
    if (code === "PAYMENT_NOT_FOUND") return NextResponse.json({ error: "Исходная оплата не найдена" }, { status: 404 });
    if (code === "REFUND_EXCEEDS_PAID") return NextResponse.json({ error: "Сумма возврата превышает доступную сумму оплаты" }, { status: 409 });
    if (["INVALID_REFUND", "REFUND_PARTS_MISMATCH", "REFUND_REASON_REQUIRED"].includes(code)) return NextResponse.json({ error: code === "REFUND_PARTS_MISMATCH" ? "Сумма частей не совпадает с возвратом" : "Проверьте сумму и причину возврата" }, { status: 400 });
    if (code === "IDEMPOTENCY_CONFLICT") return NextResponse.json({ error: "Ключ повтора уже использован для другой операции" }, { status: 409 });
    return NextResponse.json({ error: "Не удалось оформить возврат" }, { status: 500 });
  }
}
