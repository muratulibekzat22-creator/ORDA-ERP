import { prisma } from "@/lib/prisma";
import { compareRequestHash } from "@/lib/idempotency";
import { getCompanyProfitability } from "@/lib/services/profitability.service";

export const COMPANY_EXPENSE_CATEGORIES = ["SALARY", "MANAGER_BONUS", "ADVERTISING", "RENT", "FUEL", "DELIVERY", "TAX", "ACCOUNTING", "COMMUNICATION", "OFFICE", "SERVICES", "EQUIPMENT", "COMPANY_LOAN", "OTHER"] as const;
export const PERSONAL_CATEGORIES = ["FOOD", "PERSONAL_FUEL", "LOAN", "HOUSING", "CAR", "TRAVEL", "FAMILY", "PERSONAL_PURCHASE", "OTHER"] as const;
export type LedgerInput = { type: string; category: string; direction: "INCOME" | "EXPENSE"; amount: number; operationDate: Date; comment?: string; orderId?: number; authorId: number; idempotencyKey?: string; requestHash?: string };

export async function getCompanyFinance(from?: Date, to?: Date) {
  const where = from || to ? { operationDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {};
  const [entries, profitability] = await Promise.all([
    prisma.companyLedgerEntry.findMany({ where, include: { order: { select: { number: true } }, author: { select: { name: true } } }, orderBy: [{ operationDate: "desc" }, { id: "desc" }] }),
    getCompanyProfitability({ from, to }),
  ]);
  return {
    entries,
    totals: {
      orderProfit: Number(profitability.totals.orderProfit),
      otherIncome: Number(profitability.totals.otherIncome),
      operatingExpenses: Number(profitability.totals.generalExpenses),
      companyNetProfit: Number(profitability.totals.companyNetProfit),
    },
  };
}

export async function createCompanyEntry(input: LedgerInput) {
  if (input.idempotencyKey) {
    const existing = await prisma.companyLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (!compareRequestHash(existing.requestHash, input.requestHash ?? "")) throw new Error("IDEMPOTENCY_CONFLICT");
      return { entry: existing, created: false };
    }
  }
  return { entry: await prisma.companyLedgerEntry.create({ data: input }), created: true };
}

export async function getPersonalFinance(from?: Date, to?: Date) {
  const entries = await prisma.personalLedgerEntry.findMany({ where: from || to ? { operationDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}, include: { author: { select: { name: true } } }, orderBy: [{ operationDate: "desc" }, { id: "desc" }] });
  const income = entries.filter((entry) => entry.direction === "INCOME").reduce((sum, entry) => sum + Number(entry.amount), 0);
  const expenses = entries.filter((entry) => entry.direction === "EXPENSE").reduce((sum, entry) => sum + Number(entry.amount), 0);
  return { entries, totals: { income, expenses, balance: income - expenses } };
}

export async function createPersonalEntry(input: Omit<LedgerInput, "orderId">) {
  if (input.idempotencyKey) {
    const existing = await prisma.personalLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (!compareRequestHash(existing.requestHash, input.requestHash ?? "")) throw new Error("IDEMPOTENCY_CONFLICT");
      return { entry: existing, created: false };
    }
  }
  return { entry: await prisma.personalLedgerEntry.create({ data: input }), created: true };
}
