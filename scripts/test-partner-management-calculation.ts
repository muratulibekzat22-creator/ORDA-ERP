import assert from "node:assert/strict";

import { PartnerRewardRule, PartnerSettlementOperationStatus, PartnerSettlementOperationType, PartnerSettlementStatus, PayrollAccrualType, PayrollDirection, Role } from "@prisma/client";

import { calculateOrderEconomy } from "@/lib/orders/economy";
import { calculatePartnerSettlement, calculateReward } from "@/lib/partners/settlement";

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
equal(settlement.partnerAccrued, "70000.01", "paid-percent accrual");
equal(settlement.companyAmount, "630000.06", "company amount");
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
  payments: [{ type: "CLIENT_PAYMENT", amount: "3000000" }],
  partnerId: 1,
  partnerAgreed: "3700000",
  partnerAgreedAt: new Date("2026-08-19T00:00:00Z"),
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
equal(economy.partner.paid, "0.00", "agreed cost is not a payout");
equal(economy.partner.remaining, "3700000.00", "partner remaining before payout");
equal(economy.profit.marginBeforePayroll, "1480000.00", "margin before payroll acceptance example");
equal(economy.profit.payrollAccrued, "180000.00", "order-linked payroll accruals");
equal(economy.profit.netProfit, "1300000.00", "net profit acceptance example");
equal(economy.profit.netMarginPercent, "25.00", "net margin acceptance example");
console.log("Partner calculations: fixed/order/paid/profit/manual, Decimal precision, debt and reversal PASS");
