import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import {
  correctOrderBonus,
  listOrderBonusesForCorrection,
  PayrollError,
  syncAutomaticOrderBonuses,
} from "@/lib/services/payroll.service";
import { enterTenantFromSession } from "@/lib/tenant-context";

async function authBonusCorrection() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !enterTenantFromSession(session))
    return {
      response: NextResponse.json(
        { error: "Требуется авторизация" },
        { status: 401 },
      ),
    };
  return { session };
}

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
    if (action !== "correct" && action !== "cancel")
      return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
    return NextResponse.json(
      await correctOrderBonus(
        {
          accrualId: Number(body.accrualId),
          cancel: action === "cancel",
          targetYear:
            body.targetYear == null ? undefined : Number(body.targetYear),
          targetMonth:
            body.targetMonth == null ? undefined : Number(body.targetMonth),
          targetOrderId:
            body.targetOrderId == null
              ? undefined
              : Number(body.targetOrderId),
          amount: body.amount == null ? undefined : Number(body.amount),
          manualOverride: body.manualOverride === true,
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
