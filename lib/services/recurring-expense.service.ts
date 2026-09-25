import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";

const methods = new Set(["cash", "kaspi", "bank_transfer", "card", "other"]);

export function parseExpensePeriod(value: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!match) throw new Error("INVALID_PERIOD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2020 || year > 2100 || month < 1 || month > 12)
    throw new Error("INVALID_PERIOD");
  return { year, month, key: `${year}-${String(month).padStart(2, "0")}` };
}

function operationDate(year: number, month: number, day: number) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const safeDay = Math.min(Math.max(day, 1), lastDay);
  return new Date(Date.UTC(year, month - 1, safeDay, 5));
}

export async function getRecurringExpensePlans(periodValue: string) {
  const companyId = requireTenantIdentity().companyId;
  const period = parseExpensePeriod(periodValue);
  const [plans, categories] = await Promise.all([
    prisma.recurringExpensePlan.findMany({
      where: { companyId },
      include: {
        category: { select: { id: true, code: true, name: true } },
        entries: {
          where: { recurringPeriod: period.key },
          select: { id: true, amount: true, operationDate: true, voidedAt: true },
          take: 1,
        },
      },
      orderBy: [{ active: "desc" }, { dayOfMonth: "asc" }, { name: "asc" }],
    }),
    prisma.financeCategory.findMany({
      where: { companyId, direction: "EXPENSE", active: true },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const rows = plans.map((plan) => {
    const entry = plan.entries[0] ?? null;
    return {
      id: plan.id,
      name: plan.name,
      categoryId: plan.categoryId,
      category: plan.category,
      amount: Number(plan.amount),
      dayOfMonth: plan.dayOfMonth,
      method: plan.method,
      counterparty: plan.counterparty,
      comment: plan.comment,
      active: plan.active,
      posted: Boolean(entry && !entry.voidedAt),
      entry: entry
        ? {
            id: entry.id,
            amount: Number(entry.amount),
            operationDate: entry.operationDate,
            voided: Boolean(entry.voidedAt),
          }
        : null,
    };
  });
  return {
    period: period.key,
    plans: rows,
    categories,
    totals: {
      planned: rows.filter((row) => row.active).reduce((sum, row) => sum + row.amount, 0),
      posted: rows.filter((row) => row.posted).reduce((sum, row) => sum + row.amount, 0),
      pending: rows.filter((row) => row.active && !row.posted).reduce((sum, row) => sum + row.amount, 0),
    },
  };
}

export async function createRecurringExpensePlan(input: {
  name: string;
  categoryId: number;
  amount: number;
  dayOfMonth: number;
  method: string;
  counterparty?: string | null;
  comment?: string | null;
}) {
  const companyId = requireTenantIdentity().companyId;
  const name = input.name.trim().slice(0, 120);
  if (!name || !Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 9_999_999_999.99 || !Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 28 || !methods.has(input.method))
    throw new Error("INVALID_PLAN");
  const category = await prisma.financeCategory.findFirst({
    where: { id: input.categoryId, companyId, direction: "EXPENSE", active: true },
    select: { id: true },
  });
  if (!category) throw new Error("CATEGORY_NOT_FOUND");
  try {
    return await prisma.recurringExpensePlan.create({
      data: {
        companyId,
        name,
        categoryId: category.id,
        amount: input.amount,
        dayOfMonth: input.dayOfMonth,
        method: input.method,
        counterparty: input.counterparty?.trim().slice(0, 200) || null,
        comment: input.comment?.trim().slice(0, 1000) || null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      throw new Error("PLAN_EXISTS");
    throw error;
  }
}

export async function updateRecurringExpensePlan(
  id: number,
  input: Partial<{
    name: string;
    categoryId: number;
    amount: number;
    dayOfMonth: number;
    method: string;
    counterparty: string | null;
    comment: string | null;
    active: boolean;
  }>,
) {
  const companyId = requireTenantIdentity().companyId;
  const current = await prisma.recurringExpensePlan.findFirst({ where: { id, companyId } });
  if (!current) throw new Error("PLAN_NOT_FOUND");
  if (input.categoryId !== undefined) {
    const category = await prisma.financeCategory.findFirst({ where: { id: input.categoryId, companyId, direction: "EXPENSE", active: true }, select: { id: true } });
    if (!category) throw new Error("CATEGORY_NOT_FOUND");
  }
  const amount = input.amount ?? Number(current.amount);
  const dayOfMonth = input.dayOfMonth ?? current.dayOfMonth;
  const method = input.method ?? current.method;
  const name = input.name?.trim().slice(0, 120) ?? current.name;
  if (!name || !Number.isFinite(amount) || amount <= 0 || amount > 9_999_999_999.99 || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28 || !methods.has(method))
    throw new Error("INVALID_PLAN");
  return prisma.recurringExpensePlan.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.amount !== undefined ? { amount } : {}),
      ...(input.dayOfMonth !== undefined ? { dayOfMonth } : {}),
      ...(input.method !== undefined ? { method } : {}),
      ...(input.counterparty !== undefined ? { counterparty: input.counterparty?.trim().slice(0, 200) || null } : {}),
      ...(input.comment !== undefined ? { comment: input.comment?.trim().slice(0, 1000) || null } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
}

export async function postRecurringExpensePlan(input: {
  planId: number;
  period: string;
  authorId: number;
}) {
  const companyId = requireTenantIdentity().companyId;
  const period = parseExpensePeriod(input.period);
  return prisma.$transaction(async (tx) => {
    const plan = await tx.recurringExpensePlan.findFirst({
      where: { id: input.planId, companyId, active: true },
      include: { category: true },
    });
    if (!plan) throw new Error("PLAN_NOT_FOUND");
    const existing = await tx.companyLedgerEntry.findUnique({
      where: { recurringExpensePlanId_recurringPeriod: { recurringExpensePlanId: plan.id, recurringPeriod: period.key } },
    });
    if (existing && !existing.voidedAt)
      return { entry: existing, created: false };
    if (existing) {
      const restored = await tx.companyLedgerEntry.update({
        where: { id: existing.id },
        data: {
          category: plan.category.code,
          categoryId: plan.categoryId,
          amount: plan.amount,
          operationDate: operationDate(
            period.year,
            period.month,
            plan.dayOfMonth,
          ),
          method: plan.method,
          counterparty: plan.counterparty,
          comment: plan.comment || `Постоянный расход: ${plan.name}`,
          authorId: input.authorId,
          affectsProfit: true,
          voidedAt: null,
          voidReason: null,
        },
      });
      return { entry: restored, created: true };
    }
    const entry = await tx.companyLedgerEntry.create({
      data: {
        companyId,
        type: "RECURRING_EXPENSE",
        category: plan.category.code,
        categoryId: plan.categoryId,
        direction: "EXPENSE",
        source: "RECURRING_EXPENSE",
        amount: plan.amount,
        operationDate: operationDate(period.year, period.month, plan.dayOfMonth),
        method: plan.method,
        counterparty: plan.counterparty,
        comment: plan.comment || `Постоянный расход: ${plan.name}`,
        authorId: input.authorId,
        affectsProfit: true,
        recurringExpensePlanId: plan.id,
        recurringPeriod: period.key,
        idempotencyKey: `recurring:${companyId}:${plan.id}:${period.key}`,
      },
    });
    return { entry, created: true };
  });
}
