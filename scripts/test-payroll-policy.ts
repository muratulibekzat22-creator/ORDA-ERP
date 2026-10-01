import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  auditManagerOrderBonus,
  isDateInPayrollPeriod,
  isManagerOrderBonusEligible,
  isOrderAssignedToManager,
  isValidKaspiReference,
  managerOrderBonus,
  payrollPaymentPurpose,
  payrollPaymentReference,
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
const migrationSource = readFileSync(
  new URL(
    "../prisma/migrations/20261002120000_manager_order_bonus_uniqueness/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
assert.match(serviceSource, /FOUNDER_CONFIRMATION_REQUIRED/);
assert.match(serviceSource, /KASPI_REFERENCE_REQUIRED/);
assert.match(serviceSource, /payroll-policy:v1:/);
assert.match(migrationSource, /PayrollAccrual_one_order_bonus/);
assert.match(migrationSource, /PayrollPayment_externalReference_key/);

console.log("Payroll policy tests passed");
