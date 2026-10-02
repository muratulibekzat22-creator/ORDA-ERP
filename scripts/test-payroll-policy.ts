import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  auditManagerOrderBonus,
  isDateInPayrollPeriod,
  isManagerOrderBonusEligible,
  isOrderAssignedToManager,
  isPayrollReconciled,
  isPayrollPolicyReady,
  isValidKaspiReference,
  managerOrderBonus,
  payrollPaymentPurpose,
  payrollPaymentReference,
  payrollRoleAccess,
} from "../lib/payroll-policy";

assert.equal(managerOrderBonus(616_000), 30_000);
assert.equal(managerOrderBonus(3_000_000), 30_000);
assert.equal(managerOrderBonus(3_000_001), 50_000);
assert.equal(managerOrderBonus(6_000_000), 50_000);
assert.equal(isManagerOrderBonusEligible({ status: "Передан в цех" }), true);
assert.equal(isManagerOrderBonusEligible({ status: "Отменён" }), false);
assert.equal(isManagerOrderBonusEligible({ status: "Возврат" }), false);
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
const periodStart = new Date("2026-10-01T00:00:00.000Z");
const periodEnd = new Date("2026-11-01T00:00:00.000Z");
assert.equal(isDateInPayrollPeriod(periodStart, periodStart, periodEnd), true);
assert.equal(isDateInPayrollPeriod(periodEnd, periodStart, periodEnd), false);

assert.equal(isValidKaspiReference(undefined), false);
assert.equal(isValidKaspiReference("  "), false);
assert.equal(isValidKaspiReference("K1"), false);
assert.equal(isValidKaspiReference("KASPI-123456"), true);
assert.equal(isValidKaspiReference("X".repeat(121)), false);
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
assert.match(serviceSource, /DIRECTOR_CONFIRMATION_REQUIRED/);
assert.match(serviceSource, /reconcileCurrentManagerPayroll/);
assert.match(serviceSource, /const periodCoordinates = \[\{ year, month \}, previous\]/);
assert.match(serviceSource, /KASPI_REFERENCE_REQUIRED/);
assert.match(serviceSource, /PAYROLL_RECONCILIATION_REQUIRED/);
assert.match(serviceSource, /PAYROLL_WORK_INCOMPLETE/);
assert.match(serviceSource, /MANAGER_PAYROLL_MANUAL_APPROVED/);
assert.match(payrollRouteSource, /approve-manager-payroll-manual/);
assert.match(serviceSource, /managerPayrollPolicyState/);
assert.match(
  payrollRouteSource,
  /session\.user\.accountRole\s*\|\|\s*session\.user\.role/,
);
assert.match(serviceSource, /payroll-policy:v1:/);
assert.match(migrationSource, /PayrollPayment_externalReference_key/);
assert.match(migrationSource, /PayrollAccrual_one_order_bonus/);
assert.match(uniquenessMigrationSource, /orderBonusUniquenessKey/);
assert.match(
  uniquenessMigrationSource,
  /DROP INDEX IF EXISTS "PayrollAccrual_one_order_bonus"/,
);
assert.match(externalReferenceMigrationSource, /ADD COLUMN IF NOT EXISTS "externalReference"/);
assert.match(externalReferenceMigrationSource, /PayrollPayment_externalReference_key/);

console.log("Payroll policy tests passed");
