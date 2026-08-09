import { PayrollPaymentType, Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import {
  payrollSummary,
  PayrollError,
  requestAdvance,
  requestPaymentConfirmation,
} from "@/lib/services/payroll.service";

async function authSelf() {
  const session = await getServerSession(authOptions);
  return session?.user
    ? { session }
    : {
        response: NextResponse.json(
          { error: "Требуется авторизация" },
          { status: 401 },
        ),
      };
}
const actor = (session: {
  user: { id: string; role: string; name?: string | null };
}) => ({
  userId: Number(session.user.id),
  role: session.user.role as Role,
  name: session.user.name ?? "",
});
const fail = (error: unknown) =>
  error instanceof PayrollError
    ? NextResponse.json(
        { error: error.message },
        { status: error.message === "FORBIDDEN" ? 403 : 409 },
      )
    : NextResponse.json({ error: "PAYROLL_OPERATION_FAILED" }, { status: 500 });

export async function GET(request: Request) {
  const auth = await authSelf();
  if (auth.response) return auth.response;
  try {
    const p = new URL(request.url).searchParams;
    const period = await prisma.payrollPeriod.findUnique({
      where: {
        year_month: {
          year: Number(p.get("year")),
          month: Number(p.get("month")),
        },
      },
    });
    if (!period)
      return NextResponse.json({
        period: null,
        rows: [],
        totals: { accrued: 0, paid: 0, pending: 0, payable: 0 },
      });
    return NextResponse.json({
      period,
      ...(await payrollSummary(period.id, actor(auth.session!))),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  const auth = await authSelf();
  if (auth.response) return auth.response;
  const key = readIdempotencyKey(request);
  if ("response" in key) return key.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action === "report-payment") {
      const type = Object.values(PayrollPaymentType).includes(body.type as PayrollPaymentType)
        ? body.type as PayrollPaymentType
        : PayrollPaymentType.SALARY_PAYMENT;
      return NextResponse.json(
        await requestPaymentConfirmation(
          {
            periodId: Number(body.periodId),
            amount: Number(body.amount),
            type,
            claimedPaymentDate: new Date(String(body.paymentDate ?? new Date().toISOString())),
            method: typeof body.method === "string" ? body.method : undefined,
            comment: typeof body.comment === "string" ? body.comment : undefined,
            key: key.key,
            requestHash: createRequestHash(body),
          },
          actor(auth.session!),
        ),
      );
    }
    return NextResponse.json(
      await requestAdvance(
        {
          periodId: Number(body.periodId),
          amount: Number(body.amount),
          comment: typeof body.comment === "string" ? body.comment : undefined,
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
