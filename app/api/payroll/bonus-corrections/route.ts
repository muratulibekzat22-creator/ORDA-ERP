import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import {
  listOrderBonusesForCorrection,
  PayrollError,
  saveOrderBonusDecision,
  syncAutomaticOrderBonuses,
} from "@/lib/services/payroll.service";

const authBonusCorrection = () => requirePermission("payroll");

const actor = (session: {
  user: {
    id: string;
    role: string;
    accountRole?: string | null;
    name?: string | null;
  };
}) => ({
  userId: Number(session.user.id),
  role: (session.user.accountRole || session.user.role) as Role,
  name: session.user.name ?? "",
});

const fail = (error: unknown) =>
  error instanceof PayrollError
    ? NextResponse.json(
        { error: error.message },
        {
          status:
            error.message === "FORBIDDEN"
              ? 403
              : error.message.includes("NOT_FOUND")
                ? 404
                : 409,
        },
      )
    : NextResponse.json(
        { error: "PAYROLL_OPERATION_FAILED" },
        { status: 500 },
      );

export async function GET(request: Request) {
  const auth = await authBonusCorrection();
  if (auth.response) return auth.response;
  try {
    const params = new URL(request.url).searchParams;
    return NextResponse.json(
      await listOrderBonusesForCorrection(
        Number(params.get("year")),
        Number(params.get("month")),
        actor(auth.session!),
      ),
    );
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  const auth = await authBonusCorrection();
  if (auth.response) return auth.response;
  const key = readIdempotencyKey(request);
  if ("response" in key) return key.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    if (action === "sync")
      return NextResponse.json(
        await syncAutomaticOrderBonuses(
          Number(body.year),
          Number(body.month),
          actor(auth.session!),
        ),
      );
    if (action !== "save")
      return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
    if (
      !Object.hasOwn(body, "manualBonus") ||
      (body.manualBonus !== null &&
        (typeof body.manualBonus !== "number" ||
          !Number.isFinite(body.manualBonus)))
    )
      throw new PayrollError("INVALID_AMOUNT");
    return NextResponse.json(
      await saveOrderBonusDecision(
        {
          year: Number(body.year),
          month: Number(body.month),
          orderId: Number(body.orderId),
          employeeId: Number(body.employeeId),
          manualBonus: body.manualBonus,
          reason: String(body.reason ?? ""),
          key: key.key,
          requestHash: createRequestHash(body),
        },
        actor(auth.session!),
      ),
    );
  } catch (error) {
    return fail(error);
  }
}
