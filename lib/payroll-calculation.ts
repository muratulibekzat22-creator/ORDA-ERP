export type PayrollAccrualValue = {
  type: string;
  direction: "INCREASE" | "DECREASE";
  amount: number | string | { toString(): string };
};

export type PayrollPaymentValue = {
  id: number;
  type: string;
  amount: number | string | { toString(): string };
  reversalOfId?: number | null;
};

export type OrderBonusRule = "FIXED" | "PAID_PERCENT" | "PROFIT_PERCENT";

const bonusTypes = new Set([
  "GUARANTEED_ORDER_BONUS",
  "ORDER_BONUS",
  "MEASUREMENT_BONUS",
  "EXTRA_BONUS",
]);

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const amount = (value: PayrollAccrualValue["amount"]) => Number(value);

export function calculateOrderBonus(
  rule: OrderBonusRule,
  value: number,
  basis: { paidAmount: number; orderAmount: number; profitAmount: number },
) {
  if (!Number.isFinite(value) || value < 0) throw new Error("INVALID_BONUS_VALUE");
  const paidAmount = Math.max(basis.paidAmount, 0);
  const orderAmount = Math.max(basis.orderAmount, 0);
  const profitAmount = Math.max(basis.profitAmount, 0);
  const realizedProfit = orderAmount > 0
    ? profitAmount * Math.min(paidAmount / orderAmount, 1)
    : 0;
  const basisAmount = rule === "FIXED"
    ? paidAmount
    : rule === "PAID_PERCENT"
      ? paidAmount
      : realizedProfit;
  const calculatedAmount = rule === "FIXED"
    ? value
    : basisAmount * value / 100;
  return {
    basisAmount: money(basisAmount),
    calculatedAmount: money(calculatedAmount),
    realizedProfit: money(realizedProfit),
  };
}

export function calculatePayrollBreakdown(
  accruals: PayrollAccrualValue[],
  payments: PayrollPaymentValue[],
) {
  const increases = accruals.filter((row) => row.direction === "INCREASE");
  const decreases = accruals.filter((row) => row.direction === "DECREASE");
  const sumAccruals = (rows: PayrollAccrualValue[]) =>
    money(rows.reduce((sum, row) => sum + amount(row.amount), 0));
  const salaryAccrued = sumAccruals(increases.filter((row) => row.type === "BASE_SALARY"));
  const bonusesAccrued = sumAccruals(increases.filter((row) => bonusTypes.has(row.type)));
  const premiumsAccrued = sumAccruals(increases.filter((row) => row.type === "PREMIUM"));
  const otherAccruals = sumAccruals(
    increases.filter(
      (row) => row.type !== "BASE_SALARY" && row.type !== "PREMIUM" && !bonusTypes.has(row.type),
    ),
  );
  const totalAccrued = sumAccruals(increases);
  const deductions = sumAccruals(decreases);

  const paymentById = new Map(payments.map((row) => [row.id, row]));
  const receivedFor = (matches: (type: string) => boolean) => money(payments.reduce((sum, row) => {
    if (row.type === "EMPLOYEE_REFUND") {
      const original = row.reversalOfId ? paymentById.get(row.reversalOfId) : undefined;
      return original && matches(original.type) ? sum - amount(row.amount) : sum;
    }
    return matches(row.type) ? sum + amount(row.amount) : sum;
  }, 0));
  const advancesPaid = receivedFor((type) => type === "ADVANCE");
  const totalPaid = receivedFor((type) => type !== "EMPLOYEE_REFUND");
  const salaryPayments = money(totalPaid - advancesPaid);
  const partialPayments = receivedFor((type) =>
    type !== "ADVANCE" && type !== "FINAL_SETTLEMENT" && type !== "EMPLOYEE_REFUND",
  );
  const finalPayments = receivedFor((type) => type === "FINAL_SETTLEMENT");
  const payable = money(totalAccrued - deductions - totalPaid);

  return {
    salaryAccrued,
    bonusesAccrued,
    premiumsAccrued,
    otherAccruals,
    totalAccrued,
    deductions,
    advancesPaid,
    partialPayments,
    finalPayments,
    salaryPayments,
    totalPaid,
    payable,
  };
}
