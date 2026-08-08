import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { calculateStair, type CalculationLineInput, type DeliveryOption, type StairMaterial, type StairRates } from "@/lib/calculator/stair-calculation";
import { getCalculatorTariffs, MATERIAL_CODES, tariffMap } from "@/lib/calculator/tariffs";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import { publicCalculationSnapshot } from "@/lib/lead-calculation-view";

type Context = { params: Promise<{ id: string }> };
const clientId = async (context: Context) => { const value = Number((await context.params).id); return Number.isInteger(value) && value > 0 ? value : null; };
const redacted = (value: Record<string, unknown>, role: Role) => { if (role === Role.DIRECTOR) return value; const result: Record<string, unknown> = { ...value, snapshot: publicCalculationSnapshot(value.snapshot) }; delete result.internalCost; if (Array.isArray(result.adjustments)) result.adjustments = result.adjustments.map((item: unknown) => { const row = item as Record<string, unknown>; return { id: row.id, originalPrice: row.originalPrice, newPrice: row.newPrice, authorName: row.authorName, comment: row.comment, createdAt: row.createdAt }; }); return result; };

export async function GET(_: Request, context: Context) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  const id = await clientId(context); if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const client = await prisma.client.findUnique({ where: { id }, select: { managerUserId: true } });
  if (!client || (role === Role.MANAGER && client.managerUserId !== Number(auth.session!.user.id))) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
  const values = await prisma.leadCalculation.findMany({ where: { clientId: id }, include: { adjustments: { orderBy: { createdAt: "desc" } } }, orderBy: { createdAt: "desc" } });
  return NextResponse.json(values.map((value) => redacted(value as unknown as Record<string, unknown>, role)));
}

export async function POST(request: Request, context: Context) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  const id = await clientId(context), role = auth.session!.user.role as Role;
  if (!id || (role !== Role.DIRECTOR && role !== Role.MANAGER)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    if ("internalCost" in body || "workshopCost" in body) return NextResponse.json({ error: "Внутренние цены недоступны" }, { status: 403 });
    const client = await prisma.client.findUnique({ where: { id }, select: { id: true, managerUserId: true } }); if (!client || (role === Role.MANAGER && client.managerUserId !== Number(auth.session!.user.id))) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
    const tariffs = await getCalculatorTariffs(), byCode = tariffMap(tariffs);
    const rates = Object.fromEntries(Object.entries(MATERIAL_CODES).map(([name, code]) => { const tariff = byCode.get(code); if (!tariff) throw new Error("Тариф материала не настроен"); return [name, { workshopRate: tariff.internalPrice, saleRate: tariff.salePrice }]; })) as StairRates;
    const lines: CalculationLineInput[] = (Array.isArray(body.lines) ? body.lines as Array<Record<string, unknown>> : []).map((line) => { const tariff = typeof line.code === "string" ? byCode.get(line.code) : undefined; if (!tariff) throw new Error("Позиция калькулятора не найдена"); return { code: tariff.code, kind: tariff.kind as CalculationLineInput["kind"], name: tariff.uiName, quantity: Number(line.quantity ?? tariff.defaultQuantity), unit: tariff.unit, unitCost: tariff.internalPrice, unitSale: tariff.manualPriceAllowed && line.unitSale !== undefined ? Number(line.unitSale) : tariff.salePrice, comment: typeof line.comment === "string" ? line.comment.slice(0, 500) : undefined, enabled: line.enabled !== false }; });
    const platformEquivalents = Array.isArray(body.platformEquivalents) ? body.platformEquivalents.map(Number) : [];
    const calculated = calculateStair({ material: body.material as StairMaterial, regularSteps: Number(body.regularSteps), platformEquivalents, clientPrice: body.clientPrice === undefined ? undefined : Number(body.clientPrice), installationRequired: body.installationRequired !== false, deliveryRequired: body.deliveryRequired !== false, measurementRequired: body.measurementRequired !== false, otherCity: body.otherCity === true, pickup: body.pickup === true, deliveryOption: body.deliveryOption as DeliveryOption | undefined, lines }, rates);
    const materialTariff = byCode.get(MATERIAL_CODES[calculated.material]);
    const equivalentSteps = Number(body.regularSteps) + platformEquivalents.reduce((sum, value) => sum + value, 0);
    const managerMinimumTotal = equivalentSteps * Number(materialTariff?.managerMinimumPrice ?? materialTariff?.salePrice ?? 0) + lines.reduce((sum, line) => { const tariff = line.code ? byCode.get(line.code) : undefined; return sum + (line.enabled === false ? 0 : line.quantity * Number(tariff?.managerMinimumPrice ?? tariff?.salePrice ?? line.unitSale)); }, 0) + calculated.deliveryCharge;
    if (role === Role.MANAGER && Number(calculated.clientPrice) < managerMinimumTotal) return NextResponse.json({ error: "Требуется согласование директора", code: "PRICE_APPROVAL_REQUIRED" }, { status: 409 });
    const snapshot = JSON.parse(JSON.stringify(calculated));
    const saved = await prisma.leadCalculation.create({ data: { clientId: id, material: calculated.material, baseClientPrice: calculated.baseClientPrice, clientPrice: calculated.clientPrice, internalCost: calculated.totalCost, snapshot, comment: typeof body.comment === "string" ? body.comment.slice(0, 1000) : null, authorId: Number(auth.session!.user.id), authorName: auth.session!.user.name ?? "Система", ...(calculated.clientPrice !== calculated.baseClientPrice ? { adjustments: { create: { originalPrice: calculated.baseClientPrice, newPrice: calculated.clientPrice, authorId: Number(auth.session!.user.id), authorName: auth.session!.user.name ?? "Система", comment: typeof body.adjustmentComment === "string" ? body.adjustmentComment.slice(0, 500) : null } } } : {}) }, include: { adjustments: true } });
    await prisma.$transaction([prisma.client.update({ where: { id }, data: { estimatedAmount: calculated.clientPrice, amount: String(calculated.clientPrice), status: "Нужен расчёт" } }), prisma.leadStatusHistory.create({ data: { clientId: id, toStatus: "Нужен расчёт", authorId: Number(auth.session!.user.id), authorName: auth.session!.user.name ?? "Система", comment: "Сохранён предварительный расчёт" } })]);
    return NextResponse.json(redacted(saved as unknown as Record<string, unknown>, role), { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Некорректный расчёт" }, { status: 400 }); }
}
