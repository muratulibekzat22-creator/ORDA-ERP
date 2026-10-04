import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  resolve(
    "prisma/migrations/20261004140000_payroll_calculation_snapshots/migration.sql",
  ),
  "utf8",
);
const reconciliationMigration = readFileSync(
  resolve(
    "prisma/migrations/20261004161000_payroll_component_ledger_reconciliation/migration.sql",
  ),
  "utf8",
);
const prismaCli = resolve("node_modules/prisma/build/index.js");
const schemaSql = execFileSync(
  process.execPath,
  [
    prismaCli,
    "migrate",
    "diff",
    "--from-empty",
    "--to-schema",
    "prisma/schema.prisma",
    "--script",
  ],
  { encoding: "utf8" },
);

const db = new PGlite();

async function one(sql: string) {
  const result = await db.query<Record<string, unknown>>(sql);
  assert.equal(result.rows.length, 1, `Expected one row for query:\n${sql}`);
  return result.rows[0];
}

async function main() {
  try {
    await db.exec(schemaSql);
    await db.exec(`
      DROP TABLE "PayrollCalculationSnapshot" CASCADE;
      DROP INDEX IF EXISTS "PayrollOrderBonusDecision_periodId_employeeId_idx";
      ALTER TABLE "PayrollOrderBonusDecision"
        DROP CONSTRAINT IF EXISTS "PayrollOrderBonusDecision_periodId_fkey",
        DROP COLUMN "periodId",
        DROP COLUMN "earnedAt";

      INSERT INTO "Company" (id, slug, name, timezone, "updatedAt")
      VALUES (1, 'altyn-sapa-company', 'Snapshot Test', 'Asia/Almaty', CURRENT_TIMESTAMP);

      INSERT INTO "User" (
        id, "companyId", name, email, password, role, "updatedAt"
      ) VALUES
        (1, 1, 'Founder', 'founder@snapshot.test', 'x', 'DIRECTOR', CURRENT_TIMESTAMP),
        (2, 1, 'Explicit manager', 'explicit@snapshot.test', 'x', 'MANAGER', CURRENT_TIMESTAMP),
        (3, 1, 'Automatic manager', 'automatic@snapshot.test', 'x', 'MANAGER', CURRENT_TIMESTAMP),
        (4, 1, 'Component only', 'component@snapshot.test', 'x', 'MANAGER', CURRENT_TIMESTAMP),
        (5, 1, 'Measurer', 'measurer@snapshot.test', 'x', 'MEASURER', CURRENT_TIMESTAMP);

      INSERT INTO "EmployeePayrollProfile" (
        id, "companyId", "userId", name, position, "hiredAt", "baseSalary",
        "salaryPlanEnabled", "updatedAt"
      ) VALUES
        (1, 1, 2, 'Explicit manager', 'MANAGER', TIMESTAMP '2026-08-01', 200000, TRUE, CURRENT_TIMESTAMP),
        (2, 1, 3, 'Automatic manager', 'MANAGER', TIMESTAMP '2026-08-01', 200000, TRUE, CURRENT_TIMESTAMP),
        (3, 1, 4, 'Component only', 'MANAGER', TIMESTAMP '2026-08-01', 0, FALSE, CURRENT_TIMESTAMP),
        (4, 1, 5, 'Measurer', 'MEASURER', TIMESTAMP '2026-08-01', 0, FALSE, CURRENT_TIMESTAMP);

      INSERT INTO "Client" (
        id, "companyId", name, phone, city, manager, amount, status, "managerUserId", "updatedAt"
      ) VALUES
        (1, 1, 'Client', '+77000000000', 'Алматы', 'Explicit manager', '1000000', 'Новый', 2, CURRENT_TIMESTAMP);

      INSERT INTO "Order" (
        id, "companyId", number, "clientId", address, staircase, material,
        amount, manager, "responsibleType", "managerUserId", "orderReceivedAt",
        "updatedAt"
      ) VALUES
        (1, 1, 'SNAPSHOT-ORDER', 1, 'Address', 'Прямая', 'Металл',
         1000000, 'Explicit manager', 'EMPLOYEE', 2,
         TIMESTAMP '2026-09-30 18:00:00', CURRENT_TIMESTAMP),
        (2, 1, 'COMPANY-MEASUREMENT', 1, 'Address', 'Прямая', 'Металл',
         1000000, 'Компания', 'COMPANY', NULL,
         TIMESTAMP '2026-09-15 12:00:00', CURRENT_TIMESTAMP);

      INSERT INTO "PayrollPeriod" (
        id, "companyId", year, month, "updatedAt"
      ) VALUES (1, 1, 2026, 9, CURRENT_TIMESTAMP);

      INSERT INTO "PayrollOrderBonusDecision" (
        id, "companyId", "orderId", "employeeId", "manualAmount", "updatedById",
        "createdAt", "updatedAt"
      ) VALUES
        (1, 1, 1, 1, 30000, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

      INSERT INTO "PayrollAccrual" (
        id, "employeeId", "periodId", type, direction, amount, reason,
        "approvedById", "createdById", "idempotencyKey", "requestHash", "approvedAt", "createdAt"
      ) VALUES
        (1, 1, 1, 'BASE_SALARY', 'INCREASE', 200000, 'Подтверждение оклада', 1, 1,
         'manual-salary:1', 'h1', TIMESTAMP '2026-10-01 10:00:00', TIMESTAMP '2026-10-01 10:00:00'),
        (2, 1, 1, 'PREMIUM', 'INCREASE', 50000, 'Премия', 1, 1,
         'manual-premium:1', 'h2', TIMESTAMP '2026-10-01 10:01:00', TIMESTAMP '2026-10-01 10:01:00'),
        (3, 1, 1, 'DEDUCTION', 'DECREASE', 10000, 'Удержание', 1, 1,
         'manual-deduction:1', 'h3', TIMESTAMP '2026-10-01 10:02:00', TIMESTAMP '2026-10-01 10:02:00'),
        (4, 2, 1, 'BASE_SALARY', 'INCREASE', 200000, 'Автопроверка оклада: системная запись', 1, 1,
         'payroll-policy:v1:automatic:salary:2', 'h4', TIMESTAMP '2026-10-01 10:03:00', TIMESTAMP '2026-10-01 10:03:00'),
        (5, 3, 1, 'PREMIUM', 'INCREASE', 20000, 'Отдельная премия', 1, 1,
         'component-premium:3', 'h5', TIMESTAMP '2026-10-01 10:04:00', TIMESTAMP '2026-10-01 10:04:00'),
        (6, 3, 1, 'EXTRA_BONUS', 'INCREASE', 15000, 'Отдельный бонус', 1, 1,
         'component-extra:3', 'h6', TIMESTAMP '2026-10-01 10:05:00', TIMESTAMP '2026-10-01 10:05:00'),
        (7, 3, 1, 'DEDUCTION', 'DECREASE', 5000, 'Отдельное удержание', 1, 1,
         'component-deduction:3', 'h7', TIMESTAMP '2026-10-01 10:06:00', TIMESTAMP '2026-10-01 10:06:00'),
        (8, 4, 1, 'MEASUREMENT_BONUS', 'INCREASE', 30000, 'Старый бонус заказа компании', 1, 1,
         'legacy-company-measurement:4', 'h8', TIMESTAMP '2026-09-15 12:00:00', TIMESTAMP '2026-09-15 12:00:00');

      UPDATE "PayrollAccrual" SET "orderId" = 2 WHERE id = 8;

      INSERT INTO "PayrollAuditEvent" (
        id, action, "actorId", "periodId", "employeeId", after, reason,
        "idempotencyKey", "createdAt"
      ) VALUES
        (1, 'PAYROLL_ACCRUAL_CREATED', 1, 1, 1,
         jsonb_build_object('accrualId', 1, 'type', 'BASE_SALARY', 'amount', 200000),
         'Founder explicitly confirmed salary', 'manual-salary:1:audit', TIMESTAMP '2026-10-01 10:00:00'),
        (2, 'PAYROLL_ACCRUAL_CREATED', 1, 1, 2,
         jsonb_build_object('accrualId', 4, 'type', 'BASE_SALARY', 'amount', 200000),
         'Automatic policy write', 'payroll-policy:v1:automatic:salary:2:audit', TIMESTAMP '2026-10-01 10:03:00');

      INSERT INTO "CompanyLedgerEntry" (
        id, "companyId", type, category, direction, amount, "authorId",
        "payrollAccrualId", "affectsProfit", "updatedAt"
      ) VALUES
        (1, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 200000, 1, 1, TRUE, CURRENT_TIMESTAMP),
        (2, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 50000, 1, 2, TRUE, CURRENT_TIMESTAMP),
        (3, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'INCOME', 10000, 1, 3, TRUE, CURRENT_TIMESTAMP),
        (4, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 20000, 1, 5, TRUE, CURRENT_TIMESTAMP),
        (5, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 15000, 1, 6, TRUE, CURRENT_TIMESTAMP),
        (6, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'INCOME', 5000, 1, 7, TRUE, CURRENT_TIMESTAMP),
        (7, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 30000, 1, 8, TRUE, CURRENT_TIMESTAMP);

      SELECT setval(pg_get_serial_sequence('"PayrollPeriod"', 'id'), 1, TRUE);
      SELECT setval(pg_get_serial_sequence('"PayrollAccrual"', 'id'), 8, TRUE);
      SELECT setval(pg_get_serial_sequence('"PayrollAuditEvent"', 'id'), 2, TRUE);
      SELECT setval(pg_get_serial_sequence('"CompanyLedgerEntry"', 'id'), 7, TRUE);
    `);

    await db.exec(migration);
    await db.exec(reconciliationMigration);

    assert.deepEqual(await one(`
      SELECT period.year, period.month, decision."earnedAt"::text AS "earnedAt",
             decision."manualAmount"::text AS "manualAmount"
      FROM "PayrollOrderBonusDecision" decision
      JOIN "PayrollPeriod" period ON period.id = decision."periodId"
      WHERE decision.id = 1
    `), {
      year: 2026,
      month: 9,
      earnedAt: "2026-09-30 18:00:00",
      manualAmount: "30000.00",
    });

    assert.deepEqual(await one(`
      SELECT COUNT(*)::int AS count,
             MAX("employeeId")::int AS "employeeId",
             MAX("preparedAmount")::text AS prepared,
             MAX("salaryAmount")::text AS salary,
             MAX("orderBonusAmount")::text AS "orderBonus",
             MAX("premiumAmount")::text AS premium,
             MAX("deductionAmount")::text AS deduction
      FROM "PayrollCalculationSnapshot"
    `), {
      count: 1,
      employeeId: 1,
      prepared: "270000.00",
      salary: "200000.00",
      orderBonus: "30000.00",
      premium: "50000.00",
      deduction: "10000.00",
    });
    assert.equal(
      Number((await one(`
        SELECT COUNT(*)::int AS count FROM "PayrollCalculationSnapshot"
        WHERE "employeeId" = 2
      `)).count),
      0,
      "an automated salary row must not become a confirmed calculation",
    );
    assert.equal(
      Number((await one(`
        SELECT COUNT(*)::int AS count FROM "PayrollCalculationSnapshot"
        WHERE "employeeId" = 3
      `)).count),
      0,
      "component-only rows must not be promoted to a confirmed calculation",
    );
    assert.equal(
      Number((await one(`
        SELECT COUNT(*)::int AS count FROM "PayrollAuditEvent"
        WHERE action = 'PAYROLL_CALCULATION_MIGRATED'
      `)).count),
      1,
    );
    assert.deepEqual(await one(`
      SELECT
        COUNT(*) FILTER (
          WHERE "payrollAccrualId" IS NOT NULL AND "affectsProfit" = FALSE
        )::int AS "preparedComponents",
        COUNT(*) FILTER (
          WHERE "payrollCalculationSnapshotId" IS NOT NULL
            AND "affectsProfit" = TRUE
        )::int AS "snapshotEntries",
        COUNT(*) FILTER (
          WHERE "payrollAccrualId" IN (5, 6, 7)
            AND "affectsProfit" = TRUE
        )::int AS "componentOnlyEntries",
        SUM(
          CASE
            WHEN "payrollAccrualId" IN (5, 6, 7) AND direction = 'EXPENSE'
              THEN amount
            WHEN "payrollAccrualId" IN (5, 6, 7) AND direction = 'INCOME'
              THEN -amount
            ELSE 0
          END
        )::text AS "componentOnlyNet",
        MAX(amount) FILTER (
          WHERE "payrollCalculationSnapshotId" IS NOT NULL
        )::text AS "recognisedAmount",
        MAX("operationDate") FILTER (
          WHERE "payrollCalculationSnapshotId" IS NOT NULL
        )::text AS "accountingDate"
      FROM "CompanyLedgerEntry"
    `), {
      preparedComponents: 5,
      snapshotEntries: 1,
      componentOnlyEntries: 3,
      componentOnlyNet: "30000.00",
      recognisedAmount: "270000.00",
      accountingDate: "2026-09-30 18:59:59.999",
    });
    assert.equal(
      (await one(`
        SELECT "affectsProfit" FROM "CompanyLedgerEntry"
        WHERE "payrollAccrualId" = 8
      `)).affectsProfit,
      false,
      "a measurement bonus linked to a Company-owned order must not affect P&L",
    );
    assert.deepEqual(await one(`
      SELECT
        COUNT(*)::int AS reversals,
        COUNT(*) FILTER (
          WHERE ledger."affectsProfit" = FALSE
        )::int AS "neutralLedgers",
        COUNT(*) FILTER (
          WHERE audit.action = 'MEASUREMENT_BONUS_INVALIDATED'
        )::int AS audits
      FROM "PayrollAccrual" reversal
      LEFT JOIN "CompanyLedgerEntry" ledger
        ON ledger."payrollAccrualId" = reversal.id
      LEFT JOIN "PayrollAuditEvent" audit
        ON audit."idempotencyKey" =
          'company-measurement-bonus-reset:v1:audit:8'
      WHERE reversal."reversalOfId" = 8
    `), {
      reversals: 1,
      neutralLedgers: 1,
      audits: 1,
    });

    const beforeReplay = await one(`
      SELECT
        (SELECT COUNT(*)::int FROM "PayrollPeriod") AS periods,
        (SELECT COUNT(*)::int FROM "PayrollCalculationSnapshot") AS snapshots,
        (SELECT COUNT(*)::int FROM "PayrollAccrual") AS accruals,
        (SELECT COUNT(*)::int FROM "CompanyLedgerEntry") AS ledger,
        (SELECT COUNT(*)::int FROM "PayrollAuditEvent") AS audits
    `);
    await db.exec(migration);
    await db.exec(reconciliationMigration);
    const afterReplay = await one(`
      SELECT
        (SELECT COUNT(*)::int FROM "PayrollPeriod") AS periods,
        (SELECT COUNT(*)::int FROM "PayrollCalculationSnapshot") AS snapshots,
        (SELECT COUNT(*)::int FROM "PayrollAccrual") AS accruals,
        (SELECT COUNT(*)::int FROM "CompanyLedgerEntry") AS ledger,
        (SELECT COUNT(*)::int FROM "PayrollAuditEvent") AS audits
    `);
    assert.deepEqual(afterReplay, beforeReplay);

    console.log("Payroll calculation snapshot migration test passed");
  } finally {
    await db.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
