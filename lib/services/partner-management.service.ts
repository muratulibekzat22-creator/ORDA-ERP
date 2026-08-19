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
import { calculatePartnerSettlement } from "@/lib/partners/settlement";
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
  return calculatePartnerSettlement({
    orderAmount: relation.order.amount,
    companyProfit: relation.profitBasis,
    companyClientReceived: canonical.clientReceived,
    companyPaidPartner: canonical.partnerPaid,
    rewardRule: relation.rewardRule,
    rewardPercent: relation.rewardPercent,
    fixedAmount: relation.fixedAmount,
    manualAmount: relation.manualAmount,
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
    settlementStatus: metrics.status,
    storedSettlementStatus: relation.settlementStatus,
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
  };
}

async function loadedRelation(id: number) {
  return prisma.partnerOrderRelation.findFirst({
    where: { id, companyId: companyId() },
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
        partnerPrice: metrics.partnerAccrued,
        partnerAgreedAt: relation.startsAt,
        partnerPaid: metrics.companyPaidPartner,
        partnerBalance: metrics.companyDebt,
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
  if (rewardRule === PartnerRewardRule.MANUAL && (!manualAmount || manualAmount.lt(0)))
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
  const current = await prisma.partner.findFirst({ where: { id, companyId: companyId(), managementDirectory: true } });
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
  comment?: string;
}, actor: PartnerManagementActor) {
  director(actor);
  const tenant = companyId();
  const [partner, order, existing] = await Promise.all([
    prisma.partner.findFirst({ where: { id: input.partnerId, companyId: tenant, managementDirectory: true, businessStatus: { not: PartnerBusinessStatus.ARCHIVED } } }),
    prisma.order.findFirst({ where: { id: input.orderId, companyId: tenant, deletedAt: null } }),
    prisma.partnerOrderRelation.findFirst({ where: { companyId: tenant, orderId: input.orderId }, include: relationInclude }),
  ]);
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
  });
  return { relation: await refreshRelation(relation.id), created: true };
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
  const partner = await prisma.partner.findFirst({ where: { id: input.partnerId, companyId: tenant, managementDirectory: true, businessStatus: { not: PartnerBusinessStatus.ARCHIVED } } });
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
    partnerId: partner.id,
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
  return { order: result.order, relation: linked.relation, created: result.created };
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
  let paymentId: number | undefined;
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
    });
    if (!financial) throw new PartnerManagementError("ORDER_NOT_FOUND");
    paymentId = financial.payment.id;
  }
  const adjustmentEffect = input.type === PartnerSettlementOperationType.ADJUSTMENT
    ? new Prisma.Decimal(input.adjustmentEffect ?? 0).toDecimalPlaces(2)
    : new Prisma.Decimal(0);
  if (input.type === PartnerSettlementOperationType.ADJUSTMENT && adjustmentEffect.eq(0))
    throw new PartnerManagementError("INVALID_ADJUSTMENT");
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
        paymentId,
        createdById: actor.userId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      },
    });
    await tx.partnerAuditEvent.create({
      data: {
        companyId: tenant, partnerId: relation!.partnerId, relationId: relation!.id, operationId: created.id,
        action: "SETTLEMENT_OPERATION_POSTED", before: { balance: before.partnerBalance.toString() },
        after: { type: created.type, amount: created.amount.toString(), paymentId: paymentId ?? null },
        comment: created.comment, actorId: actor.userId,
      },
    });
    return created;
  });
  relation = await loadedRelation(relation.id);
  return { operation, relation: await refreshRelation(relation!.id), created: true };
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
  const relation = await loadedRelation(relationId);
  if (!relation) throw new PartnerManagementError("RELATION_NOT_FOUND");
  const metrics = calculateLoadedPartnerRelation(relation);
  if (action === "CLOSE" && !metrics.partnerBalance.eq(0))
    throw new PartnerManagementError("SETTLEMENT_HAS_BALANCE");
  const status = action === "DISPUTE" ? PartnerSettlementStatus.DISPUTED : PartnerSettlementStatus.CLOSED;
  await prisma.$transaction([
    prisma.partnerOrderRelation.update({ where: { id: relation.id }, data: { settlementStatus: status, closedAt: status === PartnerSettlementStatus.CLOSED ? new Date() : null } }),
    prisma.partnerAuditEvent.create({ data: {
      companyId: companyId(), partnerId: relation.partnerId, relationId: relation.id,
      action: action === "DISPUTE" ? "SETTLEMENT_DISPUTED" : "SETTLEMENT_CLOSED",
      before: { status: relation.settlementStatus }, after: { status }, comment: comment.trim().slice(0, 2000) || null, actorId: actor.userId,
    } }),
  ]);
  return relationView((await loadedRelation(relation.id))!);
}

export async function searchPartnerOrders(query: string) {
  const tenant = companyId();
  const search = query.trim().slice(0, 120);
  const digits = search.replace(/\D/g, "");
  const numeric = /^\d+(?:[.,]\d{1,2})?$/.test(search) ? new Prisma.Decimal(search.replace(",", ".")) : null;
  return prisma.order.findMany({
    where: {
      companyId: tenant,
      deletedAt: null,
      ...(search ? { OR: [
        { number: { contains: search, mode: "insensitive" } },
        { client: { name: { contains: search, mode: "insensitive" } } },
        { client: { phone: { contains: digits || search } } },
        { address: { contains: search, mode: "insensitive" } },
        { documents: { some: { type: DocumentType.CONTRACT, number: { contains: search, mode: "insensitive" } } } },
        ...(numeric ? [{ amount: numeric }] : []),
      ] } : {}),
    },
    select: {
      id: true, number: true, amount: true, prepayment: true, balance: true, status: true,
      address: true, staircase: true, material: true, partnerId: true,
      client: { select: { id: true, name: true, phone: true } },
      documents: { where: { type: DocumentType.CONTRACT }, select: { id: true, number: true }, take: 1 },
      partnerRelation: { select: { id: true, partnerId: true, partner: { select: { name: true } } } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
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

export async function getPartnerManagementReadModel(filters: {
  partnerId?: number;
  query?: string;
  from?: Date;
  to?: Date;
  settlementStatus?: PartnerSettlementStatus;
  debt?: "company" | "partner" | "any";
} = {}) {
  const tenant = companyId();
  const relationWhere: Prisma.PartnerOrderRelationWhereInput = {
    companyId: tenant,
    ...(filters.partnerId ? { partnerId: filters.partnerId } : {}),
    ...(filters.from || filters.to ? { startsAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } } : {}),
    ...(filters.query ? { OR: [
      { order: { number: { contains: filters.query, mode: "insensitive" } } },
      { order: { client: { name: { contains: filters.query, mode: "insensitive" } } } },
      { order: { client: { phone: { contains: filters.query.replace(/\D/g, "") || filters.query } } } },
      { partner: { name: { contains: filters.query, mode: "insensitive" } } },
    ] } : {}),
  };
  const [partners, relations, managers, audits] = await Promise.all([
    prisma.partner.findMany({
      where: {
        companyId: tenant, isTest: false, managementDirectory: true,
        ...(filters.partnerId ? { id: filters.partnerId } : {}),
        ...(filters.query ? { OR: [
          { name: { contains: filters.query, mode: "insensitive" } },
          { phone: { contains: filters.query.replace(/\D/g, "") || filters.query } },
          { secondaryPhone: { contains: filters.query.replace(/\D/g, "") || filters.query } },
          { contactPerson: { contains: filters.query, mode: "insensitive" } },
          { city: { contains: filters.query, mode: "insensitive" } },
        ] } : {}),
      },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: [{ businessStatus: "asc" }, { name: "asc" }],
    }),
    prisma.partnerOrderRelation.findMany({ where: relationWhere, include: relationInclude, orderBy: [{ startsAt: "desc" }, { id: "desc" }] }),
    prisma.user.findMany({ where: { companyId: tenant, role: Role.MANAGER, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.partnerAuditEvent.findMany({
      where: { companyId: tenant, ...(filters.partnerId ? { partnerId: filters.partnerId } : {}) },
      include: { actor: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200,
    }),
  ]);
  let orderRows = relations.map(relationView);
  if (filters.settlementStatus) orderRows = orderRows.filter((item) => item.settlementStatus === filters.settlementStatus);
  if (filters.debt === "company") orderRows = orderRows.filter((item) => item.metrics.companyDebt.gt(0));
  if (filters.debt === "partner") orderRows = orderRows.filter((item) => item.metrics.partnerDebt.gt(0));
  if (filters.debt === "any") orderRows = orderRows.filter((item) => !item.metrics.partnerBalance.eq(0));
  const totals = orderRows.reduce((sum, item) => ({
    orders: sum.orders + 1,
    orderAmount: sum.orderAmount.add(item.metrics.orderAmount),
    received: sum.received.add(item.metrics.received),
    clientRemaining: sum.clientRemaining.add(item.metrics.clientRemaining),
    companyAmount: sum.companyAmount.add(item.metrics.companyAmount),
    partnerAccrued: sum.partnerAccrued.add(item.metrics.partnerAccrued),
    partnerPaid: sum.partnerPaid.add(item.metrics.companyPaidPartner),
    companyDebt: sum.companyDebt.add(item.metrics.companyDebt),
    partnerDebt: sum.partnerDebt.add(item.metrics.partnerDebt),
    profit: sum.profit.add(new Prisma.Decimal(item.order.companyProfit).sub(item.metrics.partnerAccrued)),
  }), {
    orders: 0,
    orderAmount: new Prisma.Decimal(0), received: new Prisma.Decimal(0), clientRemaining: new Prisma.Decimal(0),
    companyAmount: new Prisma.Decimal(0), partnerAccrued: new Prisma.Decimal(0), partnerPaid: new Prisma.Decimal(0),
    companyDebt: new Prisma.Decimal(0), partnerDebt: new Prisma.Decimal(0), profit: new Prisma.Decimal(0),
  });
  const monthMap = new Map<string, { month: string; orders: number; sales: Prisma.Decimal; received: Prisma.Decimal }>();
  const partnerMap = new Map<number, { partnerId: number; name: string; orders: number; sales: Prisma.Decimal; profit: Prisma.Decimal; debt: Prisma.Decimal }>();
  for (const item of orderRows) {
    const month = item.order.orderReceivedAt.toISOString().slice(0, 7);
    const trend = monthMap.get(month) ?? { month, orders: 0, sales: new Prisma.Decimal(0), received: new Prisma.Decimal(0) };
    trend.orders += 1; trend.sales = trend.sales.add(item.metrics.orderAmount); trend.received = trend.received.add(item.metrics.received); monthMap.set(month, trend);
    const byPartner = partnerMap.get(item.partnerId) ?? { partnerId: item.partnerId, name: item.partner.name, orders: 0, sales: new Prisma.Decimal(0), profit: new Prisma.Decimal(0), debt: new Prisma.Decimal(0) };
    byPartner.orders += 1; byPartner.sales = byPartner.sales.add(item.metrics.orderAmount); byPartner.profit = byPartner.profit.add(new Prisma.Decimal(item.order.companyProfit).sub(item.metrics.partnerAccrued)); byPartner.debt = byPartner.debt.add(item.metrics.partnerBalance); partnerMap.set(item.partnerId, byPartner);
  }
  const partnerSummaries = partners.map((partner) => {
    const rows = orderRows.filter((item) => item.partnerId === partner.id);
    return {
      ...partner,
      totals: rows.reduce((sum, item) => ({
        orders: sum.orders + 1,
        orderAmount: sum.orderAmount.add(item.metrics.orderAmount), received: sum.received.add(item.metrics.received),
        clientRemaining: sum.clientRemaining.add(item.metrics.clientRemaining), partnerAccrued: sum.partnerAccrued.add(item.metrics.partnerAccrued),
        partnerPaid: sum.partnerPaid.add(item.metrics.companyPaidPartner), balance: sum.balance.add(item.metrics.partnerBalance),
        profit: sum.profit.add(new Prisma.Decimal(item.order.companyProfit).sub(item.metrics.partnerAccrued)),
      }), { orders: 0, orderAmount: new Prisma.Decimal(0), received: new Prisma.Decimal(0), clientRemaining: new Prisma.Decimal(0), partnerAccrued: new Prisma.Decimal(0), partnerPaid: new Prisma.Decimal(0), balance: new Prisma.Decimal(0), profit: new Prisma.Decimal(0) }),
    };
  });
  return {
    partners: partnerSummaries,
    orders: orderRows,
    operations: orderRows.flatMap((item) => item.operations.map((operation) => ({ ...operation, orderNumber: item.order.number, partnerName: item.partner.name }))).sort((a, b) => b.operationDate.getTime() - a.operationDate.getTime()),
    audits,
    managers,
    totals: {
      ...totals,
      activePartners: partners.filter((partner) => partner.businessStatus === PartnerBusinessStatus.ACTIVE).length,
      averageOrder: totals.orders ? totals.orderAmount.div(totals.orders).toDecimalPlaces(2) : new Prisma.Decimal(0),
    },
    charts: {
      monthly: [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
      partners: [...partnerMap.values()].sort((a, b) => b.sales.comparedTo(a.sales)),
    },
  };
}

export async function getManagedPartner(id: number) {
  const data = await getPartnerManagementReadModel({ partnerId: id });
  const partner = data.partners.find((item) => item.id === id);
  if (!partner) throw new PartnerManagementError("PARTNER_NOT_FOUND");
  return { partner, orders: data.orders, operations: data.operations, audits: data.audits };
}
