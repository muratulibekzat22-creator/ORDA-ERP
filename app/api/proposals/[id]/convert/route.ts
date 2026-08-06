import { Prisma, Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
type Context = { params: Promise<{ id: string }> };
export async function POST(_: Request, { params }: Context) {
  const auth = await requirePermission("orders"); if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR && auth.session!.user.role !== Role.MANAGER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const proposalId = Number((await params).id); if (!Number.isInteger(proposalId)) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const order = await prisma.$transaction(async (tx) => {
      const existing = await tx.leadConversion.findUnique({ where: { proposalId }, include: { order: true } }); if (existing) return existing.order;
      const proposal = await tx.commercialProposal.findUnique({ where: { id: proposalId }, include: { client: true, calculation: true } });
      if (!proposal || proposal.status !== "Принято") throw new Error("PROPOSAL_NOT_ACCEPTED");
      const anyConversion = await tx.leadConversion.findUnique({ where: { clientId: proposal.clientId }, include: { order: true } }); if (anyConversion) return anyConversion.order;
      const number = `ORD-${Date.now()}-${proposal.clientId}`;
      const created = await tx.order.create({ data: { number, clientId: proposal.clientId, address: proposal.client.address || "Адрес уточняется", staircase: "По расчёту КП", material: proposal.calculation.material, amount: proposal.calculation.clientPrice, prepayment: 0, balance: proposal.calculation.clientPrice, partnerPrice: proposal.calculation.internalCost, companyProfit: Number(proposal.calculation.clientPrice) - Number(proposal.calculation.internalCost), partnerPaid: 0, partnerBalance: proposal.calculation.internalCost, manager: auth.session!.user.name ?? proposal.client.manager, status: "Оформлен" } });
      const snapshot = proposal.calculation.snapshot as Prisma.JsonObject;
      await tx.orderCalculation.create({ data: { orderId: created.id, material: proposal.calculation.material, regularSteps: Number(snapshot.regularSteps ?? 0), platformEquivalents: Array.isArray(snapshot.platformEquivalents) ? snapshot.platformEquivalents.map(Number) : [], equivalentSteps: Number(snapshot.equivalentSteps ?? 0), workshopRate: Number(snapshot.workshopRate ?? 0), saleRate: Number(snapshot.saleRate ?? 0), baseWorkshopCost: Number(snapshot.baseWorkshopCost ?? proposal.calculation.internalCost), workshopCost: proposal.calculation.internalCost, baseClientPrice: proposal.calculation.baseClientPrice, clientPrice: proposal.calculation.clientPrice, grossDifference: Number(proposal.calculation.clientPrice) - Number(proposal.calculation.internalCost), workshopAdjustment: Number(snapshot.workshopAdjustment ?? 0), clientAdjustment: Number(proposal.calculation.clientPrice) - Number(proposal.calculation.baseClientPrice), installationRequired: snapshot.installationRequired !== false, deliveryRequired: snapshot.deliveryRequired !== false, otherCity: snapshot.otherCity === true, pickup: snapshot.pickup === true, materialCost: Number(snapshot.materialCost ?? 0), installationCost: Number(snapshot.installationCost ?? 0), deliveryCost: Number(snapshot.deliveryCost ?? 0), otherDirectCosts: Number(snapshot.otherDirectCosts ?? 0), totalCost: proposal.calculation.internalCost, grossProfit: Number(proposal.calculation.clientPrice) - Number(proposal.calculation.internalCost), createdByUserId: Number(auth.session!.user.id), createdByName: auth.session!.user.name ?? "Система" } });
      await tx.leadConversion.create({ data: { clientId: proposal.clientId, proposalId, orderId: created.id, managerId: Number(auth.session!.user.id), managerName: auth.session!.user.name ?? "Система" } });
      await tx.client.update({ where: { id: proposal.clientId }, data: { status: "Конвертирован в заказ" } });
      await tx.leadStatusHistory.create({ data: { clientId: proposal.clientId, fromStatus: proposal.client.status, toStatus: "Конвертирован в заказ", authorId: Number(auth.session!.user.id), authorName: auth.session!.user.name ?? "Система", comment: `Создан заказ ${number}` } });
      await tx.orderEvent.create({ data: { orderId: created.id, title: "Заказ оформлен из заявки", description: `КП ${proposal.number}`, user: auth.session!.user.name ?? "Система" } });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(order, { status: 201 });
  } catch (error) { if (error instanceof Error && error.message === "PROPOSAL_NOT_ACCEPTED") return NextResponse.json({ error: "Сначала отметьте КП как принятое" }, { status: 409 }); return NextResponse.json({ error: "Не удалось оформить заказ" }, { status: 409 }); }
}
