import {
  BonusPaymentMode,
  PartnerRewardRule,
  PartnerSettlementStatus,
  PayrollAccrualType,
  PayrollBonusRule,
  PayrollDirection,
  PayrollPeriodStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import { ensureMeasurerBonusForOrder } from "@/lib/services/measurement.service";
import { createFinanceOperation } from "@/lib/services/payment.service";
import { requireTenantIdentity } from "@/lib/tenant-context";

type Context = { params: Promise<{ id: string }> };
type ProposalVariant = {
  calculationId?: number;
  material?: string;
  finalPrice?: number;
  total?: number;
};

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export async function POST(request: Request, { params }: Context) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const proposalId = Number((await params).id);
  if (!Number.isInteger(proposalId))
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const calculationId = Number(body.calculationId);
    const finalSaleAmount = new Prisma.Decimal(Number(body.finalSaleAmount));
    const initialPayment = new Prisma.Decimal(Number(body.initialPayment ?? 0));
    const adjustmentReason = text(body.adjustmentReason, 1000);
    const address = text(body.address, 1000);
    const paymentMethod = text(body.paymentMethod, 100);
    const conversionComment = text(body.comment, 2000);
    const promisedAt = body.promisedAt ? new Date(String(body.promisedAt)) : null;
    const workshopPartnerId = body.workshopPartnerId ? Number(body.workshopPartnerId) : null;
    const workshopCost = body.workshopCost === undefined || body.workshopCost === ""
      ? null
      : new Prisma.Decimal(Number(body.workshopCost));
    const workshopDueAt = body.workshopDueAt ? new Date(String(body.workshopDueAt)) : null;
    const workshopPaymentDueAt = body.workshopPaymentDueAt ? new Date(String(body.workshopPaymentDueAt)) : null;
    const workshopComment = text(body.workshopComment, 2000);
    const managerBonus = body.managerBonus === undefined || body.managerBonus === ""
      ? new Prisma.Decimal(0)
      : new Prisma.Decimal(Number(body.managerBonus));
    if (
      !Number.isInteger(calculationId) || calculationId <= 0 ||
      !finalSaleAmount.gt(0) || initialPayment.lt(0) || initialPayment.gt(finalSaleAmount) ||
      !address || !paymentMethod ||
      (promisedAt && Number.isNaN(promisedAt.getTime())) ||
      (workshopDueAt && Number.isNaN(workshopDueAt.getTime())) ||
      (workshopPaymentDueAt && Number.isNaN(workshopPaymentDueAt.getTime())) ||
      managerBonus.lt(0)
    ) return NextResponse.json({ error: "Проверьте вариант, сумму, адрес, срок и оплату" }, { status: 400 });
    if ((workshopPartnerId === null) !== (workshopCost === null))
      return NextResponse.json({ error: "Для передачи в цех выберите партнёра и укажите стоимость" }, { status: 400 });
    if (workshopCost !== null && !workshopCost.gt(0))
      return NextResponse.json({ error: "Стоимость цеха должна быть больше нуля" }, { status: 400 });

    const tenant = requireTenantIdentity().companyId;
    const actor = {
      userId: Number(auth.session!.user.id),
      role,
      name: auth.session!.user.name ?? "Сотрудник",
    };
    const order = await prisma.$transaction(async (tx) => {
      const existing = await tx.leadConversion.findUnique({
        where: { proposalId },
        include: { order: true },
      });
      if (existing) {
        await ensureMeasurerBonusForOrder(tx, existing.orderId, actor);
        return existing.order;
      }
      const proposal = await tx.commercialProposal.findFirst({
        where: { id: proposalId, companyId: tenant },
        include: { client: true },
      });
      if (!proposal || !["ACCEPTED", "Принято"].includes(proposal.status))
        throw new Error("PROPOSAL_NOT_ACCEPTED");
      if (proposal.client.stage !== "WON") throw new Error("LEAD_NOT_WON");
      if (role === Role.MANAGER && proposal.client.managerUserId !== actor.userId)
        throw new Error("LEAD_NOT_FOUND");
      const calculation = await tx.leadCalculation.findFirst({
        where: { id: calculationId, clientId: proposal.clientId },
      });
      if (!calculation) throw new Error("CALCULATION_NOT_FOUND");
      const proposalSnapshot = proposal.snapshot as Prisma.JsonObject;
      const variants = Array.isArray(proposalSnapshot.variants)
        ? proposalSnapshot.variants as unknown as ProposalVariant[]
        : [];
      const selectedVariant = variants.find((variant) =>
        Number(variant.calculationId) === calculation.id ||
        (!variant.calculationId && variant.material === calculation.material));
      if (!selectedVariant) throw new Error("VARIANT_NOT_IN_PROPOSAL");
      const proposedPrice = new Prisma.Decimal(
        Number(selectedVariant.finalPrice ?? selectedVariant.total ?? calculation.clientPrice),
      );
      if (!finalSaleAmount.eq(proposedPrice) && !adjustmentReason)
        throw new Error("ADJUSTMENT_REASON_REQUIRED");
      const anyConversion = await tx.leadConversion.findUnique({
        where: { clientId: proposal.clientId },
        include: { order: true },
      });
      if (anyConversion) {
        await ensureMeasurerBonusForOrder(tx, anyConversion.orderId, actor);
        return anyConversion.order;
      }
      const partner = workshopPartnerId
        ? await tx.partner.findFirst({
            where: { id: workshopPartnerId, companyId: tenant, active: true, archived: false, isTest: false },
          })
        : null;
      if (workshopPartnerId && !partner) throw new Error("PARTNER_NOT_FOUND");
      const number = `ORD-${Date.now()}-${proposal.clientId}`;
      const created = await tx.order.create({
        data: {
          companyId: tenant,
          number,
          clientId: proposal.clientId,
          address,
          staircase: "По выбранному варианту КП",
          material: calculation.material,
          amount: finalSaleAmount,
          prepayment: 0,
          balance: finalSaleAmount,
          partnerId: partner?.id ?? null,
          partnerPrice: workshopCost ?? 0,
          partnerAgreedAt: workshopCost ? new Date() : null,
          companyProfit: workshopCost ? finalSaleAmount.sub(workshopCost) : 0,
          partnerPaid: 0,
          partnerBalance: workshopCost ?? 0,
          manager: actor.name || proposal.client.manager,
          managerUserId: proposal.client.managerUserId ?? actor.userId,
          lifecycle: "CREATED",
          status: "Оформлен",
          promisedAt,
          paymentMethod,
          additionalDetails: conversionComment,
        },
      });
      const snapshot = calculation.snapshot as Prisma.JsonObject;
      await tx.orderCalculation.create({
        data: {
          orderId: created.id,
          material: calculation.material,
          regularSteps: Number(snapshot.regularSteps ?? 0),
          platformEquivalents: Array.isArray(snapshot.platformEquivalents) ? snapshot.platformEquivalents.map(Number) : [],
          equivalentSteps: Number(snapshot.equivalentSteps ?? 0),
          workshopRate: Number(snapshot.workshopRate ?? 0),
          saleRate: Number(snapshot.saleRate ?? 0),
          baseWorkshopCost: Number(snapshot.baseWorkshopCost ?? calculation.internalCost),
          workshopCost: calculation.internalCost,
          baseClientPrice: calculation.baseClientPrice,
          clientPrice: finalSaleAmount,
          grossDifference: finalSaleAmount.sub(calculation.internalCost),
          workshopAdjustment: Number(snapshot.workshopAdjustment ?? 0),
          clientAdjustment: finalSaleAmount.sub(calculation.baseClientPrice),
          installationRequired: snapshot.installationRequired !== false,
          deliveryRequired: snapshot.deliveryRequired !== false,
          otherCity: snapshot.otherCity === true,
          pickup: snapshot.pickup === true,
          materialCost: Number(snapshot.materialCost ?? 0),
          installationCost: Number(snapshot.installationCost ?? 0),
          deliveryCost: Number(snapshot.deliveryCost ?? 0),
          otherDirectCosts: Number(snapshot.otherDirectCosts ?? 0),
          totalCost: calculation.internalCost,
          grossProfit: finalSaleAmount.sub(calculation.internalCost),
          createdByUserId: actor.userId,
          createdByName: actor.name,
        },
      });
      if (partner && workshopCost) {
        const relation = await tx.partnerOrderRelation.create({
          data: {
            companyId: tenant,
            partnerId: partner.id,
            orderId: created.id,
            rewardRule: PartnerRewardRule.MANUAL,
            manualAmount: workshopCost,
            profitBasis: finalSaleAmount.sub(workshopCost),
            startsAt: new Date(),
            workDueAt: workshopDueAt,
            paymentDueAt: workshopPaymentDueAt,
            settlementStatus: PartnerSettlementStatus.CALCULATED,
            comment: workshopComment || "Передан в цех при оформлении заказа",
            createdById: actor.userId,
          },
        });
        await tx.partnerAuditEvent.create({
          data: {
            companyId: tenant,
            partnerId: partner.id,
            relationId: relation.id,
            action: "ORDER_LINKED_DURING_PROPOSAL_CONVERSION",
            after: { orderId: created.id, amount: workshopCost.toString() },
            comment: workshopComment || null,
            actorId: actor.userId,
          },
        });
      }
      if (managerBonus.gt(0)) {
        const now = new Date();
        const [profile, period] = await Promise.all([
          tx.employeePayrollProfile.findFirst({
            where: { companyId: tenant, userId: created.managerUserId ?? actor.userId, active: true, payrollEnabled: true },
          }),
          tx.payrollPeriod.findUnique({
            where: { companyId_year_month: { companyId: tenant, year: now.getFullYear(), month: now.getMonth() + 1 } },
          }),
        ]);
        if (!profile || !period || period.status !== PayrollPeriodStatus.OPEN)
          throw new Error("PAYROLL_NOT_READY");
        const bonusPayload = { proposalId, orderId: created.id, managerBonus: managerBonus.toString() };
        await tx.payrollAccrual.create({
          data: {
            employeeId: profile.id,
            periodId: period.id,
            type: PayrollAccrualType.ORDER_BONUS,
            direction: PayrollDirection.INCREASE,
            amount: managerBonus,
            orderId: created.id,
            reason: `Бонус менеджера по заказу ${number}`,
            paymentMode: BonusPaymentMode.ACCUMULATE,
            bonusRule: PayrollBonusRule.FIXED,
            bonusValue: managerBonus,
            bonusBasisAmount: finalSaleAmount,
            bonusSnapshot: bonusPayload,
            approvedById: actor.userId,
            createdById: actor.userId,
            idempotencyKey: `proposal-conversion:${proposalId}:manager-bonus`,
            requestHash: createRequestHash(bonusPayload),
          },
        });
      }
      await tx.leadConversion.create({ data: { clientId: proposal.clientId, proposalId, orderId: created.id, managerId: actor.userId, managerName: actor.name } });
      await tx.leadStatusHistory.create({ data: { clientId: proposal.clientId, fromStatus: proposal.client.status, toStatus: proposal.client.status, fromStage: proposal.client.stage, toStage: proposal.client.stage, authorId: actor.userId, authorName: actor.name, comment: `Создан заказ ${number}; выбран вариант ${calculation.material}` } });
      await tx.orderEvent.create({ data: { companyId: tenant, orderId: created.id, title: "Заказ оформлен из заявки", description: `КП ${proposal.number} · ${calculation.material} · ${finalSaleAmount.toString()} ₸${adjustmentReason ? ` · ${adjustmentReason}` : ""}`, user: actor.name } });
      await tx.orderLifecycleEvent.create({ data: { orderId: created.id, type: "ORDER_CREATED", toLifecycle: "CREATED", message: `КП ${proposal.number}; выбран ${calculation.material}`, actorId: actor.userId, actorName: actor.name, role, metadata: { proposalId: proposal.id, clientId: proposal.clientId, calculationId: calculation.id, finalSaleAmount: finalSaleAmount.toString() } } });
      await ensureMeasurerBonusForOrder(tx, created.id, actor);
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });

    if (initialPayment.gt(0)) {
      const paymentPayload = { proposalId, orderId: order.id, amount: initialPayment.toString(), method: paymentMethod };
      await createFinanceOperation({
        type: "CLIENT_PAYMENT",
        orderId: order.id,
        amount: Number(initialPayment),
        method: paymentMethod,
        operationDate: new Date(),
        comment: `Первый платёж при оформлении заказа из КП ${proposalId}`,
        author: actor.name,
        authorId: actor.userId,
        idempotencyKey: `proposal-conversion:${proposalId}:initial-payment`,
        requestHash: createRequestHash(paymentPayload),
      });
    }
    const refreshed = await prisma.order.findFirst({ where: { id: order.id, companyId: tenant } });
    return NextResponse.json(refreshed ?? order, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "PROPOSAL_NOT_ACCEPTED") return NextResponse.json({ error: "Сначала отметьте КП как принятое" }, { status: 409 });
    if (code === "LEAD_NOT_WON") return NextResponse.json({ error: "Сначала переведите заявку в WON" }, { status: 409 });
    if (["LEAD_NOT_FOUND", "CALCULATION_NOT_FOUND", "VARIANT_NOT_IN_PROPOSAL"].includes(code)) return NextResponse.json({ error: "Выбранный вариант КП не найден" }, { status: 404 });
    if (code === "ADJUSTMENT_REASON_REQUIRED") return NextResponse.json({ error: "Укажите основание изменения цены КП" }, { status: 400 });
    if (code === "PARTNER_NOT_FOUND") return NextResponse.json({ error: "Выбранный цех недоступен" }, { status: 404 });
    if (code === "PAYROLL_NOT_READY") return NextResponse.json({ error: "Для бонуса настройте профиль и откройте зарплатный месяц" }, { status: 409 });
    if (code === "IDEMPOTENCY_CONFLICT") return NextResponse.json({ error: "Параметры повторной операции отличаются" }, { status: 409 });
    return NextResponse.json({ error: "Не удалось оформить заказ" }, { status: 409 });
  }
}
