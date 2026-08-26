import { PayrollAccrualType, Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import { createAccrual, PayrollError } from "@/lib/services/payroll.service";
import { requireTenantIdentity } from "@/lib/tenant-context";

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const orderId = Number((await context.params).id);
  const role = auth.session!.user.role as Role;
  if (!Number.isInteger(orderId) || (role !== Role.DIRECTOR && role !== Role.MANAGER))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      companyId: requireTenantIdentity().companyId,
      deletedAt: null,
      ...(role === Role.MANAGER
        ? { managerUserId: Number(auth.session!.user.id) }
        : {}),
    },
    select: { id: true, managerUser: { select: { payrollProfile: { select: { id: true } } } } },
  });
  if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  return NextResponse.json(
    await prisma.payrollAccrual.findMany({
      where: {
        orderId,
        ...(role === Role.MANAGER
          ? { employeeId: order.managerUser?.payrollProfile?.id ?? -1 }
          : {}),
      },
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
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const key = readIdempotencyKey(request);
  if ("response" in key) return key.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const orderId = Number((await context.params).id);
    const role = auth.session!.user.role as Role;
    if (!Number.isInteger(orderId) || (role !== Role.DIRECTOR && role !== Role.MANAGER))
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    let employeeId = Number(body.employeeId);
    let periodId = Number(body.periodId);
    let type = (body.type ?? PayrollAccrualType.GUARANTEED_ORDER_BONUS) as PayrollAccrualType;
    if (role === Role.MANAGER) {
      const now = new Date();
      const order = await prisma.order.findFirst({
        where: {
          id: orderId,
          companyId: requireTenantIdentity().companyId,
          deletedAt: null,
          managerUserId: Number(auth.session!.user.id),
        },
        select: { managerUser: { select: { payrollProfile: { select: { id: true } } } } },
      });
      const period = await prisma.payrollPeriod.findUnique({
        where: {
          companyId_year_month: {
            companyId: requireTenantIdentity().companyId,
            year: now.getFullYear(),
            month: now.getMonth() + 1,
          },
        },
        select: { id: true },
      });
      employeeId = order?.managerUser?.payrollProfile?.id ?? 0;
      periodId = period?.id ?? 0;
      type = PayrollAccrualType.ORDER_BONUS;
    }
    const payload = {
      employeeId,
      periodId,
      type,
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
          role,
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
