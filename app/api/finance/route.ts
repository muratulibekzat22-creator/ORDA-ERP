import { NextResponse } from "next/server";
import { Role } from "@prisma/client";

import { createRequestHash, idempotencyConflict, readIdempotencyKey } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { logRequestFailure } from "@/lib/observability";
import { requirePermission } from "@/lib/server-auth";
import { createFinanceOperation, financeOperationTypes, getFinanceDashboard, type AdjustmentDirection, type FinanceOperationType } from "@/lib/services/payment.service";

const methods = ["cash", "kaspi", "bank_transfer", "card", "other"] as const;
const maxAmount = 9_999_999_999.99;

function positiveInteger(value: unknown) {
  if (typeof value === "string" && !value.trim()) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function positiveMoney(value: unknown) {
  if (typeof value === "string" && !value.trim()) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 && number <= maxAmount ? number : null;
}

function optionalText(value: unknown) {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 2000) : null;
}

function optionalDate(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function operationError(error: unknown) {
  if (!(error instanceof Error)) return null;
  const messages: Record<string, [string, number]> = {
    IDEMPOTENCY_CONFLICT: ["Idempotency-Key already belongs to a different request", 409],
    ORDER_REQUIRED: ["An order is required for this operation", 400],
    ORDER_PARTNER_REQUIRED: ["The order is not linked to the selected partner", 409],
    PARTNER_NOT_FOUND: ["Partner not found", 404],
    PAYMENT_EXCEEDS_BALANCE: ["Payment exceeds the order balance", 409],
    REFUND_EXCEEDS_PAID: ["Refund exceeds paid amount", 409],
    PARTNER_PAYMENT_EXCEEDS_BALANCE: ["Partner payout exceeds the partner balance", 409],
  };
  return messages[error.message] ?? null;
}

export async function GET(request: Request) {
  const auth = await requirePermission("finance");
  if (auth.response) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    const requestedPartnerId = positiveInteger(searchParams.get("partnerId"));
    const ownPartner = auth.session!.user.role === Role.PARTNER
      ? await prisma.partner.findUnique({ where: { userId: Number(auth.session!.user.id) }, select: { id: true } })
      : null;
    if (auth.session!.user.role === Role.PARTNER && !ownPartner) return NextResponse.json({ error: "Partner profile not found" }, { status: 403 });
    if (ownPartner && requestedPartnerId && requestedPartnerId !== ownPartner.id) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    const from = optionalDate(searchParams.get("from"));
    const to = optionalDate(searchParams.get("to"));
    if (from === null || to === null) return NextResponse.json({ error: "Invalid date filter" }, { status: 400 });
    const data = await getFinanceDashboard({
      period: (searchParams.get("period") ?? "all") as "all" | "month" | "quarter" | "year",
      manager: searchParams.get("manager") || undefined,
      partnerId: ownPartner?.id ?? requestedPartnerId ?? undefined,
      paymentStatus: (searchParams.get("paymentStatus") ?? "all") as "all" | "debt" | "partial" | "paid",
      type: searchParams.get("type") || undefined,
      orderId: positiveInteger(searchParams.get("orderId")) ?? undefined,
      from: from ?? undefined,
      to: to ?? undefined,
    });
    return NextResponse.json(data);
  } catch (error) {
    logRequestFailure("finance.read_failed", request, error);
    return NextResponse.json({ error: "Unable to load finance data" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission("finance");
  if (auth.response) return auth.response;
  if (auth.session!.user.role === Role.PARTNER) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const type = typeof body.type === "string" && financeOperationTypes.includes(body.type as FinanceOperationType) ? body.type as FinanceOperationType : null;
    const amount = positiveMoney(body.amount);
    const method = typeof body.method === "string" && methods.includes(body.method as typeof methods[number]) ? body.method : null;
    const orderId = body.orderId == null || body.orderId === "" ? undefined : positiveInteger(body.orderId);
    const partnerId = body.partnerId == null || body.partnerId === "" ? undefined : positiveInteger(body.partnerId);
    const comment = optionalText(body.comment);
    const operationDate = optionalDate(body.operationDate);
    const adjustmentDirection = body.adjustmentDirection === "INCOME" || body.adjustmentDirection === "EXPENSE" ? body.adjustmentDirection as AdjustmentDirection : undefined;
    if (!type || amount === null || !method || comment === null || operationDate === null || (body.orderId != null && body.orderId !== "" && !orderId) || (body.partnerId != null && body.partnerId !== "" && !partnerId)) return NextResponse.json({ error: "Invalid finance operation" }, { status: 400 });
    if ((type === "CLIENT_PAYMENT" || type === "REFUND" || type === "PARTNER_PAYOUT") && !orderId) return NextResponse.json({ error: "An order is required for this operation" }, { status: 400 });
    if (type === "ADJUSTMENT" && !adjustmentDirection) return NextResponse.json({ error: "Adjustment direction is required" }, { status: 400 });
    const payload = { type, amount, method, orderId: orderId ?? null, partnerId: partnerId ?? null, comment: comment ?? null, operationDate: operationDate?.toISOString() ?? null, adjustmentDirection: adjustmentDirection ?? null };
    const result = await createFinanceOperation({ ...payload, orderId: orderId ?? undefined, partnerId: partnerId ?? undefined, comment: type === "ADJUSTMENT" ? `[${adjustmentDirection}]${comment ? ` ${comment}` : ""}` : comment, operationDate: operationDate ?? undefined, adjustmentDirection: adjustmentDirection ?? undefined, author: auth.session!.user.name ?? "System", idempotencyKey: idempotency.key, requestHash: createRequestHash(payload) });
    if (!result) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    const mapped = operationError(error);
    if (mapped) return mapped[0].includes("Idempotency") ? idempotencyConflict() : NextResponse.json({ error: mapped[0] }, { status: mapped[1] });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    logRequestFailure("finance.mutation_failed", request, error);
    return NextResponse.json({ error: "Unable to create finance operation" }, { status: 500 });
  }
}
