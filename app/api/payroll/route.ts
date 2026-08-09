import {
  AdvanceRequestStatus,
  BonusPaymentMode,
  PayrollAccrualType,
  PayrollPaymentType,
  PayrollPeriodStatus,
  Role,
} from "@prisma/client";
import { NextResponse } from "next/server";
import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import {
  changeAllowance,
  changeSalary,
  closePeriod,
  createAccrual,
  createPayment,
  ensurePeriod,
  payAdvance,
  payrollSummary,
  PayrollError,
  reviewPaymentConfirmation,
  reviewAdvance,
  reverseAccrual,
  reversePayment,
  transitionPeriod,
  upsertPayrollProfile,
} from "@/lib/services/payroll.service";

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
        {
          status:
            error.message === "FORBIDDEN"
              ? 403
              : error.message.includes("NOT_FOUND")
                ? 404
                : 409,
        },
      )
    : NextResponse.json({ error: "PAYROLL_OPERATION_FAILED" }, { status: 500 });

export async function GET(request: Request) {
  const auth = await requirePermission("payroll");
  if (auth.response) return auth.response;
  try {
    const params = new URL(request.url).searchParams;
    const year = Number(params.get("year"));
    const month = Number(params.get("month"));
    const period = await prisma.payrollPeriod.findUnique({
      where: { year_month: { year, month } },
    });
    const identity = actor(auth.session!);
    const unconfigured = identity.role === Role.DIRECTOR
      ? await prisma.user.findMany({ where: { active: true, payrollProfile: null, role: { not: Role.PARTNER } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } })
      : [];
    if (!period)
      return NextResponse.json({
        period: null,
        rows: [],
        totals: { accrued: 0, paid: 0, pending: 0, payable: 0 },
        unconfigured,
      });
    return NextResponse.json({
      period,
      ...(await payrollSummary(
        period.id,
        actor(auth.session!),
        params.get("employeeId") ? Number(params.get("employeeId")) : undefined,
      )),
      unconfigured,
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission("payroll");
  if (auth.response) return auth.response;
  const identity = actor(auth.session!);
  const keyResult = readIdempotencyKey(request);
  if ("response" in keyResult) return keyResult.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const hash = createRequestHash(body);
    if (action === "create-period") {
      if (identity.role !== Role.DIRECTOR) throw new PayrollError("FORBIDDEN");
      return NextResponse.json(
        await ensurePeriod(Number(body.year), Number(body.month)),
      );
    }
    if (action === "profile")
      return NextResponse.json(
        await upsertPayrollProfile(
          {
            userId: Number(body.userId),
            hiredAt: new Date(String(body.hiredAt)),
            baseSalary: Number(body.baseSalary),
            defaultGuaranteedBonus:
              body.defaultGuaranteedBonus == null
                ? undefined
                : Number(body.defaultGuaranteedBonus),
            comment:
              typeof body.comment === "string" ? body.comment : undefined,
          },
          identity,
        ),
      );
    if (action === "salary")
      return NextResponse.json(
        await changeSalary(
          Number(body.employeeId),
          Number(body.amount),
          new Date(String(body.effectiveFrom)),
          typeof body.comment === "string" ? body.comment : undefined,
          identity,
        ),
      );
    if (action === "allowance")
      return NextResponse.json(
        await changeAllowance(
          Number(body.employeeId),
          Number(body.amount),
          typeof body.comment === "string" ? body.comment : undefined,
          identity,
        ),
      );
    if (action === "accrual")
      return NextResponse.json(
        await createAccrual(
          {
            employeeId: Number(body.employeeId),
            periodId: Number(body.periodId),
            earnedPeriodId:
              body.earnedPeriodId == null
                ? undefined
                : Number(body.earnedPeriodId),
            type: body.type as PayrollAccrualType,
            amount: Number(body.amount),
            orderId: body.orderId == null ? undefined : Number(body.orderId),
            reason: String(body.reason ?? ""),
            paymentMode: body.paymentMode as BonusPaymentMode | undefined,
            key: keyResult.key,
            requestHash: hash,
          },
          identity,
        ),
      );
    if (action === "payment")
      return NextResponse.json(
        await createPayment(
          {
            employeeId: Number(body.employeeId),
            periodId: Number(body.periodId),
            amount: Number(body.amount),
            type: body.type as PayrollPaymentType,
            paymentDate: new Date(
              String(body.paymentDate ?? new Date().toISOString()),
            ),
            method: typeof body.method === "string" ? body.method : undefined,
            comment:
              typeof body.comment === "string" ? body.comment : undefined,
            relatedAccrualId:
              body.relatedAccrualId == null
                ? undefined
                : Number(body.relatedAccrualId),
            key: keyResult.key,
            requestHash: hash,
          },
          identity,
        ),
      );
    if (action === "review-payment-confirmation")
      return NextResponse.json(
        await reviewPaymentConfirmation(
          Number(body.id),
          {
            decision: body.decision === "REJECT" ? "REJECT" : "CONFIRM",
            amount: body.amount == null ? undefined : Number(body.amount),
            paymentDate: body.paymentDate == null ? undefined : new Date(String(body.paymentDate)),
            method: typeof body.method === "string" ? body.method : undefined,
            comment: typeof body.comment === "string" ? body.comment : undefined,
            key: keyResult.key,
            requestHash: hash,
          },
          identity,
        ),
      );
    if (action === "reverse-payment")
      return NextResponse.json(
        await reversePayment(
          Number(body.id),
          { reason: String(body.reason ?? ""), key: keyResult.key, requestHash: hash },
          identity,
        ),
      );
    if (action === "review-advance")
      return NextResponse.json(
        await reviewAdvance(
          Number(body.id),
          {
            status: body.status as AdvanceRequestStatus,
            approvedAmount:
              body.approvedAmount == null
                ? undefined
                : Number(body.approvedAmount),
            comment:
              typeof body.comment === "string" ? body.comment : undefined,
          },
          identity,
        ),
      );
    if (action === "pay-advance")
      return NextResponse.json(
        await payAdvance(
          Number(body.id),
          {
            key: keyResult.key,
            requestHash: hash,
            method: typeof body.method === "string" ? body.method : undefined,
            comment:
              typeof body.comment === "string" ? body.comment : undefined,
          },
          identity,
        ),
      );
    if (action === "close-period")
      return NextResponse.json(
        await closePeriod(Number(body.periodId), keyResult.key, identity),
      );
    if (action === "transition-period")
      return NextResponse.json(
        await transitionPeriod(
          Number(body.periodId),
          body.status as PayrollPeriodStatus,
          typeof body.reason === "string" ? body.reason : undefined,
          keyResult.key,
          identity,
        ),
      );
    if (action === "reverse-accrual")
      return NextResponse.json(
        await reverseAccrual(
          Number(body.id),
          Number(body.periodId),
          String(body.reason ?? ""),
          keyResult.key,
          hash,
          identity,
        ),
      );
    return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
  } catch (error) {
    return fail(error);
  }
}
