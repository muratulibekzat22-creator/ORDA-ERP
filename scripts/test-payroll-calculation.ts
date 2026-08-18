import assert from "node:assert/strict";

import {
  calculateOrderBonus,
  calculatePayrollBreakdown,
} from "../lib/payroll-calculation";

const accruals = [
  { type: "BASE_SALARY", direction: "INCREASE" as const, amount: 200000 },
  { type: "ORDER_BONUS", direction: "INCREASE" as const, amount: 120000 },
  { type: "ORDER_BONUS", direction: "INCREASE" as const, amount: 80000 },
  { type: "PREMIUM", direction: "INCREASE" as const, amount: 50000 },
];

const advances = [
  { id: 1, type: "ADVANCE", amount: 20000 },
  { id: 2, type: "ADVANCE", amount: 20000 },
];

const beforePayment = calculatePayrollBreakdown(accruals, advances);
assert.deepEqual(beforePayment, {
  salaryAccrued: 200000,
  bonusesAccrued: 200000,
  premiumsAccrued: 50000,
  otherAccruals: 0,
  totalAccrued: 450000,
  deductions: 0,
  advancesPaid: 40000,
  partialPayments: 0,
  finalPayments: 0,
  salaryPayments: 0,
  totalPaid: 40000,
  payable: 410000,
});

const afterPayment = calculatePayrollBreakdown(accruals, [
  ...advances,
  { id: 3, type: "SALARY_PAYMENT", amount: 100000 },
]);
assert.equal(afterPayment.totalPaid, 140000);
assert.equal(afterPayment.salaryPayments, 100000);
assert.equal(afterPayment.payable, 310000);
assert.equal(afterPayment.premiumsAccrued, 50000);

const withDeduction = calculatePayrollBreakdown(
  [...accruals, { type: "DEDUCTION", direction: "DECREASE", amount: 10000 }],
  advances,
);
assert.equal(withDeduction.totalAccrued, 450000);
assert.equal(withDeduction.deductions, 10000);
assert.equal(withDeduction.payable, 400000);

const reversedAdvance = calculatePayrollBreakdown(accruals, [
  ...advances,
  { id: 4, type: "EMPLOYEE_REFUND", amount: 20000, reversalOfId: 1 },
]);
assert.equal(reversedAdvance.advancesPaid, 20000);
assert.equal(reversedAdvance.totalPaid, 20000);

assert.deepEqual(
  calculateOrderBonus("PAID_PERCENT", 10, {
    paidAmount: 500000,
    orderAmount: 1000000,
    profitAmount: 400000,
  }),
  { basisAmount: 500000, calculatedAmount: 50000, realizedProfit: 200000 },
);
assert.deepEqual(
  calculateOrderBonus("PROFIT_PERCENT", 10, {
    paidAmount: 500000,
    orderAmount: 1000000,
    profitAmount: 400000,
  }),
  { basisAmount: 200000, calculatedAmount: 20000, realizedProfit: 200000 },
);

console.log("Payroll calculation unit tests passed");
