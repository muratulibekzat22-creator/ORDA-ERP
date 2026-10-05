export const MANAGER_ORDER_BONUS_THRESHOLD = 3_000_000;
export const MANAGER_ORDER_BONUS_STANDARD = 30_000;
export const MANAGER_ORDER_BONUS_HIGH = 50_000;
export const MANAGER_ORDER_BONUS_AUTOMATION_START = { year: 2026, month: 10 } as const;
export const AUTOMATIC_ORDER_BONUS_REASON_PREFIX = "Автоматический бонус по сумме заказа";
export const PAYROLL_POLICY_ADJUSTMENT_PREFIX = "Автопроверка бонуса за заказ";
export const PAYROLL_SALARY_ADJUSTMENT_PREFIX = "Автопроверка оклада";
export const MANAGER_ORDER_BONUS_EARNED_EVENT = "ORDER_RECEIVED";
export const TERMINATED_MANAGER_ORDER_BONUS_EARNED_EVENT = "ORDER_COMPLETED";

export const isSalesManagerPayrollEmployee = (employee: {
  position: string;
  user?: { role: string } | null;
}) =>
  !/замер/i.test(employee.position) &&
  (employee.user?.role === "MANAGER" || employee.position === "MANAGER");

const normalizeResponsibleName = (value: string | null | undefined) =>
  (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");

export const isCompanyResponsibleOrder = (order: {
  responsibleType?: "EMPLOYEE" | "COMPANY" | null;
  managerName?: string | null;
  managerUserId?: number | null;
}) => {
  if (order.responsibleType) return order.responsibleType === "COMPANY";
  const responsible = normalizeResponsibleName(order.managerName);
  const companyLabel = /(^|[\s(«"'/_-])(компания|company)(?=$|[\s)»"'/_-])/iu;
  return order.managerUserId === null || companyLabel.test(responsible);
};

const payrollDate = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const payrollSalaryForPeriod = (input: {
  hiredAt: Date | string;
  terminatedAt?: Date | string | null;
  baseSalary: number | string | { toString(): string };
  salaryRates: Array<{
    amount: number | string | { toString(): string };
    effectiveFrom: Date | string;
    effectiveTo?: Date | string | null;
  }>;
  periodStart: Date;
  periodEnd: Date;
}) => {
  const hiredAt = payrollDate(input.hiredAt);
  const terminatedAt = payrollDate(input.terminatedAt);
  const employedInPeriod = Boolean(
    hiredAt &&
      hiredAt < input.periodEnd &&
      (!terminatedAt || terminatedAt > input.periodStart),
  );
  const activeRate = employedInPeriod
    ? input.salaryRates.find((rate) => {
        const effectiveFrom = payrollDate(rate.effectiveFrom);
        const effectiveTo = payrollDate(rate.effectiveTo);
        return Boolean(
          effectiveFrom &&
            effectiveFrom < input.periodEnd &&
            (!effectiveTo || effectiveTo > input.periodStart),
        );
      })
    : undefined;
  const amount = !employedInPeriod
    ? 0
    : activeRate
      ? Number(activeRate.amount)
      : input.salaryRates.length === 0
        ? Number(input.baseSalary)
        : 0;
  return {
    amount: Number.isFinite(amount) ? amount : 0,
    effectiveFrom: activeRate
      ? payrollDate(activeRate.effectiveFrom)
      : hiredAt,
    employedInPeriod,
  };
};

export const isTerminatedPayrollEmployee = (employee: {
  active: boolean;
  terminatedAt?: Date | string | null;
  accountActive?: boolean | null;
}) =>
  !employee.active ||
  Boolean(employee.terminatedAt) ||
  employee.accountActive === false;

const validDate = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const managerOrderBonusEarnedAt = (input: {
  orderReceivedAt: Date | string;
  completedAt?: Date | string | null;
  lifecycle?: string | null;
  employeeActive: boolean;
  employeeTerminatedAt?: Date | string | null;
  accountActive?: boolean | null;
}) => {
  const terminated = isTerminatedPayrollEmployee({
    active: input.employeeActive,
    terminatedAt: input.employeeTerminatedAt,
    accountActive: input.accountActive,
  });
  if (!terminated) return validDate(input.orderReceivedAt);
  if (input.lifecycle !== "COMPLETED") return null;
  // Completion unlocks a terminated manager's bonus, but the bonus still
  // belongs to the business month recorded as the factual order date.
  return validDate(input.completedAt) ? validDate(input.orderReceivedAt) : null;
};

export const managerOrderBonusEarnedEvent = (employee: {
  active: boolean;
  terminatedAt?: Date | string | null;
  accountActive?: boolean | null;
}) =>
  isTerminatedPayrollEmployee(employee)
    ? TERMINATED_MANAGER_ORDER_BONUS_EARNED_EVENT
    : MANAGER_ORDER_BONUS_EARNED_EVENT;

export const managerOrderBonus = (orderAmount: number) =>
  orderAmount > MANAGER_ORDER_BONUS_THRESHOLD
    ? MANAGER_ORDER_BONUS_HIGH
    : MANAGER_ORDER_BONUS_STANDARD;

export const isManagerOrderBonusAutomaticPeriod = (
  year: number,
  month: number,
) =>
  year > MANAGER_ORDER_BONUS_AUTOMATION_START.year ||
  (year === MANAGER_ORDER_BONUS_AUTOMATION_START.year &&
    month >= MANAGER_ORDER_BONUS_AUTOMATION_START.month);

export const isManagerOrderBonusEligible = (order: {
  status?: string | null;
  lifecycle?: string | null;
  deletedAt?: Date | string | null;
  responsibleType?: "EMPLOYEE" | "COMPANY" | null;
  managerName?: string | null;
  managerUserId?: number | null;
}) =>
  !order.deletedAt &&
  !isCompanyResponsibleOrder(order) &&
  order.lifecycle !== "CANCELLED" &&
  !/(отмен|возврат|cancel|refund|return)/i.test(order.status ?? "");

export const isOrderAssignedToManager = (
  order: {
    responsibleType?: "EMPLOYEE" | "COMPANY" | null;
    managerUserId?: number | null;
    leadManagerId?: number | null;
    managerName?: string | null;
  },
  manager: { id: number; name: string },
) => {
  // Only the current normalized order assignment is authoritative. Historical
  // lead ownership and display names must never drive payroll.
  if (isCompanyResponsibleOrder(order)) return false;
  return manager.id > 0 && order.managerUserId === manager.id;
};

export const isDateInPayrollPeriod = (
  value: Date,
  start: Date,
  end: Date,
) => value >= start && value < end;

export const auditManagerOrderBonus = (input: {
  orderAmount: number;
  status?: string | null;
  deletedAt?: Date | string | null;
  responsibleType?: "EMPLOYEE" | "COMPANY" | null;
  managerName?: string | null;
  managerUserId?: number | null;
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

export const isValidOptionalPaymentReference = (
  value: string | undefined,
) => !value?.trim() || isValidKaspiReference(value);

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
}) => {
  const totalToAccrue = money(
    input.salary + input.bonuses + input.premiums - input.deductions,
  );
  const remainingToAccrue = money(Math.max(totalToAccrue - input.accrued, 0));
  const amountToPay = money(
    Math.max(input.accrued - input.advances - input.otherPayments, 0),
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
    remainingToAccrue,
    amountToPay,
    amountToPayAfterPendingAdvances: money(
      Math.max(amountToPay - input.pendingAdvances, 0),
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
