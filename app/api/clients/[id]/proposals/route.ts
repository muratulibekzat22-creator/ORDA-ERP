import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { publicCalculationSnapshot } from "@/lib/lead-calculation-view";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
type Context = { params: Promise<{ id: string }> };
const idOf = async (context: Context) => { const id = Number((await context.params).id); return Number.isInteger(id) && id > 0 ? id : null; };
function proposalView(value: Record<string, unknown>) { const result: Record<string, unknown> = { ...value, snapshot: publicCalculationSnapshot(value.snapshot) }; if (result.calculation && typeof result.calculation === "object") { const source = result.calculation as Record<string, unknown>; const calculation: Record<string, unknown> = { ...source, snapshot: publicCalculationSnapshot(source.snapshot) }; delete calculation.internalCost; result.calculation = calculation; } return result; }

export async function GET(_: Request, context: Context) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const clientId = await idOf(context); if (!clientId) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { managerUserId: true } });
  if (!client || (role === Role.MANAGER && client.managerUserId !== Number(auth.session!.user.id))) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
  const rows = await prisma.commercialProposal.findMany({ where: { clientId }, include: { calculation: true, conversion: { select: { orderId: true } } }, orderBy: { createdAt: "desc" } });
  return NextResponse.json(rows.map((row) => proposalView(row as unknown as Record<string, unknown>)));
}

export async function POST(request: Request, context: Context) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role, clientId = await idOf(context);
  if (!clientId || (role !== Role.DIRECTOR && role !== Role.MANAGER)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const multiVariant = Array.isArray(body.calculationIds);
    const requestedIds = multiVariant ? (body.calculationIds as unknown[]).map(Number).filter(Number.isInteger) : [Number(body.calculationId)].filter(Number.isInteger);
    const [client, calculations, settings] = await Promise.all([prisma.client.findUnique({ where: { id: clientId } }), prisma.leadCalculation.findMany({ where: { id: { in: requestedIds }, clientId } }), prisma.companySettings.findUnique({ where: { id: 1 } })]);
    const byMaterial = new Map(calculations.map((item) => [item.material, item]));
    const ordered = multiVariant ? ["Сосна", "Карагач", "Дуб ламель"].map((material) => byMaterial.get(material)).filter((item): item is NonNullable<typeof item> => Boolean(item)) : calculations;
    const calculation = ordered[1] ?? ordered[0], calculationId = calculation?.id;
    if (!client || !calculation || (multiVariant && ordered.length !== 3) || (role === Role.MANAGER && client.managerUserId !== Number(auth.session!.user.id))) return NextResponse.json({ error: multiVariant ? "Для КП нужны три варианта расчёта" : "Заявка или расчёт не найдены" }, { status: 404 });
    const now = new Date(), validUntil = new Date(now.getTime() + Math.min(90, Math.max(1, Number(body.validDays) || 14)) * 86400000);
    const previous = body.previousProposalId ? await prisma.commercialProposal.findFirst({ where: { id: Number(body.previousProposalId), clientId } }) : null;
    const rootNumber = previous?.rootNumber ?? previous?.number ?? `КП-${now.getFullYear()}-${now.getTime().toString(36).toUpperCase()}`;
    const version = previous ? previous.version + 1 : 1, number = version === 1 ? rootNumber : `${rootNumber}-V${version}`;
    const variants = ordered.map((item, index) => ({ id: item.id, material: item.material, label: multiVariant ? ["Базовый вариант", "Оптимальный вариант", "Премиальный вариант"][index] : "Вариант", description: "Готовая лестница под ключ", calculation: publicCalculationSnapshot(item.snapshot), clientPrice: item.clientPrice }));
    const snapshot = JSON.parse(JSON.stringify({ company: { name: settings?.name ?? "ALTYN SAPA COMPANY", logoUrl: settings?.logoUrl ?? "", phone: settings?.phone ?? "+7 708 575 0881" }, client: { name: client.name, phone: client.phone, city: client.city, request: client.comment || client.estimateNotes }, variants, calculation: publicCalculationSnapshot(calculation.snapshot), clientPrice: calculation.clientPrice, manager: auth.session!.user.name ?? client.manager, date: now.toISOString(), number, version }));
    const proposal = await prisma.$transaction(async (tx) => {
      const created = await tx.commercialProposal.create({ data: { clientId, calculationId, number, rootNumber, version, snapshot, validUntil, executionTerm: typeof body.executionTerm === "string" ? body.executionTerm.slice(0, 200) : "Срок выполнения уточняется после замера", paymentTerms: typeof body.paymentTerms === "string" ? body.paymentTerms.slice(0, 500) : "Порядок оплаты согласовывается при оформлении заказа", warranty: typeof body.warranty === "string" ? body.warranty.slice(0, 300) : "Гарантия согласно договору", managerContact: typeof body.managerContact === "string" ? body.managerContact.slice(0, 100) : (settings?.phone || "+7 708 575 0881"), createdById: Number(auth.session!.user.id), createdByName: auth.session!.user.name ?? "Система" } });
      await tx.client.update({ where: { id: clientId }, data: { status: "КП подготовлено" } });
      await tx.leadStatusHistory.create({ data: { clientId, fromStatus: client.status, toStatus: "КП подготовлено", authorId: Number(auth.session!.user.id), authorName: auth.session!.user.name ?? "Система" } });
      return created;
    });
    return NextResponse.json(proposalView({ ...proposal, calculation }), { status: 201 });
  } catch { return NextResponse.json({ error: "Не удалось сформировать КП" }, { status: 400 }); }
}
