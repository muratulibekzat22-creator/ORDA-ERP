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
  try {
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

      const order = input.orderId ? await tx.order.findUnique({ where: { id: input.orderId } }) : null;
      if (input.orderId && !order) return null;
      const partnerId = input.partnerId ?? (affectsPartner ? order?.partnerId ?? undefined : undefined);
      if (partnerId && !await tx.partner.findUnique({ where: { id: partnerId }, select: { id: true } })) throw new Error("PARTNER_NOT_FOUND");
      if (affectsPartner && (!order?.partnerId || order.partnerId !== partnerId)) throw new Error("ORDER_PARTNER_REQUIRED");

      let orderUpdate: { prepayment?: string; balance?: string; partnerPaid?: string; partnerBalance?: string } = {};
      if (order && type === "CLIENT_PAYMENT") {
        if (input.amount > Number(order.balance)) throw new Error("PAYMENT_EXCEEDS_BALANCE");
        const paid = Number(order.prepayment) + input.amount;
        orderUpdate = { prepayment: String(paid), balance: String(Number(order.amount) - paid) };
      }
      if (order && type === "REFUND") {
        if (input.amount > Number(order.prepayment)) throw new Error("REFUND_EXCEEDS_PAID");
        const paid = Number(order.prepayment) - input.amount;
        orderUpdate = { prepayment: String(paid), balance: String(Number(order.amount) - paid) };
      }
      if (order && type === payoutType) {
        if (input.amount > Number(order.partnerBalance)) throw new Error("PARTNER_PAYMENT_EXCEEDS_BALANCE");
        const paid = Number(order.partnerPaid) + input.amount;
        orderUpdate = { partnerPaid: String(paid), partnerBalance: String(Number(order.partnerPrice) - paid) };
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
      const updatedOrder = order && Object.keys(orderUpdate).length
        ? await tx.order.update({ where: { id: order.id }, data: orderUpdate })
        : order;
      if (order && Object.keys(orderUpdate).length) {
        await tx.orderEvent.create({ data: { orderId: order.id, title: type, description: `${input.amount} • ${input.method}${input.comment ? ` • ${input.comment}` : ""}`, user: input.author ?? "System", idempotencyKey: input.idempotencyKey ? `finance-event:${input.idempotencyKey}` : undefined, requestHash: input.requestHash } });
      }
      return { payment, order: updatedOrder, created: true };
    });
  } catch (error) {
    if (isPrismaUniqueConflict(error) && input.idempotencyKey && input.requestHash) {
      const existing = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing && compareRequestHash(existing.requestHash, input.requestHash)) return { payment: existing, order: existing.orderId ? await prisma.order.findUnique({ where: { id: existing.orderId } }) : null, created: false };
      throw new Error("IDEMPOTENCY_CONFLICT");
    }
    throw error;
  }
}

// Kept for existing API consumers and business tests.
export async function createPayment(data: { orderId: number; amount: number; method: string; type: string; comment?: string; author?: string; idempotencyKey?: string; requestHash?: string }) {
  const result = await createFinanceOperation({ ...data, type: "CLIENT_PAYMENT" });
  return result && { payment: result.payment, order: result.order! };
}

export async function deletePayment(id: number) {
  return prisma.payment.delete({ where: { id } });
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
    const paid = order.payments.reduce((sum, item) => { const kind = operationKind(item.type); return sum + (kind === "CLIENT_PAYMENT" ? item.amount : kind === "REFUND" ? -item.amount : 0); }, 0);
    const partnerPaid = order.payments.reduce((sum, item) => sum + (operationKind(item.type) === payoutType ? item.amount : 0), 0);
    const amount = Number(order.amount), partnerPrice = Number(order.partnerPrice);
    const balance = amount - paid, partnerBalance = partnerPrice - partnerPaid;
    return { id: order.id, number: order.number, client: order.client.name, partner: order.partner?.name ?? "—", manager: order.manager, createdAt: order.createdAt, amount, prepayment: paid, balance, partnerPrice, partnerPaid, partnerBalance, companyProfit: amount - partnerPrice, paymentStatus: balance <= 0 ? "paid" : paid > 0 ? "partial" : "debt" };
  });
  const filteredRows = filters.paymentStatus && filters.paymentStatus !== "all" ? rows.filter((row) => row.paymentStatus === filters.paymentStatus) : rows;
  const totals = filteredRows.reduce((sum, row) => ({ turnover: sum.turnover + row.amount, received: sum.received + row.prepayment, clientBalance: sum.clientBalance + row.balance, partnerPaid: sum.partnerPaid + row.partnerPaid, partnerBalance: sum.partnerBalance + row.partnerBalance, profit: sum.profit + row.companyProfit }), { turnover: 0, received: 0, clientBalance: 0, partnerPaid: 0, partnerBalance: 0, profit: 0 });
  const operationTotals = operations.reduce((sum, item) => { const kind = operationKind(item.type); const sign = kind === "EXPENSE" || kind === "REFUND" || kind === payoutType || (kind === "ADJUSTMENT" && item.comment?.includes("[EXPENSE]")) ? -1 : 1; if (sign > 0) sum.income += item.amount; else sum.expense += item.amount; return sum; }, { income: 0, expense: 0 });
  const [managers, partners] = await Promise.all([prisma.order.findMany({ distinct: ["manager"], select: { manager: true }, orderBy: { manager: "asc" } }), prisma.partner.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  return { rows: filteredRows, totals, operations, operationTotals: { ...operationTotals, net: operationTotals.income - operationTotals.expense }, managers: managers.map((item) => item.manager), partners };
}
