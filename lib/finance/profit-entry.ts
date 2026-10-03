type ProfitEntry = { direction: string; source: string; orderId: number | null; affectsProfit: boolean; category: string; type: string };

// Order costs, payroll and partner settlements have separate accounting paths.
export function isOperatingProfitExpense(entry: ProfitEntry): boolean {
  return entry.direction === "EXPENSE" && entry.orderId === null && entry.affectsProfit &&
    !["PAYROLL_ACCRUAL", "PAYROLL_PAYMENT", "OTHER_SYSTEM"].includes(entry.source) &&
    entry.category !== "SALARY" && entry.type !== "PARTNER_PAYOUT";
}

export function isAdditionalProfitIncome(entry: ProfitEntry): boolean {
  return entry.direction === "INCOME" && entry.orderId === null && entry.affectsProfit && entry.source === "MANUAL";
}
