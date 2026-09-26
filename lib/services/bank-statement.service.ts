import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import {
  normalizeCounterparty,
  parseKaspiStatement,
  type BankStatementDirection,
  type ParsedBankStatementTransaction,
} from "@/lib/bank-statements/parser";
import { createRequestHash } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { createFinanceOperation } from "@/lib/services/payment.service";
import { requireTenantIdentity } from "@/lib/tenant-context";

const clientPaymentTypes = ["CLIENT_PAYMENT", "payment", "PREPAYMENT", "ADDITIONAL_PAYMENT"];

type Actor = { userId: number; name: string };
type ImportFile = { fileName: string; contentType: string; size: number; bytes: Buffer };

export type StatementDecision = {
  transactionId: number;
  action: "POST" | "SKIP";
  kind?: "CLIENT_PAYMENT" | "INCOME" | "EXPENSE";
  orderId?: number | null;
  clientId?: number | null;
  categoryId?: number | null;
  recurringExpensePlanId?: number | null;
  rememberRule?: boolean;
};

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Almaty",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function dayKey(value: Date) {
  return dayFormatter.format(value);
}

function monthKey(value: Date) {
  return dayKey(value).slice(0, 7);
}

function moneyEquals(left: number | Prisma.Decimal, right: number | Prisma.Decimal) {
  return Math.abs(Number(left) - Number(right)) < 0.005;
}

function safeFileName(value: string) {
  return value.normalize("NFKC").replace(/[\u0000-\u001f\u007f/\\]/g, "_").replace(/\s+/g, " ").trim().slice(0, 180) || "kaspi-statement.xlsx";
}

function compact(value: string | null | undefined, limit = 1_000) {
  const result = String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return result ? result.slice(0, limit) : null;
}

function transactionFingerprint(accountLabel: string | null, item: ParsedBankStatementTransaction, occurrence: number) {
  return createHash("sha256").update([
    accountLabel ?? "kaspi",
    item.operationDate.toISOString(),
    item.direction,
    item.amount.toFixed(2),
    normalizeCounterparty(item.counterparty),
    normalizeCounterparty(item.description),
    compact(item.reference, 200) ?? "",
    String(occurrence),
  ].join("|")).digest("hex");
}

function transactionBase(item: ParsedBankStatementTransaction) {
  return [
    item.operationDate.toISOString(),
    item.direction,
    item.amount.toFixed(2),
    normalizeCounterparty(item.counterparty),
    normalizeCounterparty(item.description),
    compact(item.reference, 200) ?? "",
  ].join("|");
}

function includesKaspi(value: string | null | undefined) {
  return /kaspi|каспи/i.test(value ?? "");
}

function partyMatchesClient(counterparty: string | null, client: { name: string; phone: string }) {
  const party = normalizeCounterparty(counterparty);
  const name = normalizeCounterparty(client.name);
  if (party && name && (party.includes(name) || name.includes(party))) return true;
  const partyDigits = (counterparty ?? "").replace(/\D/g, "");
  const clientDigits = client.phone.replace(/\D/g, "");
  return partyDigits.length >= 7 && clientDigits.length >= 7 && partyDigits.slice(-7) === clientDigits.slice(-7);
}

function expenseCategoryCode(text: string) {
  const rules: Array<[RegExp, string, number]> = [
    [/таргет|реклам|facebook|instagram|tiktok|meta ads|google ads|yandex direct/i, "ADVERTISING", 88],
    [/подпис|canva|adobe|figma|zoom|notion|google one|icloud|microsoft 365/i, "SUBSCRIPTIONS", 88],
    [/програм|software|crm|hosting|хостинг|cloud|openai|chatgpt/i, "SOFTWARE", 82],
    [/азс|бензин|топлив|helios|sinooil|qazaq oil|gas station/i, "FUEL", 88],
    [/такси|yandex go|indriver|транспорт|доставк/i, "TRANSPORT", 80],
    [/налог|kgd|комитет государственных доходов|бюджет/i, "TAX", 90],
    [/интернет|tele2|beeline|kcell|activ|altel/i, "COMMUNICATION", 84],
    [/уборк|клининг/i, "CLEANING", 90],
    [/аренд/i, "RENT", 90],
    [/с[ъь]емк|видеограф|фотограф|контент/i, "CONTENT_PRODUCTION", 82],
    [/материал|строймат|строительн/i, "MATERIALS", 72],
    [/канц|офисн/i, "OFFICE", 70],
    [/зарплат|оклад/i, "SALARY", 55],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.slice(1) as [string, number] | undefined;
}

type AnalysisContext = Awaited<ReturnType<typeof analysisContext>>;

async function analysisContext(transactions: ParsedBankStatementTransaction[]) {
  const dates = transactions.map((item) => item.operationDate.getTime());
  const from = new Date(Math.min(...dates) - 86_400_000);
  const to = new Date(Math.max(...dates) + 86_400_000);
  const [categories, rules, orders, payments, ledgerEntries, recurringPlans] = await Promise.all([
    prisma.financeCategory.findMany({ where: { active: true }, select: { id: true, code: true, direction: true, name: true } }),
    prisma.bankStatementRule.findMany({ where: { active: true } }),
    prisma.order.findMany({
      where: { deletedAt: null, lifecycle: { not: "CANCELLED" }, balance: { gt: 0 } },
      select: { id: true, number: true, amount: true, prepayment: true, balance: true, requiredPrepayment: true, paymentMethod: true, orderReceivedAt: true, createdAt: true, clientId: true, client: { select: { id: true, name: true, phone: true } } },
      orderBy: { createdAt: "desc" },
      take: 1_000,
    }),
    prisma.payment.findMany({
      where: { operationDate: { gte: from, lte: to }, type: { in: clientPaymentTypes } },
      select: { id: true, amount: true, method: true, operationDate: true, orderId: true, order: { select: { client: { select: { name: true, phone: true } } } } },
    }),
    prisma.companyLedgerEntry.findMany({
      where: { operationDate: { gte: from, lte: to }, voidedAt: null },
      select: { id: true, amount: true, direction: true, method: true, operationDate: true, counterparty: true, source: true, recurringExpensePlanId: true, recurringPeriod: true },
    }),
    prisma.recurringExpensePlan.findMany({ where: { active: true }, select: { id: true, name: true, amount: true, categoryId: true, counterparty: true } }),
  ]);
  return {
    categories,
    categoryByCode: new Map(categories.map((item) => [`${item.direction}:${item.code}`, item])),
    rules: new Map(rules.map((item) => [`${item.direction}:${item.normalizedCounterparty}`, item])),
    orders,
    payments,
    ledgerEntries,
    recurringPlans,
  };
}

function matchingOrder(item: ParsedBankStatementTransaction, context: AnalysisContext, clientId?: number | null) {
  const candidates = context.orders
    .filter((order) => !clientId || order.clientId === clientId)
    .map((order) => {
      let score = 0;
      const reasons: string[] = [];
      if (includesKaspi(order.paymentMethod)) { score += 40; reasons.push("в заказе выбран Kaspi"); }
      else return null;
      if (moneyEquals(order.balance, item.amount)) { score += 35; reasons.push("сумма равна остатку"); }
      else if (Number(order.requiredPrepayment) > 0 && moneyEquals(order.requiredPrepayment, item.amount)) { score += 30; reasons.push("сумма равна предоплате"); }
      else if (Number(order.prepayment) === 0 && moneyEquals(order.amount, item.amount)) { score += 25; reasons.push("сумма равна стоимости заказа"); }
      else return null;
      if (dayKey(order.orderReceivedAt) === dayKey(item.operationDate) || dayKey(order.createdAt) === dayKey(item.operationDate)) { score += 25; reasons.push("заказ оформлен в этот день"); }
      if (partyMatchesClient(item.counterparty, order.client)) { score += 30; reasons.push("совпадает клиент"); }
      return { order, score, reasons };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((left, right) => right.score - left.score);
  const best = candidates[0];
  if (!best || best.score < 75 || (candidates[1] && best.score - candidates[1].score < 10)) return null;
  return best;
}

function alreadyRecorded(item: ParsedBankStatementTransaction, context: AnalysisContext) {
  if (item.direction === "INCOME") {
    const matches = context.payments.filter((payment) =>
      moneyEquals(payment.amount, item.amount) &&
      dayKey(payment.operationDate) === dayKey(item.operationDate) &&
      includesKaspi(payment.method) &&
      (!item.counterparty || !payment.order || partyMatchesClient(item.counterparty, payment.order.client)),
    );
    return matches.length === 1 ? { kind: "payment" as const, id: matches[0].id, orderId: matches[0].orderId } : null;
  }
  const matches = context.ledgerEntries.filter((entry) =>
    entry.direction === "EXPENSE" &&
    moneyEquals(entry.amount, item.amount) &&
    dayKey(entry.operationDate) === dayKey(item.operationDate) &&
    (includesKaspi(entry.method) || entry.method === "card") &&
    (!item.counterparty || !entry.counterparty || normalizeCounterparty(entry.counterparty) === normalizeCounterparty(item.counterparty)),
  );
  return matches.length === 1 ? { kind: "ledger" as const, id: matches[0].id, orderId: null } : null;
}

function suggestion(item: ParsedBankStatementTransaction, context: AnalysisContext) {
  const normalizedParty = normalizeCounterparty(item.counterparty);
  const savedRule = normalizedParty ? context.rules.get(`${item.direction}:${normalizedParty}`) : null;
  const existing = alreadyRecorded(item, context);
  if (existing) return {
    suggestedKind: "ALREADY_RECORDED",
    suggestedCategoryId: null,
    suggestedOrderId: existing.orderId,
    suggestedClientId: null,
    suggestedRecurringExpensePlanId: null,
    confidence: 98,
    matchReason: "Похожая операция уже есть в журнале. Проверьте и отметьте как учтённую, чтобы не создать дубль.",
    selected: false,
  };
  if (item.direction === "INCOME") {
    const orderMatch = matchingOrder(item, context, savedRule?.clientId);
    if (orderMatch) return {
      suggestedKind: "CLIENT_PAYMENT",
      suggestedCategoryId: context.categoryByCode.get("INCOME:CLIENT_PAYMENT")?.id ?? null,
      suggestedOrderId: orderMatch.order.id,
      suggestedClientId: orderMatch.order.clientId,
      suggestedRecurringExpensePlanId: null,
      confidence: Math.min(orderMatch.score, 100),
      matchReason: `Предложен ${orderMatch.order.number}: ${orderMatch.reasons.join(", ")}.`,
      selected: orderMatch.score >= 95,
    };
    if (savedRule?.kind === "INCOME" && savedRule.categoryId) return {
      suggestedKind: "INCOME",
      suggestedCategoryId: savedRule.categoryId,
      suggestedOrderId: null,
      suggestedClientId: savedRule.clientId,
      suggestedRecurringExpensePlanId: null,
      confidence: 95,
      matchReason: "Применено сохранённое правило для этого отправителя.",
      selected: true,
    };
    return {
      suggestedKind: "INCOME",
      suggestedCategoryId: context.categoryByCode.get("INCOME:OTHER_INCOME")?.id ?? null,
      suggestedOrderId: null,
      suggestedClientId: null,
      suggestedRecurringExpensePlanId: null,
      confidence: 30,
      matchReason: "Заказ по сумме и способу оплаты не найден — требуется проверка.",
      selected: false,
    };
  }
  if (savedRule?.kind === "EXPENSE" && savedRule.categoryId) return {
    suggestedKind: "EXPENSE",
    suggestedCategoryId: savedRule.categoryId,
    suggestedOrderId: null,
    suggestedClientId: null,
    suggestedRecurringExpensePlanId: null,
    confidence: 95,
    matchReason: "Применено сохранённое правило для этого получателя.",
    selected: true,
  };
  const searchable = `${item.counterparty ?? ""} ${item.description ?? ""}`;
  const categoryGuess = expenseCategoryCode(searchable);
  const category = categoryGuess ? context.categoryByCode.get(`EXPENSE:${categoryGuess[0]}`) : context.categoryByCode.get("EXPENSE:OTHER");
  const confidence = categoryGuess?.[1] ?? 25;
  const recurringCandidates = category ? context.recurringPlans.filter((plan) => plan.categoryId === category.id && moneyEquals(plan.amount, item.amount)) : [];
  const recurring = recurringCandidates.length === 1 ? recurringCandidates[0] : null;
  const recurringPosted = recurring ? context.ledgerEntries.some((entry) => entry.recurringExpensePlanId === recurring.id && entry.recurringPeriod === monthKey(item.operationDate)) : false;
  return {
    suggestedKind: recurringPosted ? "ALREADY_RECORDED" : "EXPENSE",
    suggestedCategoryId: category?.id ?? null,
    suggestedOrderId: null,
    suggestedClientId: null,
    suggestedRecurringExpensePlanId: recurring?.id ?? null,
    confidence: recurring ? Math.max(confidence, 92) : confidence,
    matchReason: recurringPosted
      ? `Постоянный расход «${recurring?.name}» за этот месяц уже проведён.`
      : recurring
        ? `Совпадает с постоянным расходом «${recurring.name}» по категории и сумме.`
        : categoryGuess
          ? `Категория предложена по назначению платежа: ${category?.name ?? categoryGuess[0]}.`
          : "Категория не распознана — выберите её перед проведением.",
    selected: !recurringPosted && (recurring ? true : confidence >= 80 && categoryGuess?.[0] !== "SALARY"),
  };
}

export async function importKaspiStatement(file: ImportFile, actor: Actor) {
  const identity = requireTenantIdentity();
  const fileHash = createHash("sha256").update(file.bytes).digest("hex");
  const existing = await prisma.bankStatementImport.findFirst({ where: { fileHash }, select: { id: true } });
  if (existing) return { replay: true, workspace: await getBankStatementWorkspace(existing.id) };
  const parsed = await parseKaspiStatement({ fileName: file.fileName, contentType: file.contentType, bytes: file.bytes });
  const context = await analysisContext(parsed.transactions);
  const occurrences = new Map<string, number>();
  const prepared = parsed.transactions.map((item) => {
    const base = transactionBase(item);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return { item, fingerprint: transactionFingerprint(parsed.accountLabel, item, occurrence), suggestion: suggestion(item, context) };
  });
  const existingFingerprints = new Set((await prisma.bankStatementTransaction.findMany({
    where: { fingerprint: { in: prepared.map((item) => item.fingerprint) } },
    select: { fingerprint: true },
  })).map((item) => item.fingerprint));
  const fresh = prepared.filter((item) => !existingFingerprints.has(item.fingerprint));
  const created = await prisma.$transaction(async (tx) => {
    const statementImport = await tx.bankStatementImport.create({ data: {
      provider: parsed.provider,
      accountLabel: parsed.accountLabel,
      fileName: safeFileName(file.fileName),
      contentType: compact(file.contentType, 120) ?? "application/octet-stream",
      fileSize: file.size,
      fileHash,
      status: fresh.length ? "REVIEW" : "COMPLETED",
      totalRows: parsed.totalRows,
      importedRows: fresh.length,
      duplicateRows: prepared.length - fresh.length,
      createdById: actor.userId,
    } });
    if (fresh.length) await tx.bankStatementTransaction.createMany({ data: fresh.map(({ item, fingerprint, suggestion: proposed }) => ({
      importId: statementImport.id,
      fingerprint,
      rowNumber: item.rowNumber,
      operationDate: item.operationDate,
      direction: item.direction,
      amount: item.amount,
      currency: item.currency,
      counterparty: compact(item.counterparty, 300),
      description: compact(item.description, 1_000),
      reference: compact(item.reference, 200),
      raw: item.raw as Prisma.InputJsonValue,
      ...proposed,
    })) });
    return statementImport;
  });
  void identity;
  return { replay: false, workspace: await getBankStatementWorkspace(created.id) };
}

export async function getBankStatementWorkspace(importId?: number) {
  const imports = await prisma.bankStatementImport.findMany({
    select: {
      id: true, provider: true, accountLabel: true, fileName: true, status: true, totalRows: true, importedRows: true, duplicateRows: true, createdAt: true,
      _count: { select: { transactions: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  const selectedImportId = importId && imports.some((item) => item.id === importId) ? importId : imports[0]?.id ?? null;
  const [transactions, categories, orders, clients] = await Promise.all([
    selectedImportId ? prisma.bankStatementTransaction.findMany({
      where: { importId: selectedImportId },
      select: {
        id: true, rowNumber: true, operationDate: true, direction: true, amount: true, currency: true, counterparty: true, description: true, reference: true,
        status: true, suggestedKind: true, confidence: true, matchReason: true, selected: true,
        suggestedCategoryId: true, suggestedOrderId: true, suggestedClientId: true, suggestedRecurringExpensePlanId: true,
        suggestedCategory: { select: { id: true, name: true, direction: true } },
        suggestedOrder: { select: { id: true, number: true, balance: true, client: { select: { name: true } } } },
        suggestedClient: { select: { id: true, name: true } },
        suggestedRecurringExpensePlan: { select: { id: true, name: true } },
      },
      orderBy: [{ operationDate: "desc" }, { rowNumber: "asc" }],
      take: 2_000,
    }) : Promise.resolve([]),
    prisma.financeCategory.findMany({ where: { active: true }, select: { id: true, code: true, name: true, direction: true }, orderBy: [{ direction: "asc" }, { name: "asc" }] }),
    prisma.order.findMany({
      where: { deletedAt: null, lifecycle: { not: "CANCELLED" }, balance: { gt: 0 } },
      select: { id: true, number: true, balance: true, paymentMethod: true, clientId: true, client: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 1_000,
    }),
    prisma.client.findMany({ where: { active: true, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 1_000 }),
  ]);
  return {
    imports,
    selectedImportId,
    transactions: transactions.map((item) => ({ ...item, amount: Number(item.amount), suggestedOrder: item.suggestedOrder ? { ...item.suggestedOrder, balance: Number(item.suggestedOrder.balance) } : null })),
    options: {
      categories,
      orders: orders.map((item) => ({ id: item.id, name: `${item.number} — ${item.client.name} — остаток ${Number(item.balance)}`, clientId: item.clientId, paymentMethod: item.paymentMethod })),
      clients,
    },
  };
}

async function rememberRule(tx: Prisma.TransactionClient, transaction: { direction: string; counterparty: string | null }, decision: StatementDecision, actorId: number) {
  if (!decision.rememberRule) return;
  const normalizedCounterparty = normalizeCounterparty(transaction.counterparty);
  if (normalizedCounterparty.length < 2 || !decision.kind) return;
  const current = await tx.bankStatementRule.findFirst({ where: { normalizedCounterparty, direction: transaction.direction } });
  const data = {
    kind: decision.kind,
    categoryId: decision.kind === "CLIENT_PAYMENT" ? null : decision.categoryId ?? null,
    clientId: decision.clientId ?? null,
    active: true,
    updatedById: actorId,
  };
  if (current) await tx.bankStatementRule.update({ where: { id: current.id }, data });
  else await tx.bankStatementRule.create({ data: { normalizedCounterparty, direction: transaction.direction, ...data } });
}

async function updateImportStatus(importId: number) {
  const grouped = await prisma.bankStatementTransaction.groupBy({ by: ["status"], where: { importId }, _count: { _all: true } });
  const pending = grouped.find((item) => item.status === "PENDING")?._count._all ?? 0;
  const resolved = grouped.reduce((sum, item) => sum + (item.status === "PENDING" ? 0 : item._count._all), 0);
  await prisma.bankStatementImport.update({ where: { id: importId }, data: { status: pending === 0 ? "COMPLETED" : resolved > 0 ? "PARTIAL" : "REVIEW" } });
}

async function skipTransaction(transactionId: number, actor: Actor) {
  const transaction = await prisma.bankStatementTransaction.findUnique({ where: { id: transactionId } });
  if (!transaction) throw new Error("STATEMENT_TRANSACTION_NOT_FOUND");
  if (transaction.status !== "PENDING") return transaction;
  const updated = await prisma.bankStatementTransaction.update({ where: { id: transaction.id }, data: { status: "SKIPPED", selected: false, resolvedById: actor.userId, resolvedAt: new Date() } });
  await prisma.financeAuditEvent.create({ data: { orderId: transaction.suggestedOrderId, action: "BANK_STATEMENT_SKIPPED", entityType: "BankStatementTransaction", entityId: transaction.id, before: { status: transaction.status }, after: { status: updated.status }, reason: transaction.matchReason ?? "Операция выписки отмечена как учтённая или пропущенная", authorId: actor.userId } });
  return updated;
}

async function postClientPayment(transactionId: number, decision: StatementDecision, actor: Actor) {
  const transaction = await prisma.bankStatementTransaction.findUnique({ where: { id: transactionId } });
  if (!transaction) throw new Error("STATEMENT_TRANSACTION_NOT_FOUND");
  if (transaction.status !== "PENDING") return transaction;
  if (transaction.direction !== "INCOME" || !decision.orderId) throw new Error("INVALID_STATEMENT_DECISION");
  const order = await prisma.order.findFirst({ where: { id: decision.orderId, deletedAt: null, lifecycle: { not: "CANCELLED" } }, select: { id: true, clientId: true } });
  if (!order) throw new Error("ORDER_NOT_FOUND");
  const idempotencyKey = `bank-statement:${transaction.fingerprint}:payment`;
  const requestHash = createRequestHash({ transactionId: transaction.id, orderId: order.id, amount: transaction.amount.toString(), operationDate: transaction.operationDate.toISOString() });
  const result = await createFinanceOperation({
    type: "CLIENT_PAYMENT",
    amount: Number(transaction.amount),
    method: "kaspi",
    orderId: order.id,
    comment: `Выписка Kaspi${transaction.reference ? ` · ${transaction.reference}` : ""}${transaction.description ? ` · ${transaction.description}` : ""}`.slice(0, 2_000),
    operationDate: transaction.operationDate,
    author: actor.name,
    authorId: actor.userId,
    idempotencyKey,
    requestHash,
  });
  if (!result) throw new Error("ORDER_NOT_FOUND");
  await prisma.$transaction(async (tx) => {
    await tx.bankStatementTransaction.update({ where: { id: transaction.id }, data: {
      status: "POSTED", selected: false, suggestedKind: "CLIENT_PAYMENT", suggestedOrderId: order.id, suggestedClientId: order.clientId,
      postedPaymentId: result.payment.id, resolvedById: actor.userId, resolvedAt: new Date(),
    } });
    await rememberRule(tx, transaction, { ...decision, clientId: order.clientId }, actor.userId);
  });
  return result.payment;
}

async function postLedgerEntry(transactionId: number, decision: StatementDecision, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const transaction = await tx.bankStatementTransaction.findUnique({ where: { id: transactionId } });
    if (!transaction) throw new Error("STATEMENT_TRANSACTION_NOT_FOUND");
    if (transaction.status !== "PENDING") return transaction;
    const expectedDirection: BankStatementDirection = decision.kind === "INCOME" ? "INCOME" : "EXPENSE";
    if (transaction.direction !== expectedDirection || !decision.categoryId) throw new Error("INVALID_STATEMENT_DECISION");
    const category = await tx.financeCategory.findFirst({ where: { id: decision.categoryId, direction: expectedDirection, active: true } });
    if (!category) throw new Error("CATEGORY_NOT_FOUND");
    const client = decision.clientId ? await tx.client.findFirst({ where: { id: decision.clientId, active: true, deletedAt: null }, select: { id: true } }) : null;
    if (decision.clientId && !client) throw new Error("CLIENT_NOT_FOUND");
    const recurringPlanId = expectedDirection === "EXPENSE" ? decision.recurringExpensePlanId ?? transaction.suggestedRecurringExpensePlanId : null;
    const recurringPlan = recurringPlanId ? await tx.recurringExpensePlan.findFirst({ where: { id: recurringPlanId, active: true, categoryId: category.id } }) : null;
    if (recurringPlanId && (!recurringPlan || !moneyEquals(recurringPlan.amount, transaction.amount))) throw new Error("RECURRING_PLAN_MISMATCH");
    const recurringPeriod = recurringPlan ? monthKey(transaction.operationDate) : null;
    if (recurringPlan) {
      const posted = await tx.companyLedgerEntry.findFirst({ where: { recurringExpensePlanId: recurringPlan.id, recurringPeriod } });
      if (posted) {
        await tx.bankStatementTransaction.update({ where: { id: transaction.id }, data: { status: "MATCHED", selected: false, postedLedgerEntryId: posted.id, resolvedById: actor.userId, resolvedAt: new Date(), matchReason: `Постоянный расход «${recurringPlan.name}» уже был проведён.` } });
        return posted;
      }
    }
    const idempotencyKey = `bank-statement:${transaction.fingerprint}:ledger`;
    const existing = await tx.companyLedgerEntry.findUnique({ where: { idempotencyKey } });
    if (existing) return existing;
    const entry = await tx.companyLedgerEntry.create({ data: {
      type: expectedDirection === "INCOME" ? "BANK_STATEMENT_INCOME" : "BANK_STATEMENT_EXPENSE",
      category: category.code,
      categoryId: category.id,
      direction: expectedDirection,
      source: "BANK_STATEMENT",
      amount: transaction.amount,
      operationDate: transaction.operationDate,
      method: "kaspi",
      counterparty: transaction.counterparty,
      comment: `Выписка Kaspi${transaction.reference ? ` · ${transaction.reference}` : ""}${transaction.description ? ` · ${transaction.description}` : ""}`.slice(0, 2_000),
      clientId: client?.id ?? null,
      recurringExpensePlanId: recurringPlan?.id ?? null,
      recurringPeriod,
      authorId: actor.userId,
      idempotencyKey,
      requestHash: createRequestHash({ transactionId: transaction.id, categoryId: category.id, amount: transaction.amount.toString(), direction: expectedDirection }),
    } });
    await tx.bankStatementTransaction.update({ where: { id: transaction.id }, data: {
      status: "POSTED", selected: false, suggestedKind: expectedDirection, suggestedCategoryId: category.id, suggestedClientId: client?.id ?? null,
      suggestedRecurringExpensePlanId: recurringPlan?.id ?? null, postedLedgerEntryId: entry.id, resolvedById: actor.userId, resolvedAt: new Date(),
    } });
    await tx.financeAuditEvent.create({ data: { orderId: null, action: "BANK_STATEMENT_POSTED", entityType: "CompanyLedgerEntry", entityId: entry.id, after: { transactionId: transaction.id, direction: expectedDirection, categoryId: category.id, amount: transaction.amount.toString(), recurringExpensePlanId: recurringPlan?.id ?? null }, reason: transaction.description ?? transaction.counterparty ?? "Операция из выписки Kaspi", authorId: actor.userId } });
    await rememberRule(tx, transaction, decision, actor.userId);
    return entry;
  });
}

export async function applyStatementDecisions(importId: number, decisions: StatementDecision[], actor: Actor) {
  const statementImport = await prisma.bankStatementImport.findUnique({ where: { id: importId }, select: { id: true } });
  if (!statementImport) throw new Error("STATEMENT_IMPORT_NOT_FOUND");
  const allowed = new Set((await prisma.bankStatementTransaction.findMany({ where: { importId, id: { in: decisions.map((item) => item.transactionId) } }, select: { id: true } })).map((item) => item.id));
  const results: Array<{ transactionId: number; ok: boolean; error?: string }> = [];
  for (const decision of decisions.slice(0, 2_000)) {
    if (!allowed.has(decision.transactionId)) { results.push({ transactionId: decision.transactionId, ok: false, error: "Операция не относится к выбранной выписке" }); continue; }
    try {
      if (decision.action === "SKIP") await skipTransaction(decision.transactionId, actor);
      else if (decision.kind === "CLIENT_PAYMENT") await postClientPayment(decision.transactionId, decision, actor);
      else if (decision.kind === "INCOME" || decision.kind === "EXPENSE") await postLedgerEntry(decision.transactionId, decision, actor);
      else throw new Error("INVALID_STATEMENT_DECISION");
      results.push({ transactionId: decision.transactionId, ok: true });
    } catch (error) {
      results.push({ transactionId: decision.transactionId, ok: false, error: error instanceof Error ? error.message : "UNKNOWN_ERROR" });
    }
  }
  await updateImportStatus(importId);
  return { results, workspace: await getBankStatementWorkspace(importId) };
}
