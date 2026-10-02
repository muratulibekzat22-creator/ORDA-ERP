export const MANAGER_ORDER_BONUS_THRESHOLD = 3_000_000;
export const MANAGER_ORDER_BONUS_STANDARD = 30_000;
export const MANAGER_ORDER_BONUS_HIGH = 50_000;
export const PAYROLL_POLICY_ADJUSTMENT_PREFIX = "Автопроверка бонуса за заказ";
export const PAYROLL_SALARY_ADJUSTMENT_PREFIX = "Автопроверка оклада";
export const MANAGER_ORDER_BONUS_EARNED_EVENT = "ORDER_RECEIVED";

export const managerOrderBonus = (orderAmount: number) =>
  orderAmount > MANAGER_ORDER_BONUS_THRESHOLD
    ? MANAGER_ORDER_BONUS_HIGH
    : MANAGER_ORDER_BONUS_STANDARD;

export const isManagerOrderBonusEligible = (order: {
  status?: string | null;
  deletedAt?: Date | string | null;
}) =>
  !order.deletedAt &&
  !/(отмен|возврат|cancel|refund|return)/i.test(order.status ?? "");

export const isOrderAssignedToManager = (
  order: {
    managerUserId?: number | null;
    leadManagerId?: number | null;
    managerName?: string | null;
  },
  manager: { id: number; name: string },
) =>
  order.managerUserId === manager.id ||
  order.leadManagerId === manager.id ||
  (!order.managerUserId &&
    (order.managerName ?? "").trim().toLocaleLowerCase("ru-RU") ===
      manager.name.trim().toLocaleLowerCase("ru-RU"));

export const isDateInPayrollPeriod = (
  value: Date,
  start: Date,
  end: Date,
) => value >= start && value < end;

export const auditManagerOrderBonus = (input: {
  orderAmount: number;
  status?: string | null;
  deletedAt?: Date | string | null;
  submitted: number;
  recorded: number;
}) => {
  const eligible = isManagerOrderBonusEligible(input);
  const expected = eligible ? managerOrderBonus(input.orderAmount) : 0;
  return {
    eligible,
    expected,
    managerDifference: input.submitted - expected,
    ledgerDifference: expected - input.recorded,
    status: !eligible
      ? ("NOT_ELIGIBLE" as const)
      : input.submitted === expected
        ? ("MATCH" as const)
        : input.submitted > expected
          ? ("OVER" as const)
          : ("UNDER" as const),
    reconciled: Math.abs(expected - input.recorded) < 0.01,
  };
};

export const isValidKaspiReference = (value: string | undefined) => {
  const normalized = value?.trim() ?? "";
  return normalized.length >= 3 && normalized.length <= 120;
};

export const isPayrollReconciled = (delta: number) =>
  Number.isFinite(delta) && Math.abs(delta) < 0.01;

export const isPayrollPolicyReady = (
  salaryDelta: number,
  orderDeltas: number[],
) =>
  isPayrollReconciled(salaryDelta) &&
  orderDeltas.every(isPayrollReconciled);

export const payrollRoleAccess = (accountRole: string) => ({
  founder: accountRole === "DIRECTOR",
  administrator: accountRole === "OPERATIONS_DIRECTOR",
  accountant: accountRole === "ACCOUNTANT",
});

const money = (value: number) => Math.round(value * 100) / 100;

export const personalPayrollCalculation = (input: {
  salary: number;
  bonuses: number;
  premiums: number;
  deductions: number;
  advances: number;
  otherPayments: number;
  pendingAdvances: number;
  accrued: number;
  expectedTotalOverride?: number;
}) => {
  const totalToAccrue = money(
    input.expectedTotalOverride ??
      input.salary + input.bonuses + input.premiums - input.deductions,
  );
  const amountToPay = money(
    totalToAccrue - input.advances - input.otherPayments,
  );
  return {
    salary: money(input.salary),
    bonuses: money(input.bonuses),
    premiums: money(input.premiums),
    deductions: money(input.deductions),
    advances: money(input.advances),
    otherPayments: money(input.otherPayments),
    pendingAdvances: money(input.pendingAdvances),
    accrued: money(input.accrued),
    totalToAccrue,
    remainingToAccrue: money(totalToAccrue - input.accrued),
    amountToPay,
    amountToPayAfterPendingAdvances: money(
      amountToPay - input.pendingAdvances,
    ),
  };
};

export const payrollPaymentReference = (
  year: number,
  month: number,
  paymentId: number,
) =>
  `ЗП-${year}${String(month).padStart(2, "0")}-${String(paymentId).padStart(6, "0")}`;

export const payrollPaymentPurpose = (
  employeeName: string,
  year: number,
  month: number,
  paymentId: number,
) => {
  const period = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Almaty",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  return `Заработная плата за ${period} — ${employeeName}. Подтверждение ${payrollPaymentReference(year, month, paymentId)}`;
};
