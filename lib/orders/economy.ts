import { PayrollAccrualType, PayrollDirection, Prisma, Role } from "@prisma/client";

type DecimalValue = Prisma.Decimal | string | number;

export type OrderEconomyInput = {
  totalSale: DecimalValue;
  commercialAdjustments?: Array<{ balanceImpact: DecimalValue }>;
  payments?: Array<{ type: string; amount: DecimalValue; partnerId?: number | null }>;
  partnerId?: number | null;
  partnerAgreed?: DecimalValue | null;
  partnerAccrued?: DecimalValue | null;
  partnerAgreedAt?: Date | string | null;
  partnerAgreedBy?: string | null;
  partnerDueAt?: Date | string | null;
  clientDueAt?: Date | string | null;
  partnerDisputed?: boolean;
  lifecycle?: string | null;
  now?: Date;
  payrollAccruals?: Array<{
    type: PayrollAccrualType | string;
    direction: PayrollDirection | string;
    amount: DecimalValue;
    reversalOfId?: number | null;
    reversedBy?: { id: number } | null;
    employee?: { user?: { role?: Role | string | null } | null; position?: string | null } | null;
    payments?: Array<{ amount: DecimalValue; reversalOfId?: number | null; reversedAt?: Date | string | null }>;
  }>;
  ledgerEntries?: Array<{
    direction: string;
    amount: DecimalValue;
    source: string;
    category: string;
    type: string;
    affectsProfit: boolean;
    voidedAt?: Date | string | null;
  }>;
  costPlan?: {
    materialOutsideWorkshop: DecimalValue;
    delivery: DecimalValue;
    bankFees: DecimalValue;
    otherDirect: DecimalValue;
    confirmedAt?: Date | string | null;
  } | null;
};

const clientIncome = new Set(["CLIENT_PAYMENT", "payment", "PREPAYMENT", "ADDITIONAL_PAYMENT"]);
const money = (value: DecimalValue | null | undefined = 0) =>
  new Prisma.Decimal(value ?? 0).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const positive = (value: Prisma.Decimal) => value.gt(0) ? value : money(0);

export function calculateOrderEconomy(input: OrderEconomyInput) {
  const totalSale = money(input.totalSale);
  const adjustments = input.commercialAdjustments ?? [];
  const additionalWorks = money(adjustments.reduce(
    (sum, item) => money(item.balanceImpact).gt(0) ? sum.add(item.balanceImpact) : sum,
    money(0),
  ));
  const discounts = money(adjustments.reduce(
    (sum, item) => money(item.balanceImpact).lt(0) ? sum.add(money(item.balanceImpact).abs()) : sum,
    money(0),
  ));
  const contractAmount = money(totalSale.sub(additionalWorks).add(discounts));

  let clientReceived = money(0);
  let clientRefunds = money(0);
  let partnerPaid = money(0);
  for (const payment of input.payments ?? []) {
    const amount = money(payment.amount);
    if (clientIncome.has(payment.type)) clientReceived = clientReceived.add(amount);
    else if (payment.type === "REFUND") clientRefunds = clientRefunds.add(amount);
    else if (payment.type === "PARTNER_PAYOUT" && payment.partnerId === input.partnerId)
      partnerPaid = partnerPaid.add(amount);
    else if (payment.type === "PARTNER_PAYOUT_REVERSAL" && payment.partnerId === input.partnerId)
      partnerPaid = partnerPaid.sub(amount);
  }
  const netReceived = money(clientReceived.sub(clientRefunds));
  const clientRemaining = money(positive(totalSale.sub(netReceived)));
  const clientOverpayment = money(positive(netReceived.sub(totalSale)));
  const partnerAgreed = input.partnerAgreedAt ? money(input.partnerAgreed ?? 0) : money(0);
  const partnerAccrued = input.partnerAgreedAt ? money(input.partnerAccrued ?? partnerAgreed) : money(0);
  const partnerRemaining = money(positive(partnerAccrued.sub(partnerPaid)));
  const partnerOverpayment = money(positive(partnerPaid.sub(partnerAccrued)));

  const payroll = (input.payrollAccruals ?? []).filter(
    (row) => !row.reversalOfId && !row.reversedBy,
  );
  const accrualValue = (row: (typeof payroll)[number]) =>
    row.direction === PayrollDirection.DECREASE || row.direction === "DECREASE"
      ? money(row.amount).negated()
      : money(row.amount);
  const payrollAccrued = money(payroll.reduce((sum, row) => sum.add(accrualValue(row)), money(0)));
  const byRole = (roles: string[], positions: RegExp) => money(payroll
    .filter((row) => roles.includes(String(row.employee?.user?.role ?? "")) || positions.test(row.employee?.position ?? ""))
    .reduce((sum, row) => sum.add(accrualValue(row)), money(0)));
  const managerBonus = money(payroll
    .filter((row) =>
      ["GUARANTEED_ORDER_BONUS", "ORDER_BONUS"].includes(String(row.type)) &&
      (row.employee?.user?.role === Role.MANAGER || /менеджер/i.test(row.employee?.position ?? "")))
    .reduce((sum, row) => sum.add(accrualValue(row)), money(0)));
  const measurer = money(payroll
    .filter((row) =>
      String(row.type) === "MEASUREMENT_BONUS" ||
      row.employee?.user?.role === Role.MEASURER ||
      /замер/i.test(row.employee?.position ?? ""))
    .reduce((sum, row) => sum.add(accrualValue(row)), money(0)));
  const driver = byRole([], /водител/i);
  const installers = byRole(["INSTALLER"], /монтаж|установ/i);
  const expediter = byRole([], /экспедитор/i);
  // Legacy installer/expediter accruals remain immutable and are included in
  // the catch-all amount. The current order form exposes only the canonical
  // manager, measurer, driver and other buckets.
  const classified = managerBonus.add(measurer).add(driver);
  const otherPayroll = money(payrollAccrued.sub(classified));
  const payrollPaid = money(payroll.reduce((sum, row) => sum.add(
    (row.payments ?? [])
      .filter((payment) => !payment.reversalOfId && !payment.reversedAt)
      .reduce((paid, payment) => paid.add(payment.amount), money(0)),
  ), money(0)));

  const directLedger = (input.ledgerEntries ?? []).filter((entry) =>
    !entry.voidedAt &&
    entry.direction === "EXPENSE" &&
    !["PAYROLL_PAYMENT", "OTHER_SYSTEM"].includes(entry.source) &&
    entry.category !== "SALARY" &&
    entry.type !== "PARTNER_PAYOUT",
  );
  const legacyDirectExpenses = money(directLedger
    .filter((entry) => entry.affectsProfit)
    .reduce((sum, entry) => sum.add(entry.amount), money(0)));
  const paidDirectExpenses = money(directLedger.reduce((sum, entry) => sum.add(entry.amount), money(0)));
  const directCategory = (pattern: RegExp) => money(directLedger
    .filter((entry) => entry.affectsProfit && pattern.test(`${entry.category} ${entry.type} ${entry.source}`))
    .reduce((sum, entry) => sum.add(entry.amount), money(0)));
  const legacyMaterials = directCategory(/MATERIAL|МАТЕРИАЛ/i);
  const legacyDelivery = directCategory(/DELIVER|ДОСТАВ/i);
  const contractors = directCategory(/CONTRACTOR|ПОДРЯД/i);
  const legacyBankFees = directCategory(/BANK|COMMISSION|БАНК|КОМИСС/i);
  const categorizedLegacy = legacyMaterials.add(legacyDelivery).add(legacyBankFees);
  const legacyOtherDirect = money(positive(legacyDirectExpenses.sub(categorizedLegacy)));
  const materials = input.costPlan
    ? money(input.costPlan.materialOutsideWorkshop)
    : legacyMaterials;
  const delivery = input.costPlan ? money(input.costPlan.delivery) : legacyDelivery;
  const bankFees = input.costPlan ? money(input.costPlan.bankFees) : legacyBankFees;
  const otherDirectExpenses = input.costPlan
    ? money(input.costPlan.otherDirect)
    : legacyOtherDirect;
  const directExpenses = money(materials.add(delivery).add(bankFees).add(otherDirectExpenses));
  const marginBeforePayroll = money(totalSale.sub(partnerAccrued).sub(directExpenses));
  const netProfit = money(marginBeforePayroll.sub(payrollAccrued));
  const netMarginPercent = totalSale.eq(0)
    ? new Prisma.Decimal(0)
    : netProfit.mul(100).div(totalSale).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const cashBalance = money(netReceived.sub(partnerPaid).sub(payrollPaid).sub(paidDirectExpenses));
  const now = input.now ?? new Date();
  const overdue = (value: Date | string | null | undefined) => value ? new Date(value).getTime() < now.getTime() : false;
  const clientStatus = clientOverpayment.gt(0)
    ? "OVERPAID"
    : clientRemaining.eq(0)
      ? "PAID"
      : overdue(input.clientDueAt)
        ? "OVERDUE"
        : netReceived.gt(0)
          ? "PARTIAL"
          : "UNPAID";
  const partnerStatus = !input.partnerId
    ? "NOT_ASSIGNED"
    : input.partnerDisputed
      ? "DISPUTED"
      : !input.partnerAgreedAt
        ? "COST_MISSING"
        : partnerOverpayment.gt(0)
          ? "OVERPAID"
          : partnerAccrued.eq(0)
            ? "NOT_ACCRUED"
          : partnerRemaining.eq(0)
            ? "PAID"
            : overdue(input.partnerDueAt)
              ? "OVERDUE"
              : partnerPaid.gt(0)
                ? "PARTIALLY_PAID"
                : "PAYABLE";
  const profitComplete = Boolean(input.partnerId && input.partnerAgreedAt);
  const costsConfirmed = Boolean(input.costPlan?.confirmedAt);
  const profitWarning = !input.partnerId
    ? "Прибыль не рассчитана: заказ ещё не передан в цех"
    : !input.partnerAgreedAt
      ? "Прибыль не рассчитана: не указана стоимость цеха"
      : !costsConfirmed
        ? "Предварительная прибыль: прямые расходы ещё не подтверждены"
        : null;
  const profitLabel = !profitComplete
    ? "Прибыль не рассчитана"
    : input.lifecycle === "COMPLETED" && costsConfirmed
      ? "Фактическая прибыль заказа"
      : "Предварительная прибыль";

  return {
    client: {
      contractAmount, additionalWorks, discounts, totalSale,
      receivedGross: money(clientReceived), refunds: money(clientRefunds), netReceived,
      remaining: clientRemaining, overpayment: clientOverpayment,
      dueAt: input.clientDueAt ?? null,
      overdueAmount: overdue(input.clientDueAt) ? clientRemaining : money(0),
      status: clientStatus,
    },
    partner: {
      agreed: partnerAgreed, agreedAt: input.partnerAgreedAt ?? null, agreedBy: input.partnerAgreedBy ?? null,
      accrued: partnerAccrued, paid: money(partnerPaid), remaining: partnerRemaining, overpayment: partnerOverpayment,
      dueAt: input.partnerDueAt ?? null,
      status: partnerStatus,
    },
    profit: {
      totalSale, partnerCost: partnerAccrued, directExpenses, materials, delivery, contractors, bankFees, otherDirectExpenses, marginBeforePayroll,
      managerBonus, measurer, installers, driver, expediter, otherPayroll,
      payrollAccrued, netProfit, netMarginPercent,
      complete: profitComplete,
      costsConfirmed,
      label: profitLabel,
      warning: profitWarning,
      mode: input.lifecycle === "COMPLETED" ? ("ACTUAL" as const) : ("PLANNED" as const),
    },
    cash: {
      clientReceived: netReceived, partnerPaid: money(partnerPaid), payrollPaid,
      otherExpensesPaid: paidDirectExpenses, balance: cashBalance,
    },
  };
}
