import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import { requireTenantIdentity } from "@/lib/tenant-context";
import { saveOrderCostPlan } from "@/lib/services/profitability.service";

type Context = { params: Promise<{ id: string }> };
const orderId = async (context: Context) => {
  const value = Number((await context.params).id);
  return Number.isInteger(value) && value > 0 ? value : null;
};

function amount(value: unknown) {
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 9_999_999_999.99
    ? parsed
    : null;
}

async function authorize(context: Context, write = false) {
  const auth = await requirePermission("orders");
  if (auth.response) return { response: auth.response } as const;
  const role = auth.session!.user.role as Role;
  if (
    (write && role !== Role.DIRECTOR) ||
    (!write && role !== Role.DIRECTOR && role !== Role.ACCOUNTANT && role !== Role.MANAGER)
  )
    return {
      response: NextResponse.json(
        { error: "Недостаточно прав" },
        { status: 403 },
      ),
    } as const;
  const id = await orderId(context);
  if (!id)
    return {
      response: NextResponse.json(
        { error: "Некорректный заказ" },
        { status: 400 },
      ),
    } as const;
  const companyId = requireTenantIdentity().companyId;
  const order = await prisma.order.findFirst({
    where: {
      id,
      companyId,
      deletedAt: null,
      ...(role === Role.MANAGER
        ? { managerUserId: Number(auth.session!.user.id) }
        : {}),
    },
    select: { id: true, number: true, client: { select: { name: true } } },
  });
  if (!order)
    return {
      response: NextResponse.json(
        { error: "Заказ не найден" },
        { status: 404 },
      ),
    } as const;
  return { auth, companyId, id, order, role } as const;
}

export async function GET(_: Request, context: Context) {
  const access = await authorize(context);
  if ("response" in access) return access.response;
  const now = new Date();
  const [settings, partners, employees, costPlan, period] = await Promise.all([
    prisma.companySettings.findUnique({
      where: { companyId: access.companyId },
      select: {
        defaultWorkshopPartnerId: true,
        defaultWorkshopPartner: {
          select: { id: true, name: true, active: true, archived: true, isTest: true },
        },
      },
    }),
    prisma.partner.findMany({
      where: {
        companyId: access.companyId,
        active: true,
        archived: false,
        isTest: false,
        businessStatus: "ACTIVE",
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.employeePayrollProfile.findMany({
      where: {
        companyId: access.companyId,
        active: true,
        payrollEnabled: true,
        OR: [{ userId: null }, { user: { active: true } }],
      },
      select: {
        id: true,
        name: true,
        position: true,
        user: { select: { id: true, name: true, role: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.orderCostPlan.findUnique({ where: { orderId: access.id } }),
    prisma.payrollPeriod.findUnique({
      where: {
        companyId_year_month: {
          companyId: access.companyId,
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        },
      },
      select: { id: true, status: true },
    }),
  ]);
  const defaultWorkshop = settings?.defaultWorkshopPartner;
  return NextResponse.json({
    order: access.order,
    partners,
    employees: access.role === Role.DIRECTOR ? employees : [],
    period,
    costPlan: access.role === Role.DIRECTOR ? costPlan : null,
    defaultWorkshop:
      defaultWorkshop?.active &&
      !defaultWorkshop.archived &&
      !defaultWorkshop.isTest
        ? { id: defaultWorkshop.id, name: defaultWorkshop.name }
        : null,
  });
}

export async function PATCH(request: Request, context: Context) {
  const access = await authorize(context, true);
  if ("response" in access) return access.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action !== "saveCostPlan")
      return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
    const materialOutsideWorkshop = amount(body.materialOutsideWorkshop);
    const delivery = amount(body.delivery);
    const bankFees = amount(body.bankFees);
    const otherDirect = amount(body.otherDirect);
    if (
      materialOutsideWorkshop === null ||
      delivery === null ||
      bankFees === null ||
      otherDirect === null
    )
      return NextResponse.json(
        { error: "Расходы должны быть неотрицательными суммами" },
        { status: 400 },
      );
    const plan = await saveOrderCostPlan(
      access.id,
      {
        materialOutsideWorkshop,
        delivery,
        bankFees,
        otherDirect,
        confirmed: body.confirmed === true,
      },
      {
        userId: Number(access.auth.session!.user.id),
        name: access.auth.session!.user.name ?? "Директор",
      },
    );
    return NextResponse.json(plan);
  } catch {
    return NextResponse.json(
      { error: "Не удалось сохранить экономику заказа" },
      { status: 500 },
    );
  }
}
