import { PartnerRewardRule, PartnerSettlementStatus, Prisma } from "@prisma/client";

type DecimalValue = Prisma.Decimal | string | number;

export type PartnerOperationValue = {
  type: string;
  status: string;
  amount: DecimalValue;
  adjustmentEffect?: DecimalValue;
};

export type PartnerSettlementInput = {
  orderAmount: DecimalValue;
  companyProfit: DecimalValue;
  companyClientReceived: DecimalValue;
  companyPaidPartner: DecimalValue;
  rewardRule: PartnerRewardRule;
  rewardPercent?: DecimalValue | null;
  fixedAmount?: DecimalValue | null;
  manualAmount?: DecimalValue | null;
  operations: PartnerOperationValue[];
  disputed?: boolean;
  cancelled?: boolean;
};

const decimal = (value: DecimalValue | null | undefined) => new Prisma.Decimal(value ?? 0);
const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const zeroFloor = (value: Prisma.Decimal) => value.lt(0) ? new Prisma.Decimal(0) : value;

function percentOf(value: Prisma.Decimal, percent: Prisma.Decimal) {
  return money(value.mul(percent).div(100));
}

export function calculateReward(
  rule: PartnerRewardRule,
  input: {
    orderAmount: DecimalValue;
    received: DecimalValue;
    grossProfit: DecimalValue;
    percent?: DecimalValue | null;
    fixedAmount?: DecimalValue | null;
    manualAmount?: DecimalValue | null;
  },
) {
  const orderAmount = zeroFloor(decimal(input.orderAmount));
  const received = zeroFloor(decimal(input.received));
  const grossProfit = zeroFloor(decimal(input.grossProfit));
  const percent = zeroFloor(decimal(input.percent));
  const fixed = zeroFloor(decimal(input.fixedAmount));
  const manual = zeroFloor(decimal(input.manualAmount));
  if (rule === PartnerRewardRule.FIXED)
    return { planned: money(fixed), accrued: money(fixed), basis: money(fixed) };
  if (rule === PartnerRewardRule.ORDER_PERCENT) {
    const reward = percentOf(orderAmount, percent);
    return { planned: reward, accrued: reward, basis: money(orderAmount) };
  }
  if (rule === PartnerRewardRule.PAID_PERCENT)
    return {
      planned: percentOf(orderAmount, percent),
      accrued: percentOf(received, percent),
      basis: money(received),
    };
  if (rule === PartnerRewardRule.PROFIT_PERCENT)
    return {
      planned: percentOf(grossProfit, percent),
      accrued: percentOf(grossProfit, percent),
      basis: money(grossProfit),
    };
  return { planned: money(manual), accrued: money(manual), basis: money(manual) };
}

export function calculatePartnerSettlement(input: PartnerSettlementInput) {
  const active = input.operations.filter(
    (operation) => operation.status === "POSTED" && operation.type !== "REVERSAL",
  );
  const sum = (type: string) => active
    .filter((operation) => operation.type === type)
    .reduce((total, operation) => total.add(decimal(operation.amount)), new Prisma.Decimal(0));
  const adjustment = active
    .filter((operation) => operation.type === "ADJUSTMENT")
    .reduce((total, operation) => total.add(decimal(operation.adjustmentEffect)), new Prisma.Decimal(0));
  const clientPaidToPartner = sum("CLIENT_TO_PARTNER");
  const partnerReturned = sum("PARTNER_REFUND");
  const partnerTransferred = sum("PARTNER_TO_COMPANY");
  const companyClientReceived = decimal(input.companyClientReceived);
  const companyPaidPartner = decimal(input.companyPaidPartner);
  const received = zeroFloor(companyClientReceived.add(clientPaidToPartner).sub(partnerReturned));
  const reward = calculateReward(input.rewardRule, {
    orderAmount: input.orderAmount,
    received,
    grossProfit: input.companyProfit,
    percent: input.rewardPercent,
    fixedAmount: input.fixedAmount,
    manualAmount: input.manualAmount,
  });
  const partnerAccrued = money(zeroFloor(reward.accrued.add(adjustment)));
  const partnerBalance = money(
    partnerAccrued
      .sub(companyPaidPartner)
      .sub(clientPaidToPartner)
      .add(partnerReturned)
      .add(partnerTransferred),
  );
  const orderAmount = decimal(input.orderAmount);
  const clientRemaining = money(zeroFloor(orderAmount.sub(received)));
  const clientOverpayment = money(zeroFloor(received.sub(orderAmount)));
  const companyAmount = money(received.sub(partnerAccrued));
  const companyDebt = money(zeroFloor(partnerBalance));
  const partnerDebt = money(zeroFloor(partnerBalance.negated()));
  let status: PartnerSettlementStatus = PartnerSettlementStatus.CALCULATED;
  if (input.cancelled) status = PartnerSettlementStatus.CANCELLED;
  else if (input.disputed) status = PartnerSettlementStatus.DISPUTED;
  else if (partnerBalance.eq(0) && (received.gt(0) || partnerAccrued.eq(0)))
    status = PartnerSettlementStatus.CLOSED;
  else if (partnerBalance.lt(0)) status = PartnerSettlementStatus.PARTNER_OWES_COMPANY;
  else if (companyPaidPartner.gt(0)) status = PartnerSettlementStatus.PARTIALLY_PAID;
  else if (partnerBalance.gt(0)) status = PartnerSettlementStatus.COMPANY_OWES_PARTNER;
  return {
    orderAmount: money(orderAmount),
    companyClientReceived: money(companyClientReceived),
    clientPaidToPartner: money(clientPaidToPartner),
    partnerReturned: money(partnerReturned),
    partnerTransferred: money(partnerTransferred),
    received: money(received),
    clientRemaining,
    clientOverpayment,
    partnerPlanned: reward.planned,
    partnerAccrued,
    rewardBasis: reward.basis,
    companyPaidPartner: money(companyPaidPartner),
    partnerRemaining: companyDebt,
    companyAmount,
    companyDebt,
    partnerDebt,
    partnerBalance,
    adjustment: money(adjustment),
    status,
  };
}
