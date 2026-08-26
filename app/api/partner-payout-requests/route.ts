import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  createRequestHash,
  idempotencyConflict,
  readIdempotencyKey,
} from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import {
  getPendingPartnerPayoutRequests,
  PartnerManagementError,
  reviewPartnerPayoutRequest,
} from "@/lib/services/partner-management.service";

export async function GET() {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  return NextResponse.json(await getPendingPartnerPayoutRequests());
}

export async function PATCH(request: Request) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const operationId = Number(body.operationId);
    const decision: "CONFIRM" | "REJECT" | null = body.decision === "CONFIRM" ? "CONFIRM" : body.decision === "REJECT" ? "REJECT" : null;
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 2000) : "";
    if (!Number.isInteger(operationId) || !decision)
      return NextResponse.json({ error: "Некорректное решение" }, { status: 400 });
    const payload = { operationId, decision, reason };
    const result = await reviewPartnerPayoutRequest({
      ...payload,
      idempotencyKey: idempotency.key,
      requestHash: createRequestHash(payload),
    }, {
      userId: Number(auth.session!.user.id),
      role: Role.DIRECTOR,
      name: auth.session!.user.name ?? "Директор",
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PartnerManagementError) {
      if (error.message === "IDEMPOTENCY_CONFLICT") return idempotencyConflict();
      if (error.message === "FORBIDDEN")
        return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
      if (error.message === "REJECTION_REASON_REQUIRED")
        return NextResponse.json({ error: "Укажите причину отклонения" }, { status: 400 });
      if (["PAYOUT_REQUEST_NOT_FOUND", "PAYOUT_REQUEST_ALREADY_REVIEWED"].includes(error.message))
        return NextResponse.json({ error: "Заявка уже обработана или не найдена" }, { status: 409 });
    }
    return NextResponse.json({ error: "Не удалось обработать заявку" }, { status: 500 });
  }
}
