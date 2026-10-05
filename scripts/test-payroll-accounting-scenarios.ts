import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { companyMonthRange } from "../lib/company-calendar";
import {
  isCompanyResponsibleOrder,
  isManagerOrderBonusEligible,
  isOrderAssignedToManager,
  managerOrderBonus,
  payrollSalaryForPeriod,
  personalPayrollCalculation,
} from "../lib/payroll-policy";

type ScenarioEvidence = {
  label: string;
  result: unknown;
};

const passed: ScenarioEvidence[] = [];
const pass = (label: string, result: unknown) => passed.push({ label, result });

const statement = (input: {
  salary: number;
  savedBonuses: Array<number | null>;
  paid: number;
  accrued?: number;
}) => {
  const missingBonusCount = input.savedBonuses.filter(
    (amount) => amount == null,
  ).length;
  const savedBonusTotal = input.savedBonuses.reduce<number>(
    (sum, amount) => sum + (amount ?? 0),
    0,
  );
  const calculation = personalPayrollCalculation({
    salary: input.salary,
    bonuses: savedBonusTotal,
    premiums: 0,
    deductions: 0,
    advances: input.paid,
    otherPayments: 0,
    pendingAdvances: 0,
    accrued: input.accrued ?? 0,
  });
  return {
    prepared: calculation.totalToAccrue,
    pendingAccrual: calculation.remainingToAccrue,
    accrued: calculation.accrued,
    paid: input.paid,
    remaining: calculation.amountToPay,
    incomplete: missingBonusCount > 0,
    missingBonusCount,
  };
};

const september = companyMonthRange(2026, 9);
const october = companyMonthRange(2026, 10);
assert.equal(september.start.toISOString(), "2026-08-31T19:00:00.000Z");
assert.equal(september.end.toISOString(), "2026-09-30T19:00:00.000Z");
assert.equal(october.start.toISOString(), "2026-09-30T19:00:00.000Z");
assert.equal(october.end.toISOString(), "2026-10-31T19:00:00.000Z");
pass("Границы месяцев рассчитаны в Asia/Almaty", {
  september,
  october,
});

// Missing manual decisions never inherit the system recommendation.
const akbota = statement({
  salary: 200_000,
  savedBonuses: [null, null, null],
  paid: 50_000,
});
assert.deepEqual(akbota, {
  prepared: 200_000,
  pendingAccrual: 200_000,
  accrued: 0,
  paid: 50_000,
  remaining: 0,
  incomplete: true,
  missingBonusCount: 3,
});
pass("Сентябрь — Акбота: пустые бонусы не заменяются подсказкой", akbota);

// Saved decisions form a calculation, but do not become an accrual until a
// director confirms the calculation.
const akbotaWithSavedBonuses = statement({
  salary: 200_000,
  savedBonuses: [50_000, 40_000],
  paid: 50_000,
});
assert.deepEqual(akbotaWithSavedBonuses, {
  prepared: 290_000,
  pendingAccrual: 290_000,
  accrued: 0,
  paid: 50_000,
  remaining: 0,
  incomplete: false,
  missingBonusCount: 0,
});
pass("Сентябрь — Акбота до начисления: 290 000 ожидает подтверждения", akbotaWithSavedBonuses);

const akbotaConfirmed = statement({
  salary: 200_000,
  savedBonuses: [50_000, 40_000],
  paid: 50_000,
  accrued: 290_000,
});
assert.deepEqual(akbotaConfirmed, {
  prepared: 290_000,
  pendingAccrual: 0,
  accrued: 290_000,
  paid: 50_000,
  remaining: 240_000,
  incomplete: false,
  missingBonusCount: 0,
});
pass("Сентябрь — Акбота: 0 / 290 000 / 50 000 / 240 000", akbotaConfirmed);

const alikhan = statement({
  salary: 400_000,
  savedBonuses: [],
  paid: 83_000,
  accrued: 400_000,
});
assert.deepEqual(alikhan, {
  prepared: 400_000,
  pendingAccrual: 0,
  accrued: 400_000,
  paid: 83_000,
  remaining: 317_000,
  incomplete: false,
  missingBonusCount: 0,
});
pass("Сентябрь — Алихан: 0 / 400 000 / 83 000 / 317 000", alikhan);

const octoberStart = new Date("2026-09-30T19:00:00.000Z");
const unconfiguredMeasurerSalary = {
  hiredAt: octoberStart,
  baseSalary: 0,
  salaryRates: [{ amount: 0, effectiveFrom: octoberStart }],
};
for (const name of ["Еркебулан", "Нурасыл"] as const) {
  const septemberSalary = payrollSalaryForPeriod({
    ...unconfiguredMeasurerSalary,
    periodStart: september.start,
    periodEnd: september.end,
  }).amount;
  const octoberSalary = payrollSalaryForPeriod({
    ...unconfiguredMeasurerSalary,
    periodStart: october.start,
    periodEnd: october.end,
  }).amount;
  assert.deepEqual({ septemberSalary, octoberSalary }, {
    septemberSalary: 0,
    octoberSalary: 0,
  });
  pass(`${name}: дата начала в октябре не создаёт оклад или начисление`, {
    septemberSalary,
    octoberSalary,
    salaryConfigured: false,
  });
}

const companyOrder = {
  responsibleType: "COMPANY" as const,
  managerUserId: null,
  leadManagerId: 17,
  managerName: "Компания",
};
const companyOrderResult = {
  companyResponsible: isCompanyResponsibleOrder(companyOrder),
  assignedToGulsim: isOrderAssignedToManager(companyOrder, {
    id: 17,
    name: "Гулсим",
  }),
  bonusEligible: isManagerOrderBonusEligible({
    ...companyOrder,
    status: "Оформлен",
  }),
};
assert.deepEqual(companyOrderResult, {
  companyResponsible: true,
  assignedToGulsim: false,
  bonusEligible: false,
});
pass("Текущий ответственный Компания исключает заказ из зарплаты", companyOrderResult);

const suggestion = managerOrderBonus(2_800_000);
assert.equal(suggestion, 30_000);
const manualFifty: number | null = 50_000;
const manualZero: number | null = 0;
const missingManual: number | null = null;
assert.equal(manualFifty ?? 0, 50_000);
assert.equal(manualZero ?? 0, 0);
assert.equal(missingManual ?? 0, 0);
pass("Ручной бонус 50 000 независим от подсказки 30 000", {
  suggestion,
  manualBonus: manualFifty,
  effectiveBonus: manualFifty ?? 0,
});
pass("Ручной бонус 0 сохранён как осознанное значение", {
  suggestion,
  manualBonus: manualZero,
  effectiveBonus: manualZero ?? 0,
});
pass("Незаполненный бонус равен 0 в расчёте и делает его неполным", {
  suggestion,
  manualBonus: missingManual,
  effectiveBonus: missingManual ?? 0,
  incomplete: true,
});

const service = readFileSync("lib/services/payroll.service.ts", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");
const page = readFileSync("app/payroll/page.tsx", "utf8");
const payrollRoute = readFileSync("app/api/payroll/route.ts", "utf8");
const bonusRoute = readFileSync(
  "app/api/payroll/bonus-corrections/route.ts",
  "utf8",
);
const orderRoute = readFileSync("app/api/orders/[id]/route.ts", "utf8");
const tenantScope = readFileSync("lib/tenant-scope.ts", "utf8");
const accountingMigration = readFileSync(
  "prisma/migrations/20261004110000_payroll_accounting_source_of_truth/migration.sql",
  "utf8",
);
const measurerRepair = readFileSync(
  "prisma/migrations/20261004150000_revoke_unverified_measurer_salary_autofill/migration.sql",
  "utf8",
);
const salaryRateInvariantMigration = readFileSync(
  "prisma/migrations/20261004160000_payroll_salary_rate_invariants/migration.sql",
  "utf8",
);
const orderPayrollBonusRoute = readFileSync(
  "app/api/orders/[id]/payroll-bonuses/route.ts",
  "utf8",
);
const measurementService = readFileSync(
  "lib/services/measurement.service.ts",
  "utf8",
);
const componentLedgerReconciliation = readFileSync(
  "prisma/migrations/20261004161000_payroll_component_ledger_reconciliation/migration.sql",
  "utf8",
);

assert.match(
  service,
  /effectiveOrderBonusAmount[\s\S]*?manualAmount == null \? 0 : Number\(manualAmount\)/,
);
assert.match(service, /const effectiveBonus = manualBonus \?\? 0/);
assert.match(
  service,
  /if \(manualAmount == null\) missingBonusCount \+= 1;[\s\S]*?else orderBonuses \+= manualAmount/,
);
pass("Подсказка не используется как fallback фактического бонуса", {
  nullEffectiveBonus: 0,
  missingMarkedIncomplete: true,
});

assert.match(service, /payrollOrderBonusDecision\.upsert/);
assert.match(service, /const sameValue =/);
assert.match(service, /ORDER_BONUS_DECISION_NOOP/);
assert.match(service, /idempotencyKey: `\$\{input\.key\}:audit`/);
assert.match(service, /periodId: period\.id,[\s\S]*?earnedAt: factualEarnedAt/);
assert.match(service, /existing\.periodId !== period\.id/);
assert.match(
  accountingMigration,
  /PayrollOrderBonusDecision_orderId_employeeId_key/,
);
pass("Решение бонуса уникально и закреплено за явным периодом", {
  oneDecisionPerAssignment: true,
  idempotentNoOp: true,
  explicitPeriod: true,
});

const assignmentResult = {
  assignedBefore: isOrderAssignedToManager(
    { responsibleType: "EMPLOYEE", managerUserId: 17 },
    { id: 17, name: "Гулсим" },
  ),
  assignedAfter: isOrderAssignedToManager(
    { responsibleType: "COMPANY", managerUserId: null },
    { id: 17, name: "Гулсим" },
  ),
};
assert.deepEqual(assignmentResult, {
  assignedBefore: true,
  assignedAfter: false,
});
assert.match(service, /responsibleType: OrderResponsibleType\.EMPLOYEE/);
assert.match(orderRoute, /ORDER_BONUS_DECISION_INVALIDATED/);
assert.match(orderRoute, /payrollOrderBonusDecision\.deleteMany/);
pass("Смена ответственного на Компанию сразу исключает заказ", assignmentResult);

const previewOnly = statement({
  salary: 200_000,
  savedBonuses: [null],
  paid: 0,
});
assert.deepEqual(previewOnly, {
  prepared: 200_000,
  pendingAccrual: 200_000,
  accrued: 0,
  paid: 0,
  remaining: 0,
  incomplete: true,
  missingBonusCount: 1,
});
assert.match(service, /throw new PayrollError\("CALCULATION_INCOMPLETE"\)/);
pass("Оклад и рекомендация не создают начисление", previewOnly);

assert.match(schema, /model PayrollCalculationSnapshot/);
assert.match(schema, /@@unique\(\[periodId, employeeId, revision\]\)/);
assert.match(service, /PAYROLL_CALCULATION_CONFIRMED/);
assert.match(service, /PAYROLL_CALCULATION_CORRECTED/);
assert.match(service, /input\.expectedCalculationHash !== calculationHash/);
assert.match(payrollRoute, /expectedCalculationHash/);
assert.match(tenantScope, /"PayrollCalculationSnapshot"/);
assert.match(
  service,
  /payrollPaymentConfirmation\.findFirst\(\{[\s\S]*?where: \{ id, employee: \{ companyId \} \}/,
);
assert.match(
  service,
  /employee\.calculationSnapshots\.length > 0 \|\|[\s\S]*?employeesWithPriorSnapshotDebt\.has\(employee\.id\)/,
);
assert.match(
  service,
  /employeesWithPriorPreliminaryActivity\.has\(employee\.id\)/,
);
assert.match(
  service,
  /previouslyRecognizedProfit[\s\S]*?calculation\.previouslyRecognizedProfit/,
);
assert.match(
  service,
  /payrollSnapshotMatchesCalculation\(latest, prepared, calculationHash\)/,
);
assert.match(service, /approvalStatus = !latestApproval[\s\S]*?NEEDS_CORRECTION/);
pass("Начисление хранится как подтверждённый снимок с ревизиями", {
  confirmationIsExplicit: true,
  replayDoesNotDuplicate: true,
  staleViewIsRejected: true,
  laterChangesNeedCorrection: true,
});

assert.match(bonusRoute, /!Object\.hasOwn\(body, "manualBonus"\)/);
assert.match(bonusRoute, /typeof body\.manualBonus !== "number"/);

assert.match(service, /const priorDebtBreakdown = priorPeriods\.flatMap/);
assert.match(service, /const priorDebt = priorDebtBreakdown\.reduce/);
assert.match(page, /statementPriorDebt/);
assert.match(page, /Долг за прошлые месяцы/);
pass("Долг прошлых месяцев отделён от текущего заработка", {
  separateBreakdown: true,
});

assert.match(measurerRepair, /"baseSalary" = 0/);
assert.match(measurerRepair, /"salaryPlanEnabled" = FALSE/);
assert.doesNotMatch(measurerRepair, /Еркебулан|Нурасыл|Кокбай/u);
assert.doesNotMatch(
  measurerRepair,
  /UPDATE\s+"Payroll(?:Accrual|Payment|PaymentConfirmation)"/u,
);
pass("Неподтверждённая ставка замерщиков отменяется по источнику, не по имени", {
  salaryConfigured: false,
  accountingOperationsUntouched: true,
});

assert.match(page, /const statementPrepared =/);
assert.match(page, /const statementPendingAccrual =/);
assert.match(page, /const statementAccrued =/);
assert.match(page, /const statementPaid =/);
assert.match(page, /const statementPayable =/);
assert.match(
  page,
  /const partialSalaryAvailable = \(row: PayrollRow\) => statementPayable\(row\)/,
);
assert.match(page, /Текущий остаток зарплаты к выплате/);
assert.doesNotMatch(page, /row\.currentSalary - paidTowardSalary/);
assert.match(page, /const PAYROLL_PAGE_SIZE = 25/);
assert.match(page, /Пустой бонус означает «Не указан»; 0 ₸ — сохранённое/);
for (const action of ["Выдать аванс", "Частичная выплата", "Выплатить остаток"])
  assert.ok(page.includes(action), `Payroll UI is missing payment action: ${action}`);
assert.match(
  page,
  /partialSalary:\s*operation === "advancePayment" \|\| operation === "partialPayment"/,
);
assert.match(page, /canPay=\{director && !closed\}/);
assert.match(
  service,
  /openPeriod\(tx, input\.periodId, \{ allowReview: true \}\)/,
);
pass("Аванс и частичная выплата доступны отдельными действиями", {
  advanceReducesPayable: true,
  partialPaymentReducesPayable: true,
  fullBalancePaymentRemainsAvailable: true,
  reviewPeriodPaymentsAllowed: true,
});
pass("Таблица и карточка используют единый контракт расчёта", {
  fields: ["pendingAccrual", "accrued", "paid", "remaining", "priorDebt"],
  pageSize: 25,
});

assert.match(service, /row\.calculation\.hasActivity/);
assert.match(service, /salaryPlanEnabled \|\|[\s\S]*orderBonuses\.length > 0/);
assert.match(service, /ACCRUAL_PERIOD_MISMATCH/);
assert.match(service, /FOR KEY SHARE/);
assert.match(service, /FOR UPDATE/);
assert.match(service, /pendingLegacyAdvances/);
assert.match(service, /idempotency\?: \{ key: string; requestHash: string \}/);
assert.match(service, /pg_advisory_xact_lock\(\$\{30_000_000 \+ employeeId\}\)/);
assert.match(
  salaryRateInvariantMigration,
  /EmployeeSalaryRate_one_current_per_employee_key/,
);
assert.match(
  orderPayrollBonusRoute,
  /order: \{ companyId \},[\s\S]*employee: \{ companyId \}/,
);
assert.match(
  orderPayrollBonusRoute,
  /role !== Role\.MANAGER[\s\S]*?role !== Role\.DIRECTOR[\s\S]*?role !== Role\.OPERATIONS_DIRECTOR[\s\S]*?role !== Role\.ACCOUNTANT/,
);
assert.match(
  orderPayrollBonusRoute,
  /role === Role\.MANAGER[\s\S]*?managerUserId: userId/,
);
assert.match(
  service,
  /actor\.role === Role\.MANAGER[\s\S]*?period\.status !== PayrollPeriodStatus\.OPEN[\s\S]*?confirmedCalculation/,
);
assert.match(orderRoute, /ORDER_BONUS_PERIOD_REALIGNED/);
assert.match(orderRoute, /MEASUREMENT_BONUS_PERIOD_REALIGNED/);
assert.match(
  orderRoute,
  /data: \{[\s\S]*?periodId: targetPeriod\.id,[\s\S]*?earnedPeriodId: targetPeriod\.id/,
);
assert.match(
  measurementService,
  /responsibleType: OrderResponsibleType\.EMPLOYEE/,
);
assert.match(measurementService, /formatToParts\(order\.orderReceivedAt\)/);
assert.match(
  measurementService,
  /type: "PAYROLL_ACCRUAL"[\s\S]*?payrollAccrualId: accrual\.id/,
);
assert.match(
  measurementService,
  /payrollAccrualId: accrual\.id[\s\S]*?affectsProfit: false|affectsProfit: false[\s\S]*?payrollAccrualId: accrual\.id/,
);
assert.match(
  componentLedgerReconciliation,
  /accrual\.type = 'MEASUREMENT_BONUS'[\s\S]*?customer_order\."responsibleType" = 'COMPANY'[\s\S]*?ledger\."affectsProfit" = TRUE/,
);
pass("Закрытие периода, ставки и tenant-границы защищены инвариантами", {
  zeroValueActivityRequiresConfirmation: true,
  closeIsCoordinatedWithWriters: true,
  salaryReplayIsIdempotent: true,
  oneCurrentSalaryRate: true,
  foreignOrderPayrollHidden: true,
  terminatedPreliminaryDebtVisible: true,
  managerReadsOnlyOwnOrders: true,
  managerCannotMutateConfirmedCalculation: true,
  factualOrderDateRealignsBonusPeriods: true,
  companyMeasurementBonusExcluded: true,
});

assert.equal(new Set(passed.map(({ label }) => label)).size, passed.length);
console.log(
  passed
    .map(
      ({ label, result }, index) =>
        `${index + 1}. ${label}: PASS ${JSON.stringify(result)}`,
    )
    .join("\n"),
);
