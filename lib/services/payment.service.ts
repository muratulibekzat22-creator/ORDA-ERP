import { Prisma, Role } from "@prisma/client";
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
  authorId?: number;
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
      if (partnerId && !await tx.partner.findFirst({ where: { id: partnerId, active: true, archived: false, isTest: false }, select: { id: true } })) throw new Error("PARTNER_NOT_FOUND");
      if (affectsPartner && (!order?.partnerId || order.partnerId !== partnerId)) throw new Error("ORDER_PARTNER_REQUIRED");
      if (affectsPartner && !order?.partnerAgreedAt) throw new Error("PARTNER_PRICE_REQUIRED");

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
      if (affectsPartner && input.authorId) {
        await tx.financeAuditEvent.create({ data: {
          orderId: order!.id,
          action: "PARTNER_PAYOUT_CREATED",
          entityType: "Payment",
          entityId: payment.id,
          before: Prisma.JsonNull,
          after: { amount: String(payment.amount), partnerId, method: payment.method, operationDate: payment.operationDate.toISOString() },
          reason: input.comment?.trim() || "Partner payout",
          authorId: input.authorId,
        } });
      }
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

export type FinanceFilters = { period?: "all" | "today" | "week" | "month" | "quarter" | "year"; manager?: string; partnerId?: number; paymentStatus?: "all" | "debt" | "partial" | "paid"; type?: string; orderId?: number; from?: Date; to?: Date };

function financeRange(period: FinanceFilters["period"], from?: Date, to?: Date) {
  if (from || to) return { from, to };
  if (!period || period === "all") return {};
  const end = new Date();
  const start = new Date(end);
  start.setHours(0, 0, 0, 0);
  if (period === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (period === "month") start.setDate(1);
  if (period === "quarter") start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1);
  if (period === "year") start.setMonth(0, 1);
  return { from: start, to: end };
}

const operationInRange = (date: Date, from?: Date, to?: Date) => (!from || date >= from) && (!to || date <= to);

export async function getFinanceDashboard(filters: FinanceFilters = {}) {
  const selectedRange = financeRange(filters.period, filters.from, filters.to);
  const orderWhere: Prisma.OrderWhereInput = {
    lifecycle: { not: "CANCELLED" },
    ...(filters.manager ? { manager: filters.manager } : {}),
    ...(filters.partnerId ? { partnerId: filters.partnerId } : {}),
    ...(filters.orderId ? { id: filters.orderId } : {}),
  };
  const operationDate = selectedRange.from || selectedRange.to
    ? { ...(selectedRange.from ? { gte: selectedRange.from } : {}), ...(selectedRange.to ? { lte: selectedRange.to } : {}) }
    : undefined;
  const [orders, paymentOperations, ledgerEntries, payrollProfiles, managers, partners] = await Promise.all([
    prisma.order.findMany({ where: orderWhere, include: { client: true, partner: true, payments: true, payrollAccruals: { where: { direction: "INCREASE" }, include: { payments: true, reversedBy: { select: { id: true } } } } }, orderBy: { createdAt: "desc" } }),
    getPayments({ type: filters.type, orderId: filters.orderId, partnerId: filters.partnerId, from: selectedRange.from, to: selectedRange.to }),
    prisma.companyLedgerEntry.findMany({
      where: {
        ...(operationDate ? { operationDate } : {}),
        ...(filters.orderId ? { orderId: filters.orderId } : filters.manager ? { order: { manager: filters.manager } } : filters.partnerId ? { order: { partnerId: filters.partnerId } } : {}),
        OR: [{ payrollPaymentId: { not: null } }, { payrollAccrualId: null }],
      },
      include: {
        order: { select: { id: true, number: true, client: { select: { name: true } } } },
        author: { select: { name: true } },
        payrollPayment: { include: { employee: { include: { user: { select: { name: true } } } } } },
      },
      orderBy: [{ operationDate: "desc" }, { id: "desc" }],
    }),
    prisma.employeePayrollProfile.findMany({
      where: { active: true, payrollEnabled: true },
      select: { accruals: { select: { amount: true, direction: true } }, payments: { select: { amount: true, type: true } } },
    }),
    prisma.user.findMany({ where: { role: Role.MANAGER, active: true }, select: { name: true }, orderBy: { name: "asc" } }),
    prisma.partner.findMany({ where: { active: true, archived: false, isTest: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const rows = orders.map((order) => {
    const received = order.payments.reduce((sum, item) => { const kind = operationKind(item.type); return sum + (kind === "CLIENT_PAYMENT" ? Number(item.amount) : kind === "REFUND" ? -Number(item.amount) : 0); }, 0);
    const partnerPaid = order.payments.reduce((sum, item) => sum + (item.partnerId === order.partnerId && operationKind(item.type) === payoutType ? Number(item.amount) : item.partnerId === order.partnerId && item.type === "PARTNER_PAYOUT_REVERSAL" ? -Number(item.amount) : 0), 0);
    const amount = Number(order.amount), priceSet = order.partnerAgreedAt !== null;
    const partnerPrice = priceSet ? Number(order.partnerPrice) : null;
    const rawBalance = amount - received, rawPartnerBalance = partnerPrice === null ? 0 : partnerPrice - partnerPaid;
    const payrollRemaining = (types: string[]) => order.payrollAccruals
      .filter((accrual) => types.includes(accrual.type) && !accrual.reversedBy)
      .reduce((sum, accrual) => {
        const paid = accrual.payments.filter((payment) => !payment.reversalOfId && !payment.reversedAt).reduce((value, payment) => value + Number(payment.amount), 0);
        return sum + Math.max(Number(accrual.amount) - paid, 0);
      }, 0);
    return {
      id: order.id, number: order.number, client: order.client.name, partner: order.partner?.name ?? "—", manager: order.manager,
      createdAt: order.createdAt, partnerAgreedAt: order.partnerAgreedAt, promisedAt: order.promisedAt, partnerPlannedReadyAt: order.partnerPlannedReadyAt,
      amount, prepayment: received, balance: Math.max(rawBalance, 0), clientOverpayment: Math.max(-rawBalance, 0),
      priceSet, partnerPrice, partnerPaid: priceSet ? partnerPaid : 0, partnerBalance: priceSet ? Math.max(rawPartnerBalance, 0) : 0,
      partnerOverpayment: priceSet ? Math.max(-rawPartnerBalance, 0) : 0,
      grossMargin: partnerPrice === null ? null : amount - partnerPrice,
      managerBonusPayable: payrollRemaining(["GUARANTEED_ORDER_BONUS", "ORDER_BONUS", "EXTRA_BONUS"]),
      measurerBonusPayable: payrollRemaining(["MEASUREMENT_BONUS"]),
      paymentStatus: rawBalance <= 0 ? "paid" : received > 0 ? "partial" : "debt",
    };
  });
  const filteredRows = filters.paymentStatus && filters.paymentStatus !== "all" ? rows.filter((row) => row.paymentStatus === filters.paymentStatus) : rows;

  const normalizedPayments = paymentOperations.filter((item) => !filters.manager || item.order?.manager === filters.manager).map((item) => {
    const kind = operationKind(item.type);
    const outgoing = kind === "REFUND" || kind === payoutType || (kind === "ADJUSTMENT" && item.comment?.includes("[EXPENSE]"));
    return {
      id: `payment-${item.id}`, sourceId: item.id, source: "PAYMENT" as const, type: item.type, amount: Number(item.amount), direction: outgoing ? "EXPENSE" as const : "INCOME" as const,
      method: item.method, comment: item.comment, author: item.author, operationDate: item.operationDate,
      order: item.order ? { id: item.order.id, number: item.order.number, client: { name: item.order.client.name } } : null,
      partner: item.partner ? { name: item.partner.name } : item.order?.partner ? { name: item.order.partner.name } : null,
      employee: null,
    };
  });
  const normalizedLedger = ledgerEntries.map((item) => ({
    id: `ledger-${item.id}`, sourceId: item.id, source: "COMPANY_LEDGER" as const,
    type: item.payrollPaymentId ? "PAYROLL_PAYMENT" : item.direction === "INCOME" ? "OTHER_INCOME" : "OTHER_EXPENSE",
    amount: Number(item.amount), direction: item.direction === "INCOME" ? "INCOME" as const : "EXPENSE" as const,
    method: item.payrollPayment?.method ?? "ledger", comment: item.comment, author: item.author?.name ?? null, operationDate: item.operationDate,
    order: item.order, partner: null, employee: item.payrollPayment ? item.payrollPayment.employee.user?.name ?? item.payrollPayment.employee.name : null,
  }));
  const operations = [...normalizedPayments, ...normalizedLedger]
    .filter((item) => !filters.type || item.type === filters.type)
    .sort((a, b) => b.operationDate.getTime() - a.operationDate.getTime());
  const operationTotals = operations.reduce((sum, item) => {
    if (item.direction === "INCOME") sum.income += item.amount;
    else sum.expense += item.amount;
    return sum;
  }, { income: 0, expense: 0 });

  const payrollPayable = payrollProfiles.reduce((total, profile) => {
    const accrued = profile.accruals.reduce((sum, item) => sum + Number(item.amount) * (item.direction === "INCREASE" ? 1 : -1), 0);
    const paid = profile.payments.reduce((sum, item) => sum + Number(item.amount) * (item.type === "EMPLOYEE_REFUND" ? -1 : 1), 0);
    return total + Math.max(accrued - paid, 0);
  }, 0);
  const totals = filteredRows.reduce((sum, row) => ({
    turnover: sum.turnover + row.amount, received: sum.received + row.prepayment, clientBalance: sum.clientBalance + row.balance,
    partnerAgreed: sum.partnerAgreed + (row.partnerPrice ?? 0), partnerPaid: sum.partnerPaid + row.partnerPaid,
    partnerBalance: sum.partnerBalance + row.partnerBalance, profit: sum.profit + (row.grossMargin ?? 0),
  }), { turnover: 0, received: 0, clientBalance: 0, partnerAgreed: 0, partnerPaid: 0, partnerBalance: 0, profit: 0 });
  const grossMargin = filteredRows
    .filter((row) => row.grossMargin !== null && operationInRange(row.createdAt, selectedRange.from, selectedRange.to))
    .reduce((sum, row) => sum + (row.grossMargin ?? 0), 0);
  const cards = { receipts: operationTotals.income, expenses: operationTotals.expense, customerReceivable: totals.clientBalance, partnerPayable: totals.partnerBalance, payrollPayable, grossMargin };
  const partnerAgreedPeriod = filteredRows.filter((row) => row.partnerAgreedAt && operationInRange(row.partnerAgreedAt, selectedRange.from, selectedRange.to)).reduce((sum, row) => sum + (row.partnerPrice ?? 0), 0);
  const partnerPaidPeriod = normalizedPayments.reduce((sum, item) => item.type === "PARTNER_PAYOUT" ? sum + item.amount : item.type === "PARTNER_PAYOUT_REVERSAL" ? sum - item.amount : sum, 0);

  const trendMap = new Map<string, { date: string; income: number; expense: number }>();
  operations.forEach((item) => {
    const date = item.operationDate.toISOString().slice(0, 10);
    const row = trendMap.get(date) ?? { date, income: 0, expense: 0 };
    row[item.direction === "INCOME" ? "income" : "expense"] += item.amount;
    trendMap.set(date, row);
  });
  const partnerMap = new Map<number, { partnerId: number; partner: string; orders: number; agreed: number; paid: number; remaining: number }>();
  filteredRows.forEach((row) => {
    const order = orders.find((item) => item.id === row.id);
    if (!order?.partnerId || !order.partner || !row.priceSet) return;
    const value = partnerMap.get(order.partnerId) ?? { partnerId: order.partnerId, partner: order.partner.name, orders: 0, agreed: 0, paid: 0, remaining: 0 };
    value.orders += 1; value.agreed += row.partnerPrice ?? 0; value.paid += row.partnerPaid; value.remaining += row.partnerBalance;
    partnerMap.set(order.partnerId, value);
  });
  const now = new Date();
  const alerts = {
    withoutPartner: filteredRows.filter((row) => !orders.find((item) => item.id === row.id)?.partnerId).length,
    withoutPartnerPrice: filteredRows.filter((row) => Boolean(orders.find((item) => item.id === row.id)?.partnerId) && !row.priceSet).length,
    overdueCustomer: filteredRows.filter((row) => row.promisedAt && row.promisedAt < now && row.balance > 0).length,
    overduePartner: filteredRows.filter((row) => row.partnerPlannedReadyAt && row.partnerPlannedReadyAt < now && row.partnerBalance > 0).length,
  };
  return {
    rows: filteredRows, totals, cards, operations,
    operationTotals: { ...operationTotals, net: operationTotals.income - operationTotals.expense },
    trend: [...trendMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    partnerTotals: { agreed: partnerAgreedPeriod, paid: partnerPaidPeriod, remaining: totals.partnerBalance },
    partnerBreakdown: [...partnerMap.values()].sort((a, b) => b.remaining - a.remaining),
    alerts, managers: managers.map((item) => item.name), partners,
  };
}
