import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { compareRequestHash, isPrismaUniqueConflict } from "@/lib/idempotency";

export const financeOperationTypes = [
  "CLIENT_PAYMENT",
  "REFUND",
  "EXPENSE",
  "OTHER_INCOME",
  "PARTNER_PAYOUT",
  "ADJUSTMENT",
] as const;

export type FinanceOperationType = (typeof financeOperationTypes)[number];
export type AdjustmentDirection = "INCOME" | "EXPENSE";

type CreateOperationInput = {
  type: FinanceOperationType;
  amount: number;
  method: string;
  orderId?: number;
  partnerId?: number;
  comment?: string;
  operationDate?: Date;
  author?: string;
  adjustmentDirection?: AdjustmentDirection;
  idempotencyKey?: string;
  requestHash?: string;
};

const SERIALIZABLE_RETRIES = 5;

async function lockOrder(tx: Prisma.TransactionClient, orderId: number) {
  await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${orderId})`;
  return tx.order.findUnique({ where: { id: orderId } });
}

async function calculatedMirrors(tx: Prisma.TransactionClient, orderId: number) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { amount: true, partnerPrice: true, partnerId: true } });
  const operations = await tx.payment.findMany({ where: { orderId }, select: { amount: true, type: true, partnerId: true } });
  let paid = new Prisma.Decimal(0), partnerPaid = new Prisma.Decimal(0);
  for (const operation of operations) {
    const amount = new Prisma.Decimal(operation.amount);
    const kind = operationKind(operation.type);
    if (kind === "CLIENT_PAYMENT") paid = paid.add(amount);
    else if (kind === "REFUND") paid = paid.sub(amount);
    else if (kind === payoutType && operation.partnerId === order.partnerId) partnerPaid = partnerPaid.add(amount);
    else if (operation.type === "PARTNER_PAYOUT_REVERSAL" && operation.partnerId === order.partnerId) partnerPaid = partnerPaid.sub(amount);
  }
  return { paid, balance: order.amount.sub(paid), partnerPaid, partnerBalance: order.partnerPrice.sub(partnerPaid), companyProfit: order.amount.sub(order.partnerPrice) };
}

export async function reconcileOrderFinance(orderId: number, repair = false) {
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const calculated = await calculatedMirrors(tx, orderId);
    const mismatch = !order.prepayment.equals(calculated.paid) || !order.balance.equals(calculated.balance) || !order.partnerPaid.equals(calculated.partnerPaid) || !order.partnerBalance.equals(calculated.partnerBalance) || !order.companyProfit.equals(calculated.companyProfit);
    if (repair && mismatch) await tx.order.update({ where: { id: orderId }, data: { prepayment: calculated.paid, balance: calculated.balance, partnerPaid: calculated.partnerPaid, partnerBalance: calculated.partnerBalance, companyProfit: calculated.companyProfit } });
    return { orderId, mismatch, stored: { paid: order.prepayment, balance: order.balance, partnerPaid: order.partnerPaid, partnerBalance: order.partnerBalance, companyProfit: order.companyProfit }, calculated };
  });
}

const clientPaymentTypes = new Set(["CLIENT_PAYMENT", "payment", "PREPAYMENT", "ADDITIONAL_PAYMENT"]);
const payoutType = "PARTNER_PAYOUT";

function operationKind(type: string) {
  if (clientPaymentTypes.has(type)) return "CLIENT_PAYMENT";
  if (type === "REFUND") return "REFUND";
  if (type === payoutType || type.includes("Выплата партн")) return payoutType;
  return type;
}

function orderInclude() {
  return { order: { include: { client: true, partner: true } }, partner: true } as const;
}

export async function getPayments(filters: { type?: string; orderId?: number; partnerId?: number; from?: Date; to?: Date } = {}) {
  return prisma.payment.findMany({
    where: {
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.orderId ? { orderId: filters.orderId } : {}),
      ...(filters.partnerId ? { OR: [{ partnerId: filters.partnerId }, { order: { partnerId: filters.partnerId } }] } : {}),
      ...((filters.from || filters.to) ? { operationDate: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } } : {}),
    },
    include: orderInclude(),
    orderBy: [{ operationDate: "desc" }, { id: "desc" }],
  });
}

export async function getPayment(id: number) {
  return prisma.payment.findUnique({ where: { id }, include: orderInclude() });
}

/** Creates the ledger record and updates an order balance atomically when the operation affects it. */
export async function createFinanceOperation(input: CreateOperationInput) {
  if (input.type === "EXPENSE") throw new Error("EXPENSE_USE_COMPANY_LEDGER");
  for (let attempt = 0; attempt < SERIALIZABLE_RETRIES; attempt += 1) try {
    return await prisma.$transaction(async (tx) => {
      if (input.idempotencyKey && input.requestHash) {
        const existing = await tx.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (existing) {
          if (!compareRequestHash(existing.requestHash, input.requestHash)) throw new Error("IDEMPOTENCY_CONFLICT");
          return { payment: existing, order: existing.orderId ? await tx.order.findUnique({ where: { id: existing.orderId } }) : null, created: false };
        }
      }

      const type = input.type;
      const affectsClient = type === "CLIENT_PAYMENT" || type === "REFUND";
      const affectsPartner = type === payoutType;
      if ((affectsClient || affectsPartner) && !input.orderId) throw new Error("ORDER_REQUIRED");

      const order = input.orderId ? await lockOrder(tx, input.orderId) : null;
      if (input.orderId && !order) return null;
      const partnerId = input.partnerId ?? (affectsPartner ? order?.partnerId ?? undefined : undefined);
      if (partnerId && !await tx.partner.findUnique({ where: { id: partnerId }, select: { id: true } })) throw new Error("PARTNER_NOT_FOUND");
      if (affectsPartner && (!order?.partnerId || order.partnerId !== partnerId)) throw new Error("ORDER_PARTNER_REQUIRED");

      if (order && type === "CLIENT_PAYMENT") {
        if (input.amount > Number(order.balance)) throw new Error("PAYMENT_EXCEEDS_BALANCE");
      }
      if (order && type === "REFUND") {
        if (input.amount > Number(order.prepayment)) throw new Error("REFUND_EXCEEDS_PAID");
      }
      if (order && type === payoutType) {
        if (input.amount > Number(order.partnerBalance)) throw new Error("PARTNER_PAYMENT_EXCEEDS_BALANCE");
      }

      const payment = await tx.payment.create({
        data: {
          orderId: input.orderId,
          partnerId,
          amount: input.amount,
          type,
          method: input.method,
          comment: input.comment,
          operationDate: input.operationDate,
          author: input.author,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
        },
      });
      const mirrors = order && (affectsClient || affectsPartner) ? await calculatedMirrors(tx, order.id) : null;
      const updatedOrder = mirrors ? await tx.order.update({ where: { id: order!.id }, data: { prepayment: mirrors.paid, balance: mirrors.balance, partnerPaid: mirrors.partnerPaid, partnerBalance: mirrors.partnerBalance, companyProfit: mirrors.companyProfit } }) : order;
      if (mirrors && order) {
        await tx.orderEvent.create({ data: { orderId: order.id, title: type, description: `${input.amount} • ${input.method}${input.comment ? ` • ${input.comment}` : ""}`, user: input.author ?? "System", idempotencyKey: input.idempotencyKey ? `finance-event:${input.idempotencyKey}` : undefined, requestHash: input.requestHash } });
      }
      return { payment, order: updatedOrder, created: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 20_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < SERIALIZABLE_RETRIES - 1) continue;
    if (isPrismaUniqueConflict(error) && input.idempotencyKey && input.requestHash) {
      const existing = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing && compareRequestHash(existing.requestHash, input.requestHash)) return { payment: existing, order: existing.orderId ? await prisma.order.findUnique({ where: { id: existing.orderId } }) : null, created: false };
      throw new Error("IDEMPOTENCY_CONFLICT");
    }
    throw error;
  }
  throw new Error("FINANCE_CONCURRENCY_RETRY_EXHAUSTED");
}

export async function reverseFinanceOperation(input: { paymentId: number; reason: string; authorId: number; author: string; idempotencyKey: string; requestHash: string }) {
  if (!input.reason.trim()) throw new Error("REVERSAL_REASON_REQUIRED");
  for (let attempt = 0; attempt < SERIALIZABLE_RETRIES; attempt += 1) try {
    return await prisma.$transaction(async (tx) => {
      const replay = await tx.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (replay) { if (!compareRequestHash(replay.requestHash, input.requestHash)) throw new Error("IDEMPOTENCY_CONFLICT"); return { original: replay.reversalOfId ? await tx.payment.findUniqueOrThrow({ where: { id: replay.reversalOfId } }) : replay, reversal: replay, order: replay.orderId ? await tx.order.findUniqueOrThrow({ where: { id: replay.orderId } }) : null }; }
      const original = await tx.payment.findUnique({ where: { id: input.paymentId } });
      if (!original || !original.orderId) throw new Error("OPERATION_NOT_FOUND");
      await lockOrder(tx, original.orderId);
      if (original.reversalOfId || await tx.payment.findUnique({ where: { reversalOfId: original.id } })) throw new Error("ALREADY_REVERSED");
      const kind = operationKind(original.type);
      const reverseType = kind === "CLIENT_PAYMENT" ? "REFUND" : kind === "REFUND" ? "CLIENT_PAYMENT" : kind === payoutType ? "PARTNER_PAYOUT_REVERSAL" : "REVERSAL";
      const reversal = await tx.payment.create({ data: { orderId: original.orderId, partnerId: original.partnerId, amount: original.amount, type: reverseType, method: original.method, comment: `REVERSAL: ${input.reason.trim()}`, author: input.author, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, reversalOfId: original.id, reversalReason: input.reason.trim() } });
      const mirrors = await calculatedMirrors(tx, original.orderId);
      const updated = await tx.order.update({ where: { id: original.orderId }, data: { prepayment: mirrors.paid, balance: mirrors.balance, partnerPaid: mirrors.partnerPaid, partnerBalance: mirrors.partnerBalance, companyProfit: mirrors.companyProfit } });
      await tx.financeAuditEvent.create({ data: { orderId: original.orderId, action: "FINANCIAL_REVERSAL", entityType: "Payment", entityId: original.id, before: { type: original.type, amount: String(original.amount) }, after: { reversalId: reversal.id, type: reversal.type, amount: String(reversal.amount) }, reason: input.reason.trim(), authorId: input.authorId } });
      return { original, reversal, order: updated };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 20_000 });
  } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < SERIALIZABLE_RETRIES - 1) continue; throw error; }
  throw new Error("FINANCE_CONCURRENCY_RETRY_EXHAUSTED");
}

export async function adjustOrderAmount(input: { orderId: number; newAmount: number; reason: string; authorId: number; author: string; idempotencyKey?: string; requestHash?: string }) {
  if (!Number.isFinite(input.newAmount) || input.newAmount < 0) throw new Error("INVALID_AMOUNT");
  if (!input.reason.trim()) throw new Error("ADJUSTMENT_REASON_REQUIRED");
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, input.orderId);
    if (input.idempotencyKey) {
      const existing = await tx.commercialAdjustment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) { if (!compareRequestHash(existing.requestHash, input.requestHash ?? "")) throw new Error("IDEMPOTENCY_CONFLICT"); return { adjustment: existing, order: await tx.order.findUniqueOrThrow({ where: { id: input.orderId } }), created: false }; }
    }
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } });
    const previousAmount = order.amount, newAmount = new Prisma.Decimal(input.newAmount), balanceImpact = newAmount.sub(previousAmount);
    const adjustment = await tx.commercialAdjustment.create({ data: { orderId: order.id, previousAmount, newAmount, balanceImpact, reason: input.reason.trim(), authorId: input.authorId, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash } });
    const updated = await tx.order.update({ where: { id: order.id }, data: { amount: newAmount, balance: newAmount.sub(order.prepayment), companyProfit: newAmount.sub(order.partnerPrice) } });
    await tx.financeAuditEvent.create({ data: { orderId: order.id, action: "COMMERCIAL_ADJUSTMENT", entityType: "Order", entityId: order.id, before: { amount: String(previousAmount), balance: String(order.balance), companyProfit: String(order.companyProfit) }, after: { amount: String(updated.amount), balance: String(updated.balance), companyProfit: String(updated.companyProfit) }, reason: input.reason.trim(), authorId: input.authorId } });
    await tx.orderEvent.create({ data: { orderId: order.id, title: "Коммерческая корректировка", description: `${previousAmount.toString()} → ${newAmount.toString()} · ${input.reason.trim()}`, user: input.author } });
    return { adjustment, order: updated, created: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 20_000 });
}

// Kept for existing API consumers and business tests.
export async function createPayment(data: { orderId: number; amount: number; method: string; type: string; comment?: string; author?: string; idempotencyKey?: string; requestHash?: string }) {
  const result = await createFinanceOperation({ ...data, type: "CLIENT_PAYMENT" });
  return result && { payment: result.payment, order: result.order! };
}

export async function deletePayment(id: number) {
  void id;
  throw new Error("POSTED_OPERATION_IMMUTABLE");
}

export type FinanceFilters = { period?: "all" | "month" | "quarter" | "year"; manager?: string; partnerId?: number; paymentStatus?: "all" | "debt" | "partial" | "paid"; type?: string; orderId?: number; from?: Date; to?: Date };

function periodStart(period: FinanceFilters["period"]) {
  const now = new Date(); const start = new Date(now);
  if (period === "month") start.setMonth(now.getMonth() - 1);
  if (period === "quarter") start.setMonth(now.getMonth() - 3);
  if (period === "year") start.setFullYear(now.getFullYear() - 1);
  return start;
}

export async function getFinanceDashboard(filters: FinanceFilters = {}) {
  const startDate = periodStart(filters.period);
  const orderWhere = { ...(filters.period && filters.period !== "all" ? { createdAt: { gte: startDate } } : {}), ...(filters.manager ? { manager: filters.manager } : {}), ...(filters.partnerId ? { partnerId: filters.partnerId } : {}) };
  const [orders, operations] = await Promise.all([
    prisma.order.findMany({ where: orderWhere, include: { client: true, partner: true, payments: true }, orderBy: { createdAt: "desc" } }),
    getPayments({ type: filters.type, orderId: filters.orderId, partnerId: filters.partnerId, from: filters.from ?? (filters.period && filters.period !== "all" ? startDate : undefined), to: filters.to }),
  ]);
  const rows = orders.map((order) => {
    const paid = order.payments.reduce((sum, item) => { const kind = operationKind(item.type); return sum + (kind === "CLIENT_PAYMENT" ? Number(item.amount) : kind === "REFUND" ? -Number(item.amount) : 0); }, 0);
    const partnerPaid = order.payments.reduce((sum, item) => sum + (item.partnerId === order.partnerId && operationKind(item.type) === payoutType ? Number(item.amount) : item.partnerId === order.partnerId && item.type === "PARTNER_PAYOUT_REVERSAL" ? -Number(item.amount) : 0), 0);
    const amount = Number(order.amount), partnerPrice = Number(order.partnerPrice);
    const balance = amount - paid, partnerBalance = partnerPrice - partnerPaid;
    return { id: order.id, number: order.number, client: order.client.name, partner: order.partner?.name ?? "—", manager: order.manager, createdAt: order.createdAt, amount, prepayment: paid, balance, partnerPrice, partnerPaid, partnerBalance, companyProfit: amount - partnerPrice, paymentStatus: balance <= 0 ? "paid" : paid > 0 ? "partial" : "debt" };
  });
  const filteredRows = filters.paymentStatus && filters.paymentStatus !== "all" ? rows.filter((row) => row.paymentStatus === filters.paymentStatus) : rows;
  const totals = filteredRows.reduce((sum, row) => ({ turnover: sum.turnover + row.amount, received: sum.received + row.prepayment, clientBalance: sum.clientBalance + row.balance, partnerPaid: sum.partnerPaid + row.partnerPaid, partnerBalance: sum.partnerBalance + row.partnerBalance, profit: sum.profit + row.companyProfit }), { turnover: 0, received: 0, clientBalance: 0, partnerPaid: 0, partnerBalance: 0, profit: 0 });
  const operationTotals = operations.reduce((sum, item) => { const kind = operationKind(item.type); const sign = kind === "EXPENSE" || kind === "REFUND" || kind === payoutType || (kind === "ADJUSTMENT" && item.comment?.includes("[EXPENSE]")) ? -1 : 1; if (sign > 0) sum.income += Number(item.amount); else sum.expense += Number(item.amount); return sum; }, { income: 0, expense: 0 });
  const [managers, partners] = await Promise.all([prisma.order.findMany({ distinct: ["manager"], select: { manager: true }, orderBy: { manager: "asc" } }), prisma.partner.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  return { rows: filteredRows, totals, operations, operationTotals: { ...operationTotals, net: operationTotals.income - operationTotals.expense }, managers: managers.map((item) => item.manager), partners };
}
