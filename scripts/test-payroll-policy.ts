import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  auditManagerOrderBonus,
  isDateInPayrollPeriod,
  isCompanyResponsibleOrder,
  isManagerOrderBonusAutomaticPeriod,
  isManagerOrderBonusEligible,
  isOrderAssignedToManager,
  isPayrollReconciled,
  isPayrollPolicyReady,
  isTerminatedPayrollEmployee,
  isValidKaspiReference,
  isValidOptionalPaymentReference,
  managerOrderBonus,
  managerOrderBonusEarnedAt,
  managerOrderBonusEarnedEvent,
  payrollPaymentPurpose,
  payrollPaymentReference,
  payrollRoleAccess,
  personalPayrollCalculation,
  payrollSalaryForPeriod,
} from "../lib/payroll-policy";

assert.equal(managerOrderBonus(616_000), 30_000);
assert.equal(managerOrderBonus(3_000_000), 30_000);
assert.equal(managerOrderBonus(3_000_001), 50_000);
assert.equal(managerOrderBonus(6_000_000), 50_000);
assert.equal(isManagerOrderBonusAutomaticPeriod(2026, 9), false);
assert.equal(isManagerOrderBonusAutomaticPeriod(2026, 10), true);
assert.equal(isManagerOrderBonusAutomaticPeriod(2027, 1), true);
assert.equal(isManagerOrderBonusEligible({ status: "Передан в цех" }), true);
assert.equal(isManagerOrderBonusEligible({ status: "Отменён" }), false);
assert.equal(isManagerOrderBonusEligible({ status: "Возврат" }), false);
assert.equal(
  isManagerOrderBonusEligible({ status: "Оформлен", lifecycle: "CANCELLED" }),
  false,
);
assert.equal(
  isManagerOrderBonusEligible({ status: "Новый", deletedAt: new Date() }),
  false,
);

const missingAccrual = auditManagerOrderBonus({
  orderAmount: 2_800_000,
  status: "Договор подписан",
  submitted: 0,
  recorded: 0,
});
assert.equal(missingAccrual.expected, 30_000);
assert.equal(missingAccrual.status, "UNDER");
assert.equal(missingAccrual.reconciled, false);
assert.equal(
  auditManagerOrderBonus({
    orderAmount: 2_800_000,
    status: "Договор подписан",
    submitted: 0,
    recorded: 30_000,
  }).reconciled,
  true,
);

assert.equal(
  isOrderAssignedToManager(
    { managerUserId: 12, managerName: "Гульсым" },
    { id: 12, name: "Гульсым" },
  ),
  true,
);
assert.equal(
  isOrderAssignedToManager(
    { managerUserId: 99, managerName: "Другой менеджер" },
    { id: 12, name: "Гульсым" },
  ),
  false,
);
assert.equal(
  isOrderAssignedToManager(
    {
      managerUserId: null,
      leadManagerId: 12,
      managerName: "Компания",
    },
    { id: 12, name: "Гульсым" },
  ),
  false,
  "company responsibility must override the lead's former manager",
);
assert.equal(
  isOrderAssignedToManager(
    {
      managerUserId: 99,
      leadManagerId: 12,
      managerName: "Другой менеджер",
    },
    { id: 12, name: "Гульсым" },
  ),
  false,
  "the current order manager must override lead attribution",
);
assert.equal(isCompanyResponsibleOrder({ managerName: " Компания " }), true);
assert.equal(
  isCompanyResponsibleOrder({
    managerName: "Гульсым",
    managerUserId: null,
  }),
  true,
  "an order without a current responsible user is company work even if a legacy manager name remains",
);
assert.equal(
  isOrderAssignedToManager(
    {
      managerUserId: null,
      leadManagerId: 12,
      managerName: "Гульсым",
    },
    { id: 12, name: "Гульсым" },
  ),
  false,
  "a former lead manager must not receive a company-owned order bonus",
);
assert.equal(
  isManagerOrderBonusEligible({
    status: "Оформлен",
    managerName: "Компания",
  }),
  false,
);
assert.equal(
  isManagerOrderBonusEligible({
    status: "Оформлен",
    managerName: "Гульсым",
    managerUserId: null,
  }),
  false,
);

const septemberRange = {
  periodStart: new Date("2026-09-01T00:00:00.000Z"),
  periodEnd: new Date("2026-10-01T00:00:00.000Z"),
};
assert.deepEqual(
  payrollSalaryForPeriod({
    hiredAt: "2026-10-01T00:00:00.000Z",
    baseSalary: 200_000,
    salaryRates: [
      {
        amount: 200_000,
        effectiveFrom: "2026-10-01T00:00:00.000Z",
      },
    ],
    ...septemberRange,
  }),
  {
    amount: 0,
    effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
    employedInPeriod: false,
  },
  "an October employee must have zero salary and payable in September",
);
assert.equal(
  payrollSalaryForPeriod({
    hiredAt: "2026-01-01T00:00:00.000Z",
    terminatedAt: "2026-10-01T00:00:00.000Z",
    baseSalary: 200_000,
    salaryRates: [
      {
        amount: 200_000,
        effectiveFrom: "2026-01-01T00:00:00.000Z",
      },
    ],
    ...septemberRange,
  }).amount,
  200_000,
  "a manager employed during September keeps the full September salary",
);
assert.equal(
  payrollSalaryForPeriod({
    hiredAt: "2026-01-01T00:00:00.000Z",
    terminatedAt: "2026-10-01T00:00:00.000Z",
    baseSalary: 200_000,
    salaryRates: [
      {
        amount: 200_000,
        effectiveFrom: "2026-01-01T00:00:00.000Z",
      },
    ],
    periodStart: new Date("2026-10-01T00:00:00.000Z"),
    periodEnd: new Date("2026-11-01T00:00:00.000Z"),
  }).amount,
  0,
  "salary stops in the month after employment ends",
);
assert.equal(
  managerOrderBonusEarnedAt({
    orderReceivedAt: "2026-09-10T00:00:00.000Z",
    completedAt: null,
    lifecycle: "IN_PRODUCTION",
    employeeActive: true,
    accountActive: true,
  })?.toISOString(),
  "2026-09-10T00:00:00.000Z",
  "active manager earns the bonus when the order is received",
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
  "terminated manager must not earn a bonus before order completion",
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
  "2026-10-03T08:00:00.000Z",
  "terminated manager earns the bonus in the completion month",
);
assert.equal(
  managerOrderBonusEarnedEvent({
    active: false,
    terminatedAt: "2026-09-20T00:00:00.000Z",
    accountActive: false,
  }),
  "ORDER_COMPLETED",
);
assert.equal(
  isTerminatedPayrollEmployee({ active: true, accountActive: false }),
  true,
);
const periodStart = new Date("2026-10-01T00:00:00.000Z");
const periodEnd = new Date("2026-11-01T00:00:00.000Z");
assert.equal(isDateInPayrollPeriod(periodStart, periodStart, periodEnd), true);
assert.equal(isDateInPayrollPeriod(periodEnd, periodStart, periodEnd), false);

assert.equal(isValidKaspiReference(undefined), false);
assert.equal(isValidKaspiReference("  "), false);
assert.equal(isValidKaspiReference("K1"), false);
assert.equal(isValidKaspiReference("KASPI-123456"), true);
assert.equal(isValidKaspiReference("X".repeat(121)), false);
assert.equal(isValidOptionalPaymentReference(undefined), true);
assert.equal(isValidOptionalPaymentReference("  "), true);
assert.equal(isValidOptionalPaymentReference("K1"), false);
assert.equal(isValidOptionalPaymentReference("KASPI-123456"), true);
assert.equal(isPayrollReconciled(0), true);
assert.equal(isPayrollReconciled(0.009), true);
assert.equal(isPayrollReconciled(30_000), false);
assert.equal(isPayrollReconciled(Number.NaN), false);
assert.equal(isPayrollPolicyReady(0, [0, 0]), true);
assert.equal(isPayrollPolicyReady(0, [30_000, -30_000]), false);
assert.equal(isPayrollPolicyReady(0, [30_000, -30_000, 0]), false);
assert.equal(isPayrollPolicyReady(200_000, [0]), false);
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
assert.equal(
  personalPayrollCalculation({
    salary: 200_000,
    bonuses: 0,
    premiums: 0,
    deductions: 0,
    advances: 50_000,
    otherPayments: 0,
    pendingAdvances: 0,
    accrued: 200_000,
  }).amountToPay,
  150_000,
  "partial salary payment must leave 200,000 - 50,000 = 150,000",
);
assert.deepEqual(
  personalPayrollCalculation({
    salary: 200_000,
    bonuses: 90_000,
    premiums: 0,
    deductions: 0,
    advances: 50_000,
    otherPayments: 0,
    pendingAdvances: 0,
    accrued: 50_000,
  }),
  {
    salary: 200_000,
    bonuses: 90_000,
    premiums: 0,
    deductions: 0,
    advances: 50_000,
    otherPayments: 0,
    pendingAdvances: 0,
    accrued: 50_000,
    totalToAccrue: 290_000,
    remainingToAccrue: 240_000,
    amountToPay: 240_000,
    amountToPayAfterPendingAdvances: 240_000,
  },
  "Akbota statement must distinguish 50,000 confirmed from 290,000 planned and 240,000 payable",
);
const alikhanSeptember = personalPayrollCalculation({
  salary: 400_000,
  bonuses: 0,
  premiums: 0,
  deductions: 0,
  advances: 83_000,
  otherPayments: 0,
  pendingAdvances: 0,
  accrued: 83_000,
});
assert.equal(alikhanSeptember.accrued, 83_000);
assert.equal(alikhanSeptember.amountToPay, 317_000);
const marketerWithoutSalary = personalPayrollCalculation({
  salary: 0,
  bonuses: 0,
  premiums: 0,
  deductions: 0,
  advances: 0,
  otherPayments: 0,
  pendingAdvances: 0,
  accrued: 0,
});
assert.equal(marketerWithoutSalary.amountToPay, 0);

const gulsimOrders = [
  6_000_000,
  2_040_000,
  874_000,
  2_800_000,
  616_000,
  3_000_000,
  2_170_000,
];
assert.equal(
  gulsimOrders.reduce((sum, amount) => sum + managerOrderBonus(amount), 0),
  230_000,
);
assert.equal(payrollPaymentReference(2026, 10, 42), "ЗП-202610-000042");
assert.match(
  payrollPaymentPurpose("Гульсым", 2026, 10, 42),
  /Гульсым.*ЗП-202610-000042/,
);

const serviceSource = readFileSync(
  new URL("../lib/services/payroll.service.ts", import.meta.url),
  "utf8",
);
const payrollRouteSource = readFileSync(
  new URL("../app/api/payroll/route.ts", import.meta.url),
  "utf8",
);
const payrollSelfRouteSource = readFileSync(
  new URL("../app/api/payroll/self/route.ts", import.meta.url),
  "utf8",
);
const bonusCorrectionRouteSource = readFileSync(
  new URL(
    "../app/api/payroll/bonus-corrections/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const payrollPageSource = readFileSync(
  new URL("../app/payroll/page.tsx", import.meta.url),
  "utf8",
);
const orderSearchRouteSource = readFileSync(
  new URL("../app/api/orders/search/route.ts", import.meta.url),
  "utf8",
);
const orderServiceSource = readFileSync(
  new URL("../lib/services/order.service.ts", import.meta.url),
  "utf8",
);
const orderLifecycleServiceSource = readFileSync(
  new URL("../lib/services/order360.service.ts", import.meta.url),
  "utf8",
);
const dailyOperationsRouteSource = readFileSync(
  new URL("../app/api/cron/daily-operations/route.ts", import.meta.url),
  "utf8",
);
const dailyOperationsReleaseSource = readFileSync(
  new URL("./prepare-daily-operations.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL(
    "../prisma/migrations/20261002120000_manager_order_bonus_uniqueness/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const uniquenessMigrationSource = readFileSync(
  new URL(
    "../prisma/migrations/20261002130000_order_bonus_uniqueness_key/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const externalReferenceMigrationSource = readFileSync(
  new URL(
    "../prisma/migrations/20261002140000_payroll_payment_external_reference/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const manualAccrualMigrationSource = readFileSync(
  new URL(
    "../prisma/migrations/20261002190000_manual_payroll_accrual_workflow/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const companyResponsibleMigrationSource = readFileSync(
  new URL(
    "../prisma/migrations/20261003133000_company_responsible_bonus_cleanup/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const optionalAccrualReferenceMigrationSource = readFileSync(
  new URL(
    "../prisma/migrations/20261003132000_optional_salary_accrual_reference/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const deferredTerminatedBonusMigrationSource = readFileSync(
  new URL(
    "../prisma/migrations/20261003143000_defer_terminated_manager_bonuses/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const explicitSalaryPlansMigrationSource = readFileSync(
  new URL(
    "../prisma/migrations/20261004100000_explicit_salary_plans/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const unassignedSalaryCleanupMigrationSource = readFileSync(
  new URL(
    "../prisma/migrations/20261004100200_unassigned_salary_cleanup/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const companyBonusResweepMigrationSource = readFileSync(
  new URL(
    "../prisma/migrations/20261004100500_company_bonus_resweep/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
assert.match(serviceSource, /DIRECTOR_CONFIRMATION_REQUIRED/);
assert.doesNotMatch(dailyOperationsRouteSource, /payroll\.service|reconcileCurrentManagerPayroll/);
assert.doesNotMatch(dailyOperationsReleaseSource, /payroll\.service|reconcileCurrentManagerPayroll/);
assert.doesNotMatch(payrollRouteSource, /reconcile-manager-payroll/);
assert.match(payrollSelfRouteSource, /createSelfAccrual/);
assert.match(payrollSelfRouteSource, /PayrollAccrualType\.ORDER_BONUS/);
assert.match(payrollSelfRouteSource, /report-advance/);
assert.match(payrollSelfRouteSource, /PayrollPaymentType\.ADVANCE/);
assert.match(payrollSelfRouteSource, /payrollSummary\(period\.id, actor\(auth\.session!\), undefined, true\)/);
assert.match(bonusCorrectionRouteSource, /listOrderBonusesForCorrection/);
assert.match(bonusCorrectionRouteSource, /correctOrderBonus/);
assert.match(bonusCorrectionRouteSource, /syncAutomaticOrderBonuses/);
assert.match(bonusCorrectionRouteSource, /action !== "correct" && action !== "cancel"/);
assert.match(
  payrollRouteSource,
  /identity\.role !== Role\.DIRECTOR &&[\s\S]*identity\.role !== Role\.OPERATIONS_DIRECTOR[\s\S]*FORBIDDEN/,
);
assert.match(payrollPageSource, /adminView = founder \|\| operationsDirector \|\| accountant/);
assert.match(payrollPageSource, /statementAccrued/);
assert.match(payrollPageSource, /statementPayable/);
assert.match(payrollPageSource, /«Начислено» — полный расчёт за месяц/);
assert.match(payrollPageSource, /Частичная оплата зарплаты/);
assert.match(payrollPageSource, /Оклад сотрудника не изменится; выплата будет учтена как аванс/);
assert.match(payrollPageSource, /label="Изменить оклад"/);
assert.match(payrollPageSource, /label="Редактировать начисление"/);
assert.match(payrollPageSource, /payrollAdministrator = founder \|\| operationsDirector/);
assert.match(payrollRouteSource, /action === "correct-accrual"/);
assert.match(payrollRouteSource, /correctPayrollAccrual/);
assert.match(serviceSource, /export async function correctPayrollAccrual/);
assert.match(serviceSource, /PAYROLL_ACCRUAL_CORRECTED/);
assert.match(serviceSource, /else salaryManager\(actor\)/);
assert.match(serviceSource, /payrollSalaryForPeriod/);
assert.match(serviceSource, /const statementSalary = salaryPlanEnabled/);
assert.match(payrollPageSource, /Редактировать бонус/);
assert.match(payrollPageSource, /Указать бонус/);
assert.match(serviceSource, /activeRate\?\.planEnabled \?\?/);
assert.match(serviceSource, /isValidOptionalPaymentReference/);
assert.match(serviceSource, /PARTIAL_SALARY_PAYMENT_CREATED/);
assert.match(serviceSource, /PARTIAL_SALARY_ACCRUAL_REQUIRED/);
assert.match(serviceSource, /PAYROLL_RECONCILIATION_REQUIRED/);
assert.match(serviceSource, /PAYROLL_NOT_FULLY_PAID/);
assert.match(serviceSource, /MANAGER_PAYROLL_MANUAL_APPROVED/);
assert.match(payrollRouteSource, /approve-manager-payroll-manual/);
assert.match(serviceSource, /managerPayrollPolicyState/);
assert.match(serviceSource, /SALARY_ALREADY_ACCRUED/);
assert.match(serviceSource, /SALARY_AMOUNT_MISMATCH/);
assert.match(payrollRouteSource, /PAYROLL_PERIOD_NOT_STARTED/);
assert.match(payrollPageSource, /readOnly=\{operation === "salaryAccrual" && row\.salaryPlanEnabled\}/);
assert.match(payrollPageSource, /Система предлагает бонус/);
assert.match(payrollPageSource, /Предложение системы/);
assert.match(payrollPageSource, /Исправить бонус/);
assert.match(payrollPageSource, /Отменить бонус/);
assert.match(payrollPageSource, /Бонусы за заказы ·/);
assert.match(payrollPageSource, /Уволен · бонус после завершения заказа/);
assert.match(payrollPageSource, /Референс \/ номер перевода \(необязательно\)/);
assert.match(payrollPageSource, /payrollBonus: "true"/);
assert.match(orderSearchRouteSource, /payrollBonusEligible: params\.get\("payrollBonus"\) === "true"/);
assert.match(orderServiceSource, /manager: \{ equals: "Компания", mode: "insensitive" \}/);
assert.match(orderServiceSource, /managerRoleScope/);
assert.match(payrollPageSource, /manualOverride/);
assert.match(serviceSource, /expectedOrderBonus = managerOrderBonus/);
assert.match(serviceSource, /BONUS_PAYMENT_EXISTS/);
assert.match(serviceSource, /ORDER_BONUS_CORRECTED/);
assert.match(serviceSource, /ORDER_BONUS_CANCELLED/);
assert.match(serviceSource, /if \(!deferred\) return \[\]/);
assert.match(serviceSource, /deferredCreated/);
assert.match(serviceSource, /ORDER_NOT_COMPLETED_FOR_TERMINATED_EMPLOYEE/);
assert.match(serviceSource, /accrueCompletedTerminatedManagerOrderBonus/);
assert.match(orderLifecycleServiceSource, /accrueCompletedTerminatedManagerOrderBonus/);
assert.match(serviceSource, /priorBonuses/);
assert.match(
  serviceSource,
  /actor\.role === Role\.MANAGER[\s\S]*original\.employee\.userId !== actor\.userId/,
);
assert.match(serviceSource, /const approvedAccrued = confirmedAccrued/);
assert.match(
  serviceSource,
  /input\.type === PayrollAccrualType\.BASE_SALARY[\s\S]*actor\.role !== Role\.DIRECTOR[\s\S]*actor\.role !== Role\.OPERATIONS_DIRECTOR/,
);
assert.match(
  payrollRouteSource,
  /session\.user\.accountRole\s*\|\|\s*session\.user\.role/,
);
assert.match(migrationSource, /PayrollPayment_externalReference_key/);
assert.match(migrationSource, /PayrollAccrual_one_order_bonus/);
assert.match(uniquenessMigrationSource, /orderBonusUniquenessKey/);
assert.match(
  uniquenessMigrationSource,
  /DROP INDEX IF EXISTS "PayrollAccrual_one_order_bonus"/,
);
assert.match(externalReferenceMigrationSource, /ADD COLUMN IF NOT EXISTS "externalReference"/);
assert.match(externalReferenceMigrationSource, /PayrollPayment_externalReference_key/);
assert.match(manualAccrualMigrationSource, /company\."slug" = 'altyn-sapa-company'/);
assert.match(manualAccrualMigrationSource, /period\."month" IN \(9, 10\)/);
assert.match(manualAccrualMigrationSource, /accrual\."reason" LIKE 'Автопроверка оклада:%'/);
assert.match(manualAccrualMigrationSource, /NOT EXISTS \([\s\S]*FROM "PayrollPayment"/);
assert.match(manualAccrualMigrationSource, /'BONUS_REVERSAL'/);
assert.match(companyResponsibleMigrationSource, /LOWER\(BTRIM\(customer_order\."manager"\)\)/);
assert.match(companyResponsibleMigrationSource, /'ORDER_BONUS_CANCELLED'/);
assert.match(companyResponsibleMigrationSource, /"relatedAccrualId" = accrual\."id"/);
assert.match(optionalAccrualReferenceMigrationSource, /ADD COLUMN IF NOT EXISTS "externalReference"/);
assert.match(deferredTerminatedBonusMigrationSource, /TERMINATED_MANAGER_BONUS_DEFERRED/);
assert.match(deferredTerminatedBonusMigrationSource, /customer_order\."lifecycle" = 'COMPLETED'/);
assert.match(deferredTerminatedBonusMigrationSource, /employee\."terminatedAt" IS NOT NULL/);
assert.match(explicitSalaryPlansMigrationSource, /TIMESTAMP '2026-10-01 00:00:00'/);
assert.match(explicitSalaryPlansMigrationSource, /%еркебулан%/);
assert.match(explicitSalaryPlansMigrationSource, /%нурасыл%/);
assert.match(unassignedSalaryCleanupMigrationSource, /period\."month" = 9/);
assert.match(unassignedSalaryCleanupMigrationSource, /%кокбай%/);
assert.match(companyBonusResweepMigrationSource, /customer_order\."managerUserId" IS NULL/);

console.log("Payroll policy tests passed");
