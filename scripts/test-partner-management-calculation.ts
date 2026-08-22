import assert from "node:assert/strict";

import { PartnerRewardRule, PartnerSettlementOperationStatus, PartnerSettlementOperationType, PartnerSettlementStatus, PayrollAccrualType, PayrollDirection, Role } from "@prisma/client";

import { calculateOrderEconomy } from "@/lib/orders/economy";
import { calculatePartnerSettlement, calculateReward } from "@/lib/partners/settlement";
import { calculateOrderProfitability } from "@/lib/services/profitability.service";

const equal = (actual: { toFixed(scale: number): string }, expected: string, label: string) =>
  assert.equal(actual.toFixed(2), expected, label);

equal(calculateReward(PartnerRewardRule.FIXED, { orderAmount: "1000000", received: "400000", grossProfit: "500000", fixedAmount: "125000" }).accrued, "125000.00", "fixed reward");
equal(calculateReward(PartnerRewardRule.ORDER_PERCENT, { orderAmount: "1000000", received: "400000", grossProfit: "500000", percent: "7.5" }).accrued, "75000.00", "order percent");
equal(calculateReward(PartnerRewardRule.PAID_PERCENT, { orderAmount: "1000000", received: "400000", grossProfit: "500000", percent: "7.5" }).accrued, "30000.00", "paid percent");
equal(calculateReward(PartnerRewardRule.PROFIT_PERCENT, { orderAmount: "1000000", received: "400000", grossProfit: "500000", percent: "7.5" }).accrued, "37500.00", "profit percent");
equal(calculateReward(PartnerRewardRule.MANUAL, { orderAmount: "1000000", received: "400000", grossProfit: "500000", manualAmount: "98765.43" }).accrued, "98765.43", "manual reward");

const settlement = calculatePartnerSettlement({
  orderAmount: "1000000.10", companyProfit: "500000.05", companyClientReceived: "400000.04", companyPaidPartner: "50000.01",
  rewardRule: PartnerRewardRule.PAID_PERCENT, rewardPercent: "10", operations: [
    { type: PartnerSettlementOperationType.CLIENT_TO_PARTNER, status: PartnerSettlementOperationStatus.POSTED, amount: "300000.03" },
    { type: PartnerSettlementOperationType.PARTNER_TO_COMPANY, status: PartnerSettlementOperationStatus.POSTED, amount: "100000.01" },
    { type: PartnerSettlementOperationType.ADJUSTMENT, status: PartnerSettlementOperationStatus.POSTED, amount: "1", adjustmentEffect: "10.11" },
    { type: PartnerSettlementOperationType.CLIENT_TO_PARTNER, status: PartnerSettlementOperationStatus.REVERSED, amount: "999999" },
  ],
});
equal(settlement.received, "700000.07", "received includes direct partner payment exactly once");
equal(settlement.clientRemaining, "300000.03", "client remaining");
equal(settlement.partnerAccrued, "70010.12", "paid-percent accrual includes confirmed adjustment");
equal(settlement.companyAmount, "629989.95", "company share includes confirmed adjustment");
equal(settlement.partnerBalance, "-179989.91", "partner balance formula");
equal(settlement.partnerDebt, "179989.91", "partner debt");
assert.equal(settlement.status, PartnerSettlementStatus.PARTNER_OWES_COMPANY);

const closed = calculatePartnerSettlement({ orderAmount: "1000000", companyProfit: "900000", companyClientReceived: "100000", companyPaidPartner: "100000", rewardRule: PartnerRewardRule.FIXED, fixedAmount: "100000", operations: [] });
assert.equal(closed.status, PartnerSettlementStatus.CLOSED);
const refunded = calculatePartnerSettlement({ orderAmount: "1000000", companyProfit: "900000", companyClientReceived: "0", companyPaidPartner: "0", rewardRule: PartnerRewardRule.FIXED, fixedAmount: "100000", operations: [
  { type: PartnerSettlementOperationType.CLIENT_TO_PARTNER, status: PartnerSettlementOperationStatus.POSTED, amount: "300000" },
  { type: PartnerSettlementOperationType.PARTNER_REFUND, status: PartnerSettlementOperationStatus.POSTED, amount: "50000" },
] });
equal(refunded.received, "250000.00", "partner refund reduces received");
equal(refunded.partnerBalance, "-150000.00", "partner refund reduces money held by partner");

const economy = calculateOrderEconomy({
  totalSale: "5200000",
  payments: [
    { type: "CLIENT_PAYMENT", amount: "3000000" },
    { type: "PARTNER_PAYOUT", amount: "1500000", partnerId: 1 },
  ],
  partnerId: 1,
  partnerAgreed: "3700000",
  partnerAgreedAt: new Date("2026-08-19T00:00:00Z"),
  lifecycle: "COMPLETED",
  ledgerEntries: [{ direction: "EXPENSE", amount: "20000", source: "MANUAL", category: "MATERIALS", type: "DIRECT_EXPENSE", affectsProfit: true }],
  payrollAccruals: [
    { type: PayrollAccrualType.ORDER_BONUS, direction: PayrollDirection.INCREASE, amount: "50000", employee: { user: { role: Role.MANAGER }, position: "Менеджер" } },
    { type: PayrollAccrualType.MEASUREMENT_BONUS, direction: PayrollDirection.INCREASE, amount: "30000", employee: { user: { role: Role.MEASURER }, position: "Замерщик" } },
    { type: PayrollAccrualType.EXTRA_BONUS, direction: PayrollDirection.INCREASE, amount: "100000", employee: { user: { role: Role.INSTALLER }, position: "Установщик" } },
  ],
});
equal(economy.client.netReceived, "3000000.00", "client payments are counted once");
equal(economy.client.remaining, "2200000.00", "client remaining is independent from partner payment");
equal(economy.partner.accrued, "3700000.00", "agreed partner cost creates full accrual");
equal(economy.partner.paid, "1500000.00", "canonical partner payout is counted once");
equal(economy.partner.remaining, "2200000.00", "partner remaining after partial payout");
equal(economy.profit.marginBeforePayroll, "1480000.00", "margin before payroll acceptance example");
equal(economy.profit.payrollAccrued, "180000.00", "order-linked payroll accruals");
equal(economy.profit.netProfit, "1300000.00", "net profit acceptance example");
equal(economy.profit.netMarginPercent, "25.00", "net margin acceptance example");
assert.equal(economy.client.status, "PARTIAL", "client status in acceptance example");
assert.equal(economy.partner.status, "PARTIALLY_PAID", "partner status in acceptance example");

const statusCase = (payments: Array<{ type: string; amount: string; partnerId?: number }>, dueAt?: Date) => calculateOrderEconomy({
  totalSale: "1000", payments, partnerId: 1, partnerAgreed: "600", partnerAgreedAt: new Date("2026-01-01"),
  clientDueAt: dueAt, now: new Date("2026-08-22"),
});
assert.equal(statusCase([]).client.status, "UNPAID", "unpaid client status");
assert.equal(statusCase([{ type: "CLIENT_PAYMENT", amount: "400" }]).client.status, "PARTIAL", "partial client status");
assert.equal(statusCase([{ type: "CLIENT_PAYMENT", amount: "1000" }]).client.status, "PAID", "paid client status");
assert.equal(statusCase([{ type: "CLIENT_PAYMENT", amount: "1100" }]).client.status, "OVERPAID", "client overpayment status");
assert.equal(statusCase([], new Date("2026-08-01")).client.status, "OVERDUE", "overdue client status");
equal(statusCase([{ type: "CLIENT_PAYMENT", amount: "700" }, { type: "REFUND", amount: "200" }]).client.remaining, "500.00", "refund restores client outstanding");
assert.equal(calculateOrderEconomy({ totalSale: "1000", partnerId: 1, partnerDisputed: true }).partner.status, "DISPUTED", "manual dispute has priority");
assert.equal(calculateOrderEconomy({ totalSale: "1000", partnerId: 1, partnerAgreed: "0", partnerAgreedAt: new Date() }).partner.status, "NOT_ACCRUED", "zero accrual is explicit");
assert.equal(calculateOrderEconomy({ totalSale: "1000", lifecycle: "COMPLETED" }).profit.mode, "ACTUAL", "completed order profit mode");
assert.equal(calculateOrderEconomy({ totalSale: "1000", lifecycle: "IN_PRODUCTION" }).profit.mode, "PLANNED", "active order profit mode");
const planFact = calculateOrderEconomy({
  totalSale: "1000",
  partnerId: 1,
  partnerAgreed: "400",
  partnerAgreedAt: new Date(),
  lifecycle: "COMPLETED",
  costPlan: { materialOutsideWorkshop: "100", delivery: "20", bankFees: "10", otherDirect: "10", confirmedAt: new Date() },
  ledgerEntries: [{ direction: "EXPENSE", amount: "80", source: "MANUAL", category: "MATERIALS", type: "DIRECT_EXPENSE", affectsProfit: true }],
});
equal(planFact.directCosts.plan.total, "140.00", "confirmed direct cost plan total");
equal(planFact.directCosts.fact.total, "80.00", "actual order-linked ledger cost total");
equal(planFact.directCosts.deviation.total, "-60.00", "fact minus plan deviation");
equal(planFact.profit.directExpenses, "80.00", "completed order uses fact without adding plan");

const payrollPaid = calculateOrderEconomy({
  totalSale: "1000", partnerId: 1, partnerAgreed: "400", partnerAgreedAt: new Date(),
  payrollAccruals: [{
    type: PayrollAccrualType.EXTRA_BONUS, direction: PayrollDirection.INCREASE, amount: "100",
    payments: [{ amount: "100" }],
  }],
});
equal(payrollPaid.profit.netProfit, "500.00", "payroll accrual reduces profit once");
equal(payrollPaid.cash.payrollPaid, "100.00", "payroll payment affects cash position only");

const control = calculateOrderProfitability({
  totalSale: "2000000",
  payments: [
    { type: "CLIENT_PAYMENT", amount: "1000000" },
    { type: "PARTNER_PAYOUT", amount: "500000", partnerId: 7 },
  ],
  partnerId: 7,
  partnerAgreed: "1500000",
  partnerAgreedAt: new Date("2026-08-22"),
  costPlan: {
    materialOutsideWorkshop: "50000",
    delivery: "20000",
    bankFees: "10000",
    otherDirect: "20000",
    confirmedAt: new Date("2026-08-22"),
  },
  payrollAccruals: [
    { type: PayrollAccrualType.ORDER_BONUS, direction: PayrollDirection.INCREASE, amount: "50000", employee: { user: { role: Role.MANAGER }, position: "Менеджер" }, payments: [{ amount: "50000" }] },
    { type: PayrollAccrualType.EXTRA_BONUS, direction: PayrollDirection.INCREASE, amount: "20000", employee: { user: { role: Role.MEASURER }, position: "Замерщик" } },
    { type: PayrollAccrualType.EXTRA_BONUS, direction: PayrollDirection.INCREASE, amount: "10000", employee: { position: "Водитель" } },
    { type: PayrollAccrualType.EXTRA_BONUS, direction: PayrollDirection.INCREASE, amount: "20000", employee: { position: "Администратор" } },
  ],
});
equal(control.client.remaining, "1000000.00", "control: partial client payment changes outstanding only");
equal(control.profit.marginBeforePayroll, "400000.00", "control: margin before payroll");
equal(control.profit.payrollAccrued, "100000.00", "control: payroll accrual total");
equal(control.profit.netProfit, "300000.00", "control: order profit");
equal(control.profit.netMarginPercent, "15.00", "control: order margin");
assert.equal(control.profit.costsConfirmed, true, "control: costs confirmed");
assert.equal(control.profit.label, "Предварительная прибыль", "active order remains preliminary");
const missingWorkshop = calculateOrderProfitability({ totalSale: "1800000" });
assert.equal(missingWorkshop.profit.complete, false, "missing workshop never produces complete profit");
assert.match(missingWorkshop.profit.warning ?? "", /не передан в цех/u);
const missingCost = calculateOrderProfitability({ totalSale: "1800000", partnerId: 7 });
assert.equal(missingCost.profit.complete, false, "missing workshop cost never produces complete profit");
assert.match(missingCost.profit.warning ?? "", /стоимость цеха/u);
console.log("Partner calculations: fixed/order/paid/profit/manual, Decimal precision, debt and reversal PASS");
