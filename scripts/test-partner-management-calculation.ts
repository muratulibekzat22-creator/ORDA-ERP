import assert from "node:assert/strict";

import { PartnerRewardRule, PartnerSettlementOperationStatus, PartnerSettlementOperationType, PartnerSettlementStatus, PayrollAccrualType, PayrollDirection, Role } from "@prisma/client";

import { calculateOrderEconomy } from "@/lib/orders/economy";
import { partnerOnlySettlement, stripPartnerAllocation } from "@/lib/orders/settlement-redaction";
import { calculateProfitFirstAllocation } from "@/lib/partners/profit-first";
import { calculatePartnerSettlement, calculateReward } from "@/lib/partners/settlement";
import { buildOrderSettlement } from "@/lib/services/order-settlement.service";

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
equal(economy.profit.marginBeforePayroll!, "1480000.00", "margin before payroll acceptance example");
equal(economy.profit.payrollAccrued, "180000.00", "order-linked payroll accruals");
equal(economy.profit.netProfit!, "1300000.00", "net profit acceptance example");
equal(economy.profit.netMarginPercent!, "25.00", "net margin acceptance example");
const importedEconomy = calculateOrderEconomy({
  totalSale: "1000000",
  partnerId: 1,
  partnerAgreed: "600000",
  partnerAgreedAt: null,
});
assert.equal(importedEconomy.profit.dataComplete, false, "an imported amount without a confirmed agreement date stays incomplete until repaired");
assert.equal(importedEconomy.profit.netProfit, null, "unconfirmed legacy production price must not create profit");

const profitFirst = calculateProfitFirstAllocation({
  totalSale: "1800000",
  productionCost: "1500000",
  companyClientReceived: "1000000",
  companyPaidWorkshop: "700000",
  dataComplete: true,
});
equal(profitFirst.plannedCompanyIncome!, "300000.00", "planned company income");
equal(profitFirst.companyIncomeRetained!, "300000.00", "company margin is retained first");
equal(profitFirst.productionFunded!, "700000.00", "remainder of receipt funds production");
equal(profitFirst.readyToPayWorkshop!, "0.00", "nothing remains immediately payable after payout");
equal(profitFirst.workshopRemaining!, "800000.00", "total workshop balance");
equal(profitFirst.awaitingClientForWorkshop!, "800000.00", "future client receipt funds the rest");

const waitingPayout = calculateProfitFirstAllocation({
  totalSale: "1800000",
  productionCost: "1500000",
  companyClientReceived: "1000000",
  companyPaidWorkshop: "0",
  dataComplete: true,
});
equal(waitingPayout.readyToPayWorkshop!, "700000.00", "funded amount is available to workshop now");
equal(waitingPayout.awaitingClientForWorkshop!, "800000.00", "remaining production waits for client");

const advance = calculateProfitFirstAllocation({
  totalSale: "1800000",
  productionCost: "1500000",
  companyClientReceived: "500000",
  companyPaidWorkshop: "400000",
  dataComplete: true,
});
equal(advance.workshopAdvance!, "200000.00", "payout above funded production is an advance");
equal(advance.companyIncomeRetained!, "100000.00", "actual retained income reflects the advance");

const directWorkshopPayment = calculateProfitFirstAllocation({
  totalSale: "1800000",
  productionCost: "1500000",
  companyClientReceived: "300000",
  clientPaidToWorkshop: "900000",
  workshopReturnedToClient: "100000",
  workshopTransferredToCompany: "100000",
  companyPaidWorkshop: "0",
  dataComplete: true,
});
equal(directWorkshopPayment.clientReceived, "1100000.00", "direct workshop payment less refund is client receipt");
equal(directWorkshopPayment.directWorkshopHeld, "700000.00", "workshop transfer and refund reduce direct held money");
equal(directWorkshopPayment.companyIncomeRetained!, "300000.00", "company transfer secures planned income");
equal(directWorkshopPayment.productionFunded!, "800000.00", "client receipts fund production after company income");
equal(directWorkshopPayment.readyToPayWorkshop!, "100000.00", "only the funded unpaid amount is payable now");
equal(directWorkshopPayment.awaitingClientForWorkshop!, "700000.00", "remaining workshop amount waits for client");

const orderDetailSettlement = buildOrderSettlement({
  amount: "1800000",
  partnerId: 1,
  partnerPrice: "1500000",
  partnerAgreedAt: new Date("2026-10-02T00:00:00Z"),
  partner: { id: 1, name: "Цех 1" },
  payments: [{ id: 1, type: "CLIENT_PAYMENT", amount: "300000" }],
  partnerRelation: { operations: [
    { type: "CLIENT_TO_PARTNER", status: "POSTED", amount: "900000" },
    { type: "PARTNER_REFUND", status: "POSTED", amount: "100000" },
    { type: "PARTNER_TO_COMPANY", status: "POSTED", amount: "100000" },
  ] },
});
assert.equal(orderDetailSettlement.client.received, 1_100_000, "order detail uses the same direct-payment receipt total");
assert.equal(orderDetailSettlement.partner.paid, 700_000, "order detail counts direct money still held by workshop");
assert.equal(orderDetailSettlement.partner.allocation.readyToPayWorkshop, 100_000, "order detail uses the same profit-first allocation");

const partnerPayload = partnerOnlySettlement(orderDetailSettlement, 1);
const serializedPartnerPayload = JSON.stringify(partnerPayload);
for (const forbidden of ["allocation", "totalSale", "plannedCompanyIncome", "companyIncomeRetained", "companyCashHeld", "clientReceived"])
  assert(!serializedPartnerPayload.includes(forbidden), `partner payload leaked ${forbidden}`);
assert.equal((partnerPayload.partner as unknown as { agreed: number }).agreed, 1_500_000, "partner keeps its own agreed amount");
const restrictedManagementPayload = JSON.stringify(stripPartnerAllocation(orderDetailSettlement));
assert(!restrictedManagementPayload.includes("plannedCompanyIncome"), "restricted management payload leaked company income");
console.log("Partner calculations: fixed/order/paid/profit/manual, Decimal precision, debt and reversal PASS");
