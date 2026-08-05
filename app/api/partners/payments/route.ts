import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, idempotencyConflict, readIdempotencyKey } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import { payPartner } from "@/lib/services/partner.service";

export async function POST(request: Request) {
  const auth = await requirePermission("finance");
  if (auth.response) return auth.response;
  if (auth.session!.user.role === Role.PARTNER) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const orderId = Number(body.orderId); const amount = Number(body.amount);
    if (!Number.isInteger(orderId) || orderId <= 0 || !Number.isFinite(amount) || amount <= 0 || typeof body.method !== "string" || !body.method.trim()) return NextResponse.json({ error: "Invalid partner payout" }, { status: 400 });
    const requestHash = createRequestHash({ orderId, amount, method: body.method, comment: body.comment ?? null });
    const existing = await prisma.payment.findUnique({ where: { idempotencyKey: idempotency.key } });
    if (existing) return existing.requestHash === requestHash ? NextResponse.json(existing) : idempotencyConflict();
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    const payment = await payPartner({ orderId, amount, method: body.method.trim(), comment: typeof body.comment === "string" ? body.comment.trim() || undefined : undefined, author: auth.session!.user.name ?? "System", idempotencyKey: idempotency.key, requestHash });
    return payment ? NextResponse.json(payment, { status: 201 }) : NextResponse.json({ error: "Order is not linked to a partner" }, { status: 409 });
  } catch (error) {
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") return idempotencyConflict();
    if (error instanceof Error && error.message === "PARTNER_PAYMENT_EXCEEDS_BALANCE") return NextResponse.json({ error: "Partner payout exceeds the partner balance" }, { status: 409 });
    console.error("Partner payout failed", error);
    return NextResponse.json({ error: "Unable to create partner payout" }, { status: 500 });
  }
}
