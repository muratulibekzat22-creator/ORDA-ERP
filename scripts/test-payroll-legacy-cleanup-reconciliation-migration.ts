import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  resolve(
    "prisma/migrations/20261004162000_payroll_legacy_cleanup_reconciliation/migration.sql",
  ),
  "utf8",
);
const componentLedgerMigration = readFileSync(
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
      INSERT INTO "Company" (id, slug, name, "updatedAt") VALUES
        (1, 'altyn-sapa-company', 'ALTYN SAPA', CURRENT_TIMESTAMP),
        (2, 'outside-company', 'OUTSIDE', CURRENT_TIMESTAMP);

      INSERT INTO "User" (
        id, "companyId", name, email, password, role, active, "updatedAt"
      ) VALUES
        (1, 1, 'Founder', 'founder@target.test', 'x', 'DIRECTOR', TRUE, CURRENT_TIMESTAMP),
        (2, 1, 'Manager', 'manager@target.test', 'x', 'MANAGER', TRUE, CURRENT_TIMESTAMP),
        (3, 1, 'Measurer', 'measurer@target.test', 'x', 'MEASURER', TRUE, CURRENT_TIMESTAMP),
        (4, 2, 'Outside', 'founder@outside.test', 'x', 'DIRECTOR', TRUE, CURRENT_TIMESTAMP);

      INSERT INTO "Client" (
        id, "companyId", name, phone, city, manager, amount, status, "updatedAt"
      ) VALUES
        (1, 1, 'Target client', '1', 'Almaty', 'Manager', '0', 'NEW', CURRENT_TIMESTAMP),
        (2, 2, 'Outside client', '2', 'Almaty', 'Outside', '0', 'NEW', CURRENT_TIMESTAMP);

      INSERT INTO "EmployeePayrollProfile" (
        id, "companyId", "userId", name, position, "hiredAt", "updatedAt"
      ) VALUES
        (1, 1, 2, 'Manager', 'MANAGER', TIMESTAMP '2026-08-01', CURRENT_TIMESTAMP),
        (2, 1, 3, 'Measurer', 'MEASURER', TIMESTAMP '2026-08-01', CURRENT_TIMESTAMP),
        (3, 2, 4, 'Outside', 'DIRECTOR', TIMESTAMP '2026-08-01', CURRENT_TIMESTAMP);

      INSERT INTO "PayrollPeriod" (
        id, "companyId", year, month, "updatedAt"
      ) VALUES
        (1, 1, 2026, 9, CURRENT_TIMESTAMP),
        (2, 1, 2026, 10, CURRENT_TIMESTAMP),
        (3, 2, 2026, 9, CURRENT_TIMESTAMP),
        (4, 1, 2026, 11, CURRENT_TIMESTAMP);

      INSERT INTO "Order" (
        id, "companyId", number, "clientId", address, staircase, material,
        amount, manager, "responsibleType", "managerUserId", "orderReceivedAt",
        lifecycle, "updatedAt"
      ) VALUES
        (1, 1, 'T-1', 1, 'A', 'S', 'M', 1000000, 'Manager', 'EMPLOYEE', 2,
         TIMESTAMP '2026-09-10 07:00:00', 'COMPLETED', CURRENT_TIMESTAMP),
        (2, 1, 'T-2', 1, 'A', 'S', 'M', 1000000, 'Manager', 'EMPLOYEE', 2,
         TIMESTAMP '2026-09-11 07:00:00', 'COMPLETED', CURRENT_TIMESTAMP),
        (3, 1, 'T-3', 1, 'A', 'S', 'M', 1000000, 'Компания', 'COMPANY', NULL,
         TIMESTAMP '2026-09-12 07:00:00', 'COMPLETED', CURRENT_TIMESTAMP),
        (4, 2, 'O-1', 2, 'A', 'S', 'M', 1000000, 'Outside', 'EMPLOYEE', 4,
         TIMESTAMP '2026-09-12 07:00:00', 'COMPLETED', CURRENT_TIMESTAMP);

      INSERT INTO "PayrollAccrual" (
        id, "employeeId", "periodId", "earnedPeriodId", type, direction,
        amount, "orderId", reason, "approvedById", "createdById",
        "reversalOfId", "idempotencyKey", "requestHash", "createdAt"
      ) VALUES
        (100, 1, 2, 2, 'ORDER_BONUS', 'INCREASE', 50000, 1,
         'Manual order bonus', 1, 1, NULL, 'manual-order-1', 'h100', TIMESTAMP '2026-10-02'),
        (101, 1, 2, 2, 'BONUS_REVERSAL', 'DECREASE', 50000, 1,
         'Wrong month cleanup', 1, 1, 100, 'factual-order-month-bonus:v1:100', 'h101', TIMESTAMP '2026-10-03'),
        (102, 1, 2, 2, 'ORDER_BONUS', 'INCREASE', 30000, 2,
         'System proposal', 1, 1, NULL, 'automatic-order-2', 'h102', TIMESTAMP '2026-10-02'),
        (103, 1, 2, 2, 'BONUS_REVERSAL', 'DECREASE', 30000, 2,
         'Wrong month cleanup', 1, 1, 102, 'factual-order-month-bonus:v1:102', 'h103', TIMESTAMP '2026-10-03'),
        (104, 1, 2, 2, 'GUARANTEED_ORDER_BONUS', 'INCREASE', 20000, 3,
         'Explicit but Company-owned', 1, 1, NULL, 'company-order-3', 'h104', TIMESTAMP '2026-10-02'),
        (105, 1, 2, 2, 'BONUS_REVERSAL', 'DECREASE', 20000, 3,
         'Wrong month cleanup', 1, 1, 104, 'factual-order-month-bonus:v1:104', 'h105', TIMESTAMP '2026-10-03'),

        (200, 2, 2, 2, 'PREMIUM', 'INCREASE', 25000, NULL,
         'Manual premium', 1, 1, NULL, 'manual-premium-200', 'h200', TIMESTAMP '2026-10-02'),
        (201, 2, 2, 2, 'BONUS_REVERSAL', 'DECREASE', 25000, NULL,
         'Old role sweep', 1, 1, 200, 'measurer-zero-salary:v2:200', 'h201', TIMESTAMP '2026-10-03'),
        (202, 2, 2, 2, 'EXTRA_BONUS', 'INCREASE', 15000, NULL,
         'No exact evidence', 1, 1, NULL, 'unverified-extra-202', 'h202', TIMESTAMP '2026-10-02'),
        (203, 2, 2, 2, 'BONUS_REVERSAL', 'DECREASE', 15000, NULL,
         'Old role sweep', 1, 1, 202, 'measurer-zero-salary:v2:202', 'h203', TIMESTAMP '2026-10-03'),

        (300, 2, 2, 2, 'BASE_SALARY', 'INCREASE', 200000, NULL,
         'Автопроверка оклада', 1, 1, NULL, 'payroll-policy:salary:300', 'h300', TIMESTAMP '2026-10-01'),
        (301, 2, 2, 2, 'BONUS_REVERSAL', 'DECREASE', 200000, NULL,
         'Old broad cleanup', 1, 1, 300, 'unassigned-salary-cleanup:v1:300', 'h301', TIMESTAMP '2026-10-02'),
        (302, 2, 2, 2, 'BASE_SALARY', 'INCREASE', 200000, NULL,
         'Mechanical restore', 1, 1, NULL, 'salary-cleanup-restore:v2:300', 'h302', TIMESTAMP '2026-10-03'),
        (304, 1, 2, 2, 'BASE_SALARY', 'INCREASE', 180000, NULL,
         'Manual confirmed salary', 1, 1, NULL, 'manual-salary-304', 'h304', TIMESTAMP '2026-10-01'),
        (305, 1, 2, 2, 'BONUS_REVERSAL', 'DECREASE', 180000, NULL,
         'Old broad cleanup', 1, 1, 304, 'unassigned-salary-cleanup:v1:304', 'h305', TIMESTAMP '2026-10-02'),
        (306, 1, 2, 2, 'BASE_SALARY', 'INCREASE', 180000, NULL,
         'Mechanical restore', 1, 1, NULL, 'salary-cleanup-restore:v2:304', 'h306', TIMESTAMP '2026-10-03'),

        (400, 3, 3, 3, 'PREMIUM', 'INCREASE', 99000, NULL,
         'Outside premium', 4, 4, NULL, 'outside-premium', 'h400', TIMESTAMP '2026-09-02'),
        (401, 3, 3, 3, 'BONUS_REVERSAL', 'DECREASE', 99000, NULL,
         'Outside sweep', 4, 4, 400, 'measurer-zero-salary:v2:400', 'h401', TIMESTAMP '2026-09-03'),
        (500, 2, 4, 4, 'MEASUREMENT_BONUS', 'INCREASE', 17000, 3,
         'Future Company-order fixture', 1, 1, NULL, 'future-company-measurement-500', 'h500', TIMESTAMP '2026-11-03'),
        (501, 2, 1, 1, 'MEASUREMENT_BONUS', 'INCREASE', 18000, 3,
         'September Company-order fixture', 1, 1, NULL, 'september-company-measurement-501', 'h501', TIMESTAMP '2026-09-13');

      INSERT INTO "PayrollAuditEvent" (
        id, action, "actorId", "periodId", "employeeId", after, reason,
        "idempotencyKey"
      ) VALUES
        (1, 'PAYROLL_ACCRUAL_CREATED', 1, 2, 1,
         '{"accrualId":100,"type":"ORDER_BONUS","manualOverride":true}',
         'Manual order bonus', 'audit-manual-order-100'),
        (2, 'PREMIUM_ACCRUED', 1, 2, 2,
         '{"accrualId":200,"type":"PREMIUM"}',
         'Manual premium', 'audit-premium-200'),
        (3, 'PAYROLL_ACCRUAL_CREATED', 1, 2, 1,
         '{"accrualId":304,"type":"BASE_SALARY"}',
         'Manual confirmed salary', 'audit-salary-304');

      INSERT INTO "CompanyLedgerEntry" (
        id, "companyId", type, category, direction, source, amount,
        "operationDate", "employeeId", "authorId", "idempotencyKey",
        "requestHash", "affectsProfit", "payrollAccrualId", "updatedAt"
      ) VALUES
        (1, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 'OTHER_SYSTEM', 25000,
         TIMESTAMP '2026-10-02', 2, 1, 'payroll-accrual:200', 'h200', TRUE, 200, CURRENT_TIMESTAMP),
        (2, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'INCOME', 'OTHER_SYSTEM', 25000,
         TIMESTAMP '2026-10-02', 2, 1, 'payroll-accrual:201', 'h201', TRUE, 201, CURRENT_TIMESTAMP),
        (3, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 'OTHER_SYSTEM', 200000,
         TIMESTAMP '2026-10-03', 2, 1, 'payroll-accrual:302', 'h302', TRUE, 302, CURRENT_TIMESTAMP),
        (4, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 'OTHER_SYSTEM', 180000,
         TIMESTAMP '2026-10-03', 1, 1, 'payroll-accrual:306', 'h306', TRUE, 306, CURRENT_TIMESTAMP),
        (5, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 'OTHER_SYSTEM', 17000,
         TIMESTAMP '2026-11-03', 2, 1, 'payroll-accrual:500', 'h500', TRUE, 500, CURRENT_TIMESTAMP),
        (6, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 'OTHER_SYSTEM', 18000,
         TIMESTAMP '2026-09-13', 2, 1, 'payroll-accrual:501', 'h501', TRUE, 501, CURRENT_TIMESTAMP);

      INSERT INTO "PayrollPayment" (
        id, "employeeId", "periodId", amount, "paymentDate", type, "paidById",
        "idempotencyKey", "requestHash"
      ) VALUES
        (1, 1, 1, 50000, TIMESTAMP '2026-09-20', 'ADVANCE', 1, 'payment-1', 'payment-hash');

      INSERT INTO "PayrollPaymentConfirmation" (
        id, "employeeId", "periodId", amount, type, "claimedPaymentDate",
        status, "createdById", "idempotencyKey", "requestHash", "updatedAt"
      ) VALUES
        (1, 1, 2, 10000, 'ADVANCE', TIMESTAMP '2026-10-10', 'PENDING', 2,
         'confirmation-1', 'confirmation-hash', CURRENT_TIMESTAMP);

      SELECT setval(pg_get_serial_sequence('"PayrollAccrual"', 'id'), 501, TRUE);
      SELECT setval(pg_get_serial_sequence('"PayrollAuditEvent"', 'id'), 3, TRUE);
      SELECT setval(pg_get_serial_sequence('"CompanyLedgerEntry"', 'id'), 6, TRUE);
      SELECT setval(pg_get_serial_sequence('"PayrollPayment"', 'id'), 1, TRUE);
      SELECT setval(pg_get_serial_sequence('"PayrollPaymentConfirmation"', 'id'), 1, TRUE);
    `);

    const factualRowsBefore = await db.query(`
      SELECT id, "employeeId", "periodId", amount::text, type, "idempotencyKey"
      FROM "PayrollPayment" ORDER BY id
    `);
    const confirmationsBefore = await db.query(`
      SELECT id, "employeeId", "periodId", amount::text, status, "idempotencyKey"
      FROM "PayrollPaymentConfirmation" ORDER BY id
    `);
    const outsideBefore = await db.query(`
      SELECT id, type, direction, amount::text, "idempotencyKey"
      FROM "PayrollAccrual" WHERE "employeeId" = 3 ORDER BY id
    `);

    // A deterministic replay may reuse an identical decision, but it must not
    // silently overwrite or bless a conflicting pre-existing value.
    await db.exec(`
      INSERT INTO "PayrollOrderBonusDecision" (
        "companyId", "orderId", "employeeId", "periodId", "earnedAt",
        "manualAmount", "updatedById", "updatedAt"
      ) VALUES (
        1, 1, 1, 2, TIMESTAMP '2026-09-10 07:00:00', 1, 1, CURRENT_TIMESTAMP
      );
    `);
    await assert.rejects(
      db.exec(migration),
      /Conflicting saved bonus decision for legacy accrual id\(s\): 100/,
    );
    await db.exec("ROLLBACK");
    await db.exec(`DELETE FROM "PayrollOrderBonusDecision" WHERE "orderId" = 1`);

    // The ledger reconciliation is a data repair for September/October only.
    // A future Company-owned order remains untouched; the application enforces
    // the corrected rule for newly written future data.
    await db.exec(componentLedgerMigration);
    assert.deepEqual(await one(`
      SELECT
        COUNT(*) FILTER (WHERE accrual.id = 500)::int AS original,
        COUNT(*) FILTER (WHERE accrual."reversalOfId" = 500)::int AS reversals,
        BOOL_AND(ledger."affectsProfit") AS "affectsProfit"
      FROM "PayrollAccrual" accrual
      LEFT JOIN "CompanyLedgerEntry" ledger
        ON ledger."payrollAccrualId" = accrual.id
      WHERE accrual.id = 500 OR accrual."reversalOfId" = 500
    `), { original: 1, reversals: 0, affectsProfit: true });
    assert.deepEqual(await one(`
      SELECT
        COUNT(*) FILTER (WHERE accrual.id = 501)::int AS original,
        COUNT(*) FILTER (
          WHERE accrual."reversalOfId" = 501
            AND accrual."idempotencyKey" = 'company-measurement-bonus-reset:v1:501'
        )::int AS reversals,
        COUNT(*) FILTER (WHERE ledger."affectsProfit" = FALSE)::int AS "nonProfitLedgers"
      FROM "PayrollAccrual" accrual
      LEFT JOIN "CompanyLedgerEntry" ledger
        ON ledger."payrollAccrualId" = accrual.id
      WHERE accrual.id = 501 OR accrual."reversalOfId" = 501
    `), { original: 1, reversals: 1, nonProfitLedgers: 2 });
    const componentState = await one(`
      SELECT
        (SELECT COUNT(*)::int FROM "PayrollAccrual") AS accruals,
        (SELECT COUNT(*)::int FROM "CompanyLedgerEntry") AS ledgers,
        (SELECT COUNT(*)::int FROM "PayrollAuditEvent") AS audits
    `);
    await db.exec(componentLedgerMigration);
    assert.deepEqual(await one(`
      SELECT
        (SELECT COUNT(*)::int FROM "PayrollAccrual") AS accruals,
        (SELECT COUNT(*)::int FROM "CompanyLedgerEntry") AS ledgers,
        (SELECT COUNT(*)::int FROM "PayrollAuditEvent") AS audits
    `), componentState);

    await db.exec(migration);

    assert.deepEqual(await one(`
      SELECT COUNT(*)::int AS count, MIN("periodId")::int AS "periodId",
             MIN("manualAmount")::text AS amount
      FROM "PayrollOrderBonusDecision"
      WHERE "orderId" = 1 AND "employeeId" = 1
    `), { count: 1, periodId: 1, amount: "50000.00" });
    assert.deepEqual(await one(`
      SELECT COUNT(*)::int AS count
      FROM "PayrollOrderBonusDecision"
      WHERE "orderId" IN (2, 3)
    `), { count: 0 });

    assert.deepEqual(await one(`
      SELECT COUNT(*)::int AS count, MIN(amount)::text AS amount,
             BOOL_AND("measurementId" IS NULL) AS "measurementUniquePreserved"
      FROM "PayrollAccrual"
      WHERE "idempotencyKey" = 'legacy-measurer-component-restore:v1:200'
        AND type = 'PREMIUM' AND direction = 'INCREASE'
    `), { count: 1, amount: "25000.00", measurementUniquePreserved: true });
    assert.deepEqual(await one(`
      SELECT COUNT(*)::int AS count
      FROM "PayrollAccrual"
      WHERE "idempotencyKey" = 'legacy-measurer-component-restore:v1:202'
    `), { count: 0 });
    assert.deepEqual(await one(`
      SELECT COUNT(*)::int AS count
      FROM "CompanyLedgerEntry" ledger
      JOIN "PayrollAccrual" accrual ON accrual.id = ledger."payrollAccrualId"
      WHERE accrual."idempotencyKey" = 'legacy-measurer-component-restore:v1:200'
        AND ledger."affectsProfit" = FALSE
        AND ledger."operationDate" = TIMESTAMP '2026-10-02'
    `), { count: 1 });

    assert.deepEqual(await one(`
      SELECT
        COUNT(*) FILTER (
          WHERE "idempotencyKey" = 'legacy-auto-salary-restore-reset:v1:302'
        )::int AS automatic,
        COUNT(*) FILTER (
          WHERE "idempotencyKey" = 'legacy-auto-salary-restore-reset:v1:306'
        )::int AS manual
      FROM "PayrollAccrual"
    `), { automatic: 1, manual: 0 });

    assert.deepEqual(
      (await db.query(`
        SELECT id, "employeeId", "periodId", amount::text, type, "idempotencyKey"
        FROM "PayrollPayment" ORDER BY id
      `)).rows,
      factualRowsBefore.rows,
    );
    assert.deepEqual(
      (await db.query(`
        SELECT id, "employeeId", "periodId", amount::text, status, "idempotencyKey"
        FROM "PayrollPaymentConfirmation" ORDER BY id
      `)).rows,
      confirmationsBefore.rows,
    );
    assert.deepEqual(
      (await db.query(`
        SELECT id, type, direction, amount::text, "idempotencyKey"
        FROM "PayrollAccrual" WHERE "employeeId" = 3 ORDER BY id
      `)).rows,
      outsideBefore.rows,
    );

    const accrualsBeforeReplay = await db.query(`
      SELECT id, "employeeId", "periodId", type, direction, amount::text,
             "orderId", "reversalOfId", "idempotencyKey"
      FROM "PayrollAccrual" ORDER BY id
    `);
    const decisionsBeforeReplay = await db.query(`
      SELECT id, "companyId", "orderId", "employeeId", "periodId", "earnedAt",
             "manualAmount"::text, "updatedById"
      FROM "PayrollOrderBonusDecision" ORDER BY id
    `);
    const auditsBeforeReplay = await db.query(`
      SELECT action, "actorId", "periodId", "employeeId", "idempotencyKey"
      FROM "PayrollAuditEvent" ORDER BY id
    `);
    const ledgersBeforeReplay = await db.query(`
      SELECT id, "companyId", direction, amount::text, "operationDate",
             "affectsProfit", "payrollAccrualId", "idempotencyKey"
      FROM "CompanyLedgerEntry" ORDER BY id
    `);

    await db.exec(migration);

    assert.deepEqual((await db.query(`
      SELECT id, "employeeId", "periodId", type, direction, amount::text,
             "orderId", "reversalOfId", "idempotencyKey"
      FROM "PayrollAccrual" ORDER BY id
    `)).rows, accrualsBeforeReplay.rows);
    assert.deepEqual((await db.query(`
      SELECT id, "companyId", "orderId", "employeeId", "periodId", "earnedAt",
             "manualAmount"::text, "updatedById"
      FROM "PayrollOrderBonusDecision" ORDER BY id
    `)).rows, decisionsBeforeReplay.rows);
    assert.deepEqual((await db.query(`
      SELECT action, "actorId", "periodId", "employeeId", "idempotencyKey"
      FROM "PayrollAuditEvent" ORDER BY id
    `)).rows, auditsBeforeReplay.rows);
    assert.deepEqual((await db.query(`
      SELECT id, "companyId", direction, amount::text, "operationDate",
             "affectsProfit", "payrollAccrualId", "idempotencyKey"
      FROM "CompanyLedgerEntry" ORDER BY id
    `)).rows, ledgersBeforeReplay.rows);

    console.log("Legacy payroll cleanup reconciliation migration test passed");
  } finally {
    await db.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
