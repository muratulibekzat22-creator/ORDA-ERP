import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { compareRequestHash } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";

export type FinanceDirection = "INCOME" | "EXPENSE";
export type FinanceSource =
  | "MANUAL"
  | "CLIENT_PAYMENT"
  | "PARTNER_PAYOUT"
  | "PAYROLL_PAYMENT"
  | "REFUND"
  | "OTHER_SYSTEM";

export type FinanceJournalFilters = {
  period?: "all" | "today" | "week" | "month" | "previous_month" | "year";
  from?: Date;
  to?: Date;
  direction?: FinanceDirection;
};

export type ManualFinanceInput = {
  direction: FinanceDirection;
  categoryId: number;
  amount: number;
  operationDate: Date;
  method: string;
  counterparty?: string | null;
  comment?: string | null;
  orderId?: number | null;
  clientId?: number | null;
  partnerId?: number | null;
  employeeId?: number | null;
};

const clientPaymentTypes = new Set([
  "CLIENT_PAYMENT",
  "payment",
  "PREPAYMENT",
  "ADDITIONAL_PAYMENT",
]);

function selectedRange(filters: FinanceJournalFilters) {
  if (filters.from || filters.to) return { from: filters.from, to: filters.to };
  if (!filters.period || filters.period === "all") return {};
  const to = new Date();
  const from = new Date(to);
  from.setHours(0, 0, 0, 0);
  if (filters.period === "week") from.setDate(from.getDate() - 6);
  if (filters.period === "month") from.setDate(1);
  if (filters.period === "previous_month") {
    from.setMonth(from.getMonth() - 1, 1);
    to.setDate(0);
    to.setHours(23, 59, 59, 999);
  }
  if (filters.period === "year") from.setMonth(0, 1);
  return { from, to };
}

function paymentCategory(type: string) {
  if (type === "ADDITIONAL_PAYMENT")
    return { code: "ADDITIONAL_PAYMENT", name: "Доплата клиента" };
  if (clientPaymentTypes.has(type))
    return { code: "CLIENT_PAYMENT", name: "Оплата клиента" };
  if (type === "REFUND")
    return { code: "CLIENT_REFUND", name: "Возврат клиенту" };
  if (type === "PARTNER_PAYOUT")
    return { code: "PARTNER_PAYOUT", name: "Цех / партнёр" };
  if (type === "PARTNER_PAYOUT_REVERSAL")
    return { code: "PARTNER_PAYOUT_REVERSAL", name: "Сторно выплаты цеху" };
  return { code: type, name: "Системная операция" };
}

function paymentSource(type: string): FinanceSource {
  if (clientPaymentTypes.has(type)) return "CLIENT_PAYMENT";
  if (type === "REFUND") return "REFUND";
  if (type === "PARTNER_PAYOUT" || type === "PARTNER_PAYOUT_REVERSAL")
    return "PARTNER_PAYOUT";
  return "OTHER_SYSTEM";
}

function payrollCategory(type: string | null | undefined) {
  if (type === "ADVANCE") return { code: "ADVANCE", name: "Аванс" };
  if (type?.includes("BONUS"))
    return { code: "EMPLOYEE_BONUS", name: "Бонус сотруднику" };
  return { code: "SALARY", name: "Зарплата" };
}

function auditSnapshot(entry: {
  direction: string;
  categoryId: number | null;
  amount: Prisma.Decimal;
  operationDate: Date;
  method: string | null;
  counterparty: string | null;
  comment: string | null;
  orderId: number | null;
  clientId: number | null;
  partnerId: number | null;
  employeeId: number | null;
}) {
  return {
    direction: entry.direction,
    categoryId: entry.categoryId,
    amount: entry.amount.toString(),
    operationDate: entry.operationDate.toISOString(),
    method: entry.method,
    counterparty: entry.counterparty,
    comment: entry.comment,
    orderId: entry.orderId,
    clientId: entry.clientId,
    partnerId: entry.partnerId,
    employeeId: entry.employeeId,
  };
}

export async function getFinanceJournal(filters: FinanceJournalFilters = {}) {
  const range = selectedRange(filters);
  const operationDate =
    range.from || range.to
      ? {
          ...(range.from ? { gte: range.from } : {}),
          ...(range.to ? { lte: range.to } : {}),
        }
      : undefined;
  const [payments, ledger, categories, orders, clients, partners, employees] =
    await Promise.all([
      prisma.payment.findMany({
        where: operationDate ? { operationDate } : {},
        include: {
          order: {
            select: {
              id: true,
              number: true,
              client: { select: { id: true, name: true } },
            },
          },
          partner: { select: { id: true, name: true } },
        },
        orderBy: [{ operationDate: "desc" }, { id: "desc" }],
      }),
      prisma.companyLedgerEntry.findMany({
        where: {
          ...(operationDate ? { operationDate } : {}),
          OR: [
            { payrollPaymentId: { not: null } },
            { payrollAccrualId: null },
          ],
        },
        include: {
          categoryRef: true,
          order: {
            select: {
              id: true,
              number: true,
              client: { select: { id: true, name: true } },
            },
          },
          client: { select: { id: true, name: true } },
          partner: { select: { id: true, name: true } },
          employee: {
            select: {
              id: true,
              name: true,
              user: { select: { name: true } },
            },
          },
          author: { select: { name: true } },
          payrollPayment: {
            select: {
              method: true,
              type: true,
              employee: {
                select: {
                  id: true,
                  name: true,
                  user: { select: { name: true } },
                },
              },
            },
          },
        },
        orderBy: [{ operationDate: "desc" }, { id: "desc" }],
      }),
      prisma.financeCategory.findMany({
        orderBy: [
          { direction: "asc" },
          { system: "desc" },
          { name: "asc" },
        ],
      }),
      prisma.order.findMany({
        where: { lifecycle: { not: "CANCELLED" } },
        select: {
          id: true,
          number: true,
          client: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.client.findMany({
        where: { active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.partner.findMany({
        where: { active: true, archived: false, isTest: false },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.employeePayrollProfile.findMany({
        where: { active: true, payrollEnabled: true },
        select: {
          id: true,
          name: true,
          user: { select: { name: true } },
        },
        orderBy: { name: "asc" },
      }),
    ]);

  const paymentRows = payments.map((item) => {
    const category = paymentCategory(item.type);
    const expense =
      item.type === "REFUND" ||
      item.type === "PARTNER_PAYOUT" ||
      (item.type === "ADJUSTMENT" && item.comment?.includes("[EXPENSE]"));
    return {
      id: `payment-${item.id}`,
      sourceId: item.id,
      source: paymentSource(item.type),
      system: true,
      editable: false,
      voided: false,
      direction: expense ? ("EXPENSE" as const) : ("INCOME" as const),
      categoryId: null,
      categoryCode: category.code,
      categoryName: category.name,
      amount: Number(item.amount),
      method: item.method,
      counterparty: item.partner?.name ?? item.order?.client.name ?? null,
      comment: item.comment,
      author: item.author,
      operationDate: item.operationDate,
      order: item.order,
      client: item.order?.client ?? null,
      partner: item.partner,
      employee: null,
    };
  });
  const ledgerRows = ledger.map((item) => {
    const source = (item.payrollPaymentId
      ? "PAYROLL_PAYMENT"
      : item.source) as FinanceSource;
    const payroll =
      source === "PAYROLL_PAYMENT"
        ? payrollCategory(item.payrollPayment?.type)
        : null;
    const employee = item.employee ?? item.payrollPayment?.employee ?? null;
    return {
      id: `ledger-${item.id}`,
      sourceId: item.id,
      source,
      system: source !== "MANUAL",
      editable: source === "MANUAL" && !item.voidedAt,
      voided: Boolean(item.voidedAt),
      direction:
        item.direction === "INCOME"
          ? ("INCOME" as const)
          : ("EXPENSE" as const),
      categoryId: item.categoryId,
      categoryCode: payroll?.code ?? item.categoryRef?.code ?? item.category,
      categoryName: payroll?.name ?? item.categoryRef?.name ?? item.category,
      amount: Number(item.amount),
      method: item.method ?? item.payrollPayment?.method ?? "other",
      counterparty:
        item.counterparty ??
        item.partner?.name ??
        employee?.user?.name ??
        employee?.name ??
        item.client?.name ??
        null,
      comment: item.comment,
      author: item.author?.name ?? null,
      operationDate: item.operationDate,
      order: item.order,
      client: item.client ?? item.order?.client ?? null,
      partner: item.partner,
      employee: employee
        ? { id: employee.id, name: employee.user?.name ?? employee.name }
        : null,
    };
  });
  const operations = [...paymentRows, ...ledgerRows]
    .filter((item) => !filters.direction || item.direction === filters.direction)
    .sort((a, b) => b.operationDate.getTime() - a.operationDate.getTime());
  const posted = operations.filter((item) => !item.voided);
  const totals = posted.reduce(
    (result, item) => {
      result[item.direction === "INCOME" ? "income" : "expense"] +=
        item.amount;
      return result;
    },
    { income: 0, expense: 0 },
  );
  const grouped = (direction: FinanceDirection) => {
    const map = new Map<
      string,
      { code: string; name: string; amount: number }
    >();
    posted
      .filter((item) => item.direction === direction)
      .forEach((item) => {
        const current = map.get(item.categoryCode) ?? {
          code: item.categoryCode,
          name: item.categoryName,
          amount: 0,
        };
        current.amount += item.amount;
        map.set(item.categoryCode, current);
      });
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  };
  const timelineMap = new Map<
    string,
    { date: string; income: number; expense: number }
  >();
  posted.forEach((item) => {
    const date = item.operationDate.toISOString().slice(0, 10);
    const current = timelineMap.get(date) ?? { date, income: 0, expense: 0 };
    current[item.direction === "INCOME" ? "income" : "expense"] +=
      item.amount;
    timelineMap.set(date, current);
  });
  return {
    operations,
    totals: { ...totals, cashResult: totals.income - totals.expense },
    incomeByCategory: grouped("INCOME"),
    expenseByCategory: grouped("EXPENSE"),
    timeline: [...timelineMap.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    categories,
    options: {
      orders: orders.map((item) => ({
        id: item.id,
        name: `${item.number} — ${item.client.name}`,
      })),
      clients,
      partners,
      employees: employees.map((item) => ({
        id: item.id,
        name: item.user?.name ?? item.name,
      })),
    },
  };
}

export async function createManualFinanceEntry(
  input: ManualFinanceInput & {
    authorId: number;
    idempotencyKey: string;
    requestHash: string;
  },
) {
  return prisma.$transaction(async (tx) => {
    const replay = await tx.companyLedgerEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (replay) {
      if (!compareRequestHash(replay.requestHash, input.requestHash))
        throw new Error("IDEMPOTENCY_CONFLICT");
      return { entry: replay, created: false };
    }
    const category = await tx.financeCategory.findFirst({
      where: {
        id: input.categoryId,
        direction: input.direction,
        active: true,
      },
    });
    if (!category) throw new Error("CATEGORY_NOT_FOUND");
    const entry = await tx.companyLedgerEntry.create({
      data: {
        type: input.direction === "INCOME" ? "MANUAL_INCOME" : "MANUAL_EXPENSE",
        category: category.code,
        categoryId: category.id,
        direction: input.direction,
        source: "MANUAL",
        amount: input.amount,
        operationDate: input.operationDate,
        method: input.method,
        counterparty: input.counterparty,
        comment: input.comment,
        orderId: input.orderId,
        clientId: input.clientId,
        partnerId: input.partnerId,
        employeeId: input.employeeId,
        authorId: input.authorId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      },
    });
    await tx.financeAuditEvent.create({
      data: {
        orderId: entry.orderId,
        action: "MANUAL_FINANCE_CREATED",
        entityType: "CompanyLedgerEntry",
        entityId: entry.id,
        after: auditSnapshot(entry),
        reason: input.comment || "Ручная операция",
        authorId: input.authorId,
      },
    });
    return { entry, created: true };
  });
}

export async function updateManualFinanceEntry(
  id: number,
  input: ManualFinanceInput & { authorId: number; reason?: string },
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.companyLedgerEntry.findUnique({ where: { id } });
    if (!current) throw new Error("ENTRY_NOT_FOUND");
    if (
      current.source !== "MANUAL" ||
      current.payrollPaymentId ||
      current.payrollAccrualId
    )
      throw new Error("SYSTEM_ENTRY_IMMUTABLE");
    if (current.voidedAt) throw new Error("ENTRY_VOIDED");
    const category = await tx.financeCategory.findFirst({
      where: {
        id: input.categoryId,
        direction: input.direction,
        active: true,
      },
    });
    if (!category) throw new Error("CATEGORY_NOT_FOUND");
    const updated = await tx.companyLedgerEntry.update({
      where: { id },
      data: {
        type: input.direction === "INCOME" ? "MANUAL_INCOME" : "MANUAL_EXPENSE",
        category: category.code,
        categoryId: category.id,
        direction: input.direction,
        amount: input.amount,
        operationDate: input.operationDate,
        method: input.method,
        counterparty: input.counterparty,
        comment: input.comment,
        orderId: input.orderId,
        clientId: input.clientId,
        partnerId: input.partnerId,
        employeeId: input.employeeId,
      },
    });
    await tx.financeAuditEvent.create({
      data: {
        orderId: updated.orderId,
        action: "MANUAL_FINANCE_UPDATED",
        entityType: "CompanyLedgerEntry",
        entityId: updated.id,
        before: auditSnapshot(current),
        after: auditSnapshot(updated),
        reason:
          input.reason?.trim() || "Редактирование ручной операции",
        authorId: input.authorId,
      },
    });
    return updated;
  });
}

export async function voidManualFinanceEntry(
  id: number,
  reason: string,
  authorId: number,
) {
  if (!reason.trim()) throw new Error("REASON_REQUIRED");
  return prisma.$transaction(async (tx) => {
    const current = await tx.companyLedgerEntry.findUnique({ where: { id } });
    if (!current) throw new Error("ENTRY_NOT_FOUND");
    if (
      current.source !== "MANUAL" ||
      current.payrollPaymentId ||
      current.payrollAccrualId
    )
      throw new Error("SYSTEM_ENTRY_IMMUTABLE");
    if (current.voidedAt) return current;
    const updated = await tx.companyLedgerEntry.update({
      where: { id },
      data: { voidedAt: new Date(), voidReason: reason.trim() },
    });
    await tx.financeAuditEvent.create({
      data: {
        orderId: updated.orderId,
        action: "MANUAL_FINANCE_VOIDED",
        entityType: "CompanyLedgerEntry",
        entityId: updated.id,
        before: auditSnapshot(current),
        after: { voidedAt: updated.voidedAt?.toISOString() },
        reason: reason.trim(),
        authorId,
      },
    });
    return updated;
  });
}

export async function createFinanceCategory(
  name: string,
  direction: FinanceDirection,
) {
  const clean = name.trim().slice(0, 100);
  if (!clean) throw new Error("CATEGORY_NAME_REQUIRED");
  const duplicate = await prisma.financeCategory.findFirst({
    where: { direction, name: { equals: clean, mode: "insensitive" } },
  });
  if (duplicate) throw new Error("CATEGORY_EXISTS");
  return prisma.financeCategory.create({
    data: {
      code: `CUSTOM_${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`,
      name: clean,
      direction,
    },
  });
}

export async function updateFinanceCategory(
  id: number,
  input: { name?: string; active?: boolean },
) {
  const current = await prisma.financeCategory.findUnique({ where: { id } });
  if (!current) throw new Error("CATEGORY_NOT_FOUND");
  if (current.system) throw new Error("SYSTEM_CATEGORY_IMMUTABLE");
  const name = input.name === undefined ? undefined : input.name.trim().slice(0, 100);
  if (name === "") throw new Error("CATEGORY_NAME_REQUIRED");
  if (
    name &&
    (await prisma.financeCategory.findFirst({
      where: {
        direction: current.direction,
        name: { equals: name, mode: "insensitive" },
        id: { not: id },
      },
    }))
  )
    throw new Error("CATEGORY_EXISTS");
  return prisma.financeCategory.update({
    where: { id },
    data: {
      ...(name ? { name } : {}),
      ...(input.active === undefined ? {} : { active: input.active }),
    },
  });
}
