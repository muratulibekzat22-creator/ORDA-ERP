import { PayrollAccrualType, Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import { createAccrual, PayrollError } from "@/lib/services/payroll.service";

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("payroll");
  if (auth.response) return auth.response;
  const orderId = Number((await context.params).id);
  return NextResponse.json(
    await prisma.payrollAccrual.findMany({
      where: { orderId },
      include: {
        employee: { include: { user: { select: { id: true, name: true } } } },
        payments: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("payroll");
  if (auth.response) return auth.response;
  const key = readIdempotencyKey(request);
  if ("response" in key) return key.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const orderId = Number((await context.params).id);
    const payload = {
      employeeId: Number(body.employeeId),
      periodId: Number(body.periodId),
      type: (body.type ??
        PayrollAccrualType.GUARANTEED_ORDER_BONUS) as PayrollAccrualType,
      amount: Number(body.amount ?? 20000),
      reason: String(body.reason ?? "Бонус за заказ"),
      paymentMode: body.paymentMode as never,
      orderId,
    };
    return NextResponse.json(
      await createAccrual(
        { ...payload, key: key.key, requestHash: createRequestHash(payload) },
        {
          userId: Number(auth.session!.user.id),
          role: auth.session!.user.role as Role,
          name: auth.session!.user.name ?? "",
        },
      ),
    );
  } catch (error) {
    return error instanceof PayrollError
      ? NextResponse.json(
          { error: error.message },
          { status: error.message === "FORBIDDEN" ? 403 : 409 },
        )
      : NextResponse.json(
          { error: "PAYROLL_OPERATION_FAILED" },
          { status: 500 },
        );
  }
}
