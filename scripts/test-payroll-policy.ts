import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  auditManagerOrderBonus,
  isCompanyResponsibleOrder,
  isDateInPayrollPeriod,
  isManagerOrderBonusAutomaticPeriod,
  isManagerOrderBonusEligible,
  isOrderAssignedToManager,
  isPayrollPolicyReady,
  isPayrollReconciled,
  isSalesManagerPayrollEmployee,
  isTerminatedPayrollEmployee,
  isValidKaspiReference,
  isValidOptionalPaymentReference,
  managerOrderBonus,
  managerOrderBonusEarnedAt,
  managerOrderBonusEarnedEvent,
  payrollPaymentPurpose,
  payrollPaymentReference,
  payrollRoleAccess,
  payrollSalaryForPeriod,
  personalPayrollCalculation,
} from "../lib/payroll-policy";

// A recommendation is still calculated and displayed, but never becomes a
// saved employee bonus or a confirmed payroll calculation on its own.
assert.equal(managerOrderBonus(616_000), 30_000);
assert.equal(managerOrderBonus(3_000_000), 30_000);
assert.equal(managerOrderBonus(3_000_001), 50_000);
assert.equal(managerOrderBonus(6_000_000), 50_000);
assert.equal(isSalesManagerPayrollEmployee({ position: "Менеджер", user: { role: "MANAGER" } }), true);
assert.equal(isSalesManagerPayrollEmployee({ position: "Замерщик", user: { role: "MANAGER" } }), false);
assert.equal(isSalesManagerPayrollEmployee({ position: "замерщик", user: { role: "MANAGER" } }), false);
assert.equal(isSalesManagerPayrollEmployee({ position: "Замерщик", user: { role: "MEASURER" } }), false);
assert.equal(isManagerOrderBonusAutomaticPeriod(2026, 9), false);
assert.equal(isManagerOrderBonusAutomaticPeriod(2026, 10), true);
assert.equal(isManagerOrderBonusAutomaticPeriod(2027, 1), true);
const recommendationAudit = auditManagerOrderBonus({
  orderAmount: 2_800_000,
  status: "Договор подписан",
  submitted: 0,
  recorded: 0,
});
assert.equal(recommendationAudit.expected, 30_000);
assert.equal(recommendationAudit.status, "UNDER");
assert.equal(recommendationAudit.reconciled, false);

const manager = { id: 12, name: "Гулсим" };
assert.equal(
  isOrderAssignedToManager(
    {
      responsibleType: "EMPLOYEE",
      managerUserId: 12,
      leadManagerId: 99,
    },
    manager,
  ),
  true,
);
assert.equal(
  isOrderAssignedToManager(
    {
      responsibleType: "EMPLOYEE",
      managerUserId: 99,
      leadManagerId: 12,
    },
    manager,
  ),
  false,
  "the current responsible employee must override the former lead",
);
assert.equal(
  isOrderAssignedToManager(
    {
      responsibleType: "COMPANY",
      managerUserId: null,
      leadManagerId: 12,
    },
    manager,
  ),
  false,
  "company responsibility must override every historic employee link",
);
assert.equal(
  isCompanyResponsibleOrder({
    responsibleType: "COMPANY",
    managerUserId: null,
  }),
  true,
);
assert.equal(
  isManagerOrderBonusEligible({
    responsibleType: "COMPANY",
    managerUserId: null,
    status: "Оформлен",
  }),
  false,
);
assert.equal(
  isManagerOrderBonusEligible({
    responsibleType: "EMPLOYEE",
    managerUserId: 12,
    status: "Оформлен",
  }),
  true,
);
assert.equal(
  isManagerOrderBonusEligible({
    responsibleType: "EMPLOYEE",
    managerUserId: 12,
    lifecycle: "CANCELLED",
  }),
  false,
);

const september = {
  periodStart: new Date("2026-08-31T19:00:00.000Z"),
  periodEnd: new Date("2026-09-30T19:00:00.000Z"),
};
const october = {
  periodStart: new Date("2026-09-30T19:00:00.000Z"),
  periodEnd: new Date("2026-10-31T19:00:00.000Z"),
};
const octoberHire = new Date("2026-09-30T19:00:00.000Z");
assert.deepEqual(
  payrollSalaryForPeriod({
    hiredAt: octoberHire,
    baseSalary: 0,
    salaryRates: [{ amount: 0, effectiveFrom: octoberHire }],
    ...september,
  }),
  {
    amount: 0,
    effectiveFrom: octoberHire,
    employedInPeriod: false,
  },
  "an October employee has no September salary calculation",
);
assert.deepEqual(
  payrollSalaryForPeriod({
    hiredAt: octoberHire,
    baseSalary: 0,
    salaryRates: [{ amount: 0, effectiveFrom: octoberHire }],
    ...october,
  }),
  {
    amount: 0,
    effectiveFrom: octoberHire,
    employedInPeriod: true,
  },
  "employment start must not invent an October salary condition",
);
assert.equal(
  payrollSalaryForPeriod({
    hiredAt: "2026-01-01T00:00:00.000Z",
    baseSalary: 200_000,
    salaryRates: [
      { amount: 200_000, effectiveFrom: "2026-01-01T00:00:00.000Z" },
    ],
    ...october,
  }).amount,
  200_000,
  "a real configured salary remains separate from bonuses",
);
assert.equal(
  payrollSalaryForPeriod({
    hiredAt: "2026-01-01T00:00:00.000Z",
    terminatedAt: "2026-09-30T19:00:00.000Z",
    baseSalary: 200_000,
    salaryRates: [
      { amount: 200_000, effectiveFrom: "2026-01-01T00:00:00.000Z" },
    ],
    ...october,
  }).amount,
  0,
  "salary stops after employment ends",
);

assert.equal(
  managerOrderBonusEarnedAt({
    orderReceivedAt: "2026-09-10T00:00:00.000Z",
    completedAt: "2026-10-03T08:00:00.000Z",
    lifecycle: "COMPLETED",
    employeeActive: true,
    accountActive: true,
  })?.toISOString(),
  "2026-09-10T00:00:00.000Z",
  "editing or completing a September order in October must not move its bonus",
);
assert.equal(
  managerOrderBonusEarnedAt({
    orderReceivedAt: "2026-09-10T00:00:00.000Z",
    completedAt: null,
    lifecycle: "IN_PRODUCTION",
    employeeActive: false,
    employeeTerminatedAt: "2026-09-20T00:00:00.000Z",
    accountActive: false,
  }),
  null,
  "a terminated manager's order waits for completion",
);
assert.equal(
  managerOrderBonusEarnedAt({
    orderReceivedAt: "2026-09-10T00:00:00.000Z",
    completedAt: "2026-10-03T08:00:00.000Z",
    lifecycle: "COMPLETED",
    employeeActive: false,
    employeeTerminatedAt: "2026-09-20T00:00:00.000Z",
    accountActive: false,
  })?.toISOString(),
  "2026-09-10T00:00:00.000Z",
  "completion unlocks payment without changing the factual payroll month",
);
assert.equal(
  managerOrderBonusEarnedEvent({
    active: false,
    terminatedAt: "2026-09-20T00:00:00.000Z",
    accountActive: false,
  }),
  "ORDER_COMPLETED",
);
assert.equal(isTerminatedPayrollEmployee({ active: true, accountActive: false }), true);
assert.equal(
  isDateInPayrollPeriod(october.periodStart, october.periodStart, october.periodEnd),
  true,
);
assert.equal(
  isDateInPayrollPeriod(october.periodEnd, october.periodStart, october.periodEnd),
  false,
);

assert.equal(isValidKaspiReference(undefined), false);
assert.equal(isValidKaspiReference("K1"), false);
assert.equal(isValidKaspiReference("KASPI-123456"), true);
assert.equal(isValidOptionalPaymentReference(undefined), true);
assert.equal(isValidOptionalPaymentReference("  "), true);
assert.equal(isValidOptionalPaymentReference("KASPI-123456"), true);
assert.equal(isPayrollReconciled(0.009), true);
assert.equal(isPayrollReconciled(30_000), false);
assert.equal(isPayrollPolicyReady(0, [0, 0]), true);
assert.equal(isPayrollPolicyReady(0, [30_000, -30_000]), false);
assert.deepEqual(payrollRoleAccess("DIRECTOR"), {
  founder: true,
  administrator: false,
  accountant: false,
});
assert.deepEqual(payrollRoleAccess("OPERATIONS_DIRECTOR"), {
  founder: false,
  administrator: true,
  accountant: false,
});

assert.deepEqual(
  personalPayrollCalculation({
    salary: 400_000,
    bonuses: 20_000,
    premiums: 10_000,
    deductions: 5_000,
    advances: 100_000,
    otherPayments: 0,
    pendingAdvances: 50_000,
    accrued: 0,
  }),
  {
    salary: 400_000,
    bonuses: 20_000,
    premiums: 10_000,
    deductions: 5_000,
    advances: 100_000,
    otherPayments: 0,
    pendingAdvances: 50_000,
    accrued: 0,
    totalToAccrue: 425_000,
    remainingToAccrue: 425_000,
    amountToPay: 325_000,
    amountToPayAfterPendingAdvances: 275_000,
  },
);
assert.deepEqual(
  personalPayrollCalculation({
    salary: 200_000,
    bonuses: 0,
    premiums: 0,
    deductions: 0,
    advances: 50_000,
    otherPayments: 0,
    pendingAdvances: 0,
    accrued: 0,
  }),
  {
    salary: 200_000,
    bonuses: 0,
    premiums: 0,
    deductions: 0,
    advances: 50_000,
    otherPayments: 0,
    pendingAdvances: 0,
    accrued: 0,
    totalToAccrue: 200_000,
    remainingToAccrue: 200_000,
    amountToPay: 150_000,
    amountToPayAfterPendingAdvances: 150_000,
  },
  "an unfilled recommendation must not increase the employee calculation",
);
assert.equal(payrollPaymentReference(2026, 10, 42), "ЗП-202610-000042");
assert.match(
  payrollPaymentPurpose("Гулсим", 2026, 10, 42),
  /Гулсим.*ЗП-202610-000042/,
);

const service = readFileSync(
  new URL("../lib/services/payroll.service.ts", import.meta.url),
  "utf8",
);
const payrollRoute = readFileSync(
  new URL("../app/api/payroll/route.ts", import.meta.url),
  "utf8",
);
const payrollSelfRoute = readFileSync(
  new URL("../app/api/payroll/self/route.ts", import.meta.url),
  "utf8",
);
const bonusRoute = readFileSync(
  new URL("../app/api/payroll/bonus-corrections/route.ts", import.meta.url),
  "utf8",
);
const payrollPage = readFileSync(
  new URL("../app/payroll/page.tsx", import.meta.url),
  "utf8",
);
const orderService = readFileSync(
  new URL("../lib/services/order.service.ts", import.meta.url),
  "utf8",
);
const schema = readFileSync(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const accountingMigration = readFileSync(
  new URL(
    "../prisma/migrations/20261004110000_payroll_accounting_source_of_truth/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const snapshotMigration = readFileSync(
  new URL(
    "../prisma/migrations/20261004140000_payroll_calculation_snapshots/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const measurerRepairMigration = readFileSync(
  new URL(
    "../prisma/migrations/20261004150000_revoke_unverified_measurer_salary_autofill/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

// Null and zero are deliberately different; the recommendation has no
// fallback path into prepared payroll.
assert.match(
  service,
  /effectiveOrderBonusAmount[\s\S]*?manualAmount == null \? 0 : Number\(manualAmount\)/,
);
assert.match(service, /const effectiveBonus = manualBonus \?\? 0/);
assert.match(
  service,
  /if \(manualAmount == null\) missingBonusCount \+= 1;[\s\S]*?else orderBonuses \+= manualAmount/,
);
assert.match(service, /throw new PayrollError\("CALCULATION_INCOMPLETE"\)/);

// Current normalized responsibility and the decision's explicit period are
// the only sources used by payroll.
assert.match(service, /responsibleType: OrderResponsibleType\.EMPLOYEE/);
assert.match(service, /managerUserId: employee\.userId/);
assert.match(service, /periodId: period\.id,[\s\S]*?earnedAt: factualEarnedAt/);
assert.match(service, /existing\.periodId !== period\.id/);
assert.match(service, /BONUS_PERIOD_MISMATCH/);
assert.match(orderService, /orderReceivedAt: \{ gte: monthRange\.start, lt: monthRange\.end \}/);
assert.doesNotMatch(orderService, /number[^\n]*monthRange/);

// Opening a page or running the legacy sync endpoint cannot create a bonus or
// an accrual. Only a saved manual decision changes the prepared calculation.
const syncImplementation = service.slice(
  service.indexOf("export async function syncAutomaticOrderBonuses"),
  service.indexOf("export async function accrueCompletedTerminatedManagerOrderBonus"),
);
assert.match(syncImplementation, /created: 0/);
assert.match(syncImplementation, /removed: 0/);
assert.doesNotMatch(
  syncImplementation,
  /\.(?:create|update|upsert|delete|createMany|updateMany|deleteMany)\(/,
);
assert.match(bonusRoute, /action === "sync"/);
assert.match(bonusRoute, /saveOrderBonusDecision/);

// "Начислено" is an immutable explicit approval snapshot. Reusing the same
// calculation does not create a duplicate; a changed calculation creates a
// linked correction revision.
assert.match(schema, /model PayrollCalculationSnapshot/);
assert.match(schema, /@@unique\(\[periodId, employeeId, revision\]\)/);
assert.match(service, /export async function confirmPayrollCalculation/);
assert.match(service, /salaryManager\(actor\)/);
assert.match(
  service,
  /payrollSnapshotMatchesCalculation\(latest, prepared, calculationHash\)/,
);
assert.match(service, /previousSnapshotId: latest\?\.id/);
assert.match(service, /PAYROLL_CALCULATION_CONFIRMED/);
assert.match(service, /PAYROLL_CALCULATION_CORRECTED/);
assert.match(
  service,
  /const confirmedAccrued = latestApproval[\s\S]*?Number\(latestApproval\.preparedAmount\)[\s\S]*?: 0/,
);
assert.match(
  service,
  /\(latestApproval \? Number\(latestApproval\.preparedAmount\) : preparedAmount\) - paid/,
);
assert.match(service, /approvalStatus = !latestApproval[\s\S]*?NEEDS_CORRECTION/);
assert.match(payrollRoute, /action === "confirm-calculation"/);
assert.match(payrollRoute, /confirmPayrollCalculation/);
assert.match(
  payrollRoute,
  /body\.decision !== "CONFIRM" && body\.decision !== "REJECT"/,
);
assert.doesNotMatch(
  payrollRoute,
  /body\.decision === "REJECT" \? "REJECT" : "CONFIRM"/,
);

// Any payroll user may load a started month; loading it creates only the empty
// period container, never financial operations.
assert.match(
  payrollRoute,
  /if \(!period && isCompanyMonthStarted\(year, month\)\)[\s\S]*?ensurePeriod\(year, month\)/,
);
assert.match(
  payrollSelfRoute,
  /if \(!period && isCompanyMonthStarted\(year, month\)\)[\s\S]*?ensurePeriod\(year, month\)/,
);
assert.match(payrollSelfRoute, /Number\(p\.get\("year"\)\)/);
assert.match(payrollSelfRoute, /Number\(p\.get\("month"\)\)/);
assert.match(payrollSelfRoute, /body\.action === "request-advance"/);
assert.doesNotMatch(payrollSelfRoute, /body\.action === "report-advance"/);
assert.doesNotMatch(payrollSelfRoute, /body\.action === "accrual"/);
assert.doesNotMatch(payrollSelfRoute, /createSelfAccrual/);
const selfAccrualImplementation = service.slice(
  service.indexOf("export async function createSelfAccrual"),
  service.indexOf("async function createAccrualInternal"),
);
assert.match(selfAccrualImplementation, /throw new PayrollError\("FORBIDDEN"\)/);
assert.doesNotMatch(
  selfAccrualImplementation,
  /createAccrualInternal|payrollAccrual\.(?:create|update|upsert)/,
);

// Idempotent review/transition replays must prove that the repeated request
// is identical instead of returning whichever completed record already exists.
const confirmationReviewImplementation = service.slice(
  service.indexOf("export async function reviewPaymentConfirmation"),
  service.indexOf("export async function reversePayment"),
);
for (const invariant of [
  /reviewAudit\.action !== "PAYMENT_CONFIRMATION_CONFIRMED"/,
  /input\.decision !== "CONFIRM"/,
  /compareRequestHash\(payment\.requestHash, input\.requestHash\)/,
  /payment\.amount\.equals/,
]) {
  assert.match(confirmationReviewImplementation, invariant);
}
const periodTransitionImplementation = service.slice(
  service.indexOf("export async function transitionPeriod"),
  service.indexOf("const signedPayment"),
);
assert.match(periodTransitionImplementation, /replayAfter\?\.status !== target/);
assert.match(periodTransitionImplementation, /replay\.reason !== replayReason/);
assert.match(periodTransitionImplementation, /replayAfter\?\.requestHash !== requestHash/);
assert.match(service, /paymentTypeById\.get\(row\.reversalOfId\) === PayrollPaymentType\.ADVANCE/);

// Prior-period debt is calculated separately and is not merged back into the
// current month's prepared earnings.
assert.match(service, /const priorDebtBreakdown = priorPeriods\.flatMap/);
assert.match(service, /const priorDebt = priorDebtBreakdown\.reduce/);
assert.match(service, /priorDebtBreakdown,/);
assert.match(service, /prepared: preparedAmount,/);
assert.match(payrollPage, /Долг за прошлые месяцы/);

// Main page and drawer use the same server contract, retain null/zero
// semantics, paginate large teams, and collapse history by default.
for (const label of [
  "К начислению",
  "Начислено",
  "Выплачено",
  "Осталось выплатить",
  "Подсказка системы",
  "Бонус сотруднику",
  "Не указан",
  "Применить",
  "Заказы и бонусы",
  "История операций",
]) {
  assert.ok(payrollPage.includes(label), `Payroll UI is missing: ${label}`);
}
assert.match(payrollPage, /const statementPrepared =/);
assert.match(payrollPage, /const statementAccrued =/);
assert.match(payrollPage, /const statementPaid =/);
assert.match(payrollPage, /const statementPayable =/);
assert.match(payrollPage, /const PAYROLL_PAGE_SIZE = 25/);
assert.match(payrollPage, /overflow-x-hidden overflow-y-auto/);
assert.match(payrollPage, /<details[\s\S]*?История операций/);
assert.match(
  payrollPage,
  /Система предлагает бонус только как подсказку и не включает его в/,
);
assert.match(payrollPage, /Пустой бонус означает «Не указан»; 0 ₸ — сохранённое/);
assert.match(payrollPage, /Заявка на аванс/);
assert.match(payrollPage, /Запросить аванс/);
assert.match(payrollPage, /не считается выплатой/);
assert.doesNotMatch(payrollPage, /Сообщить об авансе|Зарегистрировать полученный аванс/);

// Database contracts preserve 0 versus NULL, tenant responsibility, explicit
// period attribution, and safe/idempotent data repair.
assert.match(
  accountingMigration,
  /CREATE TYPE "OrderResponsibleType" AS ENUM \('EMPLOYEE', 'COMPANY'\)/,
);
assert.match(accountingMigration, /Order_responsibleType_managerUserId_check/);
assert.match(accountingMigration, /"manualAmount" DECIMAL\(14, 2\),/);
assert.doesNotMatch(
  accountingMigration,
  /"manualAmount" DECIMAL\(14, 2\) NOT NULL/,
);
assert.match(
  accountingMigration,
  /PayrollOrderBonusDecision_orderId_employeeId_key/,
);
assert.doesNotMatch(
  accountingMigration,
  /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"PayrollPayment"/,
);
assert.match(snapshotMigration, /ADD COLUMN IF NOT EXISTS "periodId"/);
assert.match(snapshotMigration, /ADD COLUMN IF NOT EXISTS "earnedAt"/);
assert.match(snapshotMigration, /CREATE TABLE IF NOT EXISTS "PayrollCalculationSnapshot"/);
assert.match(snapshotMigration, /ON CONFLICT \("idempotencyKey"\) DO NOTHING/);
assert.match(measurerRepairMigration, /"baseSalary" = 0/);
assert.match(measurerRepairMigration, /"salaryPlanEnabled" = FALSE/);
assert.doesNotMatch(measurerRepairMigration, /Еркебулан|Нурасыл|Кокбай/u);
assert.doesNotMatch(
  measurerRepairMigration,
  /UPDATE\s+"Payroll(?:Accrual|Payment|PaymentConfirmation)"/u,
);
assert.match(measurerRepairMigration, /ON CONFLICT \("idempotencyKey"\) DO NOTHING/);

console.log("Payroll policy and current accounting contract tests passed");
