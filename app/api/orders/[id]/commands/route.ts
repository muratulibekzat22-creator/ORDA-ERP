import { OrderBlockerSeverity, OrderLifecycle } from "@prisma/client";
import { NextResponse } from "next/server";
import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { requireOrder360Actor } from "@/lib/order360-auth";
import {
  assignInstallation,
  completeInstallation,
  completeControlMeasurement,
  confirmMilestone,
  openBlocker,
  Order360Error,
  resolveBlocker,
  transitionLifecycle,
} from "@/lib/services/order360.service";

type Context = { params: Promise<{ id: string }> };
const failure = (error: unknown) => error instanceof Order360Error
  ? NextResponse.json({ error: error.message }, { status: error.message === "NOT_FOUND" ? 404 : error.message === "FORBIDDEN" || error.message === "TRANSITION_FORBIDDEN" ? 403 : 409 })
  : NextResponse.json({ error: "ORDER_COMMAND_FAILED" }, { status: 500 });

export async function POST(request: Request, { params }: Context) {
  const auth = await requireOrder360Actor();
  if (auth.response) return auth.response;
  const orderId = Number((await params).id);
  if (!Number.isInteger(orderId) || orderId <= 0) return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });
  const key = readIdempotencyKey(request);
  if ("response" in key) return key.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    const payload = { ...body, orderId };
    const requestHash = createRequestHash(payload);
    if (action === "transition") {
      if (!Object.values(OrderLifecycle).includes(body.to as OrderLifecycle)) return NextResponse.json({ error: "INVALID_LIFECYCLE" }, { status: 400 });
      return NextResponse.json(await transitionLifecycle({ orderId, to: body.to as OrderLifecycle, expectedVersion: Number(body.expectedVersion), reason: typeof body.reason === "string" ? body.reason : undefined, override: body.override === true, key: key.key, requestHash }, auth.actor!));
    }
    if (action === "open-blocker") {
      if (!Object.values(OrderBlockerSeverity).includes(body.severity as OrderBlockerSeverity) || !String(body.title ?? "").trim()) return NextResponse.json({ error: "INVALID_BLOCKER" }, { status: 400 });
      return NextResponse.json(await openBlocker({ orderId, type: String(body.type ?? "OTHER"), severity: body.severity as OrderBlockerSeverity, title: String(body.title), comment: typeof body.comment === "string" ? body.comment : undefined, responsibleUserId: body.responsibleUserId == null ? undefined : Number(body.responsibleUserId), dueAt: body.dueAt ? new Date(String(body.dueAt)) : undefined, key: key.key, requestHash }, auth.actor!));
    }
    if (action === "resolve-blocker") return NextResponse.json(await resolveBlocker({ blockerId: Number(body.blockerId), resolution: String(body.resolution ?? ""), key: key.key, requestHash }, auth.actor!));
    if (action === "assign-installation") return NextResponse.json(await assignInstallation({ orderId, scheduledAt: new Date(String(body.scheduledAt)), installerUserId: Number(body.installerUserId), packageConfirmed: body.packageConfirmed === true, comment: typeof body.comment === "string" ? body.comment : undefined, expectedVersion: Number(body.expectedVersion), key: key.key, requestHash }, auth.actor!));
    if (action === "complete-installation") return NextResponse.json(await completeInstallation(orderId, Number(body.expectedVersion), key.key, requestHash, auth.actor!));
    if (action === "complete-control-measurement") return NextResponse.json(await completeControlMeasurement({
      orderId,
      expectedVersion: Number(body.expectedVersion),
      completedAt: body.completedAt ? new Date(String(body.completedAt)) : new Date(),
      comment: typeof body.comment === "string" ? body.comment : undefined,
      key: key.key,
      requestHash,
    }, auth.actor!));
    return NextResponse.json(await confirmMilestone({ orderId, action, expectedVersion: Number(body.expectedVersion), value: body.value as string | number | boolean | undefined, userId: body.userId == null ? undefined : Number(body.userId), key: key.key, requestHash }, auth.actor!));
  } catch (error) { return failure(error); }
}
