import {
  DocumentStatus,
  DocumentType,
  PartnerBusinessStatus,
  PartnerBusinessType,
  PartnerRewardRule,
  PartnerSettlementOperationStatus,
  PartnerSettlementOperationType,
  PartnerSettlementStatus,
  Prisma,
  Role,
} from "@prisma/client";

import { compareRequestHash } from "@/lib/idempotency";
import { normalizePhone } from "@/lib/leads/domain";
import { calculateOrderProfitability } from "@/lib/services/profitability.service";
import { calculatePartnerSettlement, calculateReward } from "@/lib/partners/settlement";
import { prisma } from "@/lib/prisma";
import { createFinanceOperation, reverseFinanceOperation } from "@/lib/services/payment.service";
import { createOrder } from "@/lib/services/order.service";
import { requireTenantIdentity } from "@/lib/tenant-context";

export type PartnerManagementActor = { userId: number; role: Role; name: string };
export class PartnerManagementError extends Error {}

const relationInclude = {
  partner: true,
  createdBy: { select: { id: true, name: true } },
  order: {
    include: {
      client: true,
      managerUser: { select: { id: true, name: true, role: true, active: true } },
      payments: true,
      commercialAdjustments: { orderBy: { createdAt: "asc" } },
      companyLedgerEntries: { orderBy: { operationDate: "asc" } },
      costPlan: true,
      payrollAccruals: {
        include: {
          employee: { include: { user: { select: { role: true } } } },
          payments: true,
          reversedBy: { select: { id: true } },
        },
      },
      documents: {
        where: {
          type: DocumentType.CONTRACT,
          status: { notIn: [DocumentStatus.ARCHIVED, DocumentStatus.CANCELLED] },
        },
        select: { id: true, number: true, title: true, status: true },
        orderBy: { documentDate: "desc" },
      },
    },
  },
  operations: {
    include: {
      createdBy: { select: { id: true, name: true } },
      payment: { select: { id: true, type: true, method: true } },
    },
    orderBy: [{ operationDate: "desc" }, { id: "desc" }],
  },
} satisfies Prisma.PartnerOrderRelationInclude;

type LoadedRelation = Prisma.PartnerOrderRelationGetPayload<{ include: typeof relationInclude }>;
type RewardInput = {
  rewardRule?: PartnerRewardRule;
  rewardPercent?: Prisma.Decimal.Value | null;
  fixedAmount?: Prisma.Decimal.Value | null;
  manualAmount?: Prisma.Decimal.Value | null;
};

const clientPaymentTypes = new Set(["CLIENT_PAYMENT", "payment", "PREPAYMENT", "ADDITIONAL_PAYMENT"]);
const cancelledOrder = new Set(["CANCELLED", "Отменён", "Отменен", "Потерян"]);
const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const percent = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
async function sequentialQueries<T extends readonly (() => Promise<unknown>)[]>(tasks: T) {
  const values: unknown[] = [];
  for (const task of tasks) values.push(await task());
  return values as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
}
const positiveMoney = (value: Prisma.Decimal.Value, code = "INVALID_AMOUNT") => {
  const result = money(value);
  if (!result.gt(0)) throw new PartnerManagementError(code);
  return result;
};
const director = (actor: PartnerManagementActor) => {
  if (actor.role !== Role.DIRECTOR) throw new PartnerManagementError("FORBIDDEN");
};
const companyId = () => requireTenantIdentity().companyId;

function canonicalPaymentTotals(relation: LoadedRelation) {
  let clientReceived = new Prisma.Decimal(0);
  let partnerPaid = new Prisma.Decimal(0);
  for (const payment of relation.order.payments) {
    const amount = new Prisma.Decimal(payment.amount);
    if (clientPaymentTypes.has(payment.type)) clientReceived = clientReceived.add(amount);
    else if (payment.type === "REFUND") clientReceived = clientReceived.sub(amount);
    else if (payment.type === "PARTNER_PAYOUT" && payment.partnerId === relation.partnerId)
      partnerPaid = partnerPaid.add(amount);
    else if (payment.type === "PARTNER_PAYOUT_REVERSAL" && payment.partnerId === relation.partnerId)
      partnerPaid = partnerPaid.sub(amount);
  }
  return { clientReceived, partnerPaid };
}

export function calculateLoadedPartnerRelation(relation: LoadedRelation) {
  const canonical = canonicalPaymentTotals(relation);
  const agreementConfirmed = relation.order.partnerAgreedAt !== null;
  return calculatePartnerSettlement({
    orderAmount: relation.order.amount,
    companyProfit: relation.profitBasis,
    companyClientReceived: canonical.clientReceived,
    companyPaidPartner: canonical.partnerPaid,
    rewardRule: agreementConfirmed ? relation.rewardRule : PartnerRewardRule.MANUAL,
    rewardPercent: agreementConfirmed ? relation.rewardPercent : null,
    fixedAmount: agreementConfirmed ? relation.fixedAmount : null,
    manualAmount: agreementConfirmed ? relation.manualAmount : new Prisma.Decimal(0),
    operations: relation.operations,
    disputed: relation.settlementStatus === PartnerSettlementStatus.DISPUTED,
    cancelled:
      relation.settlementStatus === PartnerSettlementStatus.CANCELLED ||
      relation.order.lifecycle === "CANCELLED" ||
      cancelledOrder.has(relation.order.status),
  });
}

function relationView(relation: LoadedRelation) {
  const metrics = calculateLoadedPartnerRelation(relation);
  const economy = calculateOrderProfitability({
    totalSale: relation.order.amount,
    commercialAdjustments: relation.order.commercialAdjustments,
    payments: relation.order.payments,
    partnerId: relation.partnerId,
    partnerAgreed: relation.order.partnerPrice,
    partnerAccrued: metrics.partnerAccrued,
    partnerAgreedAt: relation.order.partnerAgreedAt,
    partnerAgreedBy: relation.createdBy.name,
    partnerDueAt: relation.paymentDueAt ?? relation.order.partnerPlannedReadyAt,
    clientDueAt: relation.order.promisedAt,
    partnerDisputed: relation.settlementStatus === PartnerSettlementStatus.DISPUTED,
    lifecycle: relation.order.lifecycle,
    payrollAccruals: relation.order.payrollAccruals,
    ledgerEntries: relation.order.companyLedgerEntries,
    costPlan: relation.order.costPlan,
  });
  return {
    id: relation.id,
    companyId: relation.companyId,
    partnerId: relation.partnerId,
    orderId: relation.orderId,
    rewardRule: relation.rewardRule,
    rewardPercent: relation.rewardPercent,
    fixedAmount: relation.fixedAmount,
    manualAmount: relation.manualAmount,
    startsAt: relation.startsAt,
    workDueAt: relation.workDueAt,
    paymentDueAt: relation.paymentDueAt,
    settlementStatus: metrics.status,
    storedSettlementStatus: relation.settlementStatus,
    disputeReason: relation.disputeReason,
    comment: relation.comment,
    closedAt: relation.closedAt,
    createdAt: relation.createdAt,
    updatedAt: relation.updatedAt,
    createdBy: relation.createdBy,
    partner: relation.partner,
    order: {
      id: relation.order.id,
      number: relation.order.number,
      createdAt: relation.order.createdAt,
      orderReceivedAt: relation.order.orderReceivedAt,
      promisedAt: relation.order.promisedAt,
      client: relation.order.client,
      manager: relation.order.managerUser ?? { id: null, name: relation.order.manager },
      address: relation.order.address,
      staircase: relation.order.staircase,
      material: relation.order.material,
      amount: relation.order.amount,
      companyProfit: relation.profitBasis,
      status: relation.order.status,
      lifecycle: relation.order.lifecycle,
      contract: relation.order.documents[0] ?? null,
    },
    operations: relation.operations,
    metrics,
    economy,
  };
}

export async function setPartnerAgreedCost(
  relationId: number,
  amount: Prisma.Decimal.Value,
  comment: string,
  actor: PartnerManagementActor,
  dates: { agreedAt?: Date; workDueAt?: Date | null; paymentDueAt?: Date | null } = {},
) {
  director(actor);
  const relation = await loadedRelation(relationId);
  if (!relation) throw new PartnerManagementError("RELATION_NOT_FOUND");
  const agreed = positiveMoney(amount);
  const before = calculateLoadedPartnerRelation(relation);
  if (agreed.lt(before.companyPaidPartner) && !comment.trim())
    throw new PartnerManagementError("PARTNER_COST_BELOW_PAID_REASON_REQUIRED");
  await prisma.$transaction([
    prisma.partnerOrderRelation.update({
      where: { id: relation.id },
      data: {
        rewardRule: PartnerRewardRule.MANUAL,
        rewardPercent: null,
        fixedAmount: null,
        manualAmount: agreed,
        profitBasis: relation.order.amount.sub(agreed),
        startsAt: dates.agreedAt ?? new Date(),
        ...(dates.workDueAt === undefined ? {} : { workDueAt: dates.workDueAt }),
        ...(dates.paymentDueAt === undefined ? {} : { paymentDueAt: dates.paymentDueAt }),
        comment: comment.trim().slice(0, 2000) || relation.comment,
      },
    }),
    prisma.order.update({
      where: { id: relation.orderId },
      data: {
        partnerId: relation.partnerId,
        partnerPrice: agreed,
        partnerAgreedAt: dates.agreedAt ?? new Date(),
        partnerPaid: before.companyPaidPartner,
        partnerBalance: agreed.sub(before.companyPaidPartner),
        companyProfit: relation.order.amount.sub(agreed),
      },
    }),
    prisma.partnerAuditEvent.create({
      data: {
        companyId: companyId(),
        partnerId: relation.partnerId,
        relationId: relation.id,
        action: "PARTNER_AGREED_COST_SET",
        before: { amount: before.partnerAccrued.toString() },
        after: {
          amount: agreed.toString(),
          agreedAt: (dates.agreedAt ?? new Date()).toISOString(),
          workDueAt: dates.workDueAt?.toISOString() ?? null,
          paymentDueAt: dates.paymentDueAt?.toISOString() ?? null,
        },
        comment: comment.trim().slice(0, 2000) || null,
        actorId: actor.userId,
      },
    }),
  ]);
  return refreshRelation(relation.id);
}

async function loadedRelation(id: number) {
  return prisma.partnerOrderRelation.findFirst({
    where: {
      id,
      companyId: companyId(),
      order: { companyId: companyId() },
      partner: { companyId: companyId() },
    },
    include: relationInclude,
  });
}

async function refreshRelation(id: number) {
  const relation = await loadedRelation(id);
  if (!relation) throw new PartnerManagementError("RELATION_NOT_FOUND");
  const metrics = calculateLoadedPartnerRelation(relation);
  const storedStatus = relation.settlementStatus === PartnerSettlementStatus.DISPUTED
    ? PartnerSettlementStatus.DISPUTED
    : metrics.status;
  await prisma.$transaction([
    prisma.partnerOrderRelation.update({
      where: { id: relation.id },
      data: {
        settlementStatus: storedStatus,
        closedAt: storedStatus === PartnerSettlementStatus.CLOSED ? relation.closedAt ?? new Date() : null,
      },
    }),
    prisma.order.update({
      where: { id: relation.orderId },
      data: {
        partnerId: relation.partnerId,
        partnerPaid: metrics.companyPaidPartner,
        partnerBalance: metrics.partnerBalance,
        prepayment: metrics.received,
        balance: metrics.clientRemaining,
      },
    }),
  ]);
  return relationView((await loadedRelation(id))!);
}

function rewardConfig(partner: {
  defaultRewardRule: PartnerRewardRule;
  defaultRewardPercent: Prisma.Decimal | null;
  defaultRewardFixedAmount: Prisma.Decimal | null;
}, input: RewardInput) {
  const rewardRule = input.rewardRule ?? partner.defaultRewardRule;
  const rewardPercent = input.rewardPercent == null
    ? partner.defaultRewardPercent
    : percent(input.rewardPercent);
  const fixedAmount = input.fixedAmount == null
    ? partner.defaultRewardFixedAmount
    : money(input.fixedAmount);
  const manualAmount = input.manualAmount == null ? null : money(input.manualAmount);
  const percentRules: PartnerRewardRule[] = [PartnerRewardRule.ORDER_PERCENT, PartnerRewardRule.PAID_PERCENT, PartnerRewardRule.PROFIT_PERCENT];
  if (percentRules.includes(rewardRule)) {
    if (!rewardPercent?.gt(0) || rewardPercent.gt(100))
      throw new PartnerManagementError("INVALID_REWARD_PERCENT");
  }
  if (rewardRule === PartnerRewardRule.FIXED && (!fixedAmount || fixedAmount.lt(0)))
    throw new PartnerManagementError("INVALID_FIXED_REWARD");
  if (rewardRule === PartnerRewardRule.MANUAL && manualAmount?.lt(0))
    throw new PartnerManagementError("INVALID_MANUAL_REWARD");
  return {
    rewardRule,
    rewardPercent: percentRules.includes(rewardRule) ? rewardPercent : null,
    fixedAmount: rewardRule === PartnerRewardRule.FIXED ? fixedAmount ?? new Prisma.Decimal(0) : null,
    manualAmount: rewardRule === PartnerRewardRule.MANUAL ? manualAmount ?? new Prisma.Decimal(0) : null,
  };
}

export async function createManagedPartner(input: {
  name: string;
  kind: PartnerBusinessType;
  phone?: string;
  secondaryPhone?: string;
  email?: string;
  iinBin?: string;
  city?: string;
  address?: string;
  bankDetails?: string;
  contactPerson?: string;
  cooperationStartedAt?: Date;
  defaultRewardRule: PartnerRewardRule;
  defaultRewardPercent?: Prisma.Decimal.Value | null;
  defaultRewardFixedAmount?: Prisma.Decimal.Value | null;
  businessStatus?: PartnerBusinessStatus;
  comment?: string;
}, actor: PartnerManagementActor) {
  director(actor);
  const name = input.name.trim().slice(0, 200);
  if (!name) throw new PartnerManagementError("PARTNER_NAME_REQUIRED");
  const phone = input.phone ? normalizePhone(input.phone) : "";
  const secondaryPhone = input.secondaryPhone ? normalizePhone(input.secondaryPhone) : "";
  if (input.phone && !phone) throw new PartnerManagementError("INVALID_PHONE");
  if (input.secondaryPhone && !secondaryPhone) throw new PartnerManagementError("INVALID_PHONE");
  const config = rewardConfig({
    defaultRewardRule: input.defaultRewardRule,
    defaultRewardPercent: input.defaultRewardPercent == null ? null : percent(input.defaultRewardPercent),
    defaultRewardFixedAmount: input.defaultRewardFixedAmount == null ? null : money(input.defaultRewardFixedAmount),
  }, {});
  const status = input.businessStatus ?? PartnerBusinessStatus.ACTIVE;
  return prisma.$transaction(async (tx) => {
    const partner = await tx.partner.create({
      data: {
        companyId: companyId(),
        name,
        kind: input.kind,
        phone: phone || null,
        secondaryPhone: secondaryPhone || null,
        email: input.email?.trim().slice(0, 200) || null,
        iinBin: input.iinBin?.trim().slice(0, 32) || null,
        city: input.city?.trim().slice(0, 120) || null,
        address: input.address?.trim().slice(0, 500) || null,
        bankDetails: input.bankDetails?.trim().slice(0, 2000) || null,
        contactPerson: input.contactPerson?.trim().slice(0, 200) || null,
        cooperationStartedAt: input.cooperationStartedAt,
        defaultRewardRule: config.rewardRule,
        defaultRewardPercent: config.rewardPercent,
        defaultRewardFixedAmount: config.fixedAmount,
        businessStatus: status,
        active: status === PartnerBusinessStatus.ACTIVE,
        archived: status === PartnerBusinessStatus.ARCHIVED,
        comment: input.comment?.trim().slice(0, 2000) || null,
        managementDirectory: true,
        createdById: actor.userId,
        isTest: false,
      },
    });
    await tx.partnerAuditEvent.create({
      data: {
        companyId: companyId(), partnerId: partner.id, action: "PARTNER_CREATED",
        after: { name: partner.name, kind: partner.kind, status: partner.businessStatus },
        comment: partner.comment, actorId: actor.userId,
      },
    });
    return partner;
  });
}

export async function updateManagedPartner(id: number, input: Partial<{
  name: string;
  kind: PartnerBusinessType;
  phone: string;
  secondaryPhone: string;
  email: string;
  iinBin: string;
  city: string;
  address: string;
  bankDetails: string;
  contactPerson: string;
  cooperationStartedAt: Date | null;
  defaultRewardRule: PartnerRewardRule;
  defaultRewardPercent: Prisma.Decimal.Value | null;
  defaultRewardFixedAmount: Prisma.Decimal.Value | null;
  businessStatus: PartnerBusinessStatus;
  comment: string;
}>, actor: PartnerManagementActor) {
  director(actor);
  const current = await prisma.partner.findFirst({ where: { id, companyId: companyId(), isTest: false } });
  if (!current) throw new PartnerManagementError("PARTNER_NOT_FOUND");
  const status = input.businessStatus ?? current.businessStatus;
  const phone = input.phone === undefined ? undefined : input.phone ? normalizePhone(input.phone) : null;
  const secondaryPhone = input.secondaryPhone === undefined ? undefined : input.secondaryPhone ? normalizePhone(input.secondaryPhone) : null;
  if (input.phone && !phone) throw new PartnerManagementError("INVALID_PHONE");
  if (input.secondaryPhone && !secondaryPhone) throw new PartnerManagementError("INVALID_PHONE");
  const nextRule = input.defaultRewardRule ?? current.defaultRewardRule;
  const config = rewardConfig({
    defaultRewardRule: nextRule,
    defaultRewardPercent: input.defaultRewardPercent === undefined ? current.defaultRewardPercent : input.defaultRewardPercent == null ? null : percent(input.defaultRewardPercent),
    defaultRewardFixedAmount: input.defaultRewardFixedAmount === undefined ? current.defaultRewardFixedAmount : input.defaultRewardFixedAmount == null ? null : money(input.defaultRewardFixedAmount),
  }, {});
  return prisma.$transaction(async (tx) => {
    const updated = await tx.partner.update({
      where: { id: current.id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name.trim().slice(0, 200) }),
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(phone === undefined ? {} : { phone }),
        ...(secondaryPhone === undefined ? {} : { secondaryPhone }),
        ...(input.email === undefined ? {} : { email: input.email.trim().slice(0, 200) || null }),
        ...(input.iinBin === undefined ? {} : { iinBin: input.iinBin.trim().slice(0, 32) || null }),
        ...(input.city === undefined ? {} : { city: input.city.trim().slice(0, 120) || null }),
        ...(input.address === undefined ? {} : { address: input.address.trim().slice(0, 500) || null }),
        ...(input.bankDetails === undefined ? {} : { bankDetails: input.bankDetails.trim().slice(0, 2000) || null }),
        ...(input.contactPerson === undefined ? {} : { contactPerson: input.contactPerson.trim().slice(0, 200) || null }),
        ...(input.cooperationStartedAt === undefined ? {} : { cooperationStartedAt: input.cooperationStartedAt }),
        defaultRewardRule: config.rewardRule,
        defaultRewardPercent: config.rewardPercent,
        defaultRewardFixedAmount: config.fixedAmount,
        businessStatus: status,
        active: status === PartnerBusinessStatus.ACTIVE,
        archived: status === PartnerBusinessStatus.ARCHIVED,
        ...(input.comment === undefined ? {} : { comment: input.comment.trim().slice(0, 2000) || null }),
      },
    });
    await tx.partnerAuditEvent.create({
      data: {
        companyId: companyId(), partnerId: current.id, action: "PARTNER_UPDATED",
        before: { name: current.name, kind: current.kind, status: current.businessStatus },
        after: { name: updated.name, kind: updated.kind, status: updated.businessStatus },
        comment: input.comment?.trim() || null, actorId: actor.userId,
      },
    });
    return updated;
  });
}

export async function linkPartnerOrder(input: {
  partnerId: number;
  orderId: number;
  reward?: RewardInput;
  startsAt?: Date;
  workDueAt?: Date | null;
  paymentDueAt?: Date | null;
  comment?: string;
}, actor: PartnerManagementActor) {
  director(actor);
  const tenant = companyId();
  const [partner, order, existing] = await sequentialQueries([
    () => prisma.partner.findFirst({ where: { id: input.partnerId, companyId: tenant, isTest: false, active: true, archived: false, businessStatus: { not: PartnerBusinessStatus.ARCHIVED } } }),
    () => prisma.order.findFirst({ where: { id: input.orderId, companyId: tenant, deletedAt: null } }),
    () => prisma.partnerOrderRelation.findFirst({ where: { companyId: tenant, orderId: input.orderId }, include: relationInclude }),
  ] as const);
  if (!partner) throw new PartnerManagementError("PARTNER_NOT_FOUND");
  if (!order) throw new PartnerManagementError("ORDER_NOT_FOUND");
  if (existing) {
    if (existing.partnerId !== partner.id) throw new PartnerManagementError("ORDER_ALREADY_LINKED");
    return { relation: relationView(existing), created: false };
  }
  if (order.partnerId && order.partnerId !== partner.id)
    throw new PartnerManagementError("ORDER_ALREADY_HAS_PRIMARY_PARTNER");
  const config = rewardConfig(partner, input.reward ?? {});
  const relation = await prisma.$transaction(async (tx) => {
    const created = await tx.partnerOrderRelation.create({
      data: {
        companyId: tenant,
        partnerId: partner.id,
        orderId: order.id,
        ...config,
        profitBasis: order.companyProfit,
        startsAt: input.startsAt ?? new Date(),
        workDueAt: input.workDueAt,
        paymentDueAt: input.paymentDueAt,
        comment: input.comment?.trim().slice(0, 2000) || null,
        createdById: actor.userId,
      },
      include: relationInclude,
    });
    await tx.order.update({ where: { id: order.id }, data: { partnerId: partner.id } });
    await tx.partnerAuditEvent.create({
      data: {
        companyId: tenant, partnerId: partner.id, relationId: created.id,
        action: "ORDER_LINKED", after: { orderId: order.id, rewardRule: config.rewardRule },
        comment: input.comment?.trim() || null, actorId: actor.userId,
      },
    });
    return created;
  }, { maxWait: 5_000, timeout: 15_000 });
  return { relation: await refreshRelation(relation.id), created: true };
}

export async function setOrderPartnerAgreement(input: {
  orderId: number;
  partnerId: number;
  amount: Prisma.Decimal.Value;
  agreedAt?: Date;
  workDueAt?: Date | null;
  paymentDueAt?: Date | null;
  comment?: string;
}, actor: PartnerManagementActor) {
  director(actor);
  const tenant = companyId();
  const [order, existing] = await sequentialQueries([
    () => prisma.order.findFirst({
      where: { id: input.orderId, companyId: tenant, deletedAt: null },
      include: { payments: { where: { companyId: tenant } }, partnerRelation: true },
    }),
    () => prisma.partnerOrderRelation.findFirst({ where: { companyId: tenant, orderId: input.orderId } }),
  ] as const);
  if (!order) throw new PartnerManagementError("ORDER_NOT_FOUND");
  const partner = await prisma.partner.findFirst({
    where: { id: input.partnerId, companyId: tenant, isTest: false, active: true, archived: false },
  });
  if (!partner) throw new PartnerManagementError("PARTNER_NOT_FOUND");
  const agreed = positiveMoney(input.amount);
  if (existing && existing.partnerId !== partner.id) {
    const postedPayout = order.payments.some((payment) =>
      payment.partnerId === existing.partnerId && payment.type === "PARTNER_PAYOUT");
    if (postedPayout) throw new PartnerManagementError("PARTNER_REASSIGNMENT_WITH_PAYMENTS");
    const reason = input.comment?.trim().slice(0, 2000) ?? "";
    if (!reason) throw new PartnerManagementError("PARTNER_REASSIGNMENT_REASON_REQUIRED");
    await prisma.$transaction(async (tx) => {
      await tx.partnerOrderRelation.update({
        where: { id: existing.id },
        data: {
          partnerId: partner.id,
          rewardRule: PartnerRewardRule.MANUAL,
          rewardPercent: null,
          fixedAmount: null,
          manualAmount: agreed,
          profitBasis: order.amount.sub(agreed),
          startsAt: input.agreedAt ?? new Date(),
          workDueAt: input.workDueAt,
          paymentDueAt: input.paymentDueAt,
          settlementStatus: PartnerSettlementStatus.CALCULATED,
          disputeReason: null,
          comment: reason,
        },
      });
      await tx.order.update({
        where: { id: order.id },
        data: {
          partnerId: partner.id,
          partnerPrice: agreed,
          partnerAgreedAt: input.agreedAt ?? new Date(),
          partnerPaid: 0,
          partnerBalance: agreed,
          companyProfit: order.amount.sub(agreed),
        },
      });
      await tx.partnerAssignmentHistory.create({
        data: {
          orderId: order.id,
          previousPartnerId: existing.partnerId,
          newPartnerId: partner.id,
          previousPayable: order.partnerPrice,
          newPayable: agreed,
          paidAtChange: order.partnerPaid,
          remainingAtChange: order.partnerBalance,
          reason,
          authorId: actor.userId,
        },
      });
      await tx.partnerAuditEvent.create({
        data: {
          companyId: tenant,
          partnerId: partner.id,
          relationId: existing.id,
          action: "PARTNER_REASSIGNED",
          before: { partnerId: existing.partnerId, amount: order.partnerPrice.toString() },
          after: { partnerId: partner.id, amount: agreed.toString() },
          comment: reason,
          actorId: actor.userId,
        },
      });
      await tx.orderEvent.create({
        data: {
          companyId: tenant,
          orderId: order.id,
          title: "Партнёр изменён",
          description: `${partner.name} · ${agreed.toString()} ₸ · ${reason}`,
          user: actor.name,
        },
      });
    });
    return refreshRelation(existing.id);
  }
  if (existing) return setPartnerAgreedCost(existing.id, agreed, input.comment ?? "", actor, {
    agreedAt: input.agreedAt,
    workDueAt: input.workDueAt,
    paymentDueAt: input.paymentDueAt,
  });
  const linked = await linkPartnerOrder({
    partnerId: partner.id,
    orderId: order.id,
    reward: { rewardRule: PartnerRewardRule.MANUAL, manualAmount: null },
    startsAt: input.agreedAt,
    workDueAt: input.workDueAt,
    paymentDueAt: input.paymentDueAt,
    comment: input.comment,
  }, actor);
  return setPartnerAgreedCost(linked.relation.id, agreed, input.comment ?? "", actor, {
    agreedAt: input.agreedAt,
    workDueAt: input.workDueAt,
    paymentDueAt: input.paymentDueAt,
  });
}

export async function createPartnerOrder(input: {
  partnerId: number;
  clientId?: number;
  client?: { name: string; phone: string; secondaryPhone?: string; city: string; address: string; comment?: string };
  staircase: string;
  material: string;
  description?: string;
  address: string;
  amount: Prisma.Decimal.Value;
  orderDate?: Date;
  promisedAt?: Date | null;
  managerUserId?: number | null;
  externalContractNumber?: string;
  status?: string;
  comment?: string;
  reward?: RewardInput;
  initialPayment?: { confirmed: boolean; amount: Prisma.Decimal.Value; date: Date; receivedBy: string; account: string; method: string; comment?: string };
  idempotencyKey: string;
  requestHash: string;
}, actor: PartnerManagementActor) {
  director(actor);
  const tenant = companyId();
  const partner = await prisma.partner.findFirst({ where: {
    id: input.partnerId,
    companyId: tenant,
    isTest: false,
    active: true,
    archived: false,
    businessStatus: { not: PartnerBusinessStatus.ARCHIVED },
  } });
  if (!partner) throw new PartnerManagementError("PARTNER_NOT_FOUND");
  const manager = input.managerUserId
    ? await prisma.user.findFirst({ where: { id: input.managerUserId, companyId: tenant, role: Role.MANAGER, active: true }, select: { id: true, name: true } })
    : null;
  if (input.managerUserId && !manager) throw new PartnerManagementError("MANAGER_NOT_FOUND");
  if (input.initialPayment?.confirmed && !manager)
    throw new PartnerManagementError("MANAGER_REQUIRED_FOR_CONFIRMED_PAYMENT");
  if (input.initialPayment?.confirmed && (!input.initialPayment.receivedBy.trim() || !input.initialPayment.account.trim()))
    throw new PartnerManagementError("PAYMENT_RECEIVER_AND_ACCOUNT_REQUIRED");
  const amount = positiveMoney(input.amount);
  const confirmedPayment = input.initialPayment?.confirmed === true
    ? positiveMoney(input.initialPayment.amount)
    : new Prisma.Decimal(0);
  if (confirmedPayment.gt(amount)) throw new PartnerManagementError("PAYMENT_EXCEEDS_ORDER");
  const secondaryPhone = input.client?.secondaryPhone ? normalizePhone(input.client.secondaryPhone) : "";
  if (input.client?.secondaryPhone && !secondaryPhone) throw new PartnerManagementError("INVALID_PHONE");
  const client = input.client
    ? {
        name: input.client.name.trim(),
        phone: input.client.phone,
        city: input.client.city.trim(),
        address: input.client.address.trim(),
      }
    : undefined;
  const result = await createOrder({
    clientId: input.clientId,
    client,
    partnerId: null,
    address: input.address.trim(),
    staircase: input.staircase.trim(),
    material: input.material.trim(),
    orderReceivedAt: input.orderDate ?? new Date(),
    promisedAt: input.promisedAt,
    additionalDetails: [input.description, input.externalContractNumber ? `Внешний договор: ${input.externalContractNumber}` : "", input.comment].filter(Boolean).join(" · "),
    amount: Number(amount),
    prepayment: Number(confirmedPayment),
    initialPaymentDate: input.initialPayment?.confirmed ? input.initialPayment.date : undefined,
    initialPaymentComment: input.initialPayment?.confirmed
      ? [input.initialPayment.receivedBy, input.initialPayment.account, input.initialPayment.comment].filter(Boolean).join(" · ")
      : undefined,
    paymentMethod: input.initialPayment?.confirmed ? input.initialPayment.method : "other",
    partnerPrice: 0,
    partnerPriceSet: false,
    partnerPaid: 0,
    manager: manager?.name ?? actor.name,
    managerUserId: manager?.id,
    actorRole: Role.DIRECTOR,
    idempotencyKey: `${input.idempotencyKey}:order`,
    requestHash: input.requestHash,
  });
  const requestedStatus = input.status?.trim().slice(0, 120);
  if (requestedStatus && result.order.status !== requestedStatus) {
    result.order = await prisma.order.update({
      where: { id: result.order.id },
      data: { status: requestedStatus },
    });
  }
  if (input.client && (secondaryPhone || input.client.comment?.trim())) {
    await prisma.client.update({
      where: { id: result.order.clientId },
      data: {
        ...(secondaryPhone ? { whatsapp: secondaryPhone } : {}),
        ...(input.client.comment?.trim() ? { comment: input.client.comment.trim().slice(0, 2000) } : {}),
      },
    });
  }
  const linked = await linkPartnerOrder({
    partnerId: partner.id,
    orderId: result.order.id,
    reward: input.reward,
    startsAt: input.orderDate,
    comment: input.comment,
  }, actor);
  const explicitReward = input.reward?.rewardRule && (
    input.reward.manualAmount != null || input.reward.fixedAmount != null || input.reward.rewardPercent != null
  );
  const explicitCost = explicitReward ? calculateReward(input.reward!.rewardRule!, {
    orderAmount: amount,
    received: confirmedPayment,
    grossProfit: amount,
    percent: input.reward?.rewardPercent,
    fixedAmount: input.reward?.fixedAmount,
    manualAmount: input.reward?.manualAmount,
  }).accrued : null;
  const relation = explicitCost?.gt(0) ? await setPartnerAgreedCost(
    linked.relation.id,
    explicitCost,
    input.comment ?? "Стоимость указана при создании заказа",
    actor,
    { agreedAt: input.orderDate ?? new Date(), workDueAt: input.promisedAt },
  ) : linked.relation;
  return { order: result.order, relation, created: result.created };
}

export async function createPartnerSettlementOperation(input: {
  relationId: number;
  type: PartnerSettlementOperationType;
  amount: Prisma.Decimal.Value;
  adjustmentEffect?: Prisma.Decimal.Value;
  operationDate: Date;
  method?: string;
  account?: string;
  comment?: string;
  idempotencyKey: string;
  requestHash: string;
}, actor: PartnerManagementActor) {
  director(actor);
  const tenant = companyId();
  if (input.type === PartnerSettlementOperationType.REVERSAL)
    throw new PartnerManagementError("USE_REVERSAL_ACTION");
  const replay = await prisma.partnerSettlementOperation.findFirst({ where: { companyId: tenant, idempotencyKey: input.idempotencyKey } });
  if (replay) {
    if (!compareRequestHash(replay.requestHash, input.requestHash)) throw new PartnerManagementError("IDEMPOTENCY_CONFLICT");
    return { operation: replay, relation: await refreshRelation(replay.relationId), created: false };
  }
  let relation = await loadedRelation(input.relationId);
  if (!relation) throw new PartnerManagementError("RELATION_NOT_FOUND");
  const amount = positiveMoney(input.amount);
  if (Number.isNaN(input.operationDate.getTime())) throw new PartnerManagementError("INVALID_DATE");
  const before = calculateLoadedPartnerRelation(relation);
  const clientPaymentTypes: PartnerSettlementOperationType[] = [PartnerSettlementOperationType.CLIENT_TO_COMPANY, PartnerSettlementOperationType.CLIENT_TO_PARTNER];
  const partnerReturnTypes: PartnerSettlementOperationType[] = [PartnerSettlementOperationType.PARTNER_TO_COMPANY, PartnerSettlementOperationType.PARTNER_REFUND];
  const financeTypes: PartnerSettlementOperationType[] = [PartnerSettlementOperationType.CLIENT_TO_COMPANY, PartnerSettlementOperationType.COMPANY_TO_PARTNER, PartnerSettlementOperationType.CLIENT_REFUND];
  if (clientPaymentTypes.includes(input.type) && amount.gt(before.clientRemaining))
    throw new PartnerManagementError("PAYMENT_EXCEEDS_CLIENT_BALANCE");
  if (input.type === PartnerSettlementOperationType.COMPANY_TO_PARTNER && amount.gt(before.companyDebt))
    throw new PartnerManagementError("PAYOUT_EXCEEDS_PARTNER_BALANCE");
  if (input.type === PartnerSettlementOperationType.CLIENT_TO_COMPANY && (!relation.order.managerUser?.active || relation.order.managerUser.role !== Role.MANAGER))
    throw new PartnerManagementError("MANAGER_REQUIRED_FOR_CONFIRMED_PAYMENT");
  if (input.type === PartnerSettlementOperationType.CLIENT_REFUND && amount.gt(before.companyClientReceived))
    throw new PartnerManagementError("REFUND_EXCEEDS_COMPANY_RECEIPTS");
  const heldByPartner = before.clientPaidToPartner.sub(before.partnerReturned).sub(before.partnerTransferred);
  if (partnerReturnTypes.includes(input.type) && amount.gt(heldByPartner))
    throw new PartnerManagementError("PARTNER_TRANSFER_EXCEEDS_HELD");
  const adjustmentEffect = input.type === PartnerSettlementOperationType.ADJUSTMENT
    ? new Prisma.Decimal(input.adjustmentEffect ?? 0).toDecimalPlaces(2)
    : new Prisma.Decimal(0);
  if (input.type === PartnerSettlementOperationType.ADJUSTMENT && adjustmentEffect.eq(0))
    throw new PartnerManagementError("INVALID_ADJUSTMENT");
  if (financeTypes.includes(input.type)) {
    const financeType = input.type === PartnerSettlementOperationType.CLIENT_TO_COMPANY
      ? "CLIENT_PAYMENT"
      : input.type === PartnerSettlementOperationType.COMPANY_TO_PARTNER
        ? "PARTNER_PAYOUT"
        : "REFUND";
    const financial = await createFinanceOperation({
      type: financeType,
      orderId: relation.orderId,
      partnerId: financeType === "PARTNER_PAYOUT" ? relation.partnerId : undefined,
      amount: Number(amount),
      method: input.method?.trim() || "other",
      operationDate: input.operationDate,
      comment: input.comment?.trim() || undefined,
      author: actor.name,
      authorId: actor.userId,
      idempotencyKey: `${input.idempotencyKey}:payment`,
      requestHash: input.requestHash,
      transactionEffect: async (tx, payment) => {
        const created = await tx.partnerSettlementOperation.create({
          data: {
            companyId: tenant,
            relationId: relation!.id,
            partnerId: relation!.partnerId,
            orderId: relation!.orderId,
            type: input.type,
            amount,
            adjustmentEffect,
            operationDate: input.operationDate,
            method: input.method?.trim().slice(0, 100) || null,
            account: input.account?.trim().slice(0, 200) || null,
            comment: input.comment?.trim().slice(0, 2000) || null,
            paymentId: payment.id,
            createdById: actor.userId,
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash,
          },
        });
        await tx.partnerAuditEvent.create({
          data: {
            companyId: tenant, partnerId: relation!.partnerId, relationId: relation!.id, operationId: created.id,
            action: "SETTLEMENT_OPERATION_POSTED", before: { balance: before.partnerBalance.toString() },
            after: { type: created.type, amount: created.amount.toString(), paymentId: payment.id },
            comment: created.comment, actorId: actor.userId,
          },
        });
      },
    });
    if (!financial) throw new PartnerManagementError("ORDER_NOT_FOUND");
    const operation = await prisma.partnerSettlementOperation.findFirst({
      where: { companyId: tenant, paymentId: financial.payment.id, idempotencyKey: input.idempotencyKey },
    });
    if (!operation) throw new PartnerManagementError("SETTLEMENT_OPERATION_NOT_FOUND");
    relation = await loadedRelation(relation.id);
    return { operation, relation: await refreshRelation(relation!.id), created: financial.created };
  }
  const operation = await prisma.$transaction(async (tx) => {
    const created = await tx.partnerSettlementOperation.create({
      data: {
        companyId: tenant,
        relationId: relation!.id,
        partnerId: relation!.partnerId,
        orderId: relation!.orderId,
        type: input.type,
        amount,
        adjustmentEffect,
        operationDate: input.operationDate,
        method: input.method?.trim().slice(0, 100) || null,
        account: input.account?.trim().slice(0, 200) || null,
        comment: input.comment?.trim().slice(0, 2000) || null,
        createdById: actor.userId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      },
    });
    await tx.partnerAuditEvent.create({
      data: {
        companyId: tenant, partnerId: relation!.partnerId, relationId: relation!.id, operationId: created.id,
        action: "SETTLEMENT_OPERATION_POSTED", before: { balance: before.partnerBalance.toString() },
        after: { type: created.type, amount: created.amount.toString(), paymentId: null },
        comment: created.comment, actorId: actor.userId,
      },
    });
    return created;
  });
  relation = await loadedRelation(relation.id);
  return { operation, relation: await refreshRelation(relation!.id), created: true };
}

export async function createPartnerPayoutForOrder(input: {
  orderId: number;
  amount: Prisma.Decimal.Value;
  operationDate: Date;
  method: string;
  account?: string;
  comment?: string;
  idempotencyKey: string;
  requestHash: string;
}, actor: PartnerManagementActor) {
  director(actor);
  const tenant = companyId();
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, companyId: tenant, deletedAt: null },
    include: { partnerRelation: true },
  });
  if (!order) throw new PartnerManagementError("ORDER_NOT_FOUND");
  if (!order.partnerId) throw new PartnerManagementError("PARTNER_NOT_ASSIGNED");
  if (!order.partnerAgreedAt) throw new PartnerManagementError("PARTNER_COST_NOT_SET");
  let relation = order.partnerRelation;
  if (!relation) {
    const linked = await linkPartnerOrder({
      partnerId: order.partnerId,
      orderId: order.id,
      reward: { rewardRule: PartnerRewardRule.MANUAL, manualAmount: order.partnerPrice },
      startsAt: order.partnerAgreedAt,
      comment: "Связь создана при явном проведении выплаты директором",
    }, actor);
    relation = await prisma.partnerOrderRelation.findFirst({
      where: { id: linked.relation.id, companyId: tenant },
    });
  }
  if (!relation) throw new PartnerManagementError("RELATION_NOT_FOUND");
  return createPartnerSettlementOperation({
    relationId: relation.id,
    type: PartnerSettlementOperationType.COMPANY_TO_PARTNER,
    amount: input.amount,
    operationDate: input.operationDate,
    method: input.method,
    account: input.account,
    comment: input.comment,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
  }, actor);
}

export async function linkHistoricalPartnerPayment(input: {
  paymentId: number;
  orderId: number;
  partnerId: number;
  comment: string;
  idempotencyKey: string;
  requestHash: string;
}, actor: PartnerManagementActor) {
  director(actor);
  const tenant = companyId();
  const replay = await prisma.partnerSettlementOperation.findFirst({
    where: { companyId: tenant, idempotencyKey: input.idempotencyKey },
  });
  if (replay) {
    if (!compareRequestHash(replay.requestHash, input.requestHash))
      throw new PartnerManagementError("IDEMPOTENCY_CONFLICT");
    return { operation: replay, relation: await refreshRelation(replay.relationId), created: false };
  }
  const [payment, order, partner] = await sequentialQueries([
    () => prisma.payment.findFirst({
      where: { id: input.paymentId, companyId: tenant, type: "PARTNER_PAYOUT" },
      include: { partnerSettlementOperation: true },
    }),
    () => prisma.order.findFirst({
      where: { id: input.orderId, companyId: tenant, deletedAt: null },
      include: { partnerRelation: true },
    }),
    () => prisma.partner.findFirst({
      where: { id: input.partnerId, companyId: tenant, isTest: false, active: true, archived: false },
    }),
  ] as const);
  if (!payment) throw new PartnerManagementError("PAYMENT_NOT_FOUND");
  if (payment.partnerSettlementOperation) throw new PartnerManagementError("PAYMENT_ALREADY_LINKED");
  if (!order) throw new PartnerManagementError("ORDER_NOT_FOUND");
  if (!partner) throw new PartnerManagementError("PARTNER_NOT_FOUND");
  if (payment.orderId && payment.orderId !== order.id) throw new PartnerManagementError("PAYMENT_ORDER_MISMATCH");
  if (payment.partnerId && payment.partnerId !== partner.id) throw new PartnerManagementError("PAYMENT_PARTNER_MISMATCH");
  if (order.partnerId && order.partnerId !== partner.id) throw new PartnerManagementError("ORDER_PARTNER_MISMATCH");
  if (!order.partnerAgreedAt) throw new PartnerManagementError("PARTNER_COST_NOT_SET");
  let relation = order.partnerRelation;
  if (!relation) {
    const linked = await linkPartnerOrder({
      partnerId: partner.id,
      orderId: order.id,
      reward: { rewardRule: PartnerRewardRule.MANUAL, manualAmount: order.partnerPrice },
      startsAt: order.partnerAgreedAt,
      comment: "Связь создана при ручной разноске исторической выплаты",
    }, actor);
    relation = await prisma.partnerOrderRelation.findFirst({
      where: { id: linked.relation.id, companyId: tenant },
    });
  }
  if (!relation) throw new PartnerManagementError("RELATION_NOT_FOUND");
  const reason = input.comment.trim().slice(0, 2000);
  if (!reason) throw new PartnerManagementError("HISTORICAL_LINK_REASON_REQUIRED");
  const operation = await prisma.$transaction(async (tx) => {
    const current = await tx.payment.findFirst({
      where: { id: payment.id, companyId: tenant },
      include: { partnerSettlementOperation: true },
    });
    if (!current || current.partnerSettlementOperation)
      throw new PartnerManagementError("PAYMENT_ALREADY_LINKED");
    const linkedPayment = await tx.payment.update({
      where: { id: current.id },
      data: { orderId: order.id, partnerId: partner.id },
    });
    const created = await tx.partnerSettlementOperation.create({
      data: {
        companyId: tenant,
        relationId: relation!.id,
        partnerId: partner.id,
        orderId: order.id,
        type: PartnerSettlementOperationType.COMPANY_TO_PARTNER,
        amount: linkedPayment.amount,
        operationDate: linkedPayment.operationDate,
        method: linkedPayment.method,
        comment: reason,
        paymentId: linkedPayment.id,
        createdById: actor.userId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      },
    });
    const payments = await tx.payment.findMany({
      where: { companyId: tenant, orderId: order.id, partnerId: partner.id },
      select: { type: true, amount: true },
    });
    const paid = payments.reduce((sum, row) => row.type === "PARTNER_PAYOUT"
      ? sum.add(row.amount)
      : row.type === "PARTNER_PAYOUT_REVERSAL"
        ? sum.sub(row.amount)
        : sum, new Prisma.Decimal(0));
    await tx.order.update({
      where: { id: order.id },
      data: {
        partnerId: partner.id,
        partnerPaid: paid,
        partnerBalance: order.partnerPrice.sub(paid),
        companyProfit: order.amount.sub(order.partnerPrice),
      },
    });
    await tx.partnerAuditEvent.create({
      data: {
        companyId: tenant,
        partnerId: partner.id,
        relationId: relation!.id,
        operationId: created.id,
        action: "HISTORICAL_PARTNER_PAYMENT_LINKED",
        before: { paymentId: payment.id, orderId: payment.orderId, partnerId: payment.partnerId },
        after: { paymentId: payment.id, orderId: order.id, partnerId: partner.id },
        comment: reason,
        actorId: actor.userId,
      },
    });
    await tx.orderEvent.create({
      data: {
        companyId: tenant,
        orderId: order.id,
        title: "Историческая выплата партнёру разнесена",
        description: `${linkedPayment.amount.toString()} ₸ · ${reason}`,
        user: actor.name,
        idempotencyKey: `partner-history:${input.idempotencyKey}`,
        requestHash: input.requestHash,
      },
    });
    return created;
  });
  return { operation, relation: await refreshRelation(relation.id), created: true };
}

export async function reversePartnerSettlementOperation(input: {
  operationId: number;
  reason: string;
  idempotencyKey: string;
  requestHash: string;
}, actor: PartnerManagementActor) {
  director(actor);
  const tenant = companyId();
  const reason = input.reason.trim().slice(0, 2000);
  if (!reason) throw new PartnerManagementError("REVERSAL_REASON_REQUIRED");
  const replay = await prisma.partnerSettlementOperation.findFirst({ where: { companyId: tenant, idempotencyKey: input.idempotencyKey } });
  if (replay) {
    if (!compareRequestHash(replay.requestHash, input.requestHash)) throw new PartnerManagementError("IDEMPOTENCY_CONFLICT");
    return { operation: replay, relation: await refreshRelation(replay.relationId), created: false };
  }
  const original = await prisma.partnerSettlementOperation.findFirst({
    where: { id: input.operationId, companyId: tenant },
  });
  if (!original) throw new PartnerManagementError("OPERATION_NOT_FOUND");
  if (original.type === PartnerSettlementOperationType.REVERSAL || original.status === PartnerSettlementOperationStatus.REVERSED)
    throw new PartnerManagementError("ALREADY_REVERSED");
  let reversalPaymentId: number | undefined;
  if (original.paymentId) {
    const reversed = await reverseFinanceOperation({
      paymentId: original.paymentId,
      reason,
      authorId: actor.userId,
      author: actor.name,
      idempotencyKey: `${input.idempotencyKey}:payment`,
      requestHash: input.requestHash,
    });
    reversalPaymentId = reversed.reversal.id;
  }
  const reversal = await prisma.$transaction(async (tx) => {
    await tx.partnerSettlementOperation.update({ where: { id: original.id }, data: { status: PartnerSettlementOperationStatus.REVERSED } });
    const created = await tx.partnerSettlementOperation.create({
      data: {
        companyId: tenant, relationId: original.relationId, partnerId: original.partnerId, orderId: original.orderId,
        type: PartnerSettlementOperationType.REVERSAL, amount: original.amount, operationDate: new Date(),
        method: original.method, account: original.account, comment: reason, paymentId: reversalPaymentId,
        reversalOfId: original.id, createdById: actor.userId, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash,
      },
    });
    await tx.partnerAuditEvent.create({
      data: {
        companyId: tenant, partnerId: original.partnerId, relationId: original.relationId, operationId: created.id,
        action: "SETTLEMENT_OPERATION_REVERSED", before: { operationId: original.id, type: original.type, amount: original.amount.toString() },
        after: { reversalId: created.id, paymentId: reversalPaymentId ?? null }, comment: reason, actorId: actor.userId,
      },
    });
    return created;
  });
  return { operation: reversal, relation: await refreshRelation(original.relationId), created: true };
}

export async function setPartnerSettlementState(relationId: number, action: "DISPUTE" | "CLOSE", comment: string, actor: PartnerManagementActor) {
  director(actor);
  const reason = comment.trim().slice(0, 2000);
  if (action === "DISPUTE" && !reason) throw new PartnerManagementError("DISPUTE_REASON_REQUIRED");
  const relation = await loadedRelation(relationId);
  if (!relation) throw new PartnerManagementError("RELATION_NOT_FOUND");
  const metrics = calculateLoadedPartnerRelation(relation);
  if (action === "CLOSE" && !metrics.partnerBalance.eq(0))
    throw new PartnerManagementError("SETTLEMENT_HAS_BALANCE");
  const status = action === "DISPUTE" ? PartnerSettlementStatus.DISPUTED : PartnerSettlementStatus.CLOSED;
  await prisma.$transaction([
    prisma.partnerOrderRelation.update({ where: { id: relation.id }, data: {
      settlementStatus: status,
      disputeReason: status === PartnerSettlementStatus.DISPUTED ? reason : null,
      closedAt: status === PartnerSettlementStatus.CLOSED ? new Date() : null,
    } }),
    prisma.partnerAuditEvent.create({ data: {
      companyId: companyId(), partnerId: relation.partnerId, relationId: relation.id,
      action: action === "DISPUTE" ? "SETTLEMENT_DISPUTED" : "SETTLEMENT_CLOSED",
      before: { status: relation.settlementStatus }, after: { status }, comment: reason || null, actorId: actor.userId,
    } }),
  ]);
  return relationView((await loadedRelation(relation.id))!);
}

export async function searchPartnerOrders(query: string) {
  const tenant = companyId();
  const search = query.trim().slice(0, 120);
  const digits = search.replace(/\D/g, "");
  const numeric = /^\d+(?:[.,]\d{1,2})?$/.test(search) ? new Prisma.Decimal(search.replace(",", ".")) : null;
  const rows = await prisma.order.findMany({
    where: {
      companyId: tenant,
      deletedAt: null,
      partnerId: null,
      partnerRelation: null,
      lifecycle: { notIn: ["COMPLETED", "CANCELLED"] },
      ...(search ? { OR: [
        { number: { contains: search, mode: "insensitive" } },
        { client: { name: { contains: search, mode: "insensitive" } } },
        { client: { phone: { contains: digits || search } } },
        { client: { city: { contains: search, mode: "insensitive" } } },
        { address: { contains: search, mode: "insensitive" } },
        { material: { contains: search, mode: "insensitive" } },
        { manager: { contains: search, mode: "insensitive" } },
        { managerUser: { name: { contains: search, mode: "insensitive" } } },
        { documents: { some: { type: DocumentType.CONTRACT, number: { contains: search, mode: "insensitive" } } } },
        ...(numeric ? [{ amount: numeric }] : []),
      ] } : {}),
    },
    select: {
      id: true, number: true, amount: true, prepayment: true, balance: true, status: true, lifecycle: true,
      address: true, staircase: true, material: true, partnerId: true, orderReceivedAt: true,
      client: { select: { id: true, name: true, phone: true, city: true } },
      managerUser: { select: { id: true, name: true } },
      payments: { select: { type: true, amount: true } },
      documents: { where: { type: DocumentType.CONTRACT }, select: { id: true, number: true }, take: 1 },
      partnerRelation: { select: { id: true, partnerId: true, partner: { select: { name: true } } } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
  });
  return rows.map((order) => {
    const received = order.payments.reduce((sum, payment) =>
      clientPaymentTypes.has(payment.type)
        ? sum.add(payment.amount)
        : payment.type === "REFUND"
          ? sum.sub(payment.amount)
          : sum,
    new Prisma.Decimal(0));
    return {
      ...order,
      payments: undefined,
      received,
      remaining: Prisma.Decimal.max(order.amount.sub(received), 0),
      manager: order.managerUser,
    };
  });
}

export async function searchPartnerClients(query: string) {
  const search = query.trim().slice(0, 120);
  const digits = search.replace(/\D/g, "");
  return prisma.client.findMany({
    where: {
      companyId: companyId(), active: true, deletedAt: null,
      ...(search ? { OR: [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: digits || search } },
        { whatsapp: { contains: digits || search } },
      ] } : {}),
    },
    select: { id: true, name: true, phone: true, whatsapp: true, city: true, address: true },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 50,
  });
}

export type PartnerManagementFilters = {
  orderId?: number;
  partnerId?: number;
  query?: string;
  scope?: "active" | "completed" | "all" | "with_partner" | "without_partner" | "without_cost";
  clientStatus?: "UNPAID" | "PARTIAL" | "PAID" | "OVERPAID" | "OVERDUE";
  partnerStatus?: "NOT_ASSIGNED" | "COST_MISSING" | "NOT_ACCRUED" | "PAYABLE" | "PARTIALLY_PAID" | "PAID" | "OVERPAID" | "OVERDUE" | "DISPUTED";
  profit?: "profitable" | "loss" | "highest_profit" | "highest_margin" | "lowest_margin";
  period?: "current_month" | "previous_month" | "quarter" | "year" | "custom" | "all";
  periodBasis?: "order" | "completion" | "finance";
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
  sort?: "newest" | "oldest" | "sale_desc" | "client_debt_desc" | "partner_debt_desc" | "profit_desc" | "margin_desc" | "margin_asc";
  settlementStatus?: PartnerSettlementStatus;
  debt?: "company" | "partner" | "any";
};

const orderPartnerReadInclude = (tenant: number) => ({
  client: true,
  partner: true,
  managerUser: { select: { id: true, companyId: true, name: true, role: true, active: true } },
  payments: { where: { companyId: tenant }, orderBy: [{ operationDate: "asc" as const }, { id: "asc" as const }] },
  commercialAdjustments: { where: { companyId: tenant }, orderBy: { createdAt: "asc" as const } },
  companyLedgerEntries: { where: { companyId: tenant }, orderBy: { operationDate: "asc" as const } },
  costPlan: true,
  payrollAccruals: {
    where: { employee: { companyId: tenant } },
    include: {
      employee: { include: { user: { select: { role: true } } } },
      payments: true,
      reversedBy: { select: { id: true } },
    },
  },
  documents: {
    where: { companyId: tenant, status: { notIn: [DocumentStatus.ARCHIVED, DocumentStatus.CANCELLED] } },
    select: { id: true, number: true, title: true, type: true, status: true, documentDate: true },
    orderBy: { documentDate: "desc" as const },
  },
  attachments: { where: { companyId: tenant }, select: { id: true, fileName: true, contentType: true, createdAt: true } },
  partnerRelation: {
    where: { companyId: tenant },
    include: {
      partner: true,
      createdBy: { select: { id: true, name: true } },
      operations: {
        where: { companyId: tenant },
        include: {
          createdBy: { select: { id: true, name: true } },
          payment: { select: { id: true, type: true, method: true } },
        },
        orderBy: [{ operationDate: "desc" as const }, { id: "desc" as const }],
      },
    },
  },
}) satisfies Prisma.OrderInclude;

type PartnerReadOrder = Prisma.OrderGetPayload<{ include: ReturnType<typeof orderPartnerReadInclude> }>;

function periodRange(filters: PartnerManagementFilters, now = new Date()) {
  if (filters.period === "all") return { from: undefined, to: undefined };
  if (filters.period === "custom") return { from: filters.from, to: filters.to };
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  if (filters.period === "previous_month") {
    from.setMonth(from.getMonth() - 1, 1);
    to.setDate(0);
    to.setHours(23, 59, 59, 999);
  } else if (filters.period === "quarter") {
    from.setMonth(Math.floor(from.getMonth() / 3) * 3, 1);
  } else if (filters.period === "year") {
    from.setMonth(0, 1);
  } else {
    from.setDate(1);
  }
  return { from, to };
}

function previousRange(range: { from?: Date; to?: Date }) {
  if (!range.from || !range.to) return { from: undefined, to: undefined };
  const duration = range.to.getTime() - range.from.getTime() + 1;
  return { from: new Date(range.from.getTime() - duration), to: new Date(range.from.getTime() - 1) };
}

const within = (date: Date | null | undefined, range: { from?: Date; to?: Date }) =>
  Boolean(date && (!range.from || date >= range.from) && (!range.to || date <= range.to));

function buildOrderRow(order: PartnerReadOrder) {
  const relation = order.partnerRelation;
  const safeRelation = relation?.companyId === order.companyId && relation.partner.companyId === order.companyId ? relation : null;
  const partnerId = safeRelation?.partnerId ?? (order.partner?.companyId === order.companyId ? order.partnerId : null);
  const partner = safeRelation?.partner ?? (order.partner?.companyId === order.companyId ? order.partner : null);
  const relationAccrued = safeRelation ? calculatePartnerSettlement({
    orderAmount: order.amount,
    companyProfit: safeRelation.profitBasis,
    companyClientReceived: order.payments.reduce((sum, payment) => clientPaymentTypes.has(payment.type)
      ? sum.add(payment.amount)
      : payment.type === "REFUND"
        ? sum.sub(payment.amount)
        : sum, new Prisma.Decimal(0)),
    companyPaidPartner: order.payments.reduce((sum, payment) => payment.partnerId === partnerId && payment.type === "PARTNER_PAYOUT"
      ? sum.add(payment.amount)
      : payment.partnerId === partnerId && payment.type === "PARTNER_PAYOUT_REVERSAL"
        ? sum.sub(payment.amount)
        : sum, new Prisma.Decimal(0)),
    rewardRule: order.partnerAgreedAt ? safeRelation.rewardRule : PartnerRewardRule.MANUAL,
    rewardPercent: order.partnerAgreedAt ? safeRelation.rewardPercent : null,
    fixedAmount: order.partnerAgreedAt ? safeRelation.fixedAmount : null,
    manualAmount: order.partnerAgreedAt ? safeRelation.manualAmount ?? order.partnerPrice : 0,
    operations: safeRelation.operations,
    disputed: safeRelation.settlementStatus === PartnerSettlementStatus.DISPUTED,
    cancelled: order.lifecycle === "CANCELLED" || cancelledOrder.has(order.status),
  }) : null;
  const partnerAccrued = order.partnerAgreedAt
    ? relationAccrued?.partnerAccrued ?? order.partnerPrice
    : new Prisma.Decimal(0);
  const economy = calculateOrderProfitability({
    totalSale: order.amount,
    commercialAdjustments: order.commercialAdjustments,
    payments: order.payments,
    partnerId,
    partnerAgreed: order.partnerPrice,
    partnerAccrued,
    partnerAgreedAt: order.partnerAgreedAt,
    partnerAgreedBy: safeRelation?.createdBy.name ?? null,
    partnerDueAt: safeRelation?.paymentDueAt ?? order.partnerPlannedReadyAt,
    clientDueAt: order.promisedAt,
    partnerDisputed: safeRelation?.settlementStatus === PartnerSettlementStatus.DISPUTED,
    lifecycle: order.lifecycle,
    payrollAccruals: order.payrollAccruals,
    ledgerEntries: order.companyLedgerEntries,
    costPlan: order.costPlan,
  });
  const partnerBalance = economy.partner.remaining.sub(economy.partner.overpayment);
  return {
    id: safeRelation?.id ?? null,
    relationId: safeRelation?.id ?? null,
    companyId: order.companyId,
    partnerId,
    rewardRule: safeRelation?.rewardRule ?? null,
    rewardPercent: safeRelation?.rewardPercent ?? null,
    fixedAmount: safeRelation?.fixedAmount ?? null,
    manualAmount: safeRelation?.manualAmount ?? null,
    startsAt: safeRelation?.startsAt ?? null,
    workDueAt: safeRelation?.workDueAt ?? order.partnerPlannedReadyAt,
    paymentDueAt: safeRelation?.paymentDueAt ?? null,
    settlementStatus: economy.partner.status,
    storedSettlementStatus: safeRelation?.settlementStatus ?? null,
    disputeReason: safeRelation?.disputeReason ?? null,
    comment: safeRelation?.comment ?? order.partnerComment,
    partner,
    order: {
      id: order.id,
      number: order.number,
      createdAt: order.createdAt,
      orderReceivedAt: order.orderReceivedAt,
      completedAt: order.completedAt,
      promisedAt: order.promisedAt,
      client: order.client,
      manager: order.managerUser?.companyId === order.companyId ? order.managerUser : { id: null, name: order.manager, role: null, active: false },
      address: order.address,
      staircase: order.staircase,
      material: order.material,
      amount: order.amount,
      companyProfit: order.companyProfit,
      status: order.status,
      lifecycle: order.lifecycle,
      contract: order.documents.find((document) => document.type === DocumentType.CONTRACT) ?? null,
      documents: order.documents,
      attachments: order.attachments,
    },
    metrics: {
      orderAmount: economy.client.totalSale,
      received: economy.client.netReceived,
      clientRemaining: economy.client.remaining,
      clientOverpayment: economy.client.overpayment,
      companyAmount: economy.client.totalSale.sub(partnerAccrued),
      companyShareBeforeExpenses: economy.client.totalSale.sub(partnerAccrued),
      partnerPlanned: relationAccrued?.partnerPlanned ?? partnerAccrued,
      partnerAccrued,
      companyPaidPartner: economy.partner.paid,
      partnerRemaining: economy.partner.remaining,
      partnerOverpayment: economy.partner.overpayment,
      partnerBalance,
      companyDebt: economy.partner.remaining,
      partnerDebt: economy.partner.overpayment,
      companyClientReceived: economy.client.netReceived,
      clientPaidToPartner: relationAccrued?.clientPaidToPartner ?? new Prisma.Decimal(0),
      partnerTransferred: relationAccrued?.partnerTransferred ?? new Prisma.Decimal(0),
    },
    economy,
    operations: safeRelation?.operations ?? [],
  };
}

type PartnerOrderRow = ReturnType<typeof buildOrderRow>;

function emptyTotals() {
  return {
    orders: 0,
    orderAmount: new Prisma.Decimal(0),
    received: new Prisma.Decimal(0),
    clientRemaining: new Prisma.Decimal(0),
    companyAmount: new Prisma.Decimal(0),
    partnerAccrued: new Prisma.Decimal(0),
    partnerPaid: new Prisma.Decimal(0),
    companyDebt: new Prisma.Decimal(0),
    partnerDebt: new Prisma.Decimal(0),
    directExpenses: new Prisma.Decimal(0),
    marginBeforePayroll: new Prisma.Decimal(0),
    payroll: new Prisma.Decimal(0),
    plannedProfit: new Prisma.Decimal(0),
    actualProfit: new Prisma.Decimal(0),
    profit: new Prisma.Decimal(0),
  };
}

function aggregateRows(rows: PartnerOrderRow[]) {
  const totals = rows.reduce((sum, item) => {
    sum.orders += 1;
    sum.orderAmount = sum.orderAmount.add(item.metrics.orderAmount);
    sum.received = sum.received.add(item.metrics.received);
    sum.clientRemaining = sum.clientRemaining.add(item.metrics.clientRemaining);
    sum.companyAmount = sum.companyAmount.add(item.metrics.companyAmount);
    sum.partnerAccrued = sum.partnerAccrued.add(item.metrics.partnerAccrued);
    sum.partnerPaid = sum.partnerPaid.add(item.metrics.companyPaidPartner);
    sum.companyDebt = sum.companyDebt.add(item.metrics.companyDebt);
    sum.partnerDebt = sum.partnerDebt.add(item.metrics.partnerDebt);
    if (item.economy.profit.complete) {
      sum.directExpenses = sum.directExpenses.add(item.economy.profit.directExpenses);
      sum.marginBeforePayroll = sum.marginBeforePayroll.add(item.economy.profit.marginBeforePayroll);
      sum.payroll = sum.payroll.add(item.economy.profit.payrollAccrued);
      sum.profit = sum.profit.add(item.economy.profit.netProfit);
      if (item.order.lifecycle === "COMPLETED") sum.actualProfit = sum.actualProfit.add(item.economy.profit.netProfit);
      else sum.plannedProfit = sum.plannedProfit.add(item.economy.profit.netProfit);
    }
    return sum;
  }, emptyTotals());
  return {
    ...totals,
    averageOrder: totals.orders ? totals.orderAmount.div(totals.orders).toDecimalPlaces(2) : new Prisma.Decimal(0),
    averageMargin: totals.orderAmount.gt(0) ? totals.profit.mul(100).div(totals.orderAmount).toDecimalPlaces(2) : null,
  };
}

function percentChange(current: Prisma.Decimal, previous: Prisma.Decimal) {
  if (previous.eq(0)) return current.eq(0) ? new Prisma.Decimal(0) : null;
  return current.sub(previous).mul(100).div(previous.abs()).toDecimalPlaces(2);
}

export async function getPartnerManagementReadModel(filters: PartnerManagementFilters = {}) {
  const tenant = companyId();
  const query = filters.query?.trim().slice(0, 120) ?? "";
  const digits = query.replace(/\D/g, "");
  const [partners, canonicalOrders, managers, audits, unallocatedPayments, settings] = await sequentialQueries([
    () => prisma.partner.findMany({
      where: {
        companyId: tenant,
        isTest: false,
        ...(filters.partnerId ? { id: filters.partnerId } : {}),
        AND: [
          { OR: [
            { managementDirectory: true },
            { orders: { some: { companyId: tenant, deletedAt: null } } },
            { orderRelations: { some: { companyId: tenant } } },
          ] },
          ...(query ? [{ OR: [
            { name: { contains: query, mode: "insensitive" as const } },
            { phone: { contains: digits || query } },
            { secondaryPhone: { contains: digits || query } },
            { contactPerson: { contains: query, mode: "insensitive" as const } },
            { city: { contains: query, mode: "insensitive" as const } },
          ] }] : []),
        ],
      },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: [{ businessStatus: "asc" }, { name: "asc" }],
    }),
    () => prisma.order.findMany({
      where: {
        companyId: tenant,
        ...(filters.orderId ? { id: filters.orderId } : {}),
        deletedAt: null,
        client: { companyId: tenant },
        ...(filters.partnerId ? { OR: [{ partnerId: filters.partnerId }, { partnerRelation: { partnerId: filters.partnerId, companyId: tenant } }] } : {}),
        ...(query ? { OR: [
          { number: { contains: query, mode: "insensitive" } },
          { client: { name: { contains: query, mode: "insensitive" } } },
          { client: { phone: { contains: digits || query } } },
          { client: { city: { contains: query, mode: "insensitive" } } },
          { address: { contains: query, mode: "insensitive" } },
          { partner: { name: { contains: query, mode: "insensitive" } } },
          { partnerRelation: { partner: { name: { contains: query, mode: "insensitive" } } } },
          { documents: { some: { companyId: tenant, number: { contains: query, mode: "insensitive" } } } },
        ] } : {}),
      },
      include: orderPartnerReadInclude(tenant),
      orderBy: [{ orderReceivedAt: "desc" }, { id: "desc" }],
    }),
    () => prisma.user.findMany({
      where: { companyId: tenant, role: Role.MANAGER, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    () => prisma.partnerAuditEvent.findMany({
      where: { companyId: tenant, ...(filters.partnerId ? { partnerId: filters.partnerId } : {}) },
      include: { actor: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 300,
    }),
    () => prisma.payment.findMany({
      where: {
        companyId: tenant,
        type: "PARTNER_PAYOUT",
        partnerSettlementOperation: null,
      },
      include: {
        partner: { select: { id: true, name: true } },
        order: { select: { id: true, number: true, partnerId: true, partnerAgreedAt: true } },
        registeredBy: { select: { id: true, name: true } },
      },
      orderBy: [{ operationDate: "desc" }, { id: "desc" }],
    }),
    () => prisma.companySettings.findUnique({
      where: { companyId: tenant },
      select: {
        defaultWorkshopPartner: {
          select: { id: true, name: true, active: true, archived: true, isTest: true },
        },
      },
    }),
  ] as const);

  const allRows = canonicalOrders.map(buildOrderRow);
  const activeRows = allRows.filter((item) => item.order.lifecycle !== "COMPLETED" && item.order.lifecycle !== "CANCELLED");
  let filteredRows = allRows.filter((item) => {
    if (filters.scope === "completed") return item.order.lifecycle === "COMPLETED";
    if (filters.scope === "all") return true;
    if (filters.scope === "with_partner") return Boolean(item.partnerId);
    if (filters.scope === "without_partner") return !item.partnerId;
    if (filters.scope === "without_cost") return Boolean(item.partnerId) && item.economy.partner.status === "COST_MISSING";
    return item.order.lifecycle !== "COMPLETED" && item.order.lifecycle !== "CANCELLED";
  });
  if (filters.clientStatus) filteredRows = filteredRows.filter((item) => item.economy.client.status === filters.clientStatus);
  if (filters.partnerStatus) filteredRows = filteredRows.filter((item) => item.economy.partner.status === filters.partnerStatus);
  if (filters.settlementStatus) filteredRows = filteredRows.filter((item) => item.storedSettlementStatus === filters.settlementStatus);
  if (filters.debt === "company") filteredRows = filteredRows.filter((item) => item.metrics.companyDebt.gt(0));
  if (filters.debt === "partner") filteredRows = filteredRows.filter((item) => item.metrics.partnerDebt.gt(0));
  if (filters.debt === "any") filteredRows = filteredRows.filter((item) => !item.metrics.partnerBalance.eq(0));
  if (filters.profit === "profitable") filteredRows = filteredRows.filter((item) => item.economy.profit.complete && item.economy.profit.netProfit.gt(0));
  if (filters.profit === "loss") filteredRows = filteredRows.filter((item) => item.economy.profit.complete && item.economy.profit.netProfit.lt(0));

  const compare = (left: PartnerOrderRow, right: PartnerOrderRow) => {
    if (filters.sort === "oldest") return left.order.orderReceivedAt.getTime() - right.order.orderReceivedAt.getTime();
    if (filters.sort === "sale_desc") return right.metrics.orderAmount.comparedTo(left.metrics.orderAmount);
    if (filters.sort === "client_debt_desc") return right.metrics.clientRemaining.comparedTo(left.metrics.clientRemaining);
    if (filters.sort === "partner_debt_desc") return right.metrics.companyDebt.comparedTo(left.metrics.companyDebt);
    if (filters.sort === "profit_desc" || filters.profit === "highest_profit") return right.economy.profit.netProfit.comparedTo(left.economy.profit.netProfit);
    if (filters.sort === "margin_desc" || filters.profit === "highest_margin") return right.economy.profit.netMarginPercent.comparedTo(left.economy.profit.netMarginPercent);
    if (filters.sort === "margin_asc" || filters.profit === "lowest_margin") return left.economy.profit.netMarginPercent.comparedTo(right.economy.profit.netMarginPercent);
    return right.order.orderReceivedAt.getTime() - left.order.orderReceivedAt.getTime();
  };
  filteredRows.sort(compare);
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 5), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const totalRows = filteredRows.length;
  const pageRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  const range = periodRange({ ...filters, period: filters.period ?? "current_month" });
  const priorRange = previousRange(range);
  const periodOrderDate = (item: PartnerOrderRow) => filters.periodBasis === "completion"
    ? item.order.completedAt
    : item.order.orderReceivedAt;
  const periodRows = allRows.filter((item) => item.order.lifecycle !== "CANCELLED" && within(periodOrderDate(item), range));
  const previousRows = allRows.filter((item) => item.order.lifecycle !== "CANCELLED" && within(periodOrderDate(item), priorRange));
  const periodTotals = aggregateRows(periodRows);
  const priorTotals = aggregateRows(previousRows);
  const operationTotals = (selectedRange: { from?: Date; to?: Date }) => canonicalOrders.reduce((sum, order) => {
    for (const payment of order.payments) {
      if (!within(payment.operationDate, selectedRange)) continue;
      if (clientPaymentTypes.has(payment.type)) sum.received = sum.received.add(payment.amount);
      else if (payment.type === "REFUND") sum.received = sum.received.sub(payment.amount);
      else if (payment.type === "PARTNER_PAYOUT") sum.partnerPaid = sum.partnerPaid.add(payment.amount);
      else if (payment.type === "PARTNER_PAYOUT_REVERSAL") sum.partnerPaid = sum.partnerPaid.sub(payment.amount);
    }
    return sum;
  }, { received: new Prisma.Decimal(0), partnerPaid: new Prisma.Decimal(0) });
  const accrualInRange = (selectedRange: { from?: Date; to?: Date }) => allRows.reduce((sum, item) => {
    if (within(item.economy.partner.agreedAt ? new Date(item.economy.partner.agreedAt) : null, selectedRange))
      sum = sum.add(item.economy.partner.agreed);
    for (const operation of item.operations) {
      if (operation.type === PartnerSettlementOperationType.ADJUSTMENT && operation.status === PartnerSettlementOperationStatus.POSTED && within(operation.operationDate, selectedRange))
        sum = sum.add(operation.adjustmentEffect);
    }
    return sum;
  }, new Prisma.Decimal(0));
  const actualProfitInRange = (selectedRange: { from?: Date; to?: Date }) => allRows.reduce((sum, item) =>
    item.economy.profit.complete && item.order.lifecycle === "COMPLETED" && within(item.order.completedAt, selectedRange)
      ? sum.add(item.economy.profit.netProfit)
      : sum, new Prisma.Decimal(0));
  const periodOperations = operationTotals(range);
  const priorOperations = operationTotals(priorRange);
  periodTotals.received = periodOperations.received;
  periodTotals.partnerPaid = periodOperations.partnerPaid;
  periodTotals.partnerAccrued = accrualInRange(range);
  periodTotals.actualProfit = actualProfitInRange(range);
  priorTotals.received = priorOperations.received;
  priorTotals.partnerPaid = priorOperations.partnerPaid;
  priorTotals.partnerAccrued = accrualInRange(priorRange);
  priorTotals.actualProfit = actualProfitInRange(priorRange);
  const changes = {
    orderAmount: percentChange(periodTotals.orderAmount, priorTotals.orderAmount),
    received: percentChange(periodTotals.received, priorTotals.received),
    clientRemaining: percentChange(periodTotals.clientRemaining, priorTotals.clientRemaining),
    partnerAccrued: percentChange(periodTotals.partnerAccrued, priorTotals.partnerAccrued),
    partnerPaid: percentChange(periodTotals.partnerPaid, priorTotals.partnerPaid),
    companyDebt: percentChange(periodTotals.companyDebt, priorTotals.companyDebt),
    marginBeforePayroll: percentChange(periodTotals.marginBeforePayroll, priorTotals.marginBeforePayroll),
    payroll: percentChange(periodTotals.payroll, priorTotals.payroll),
    profit: percentChange(periodTotals.profit, priorTotals.profit),
  };

  const monthMap = new Map<string, {
    month: string; orders: number; sales: Prisma.Decimal; received: Prisma.Decimal; partnerAccrued: Prisma.Decimal;
    partnerPaid: Prisma.Decimal; clientOutstanding: Prisma.Decimal; partnerPayable: Prisma.Decimal;
    netProfit: Prisma.Decimal; netMargin: Prisma.Decimal;
  }>();
  const month = (key: string) => {
    const current = monthMap.get(key) ?? {
      month: key, orders: 0, sales: new Prisma.Decimal(0), received: new Prisma.Decimal(0), partnerAccrued: new Prisma.Decimal(0),
      partnerPaid: new Prisma.Decimal(0), clientOutstanding: new Prisma.Decimal(0), partnerPayable: new Prisma.Decimal(0),
      netProfit: new Prisma.Decimal(0), netMargin: new Prisma.Decimal(0),
    };
    monthMap.set(key, current);
    return current;
  };
  const partnerMap = new Map<number, { partnerId: number; name: string; orders: number; sales: Prisma.Decimal; profit: Prisma.Decimal; debt: Prisma.Decimal }>();
  for (const item of allRows.filter((row) => row.order.lifecycle !== "CANCELLED")) {
    const key = item.order.orderReceivedAt.toISOString().slice(0, 7);
    const trend = month(key);
    trend.orders += 1;
    trend.sales = trend.sales.add(item.metrics.orderAmount);
    trend.clientOutstanding = trend.clientOutstanding.add(item.metrics.clientRemaining);
    trend.partnerAccrued = trend.partnerAccrued.add(item.metrics.partnerAccrued);
    trend.partnerPayable = trend.partnerPayable.add(item.metrics.companyDebt);
    trend.netProfit = trend.netProfit.add(item.economy.profit.netProfit);
    for (const payment of canonicalOrders.find((order) => order.id === item.order.id)?.payments ?? []) {
      const paymentMonth = payment.operationDate.toISOString().slice(0, 7);
      const paymentTrend = month(paymentMonth);
      if (clientPaymentTypes.has(payment.type)) paymentTrend.received = paymentTrend.received.add(payment.amount);
      else if (payment.type === "REFUND") paymentTrend.received = paymentTrend.received.sub(payment.amount);
      else if (payment.type === "PARTNER_PAYOUT") paymentTrend.partnerPaid = paymentTrend.partnerPaid.add(payment.amount);
      else if (payment.type === "PARTNER_PAYOUT_REVERSAL") paymentTrend.partnerPaid = paymentTrend.partnerPaid.sub(payment.amount);
    }
    if (item.partnerId && item.partner) {
      const summary = partnerMap.get(item.partnerId) ?? {
        partnerId: item.partnerId, name: item.partner.name, orders: 0,
        sales: new Prisma.Decimal(0), profit: new Prisma.Decimal(0), debt: new Prisma.Decimal(0),
      };
      summary.orders += 1;
      summary.sales = summary.sales.add(item.metrics.orderAmount);
      summary.profit = summary.profit.add(item.economy.profit.netProfit);
      summary.debt = summary.debt.add(item.metrics.companyDebt);
      partnerMap.set(item.partnerId, summary);
    }
  }
  for (const value of monthMap.values())
    value.netMargin = value.sales.gt(0) ? value.netProfit.mul(100).div(value.sales).toDecimalPlaces(2) : new Prisma.Decimal(0);

  const partnerSummaries = partners.map((partner) => {
    const rows = allRows.filter((item) => item.partnerId === partner.id && item.order.lifecycle !== "CANCELLED");
    const totals = aggregateRows(rows);
    return {
      ...partner,
      totals: {
        ...totals,
        balance: totals.companyDebt.sub(totals.partnerDebt),
        partnerPaid: totals.partnerPaid,
      },
      overdueObligations: rows.filter((item) => item.economy.partner.status === "OVERDUE").length,
      averageExecutionDays: (() => {
        const completed = rows.filter((item) => item.order.completedAt);
        return completed.length ? Math.round(completed.reduce((sum, item) => sum + ((item.order.completedAt!.getTime() - item.order.orderReceivedAt.getTime()) / 86_400_000), 0) / completed.length) : null;
      })(),
      documents: rows.flatMap((item) => item.order.documents),
    };
  });
  const profitableRows = allRows.filter((item) => item.economy.profit.complete && item.order.lifecycle !== "CANCELLED");
  const best = (rows: PartnerOrderRow[], compareRows: (left: PartnerOrderRow, right: PartnerOrderRow) => number) =>
    rows.length ? [...rows].sort(compareRows)[0] : null;
  const highlights = {
    highestProfit: best(profitableRows, (a, b) => b.economy.profit.netProfit.comparedTo(a.economy.profit.netProfit)),
    highestMargin: best(profitableRows, (a, b) => b.economy.profit.netMarginPercent.comparedTo(a.economy.profit.netMarginPercent)),
    lowestProfit: best(profitableRows, (a, b) => a.economy.profit.netProfit.comparedTo(b.economy.profit.netProfit)),
    biggestClientDebt: best(allRows, (a, b) => b.metrics.clientRemaining.comparedTo(a.metrics.clientRemaining)),
    biggestPartnerDebt: best(allRows, (a, b) => b.metrics.companyDebt.comparedTo(a.metrics.companyDebt)),
    mostProfitablePartner: [...partnerMap.values()].sort((a, b) => b.profit.comparedTo(a.profit))[0] ?? null,
  };
  const expenseStructure = {
    partner: periodTotals.partnerAccrued,
    direct: periodTotals.directExpenses,
    payroll: periodTotals.payroll,
  };
  return {
    defaultWorkshop:
      settings?.defaultWorkshopPartner?.active &&
      !settings.defaultWorkshopPartner.archived &&
      !settings.defaultWorkshopPartner.isTest
        ? { id: settings.defaultWorkshopPartner.id, name: settings.defaultWorkshopPartner.name }
        : null,
    partners: partnerSummaries,
    orders: pageRows,
    allFilteredTotals: aggregateRows(filteredRows),
    pagination: { page, pageSize, total: totalRows, pages: Math.max(Math.ceil(totalRows / pageSize), 1) },
    counts: {
      canonical: allRows.length,
      active: activeRows.length,
      completed: allRows.filter((item) => item.order.lifecycle === "COMPLETED").length,
      withPartner: activeRows.filter((item) => item.partnerId).length,
      withoutPartner: activeRows.filter((item) => !item.partnerId).length,
      withoutCost: activeRows.filter((item) => item.partnerId && item.economy.partner.status === "COST_MISSING").length,
      clientUnpaid: activeRows.filter((item) => item.economy.client.status === "UNPAID" || item.economy.client.status === "OVERDUE").length,
      clientPartial: activeRows.filter((item) => item.economy.client.status === "PARTIAL").length,
      clientPaid: activeRows.filter((item) => item.economy.client.status === "PAID" || item.economy.client.status === "OVERPAID").length,
      partnerPayable: activeRows.filter((item) => item.economy.partner.status === "PAYABLE" || item.economy.partner.status === "OVERDUE").length,
      partnerPartial: activeRows.filter((item) => item.economy.partner.status === "PARTIALLY_PAID").length,
      partnerPaid: activeRows.filter((item) => item.economy.partner.status === "PAID").length,
    },
    operations: allRows.flatMap((item) => item.operations.map((operation) => ({
      ...operation,
      orderNumber: item.order.number,
      partnerName: item.partner?.name ?? "Партнёр не назначен",
    }))).sort((a, b) => b.operationDate.getTime() - a.operationDate.getTime()),
    unallocatedOperations: unallocatedPayments.map((payment) => ({
      id: payment.id,
      operationDate: payment.operationDate,
      amount: payment.amount,
      counterparty: payment.partner?.name ?? "Не указан",
      partnerId: payment.partnerId,
      orderId: payment.orderId,
      orderNumber: payment.order?.number ?? null,
      comment: payment.comment,
      account: payment.method,
      author: payment.registeredBy?.name ?? payment.author ?? "Система",
    })),
    audits,
    managers,
    totals: {
      ...periodTotals,
      activePartners: partners.filter((partner) => partner.businessStatus === PartnerBusinessStatus.ACTIVE && partner.active && !partner.archived).length,
    },
    previousTotals: priorTotals,
    changes,
    period: { key: filters.period ?? "current_month", basis: filters.periodBasis ?? "order", from: range.from, to: range.to },
    charts: {
      monthly: [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
      partners: [...partnerMap.values()].sort((a, b) => b.sales.comparedTo(a.sales)),
      expenses: expenseStructure,
    },
    highlights,
  };
}

export async function getManagedPartner(id: number) {
  const data = await getPartnerManagementReadModel({ partnerId: id, scope: "all", period: "all", pageSize: 100 });
  const partner = data.partners.find((item) => item.id === id);
  if (!partner) throw new PartnerManagementError("PARTNER_NOT_FOUND");
  return { partner, orders: data.orders, operations: data.operations, audits: data.audits };
}
