import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  calculateStair,
  type StairMaterial,
  type CalculationLineInput,
  type StairRates,
} from "@/lib/calculator/stair-calculation";
import { getCalculatorTariffs, MATERIAL_CODES, tariffMap } from "@/lib/calculator/tariffs";
import {
  createRequestHash,
  idempotencyConflict,
  readIdempotencyKey,
} from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

type Context = { params: Promise<{ id: string }> };
function redactCalculation(value: Record<string, unknown>, role: Role) {
  if (role === Role.DIRECTOR) return value;
  const result: Record<string, unknown> = { ...value };
  if (role === Role.ACCOUNTANT) {
    delete result.grossDifference;
    delete result.grossProfit;
    return result;
  }
  for (const key of ["workshopCost", "baseWorkshopCost", "workshopRate", "workshopAdjustment", "grossDifference", "materialCost", "installationCost", "deliveryCost", "otherDirectCosts", "totalCost", "grossProfit"]) delete result[key];
  if (Array.isArray(result.lines)) result.lines = result.lines.map((item) => { const line = item as Record<string, unknown>; return { id: line.id, calculationId: line.calculationId, code: line.code, kind: line.kind, name: line.name, quantity: line.quantity, unit: line.unit, unitSale: line.unitSale, totalSale: line.totalSale, comment: line.comment, enabled: line.enabled, position: line.position }; });
  return result;
}
async function scopedOrder(id: number, role: Role, userId: string) {
  if (role !== Role.PARTNER)
    return prisma.order.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  const partner = await prisma.partner.findUnique({
    where: { userId: Number(userId) },
    select: { id: true },
  });
  return partner
    ? prisma.order.findFirst({
        where: { id, partnerId: partner.id, deletedAt: null },
        select: { id: true },
      })
    : null;
}

export async function GET(_: Request, { params }: Context) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const id = Number((await params).id),
    role = auth.session!.user.role as Role;
  if (
    !Number.isInteger(id) ||
    !(await scopedOrder(id, role, auth.session!.user.id))
  )
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  const value = await prisma.orderCalculation.findFirst({
    where: { orderId: id },
    orderBy: { createdAt: "desc" },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  if (!value) return NextResponse.json(null);
  if (role === Role.PARTNER)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  return NextResponse.json(redactCalculation({ ...value } as Record<string, unknown>, role));
}

export async function POST(request: Request, { params }: Context) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const id = Number((await params).id),
    role = auth.session!.user.role as Role;
  if (
    (role !== Role.DIRECTOR && role !== Role.MANAGER) ||
    !Number.isInteger(id) ||
    !(await scopedOrder(id, role, auth.session!.user.id))
  )
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if ("workshopCost" in body && role !== Role.DIRECTOR)
      return NextResponse.json(
        { error: "Стоимость цеха может изменить только директор" },
        { status: 403 },
      );
    const tariffs = await getCalculatorTariffs();
    const byCode = tariffMap(tariffs);
    const materialRates = Object.fromEntries(Object.entries(MATERIAL_CODES).map(([name, code]) => {
      const tariff = byCode.get(code);
      if (!tariff) throw new Error(`Тариф материала «${name}» не настроен`);
      return [name, { workshopRate: tariff.internalPrice, saleRate: tariff.salePrice }];
    })) as StairRates;
    const requestedLines = Array.isArray(body.lines) ? body.lines as Array<Record<string, unknown>> : [];
    const lines: CalculationLineInput[] = requestedLines.map((line) => {
      const tariff = (typeof line.code === "string" ? byCode.get(line.code) : undefined) ?? tariffs.find((item) => item.kind === line.kind && item.kind !== "STAIR_MATERIAL");
      if (!tariff) throw new Error("Позиция калькулятора не найдена или отключена");
      const manual = tariff.manualPriceAllowed;
      return {
        code: tariff.code,
        kind: tariff.kind as CalculationLineInput["kind"],
        name: tariff.uiName,
        quantity: Number(line.quantity ?? tariff.defaultQuantity),
        unit: tariff.unit,
        unitSale: manual && line.unitSale !== undefined ? Number(line.unitSale) : tariff.salePrice,
        unitCost: role === Role.DIRECTOR && manual && line.unitCost !== undefined ? Number(line.unitCost) : tariff.internalPrice,
        comment: typeof line.comment === "string" ? line.comment : undefined,
        enabled: line.enabled !== false,
      };
    });
    const calculation = calculateStair({
      material: body.material as StairMaterial,
      regularSteps: Number(body.regularSteps),
      platformEquivalents: body.platformEquivalents as number[],
      ...(body.clientPrice === undefined
        ? {}
        : { clientPrice: Number(body.clientPrice) }),
      ...(body.workshopCost === undefined
        ? {}
        : { workshopCost: Number(body.workshopCost) }),
      installationRequired: body.installationRequired !== false,
      deliveryRequired: body.deliveryRequired !== false,
      otherCity: body.otherCity === true,
      pickup: body.pickup === true,
      lines,
    }, materialRates);
    const idempotency = readIdempotencyKey(request);
    if ("response" in idempotency) return idempotency.response;
    const requestHash = createRequestHash({ id, ...calculation });
    const key = idempotency.key ? `calculation:${id}:${idempotency.key}` : null;
    if (key) {
      const existing = await prisma.orderCalculation.findUnique({
        where: { idempotencyKey: key },
        include: { lines: { orderBy: { position: "asc" } } },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) return idempotencyConflict();
        return NextResponse.json(redactCalculation({ ...existing } as Record<string, unknown>, role));
      }
    }
    const saved = await prisma.$transaction(async (tx) => {
      const created = await tx.orderCalculation.create({
        data: {
          orderId: id,
          material: calculation.material,
          regularSteps: calculation.regularSteps,
          platformEquivalents: calculation.platformEquivalents,
          equivalentSteps: calculation.equivalentSteps,
          workshopRate: calculation.workshopRate,
          saleRate: calculation.saleRate,
          baseWorkshopCost: calculation.baseWorkshopCost,
          workshopCost: calculation.workshopCost,
          baseClientPrice: calculation.baseClientPrice,
          clientPrice: calculation.clientPrice,
          grossDifference: calculation.grossDifference,
          workshopAdjustment: calculation.workshopAdjustment,
          clientAdjustment: calculation.clientAdjustment,
          installationRequired: calculation.installationRequired,
          deliveryRequired: calculation.deliveryRequired,
          otherCity: calculation.otherCity,
          pickup: calculation.pickup,
          materialCost: calculation.materialCost,
          installationCost: calculation.installationCost,
          deliveryCost: calculation.deliveryCost,
          otherDirectCosts: calculation.otherDirectCosts,
          totalCost: calculation.totalCost,
          grossProfit: calculation.grossProfit,
          lines: { create: calculation.lines.map((line, position) => ({ ...line, position })) },
          createdByUserId: Number(auth.session!.user.id) || null,
          createdByName: auth.session!.user.name ?? "Система",
          idempotencyKey: key,
          requestHash,
        },
        include: { lines: { orderBy: { position: "asc" } } },
      });
      const orderFinance = await tx.order.findUniqueOrThrow({
        where: { id },
        select: { prepayment: true, partnerPaid: true, partnerPrice: true, partnerAgreedAt: true },
      });
      const canonicalPartnerPrice = orderFinance.partnerAgreedAt
        ? Number(orderFinance.partnerPrice)
        : calculation.workshopCost;
      await tx.order.update({
        where: { id },
        data: {
          material: calculation.material,
          amount: calculation.clientPrice,
          partnerPrice: canonicalPartnerPrice,
          companyProfit: calculation.clientPrice - canonicalPartnerPrice,
          balance: {
            set:
              calculation.clientPrice -
              Number(orderFinance.prepayment),
          },
          partnerBalance: {
            set:
              canonicalPartnerPrice - Number(orderFinance.partnerPaid),
          },
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: id,
          title: "Сохранён расчёт лестницы",
          description: `${calculation.material}: ${calculation.equivalentSteps} эквивалентных ступеней`,
          user: auth.session!.user.name ?? "Система",
        },
      });
      return created;
    });
    return NextResponse.json(redactCalculation({ ...saved } as Record<string, unknown>, role), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Некорректный расчёт" },
      { status: 400 },
    );
  }
}
