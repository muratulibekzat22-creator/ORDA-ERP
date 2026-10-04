import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";

const migrationPath = resolve(
  "prisma/migrations/20261004110000_payroll_accounting_source_of_truth/migration.sql",
);
const migration = readFileSync(migrationPath, "utf8");
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

async function count(sql: string) {
  return Number((await one(sql)).count);
}

const septemberPaymentSnapshot = () => one(`
  SELECT
    COUNT(payment.id)::int AS count,
    COALESCE(SUM(
      CASE
        WHEN payment.type = 'EMPLOYEE_REFUND'::"PayrollPaymentType"
          THEN -payment.amount
        ELSE payment.amount
      END
    ), 0)::text AS total
  FROM "PayrollPayment" payment
  JOIN "PayrollPeriod" period ON period.id = payment."periodId"
  JOIN "Company" company ON company.id = period."companyId"
  WHERE company.slug = 'altyn-sapa-company'
    AND period.year = 2026
    AND period.month = 9
    AND payment."reversalOfId" IS NULL
    AND payment."reversedAt" IS NULL
`);

async function main() {
try {
  // Build the complete relational baseline, then remove only the additive
  // 11:00 feature so the migration is exercised from the real 10:40 shape.
  await db.exec(schemaSql);
  await db.exec(`
    DROP TABLE "PayrollOrderBonusDecision";
    ALTER TABLE "Order" DROP COLUMN "responsibleType";
    DROP TYPE "OrderResponsibleType";
  `);

  // The production-specific assertions in the migration intentionally fail
  // on an empty database. Seed the precise company/period invariants first,
  // plus an out-of-scope tenant that must remain unchanged.
  await db.exec(`
    INSERT INTO "Company" (id, slug, name, "updatedAt") VALUES
      (1, 'altyn-sapa-company', 'ALTYN SAPA', CURRENT_TIMESTAMP),
      (2, 'outside-company', 'OUTSIDE', CURRENT_TIMESTAMP);

    INSERT INTO "User" (
      id, "companyId", name, email, password, role, "updatedAt"
    ) VALUES
      (1, 1, 'Алихан', 'director@target.test', 'x', 'DIRECTOR', CURRENT_TIMESTAMP),
      (2, 1, 'Акбота', 'akbota@target.test', 'x', 'MANAGER', CURRENT_TIMESTAMP),
      (3, 1, 'Гулсим', 'gulsim@target.test', 'x', 'MANAGER', CURRENT_TIMESTAMP),
      (4, 1, 'Еркебулан', 'erkebulan@target.test', 'x', 'MEASURER', CURRENT_TIMESTAMP),
      (5, 1, 'Нурасыл', 'nurasyl@target.test', 'x', 'MEASURER', CURRENT_TIMESTAMP),
      (6, 2, 'Outside director', 'director@outside.test', 'x', 'DIRECTOR', CURRENT_TIMESTAMP),
      (7, 2, 'Outside employee', 'employee@outside.test', 'x', 'MANAGER', CURRENT_TIMESTAMP);

    INSERT INTO "Client" (
      id, "companyId", name, phone, city, manager, amount, status, "managerUserId", "updatedAt"
    ) VALUES
      (1, 1, 'Target client', '+77000000001', 'Алматы', 'Акбота', '2800000', 'Клиент', 2, CURRENT_TIMESTAMP),
      (2, 2, 'Outside client', '+77000000002', 'Астана', 'Outside employee', '150000', 'Клиент', 7, CURRENT_TIMESTAMP);

    INSERT INTO "Order" (
      id, "companyId", number, "clientId", address, staircase, material,
      amount, manager, "managerUserId", "orderReceivedAt", "updatedAt"
    ) VALUES
      (1, 1, 'TARGET-COMPANY', 1, 'A', 'Прямая', 'Металл', 2800000, 'Компания', 3, TIMESTAMP '2026-08-31 19:00:00', CURRENT_TIMESTAMP),
      (2, 1, 'TARGET-MANUAL', 1, 'B', 'Прямая', 'Металл', 2800000, 'Акбота', 2, TIMESTAMP '2026-09-11 07:00:00', CURRENT_TIMESTAMP),
      (3, 1, 'TARGET-SYSTEM', 1, 'C', 'Прямая', 'Металл', 2000000, 'Акбота', 2, TIMESTAMP '2026-09-12 07:00:00', CURRENT_TIMESTAMP),
      (4, 2, 'OUTSIDE-ORDER', 2, 'D', 'Прямая', 'Металл', 150000, 'Outside legacy label', NULL, TIMESTAMP '2026-09-12 07:00:00', CURRENT_TIMESTAMP),
      (5, 1, 'TARGET-AUGUST-COMPANY', 1, 'E', 'Прямая', 'Металл', 100000, 'Компания', 3, TIMESTAMP '2026-08-31 18:59:59.999', CURRENT_TIMESTAMP),
      (6, 1, 'TARGET-OCTOBER-COMPANY', 1, 'F', 'Прямая', 'Металл', 100000, 'company', 3, TIMESTAMP '2026-09-30 19:00:00', CURRENT_TIMESTAMP),
      (7, 1, 'TARGET-CORRECTED-MANUAL', 1, 'G', 'Прямая', 'Металл', 2800000, 'Акбота', 2, TIMESTAMP '2026-09-23 07:00:00', CURRENT_TIMESTAMP),
      (8, 1, 'TARGET-CORRECTED-AUTO', 1, 'H', 'Прямая', 'Металл', 2000000, 'Акбота', 2, TIMESTAMP '2026-09-24 07:00:00', CURRENT_TIMESTAMP),
      (9, 1, 'TARGET-NOVEMBER-MANUAL', 1, 'I', 'Прямая', 'Металл', 2000000, 'Акбота', 2, TIMESTAMP '2026-11-10 07:00:00', CURRENT_TIMESTAMP);

    INSERT INTO "EmployeePayrollProfile" (
      id, "companyId", "userId", name, position, "hiredAt", "baseSalary",
      "salaryPlanEnabled", "updatedAt"
    ) VALUES
      (1, 1, 1, 'Алихан', 'DIRECTOR', TIMESTAMP '2026-01-01 00:00:00', 400000, TRUE, CURRENT_TIMESTAMP),
      (2, 1, 2, 'Акбота', 'MANAGER', TIMESTAMP '2026-01-01 00:00:00', 200000, TRUE, CURRENT_TIMESTAMP),
      (3, 1, 3, 'Гулсим', 'MANAGER', TIMESTAMP '2026-01-01 00:00:00', 200000, TRUE, CURRENT_TIMESTAMP),
      (4, 1, 4, 'Еркебулан', 'Замерщик', TIMESTAMP '2026-01-01 00:00:00', 0, FALSE, CURRENT_TIMESTAMP),
      (5, 1, 5, 'Нурасыл', 'Замерщик', TIMESTAMP '2026-01-01 00:00:00', 0, FALSE, CURRENT_TIMESTAMP),
      (6, 2, 7, 'Outside employee', 'MANAGER', TIMESTAMP '2026-01-01 00:00:00', 150000, TRUE, CURRENT_TIMESTAMP);

    INSERT INTO "EmployeeSalaryRate" (
      id, "employeeId", amount, "planEnabled", "effectiveFrom", "effectiveTo", "approvedById", comment
    ) VALUES
      (1, 4, 0, FALSE, TIMESTAMP '2026-08-01 00:00:00', NULL, 1, 'legacy zero'),
      (2, 4, 0, FALSE, TIMESTAMP '2026-09-30 19:00:00', NULL, 1, 'disabled October'),
      (3, 5, 0, FALSE, TIMESTAMP '2026-08-01 00:00:00', NULL, 1, 'legacy zero'),
      (4, 5, 0, FALSE, TIMESTAMP '2026-09-30 19:00:00', NULL, 1, 'disabled October'),
      (5, 6, 150000, TRUE, TIMESTAMP '2026-01-01 00:00:00', NULL, 6, 'out of scope');

    INSERT INTO "PayrollPeriod" (
      id, "companyId", year, month, "updatedAt"
    ) VALUES
      (1, 1, 2026, 9, CURRENT_TIMESTAMP),
      (2, 1, 2026, 10, CURRENT_TIMESTAMP),
      (3, 2, 2026, 9, CURRENT_TIMESTAMP),
      (4, 1, 2026, 11, CURRENT_TIMESTAMP);

    INSERT INTO "PayrollAccrual" (
      id, "employeeId", "periodId", "earnedPeriodId", type, direction, amount, "orderId",
      reason, "approvedById", "createdById", "idempotencyKey",
      "orderBonusUniquenessKey", "requestHash", "createdAt"
    ) VALUES
      (1, 2, 1, NULL, 'BASE_SALARY', 'INCREASE', 200000, NULL, 'legacy salary', 1, 1, 'seed-salary-akbota', NULL, 'h1', TIMESTAMP '2026-09-30 12:00:00'),
      (2, 1, 1, 1, 'BASE_SALARY', 'INCREASE', 400000, NULL, 'legacy salary', 1, 1, 'seed-salary-alikhan', NULL, 'h2', TIMESTAMP '2026-09-30 12:00:00'),
      (3, 3, 1, NULL, 'ORDER_BONUS', 'INCREASE', 30000, 1, 'Автоматический бонус по сумме заказа', 1, 1, 'seed-company-bonus', 'company-bonus', 'h3', TIMESTAMP '2026-09-20 12:00:00'),
      (4, 2, 1, 2, 'ORDER_BONUS', 'INCREASE', 50000, 2, 'Ручной бонус менеджеру', 1, 1, 'seed-manual-bonus', 'manual-bonus', 'h4', TIMESTAMP '2026-09-21 12:00:00'),
      (5, 2, 1, 1, 'ORDER_BONUS', 'INCREASE', 30000, 3, 'Бонус за заказ', 1, 1, 'seed-system-bonus', 'system-bonus', 'h5', TIMESTAMP '2026-09-22 12:00:00'),
      (6, 6, 3, 3, 'BASE_SALARY', 'INCREASE', 150000, NULL, 'outside salary', 6, 6, 'seed-outside-salary', NULL, 'h6', TIMESTAMP '2026-09-30 12:00:00'),
      (7, 2, 1, 1, 'ORDER_BONUS', 'INCREASE', 30000, 7, 'Автоматический бонус до исправления', 1, 1, 'seed-corrected-manual-original', NULL, 'h7', TIMESTAMP '2026-09-23 09:00:00'),
      (8, 2, 1, 1, 'BONUS_REVERSAL', 'DECREASE', 30000, 7, 'Сторно бонуса перед исправлением', 1, 1, 'seed-corrected-manual-reversal', NULL, 'h8', TIMESTAMP '2026-09-23 10:00:00'),
      (9, 2, 1, 1, 'ORDER_BONUS', 'INCREASE', 50000, 7, 'Исправленный ручной бонус', 1, 1, 'seed-corrected-manual-replacement', 'corrected-manual-replacement', 'h9', TIMESTAMP '2026-09-23 10:00:01'),
      (10, 2, 1, 1, 'ORDER_BONUS', 'INCREASE', 30000, 8, 'Автоматический бонус до пересчёта', 1, 1, 'seed-corrected-auto-original', NULL, 'h10', TIMESTAMP '2026-09-24 09:00:00'),
      (11, 2, 1, 1, 'BONUS_REVERSAL', 'DECREASE', 30000, 8, 'Сторно бонуса перед автоматическим пересчётом', 1, 1, 'seed-corrected-auto-reversal', NULL, 'h11', TIMESTAMP '2026-09-24 10:00:00'),
      (12, 2, 1, 1, 'ORDER_BONUS', 'INCREASE', 30000, 8, 'Автоматически пересчитанный бонус', 1, 1, 'seed-corrected-auto-replacement', 'corrected-auto-replacement', 'h12', TIMESTAMP '2026-09-24 10:00:01'),
      (15, 2, 4, 4, 'ORDER_BONUS', 'INCREASE', 45000, 9, 'Будущий ручной бонус', 1, 1, 'seed-future-manual-bonus', 'future-manual-bonus', 'h15', TIMESTAMP '2026-11-10 10:00:00');

    UPDATE "PayrollAccrual" SET "reversalOfId" = 7 WHERE id = 8;
    UPDATE "PayrollAccrual" SET "reversalOfId" = 10 WHERE id = 11;

    INSERT INTO "PayrollAuditEvent" (
      id, action, "actorId", "periodId", "employeeId", "after", reason,
      "idempotencyKey", "createdAt"
    ) VALUES
      (
        1, 'PAYROLL_ACCRUAL_CREATED', 1, 1, 2,
        '{"accrualId":4,"type":"ORDER_BONUS","amount":50000,"manualOverride":true}'::jsonb,
        'Ручной бонус менеджеру', 'seed-manual-bonus:audit',
        TIMESTAMP '2026-09-21 12:00:00'
      ),
      (
        2, 'PAYROLL_ACCRUAL_CREATED', 1, 1, 2,
        '{"accrualId":5,"type":"ORDER_BONUS","amount":30000,"manualOverride":false}'::jsonb,
        'Бонус за заказ', 'seed-system-bonus:audit',
        TIMESTAMP '2026-09-22 12:00:00'
      ),
      (
        3, 'ORDER_BONUS_CORRECTED', 1, 1, 2,
        '{"reversalId":8,"accrualId":9,"periodId":1,"orderId":7,"amount":50000,"expectedOrderBonus":30000,"manualOverride":true}'::jsonb,
        'Исправленный ручной бонус', 'seed-corrected-manual-replacement:audit',
        TIMESTAMP '2026-09-23 10:00:01'
      ),
      (
        4, 'ORDER_BONUS_CORRECTED', 1, 1, 2,
        '{"reversalId":11,"accrualId":12,"periodId":1,"orderId":8,"amount":30000,"expectedOrderBonus":30000,"manualOverride":false}'::jsonb,
        'Автоматически пересчитанный бонус', 'seed-corrected-auto-replacement:audit',
        TIMESTAMP '2026-09-24 10:00:01'
      ),
      (
        5, 'PAYROLL_ACCRUAL_CREATED', 1, 4, 2,
        '{"accrualId":15,"type":"ORDER_BONUS","amount":45000,"manualOverride":true}'::jsonb,
        'Будущий ручной бонус', 'seed-future-manual-bonus:audit',
        TIMESTAMP '2026-11-10 10:00:00'
      );

    INSERT INTO "CompanyLedgerEntry" (
      id, "companyId", type, category, direction, source, amount,
      "operationDate", "employeeId", "authorId", "idempotencyKey",
      "requestHash", "affectsProfit", "payrollAccrualId", "updatedAt"
    ) VALUES
      (1, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 'PAYROLL_ACCRUAL', 200000, TIMESTAMP '2026-09-30 12:00:00', 2, 1, 'payroll-accrual:1', 'h1', TRUE, 1, CURRENT_TIMESTAMP),
      (2, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 'PAYROLL_ACCRUAL', 400000, TIMESTAMP '2026-09-30 12:00:00', 1, 1, 'payroll-accrual:2', 'h2', TRUE, 2, CURRENT_TIMESTAMP),
      (3, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 'PAYROLL_ACCRUAL', 30000, TIMESTAMP '2026-09-20 12:00:00', 3, 1, 'payroll-accrual:3', 'h3', TRUE, 3, CURRENT_TIMESTAMP),
      (4, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 'PAYROLL_ACCRUAL', 50000, TIMESTAMP '2026-09-21 12:00:00', 2, 1, 'payroll-accrual:4', 'h4', TRUE, 4, CURRENT_TIMESTAMP),
      (5, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 'PAYROLL_ACCRUAL', 30000, TIMESTAMP '2026-09-22 12:00:00', 2, 1, 'payroll-accrual:5', 'h5', TRUE, 5, CURRENT_TIMESTAMP),
      (6, 2, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 'PAYROLL_ACCRUAL', 150000, TIMESTAMP '2026-09-30 12:00:00', 6, 6, 'payroll-accrual:6', 'h6', TRUE, 6, CURRENT_TIMESTAMP),
      (7, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 'PAYROLL_ACCRUAL', 30000, TIMESTAMP '2026-09-23 09:00:00', 2, 1, 'payroll-accrual:7', 'h7', TRUE, 7, CURRENT_TIMESTAMP),
      (8, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'INCOME', 'PAYROLL_ACCRUAL', 30000, TIMESTAMP '2026-09-23 10:00:00', 2, 1, 'payroll-accrual:8', 'h8', TRUE, 8, CURRENT_TIMESTAMP),
      (9, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 'PAYROLL_ACCRUAL', 50000, TIMESTAMP '2026-09-23 10:00:01', 2, 1, 'payroll-accrual:9', 'h9', TRUE, 9, CURRENT_TIMESTAMP),
      (10, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 'PAYROLL_ACCRUAL', 30000, TIMESTAMP '2026-09-24 09:00:00', 2, 1, 'payroll-accrual:10', 'h10', TRUE, 10, CURRENT_TIMESTAMP),
      (11, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'INCOME', 'PAYROLL_ACCRUAL', 30000, TIMESTAMP '2026-09-24 10:00:00', 2, 1, 'payroll-accrual:11', 'h11', TRUE, 11, CURRENT_TIMESTAMP),
      (12, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 'PAYROLL_ACCRUAL', 30000, TIMESTAMP '2026-09-24 10:00:01', 2, 1, 'payroll-accrual:12', 'h12', TRUE, 12, CURRENT_TIMESTAMP),
      (13, 1, 'PAYROLL_ACCRUAL', 'SALARY', 'EXPENSE', 'PAYROLL_ACCRUAL', 45000, TIMESTAMP '2026-11-10 10:00:00', 2, 1, 'payroll-accrual:15', 'h15', TRUE, 15, CURRENT_TIMESTAMP);

    INSERT INTO "PayrollPayment" (
      id, "employeeId", "periodId", amount, "paymentDate", type, "paidById",
      "relatedAccrualId", "idempotencyKey", "requestHash"
    ) VALUES
      (1, 2, 1, 50000, TIMESTAMP '2026-09-15 10:00:00', 'ADVANCE', 1, 1, 'seed-payment-akbota', 'p1'),
      (2, 1, 1, 83001, TIMESTAMP '2026-09-16 10:00:00', 'ADVANCE', 1, NULL, 'seed-payment-alikhan', 'p2'),
      (3, 6, 3, 77000, TIMESTAMP '2026-09-16 10:00:00', 'ADVANCE', 6, NULL, 'seed-payment-outside', 'p3'),
      (4, 2, 2, 10000, TIMESTAMP '2026-10-15 10:00:00', 'ADVANCE', 1, NULL, 'seed-payment-october', 'p4');

    SELECT setval(pg_get_serial_sequence('"Company"', 'id'), 2, TRUE);
    SELECT setval(pg_get_serial_sequence('"User"', 'id'), 7, TRUE);
    SELECT setval(pg_get_serial_sequence('"Client"', 'id'), 2, TRUE);
    SELECT setval(pg_get_serial_sequence('"Order"', 'id'), 9, TRUE);
    SELECT setval(pg_get_serial_sequence('"EmployeePayrollProfile"', 'id'), 6, TRUE);
    SELECT setval(pg_get_serial_sequence('"EmployeeSalaryRate"', 'id'), 5, TRUE);
    SELECT setval(pg_get_serial_sequence('"PayrollPeriod"', 'id'), 4, TRUE);
    SELECT setval(pg_get_serial_sequence('"PayrollAccrual"', 'id'), 15, TRUE);
    SELECT setval(pg_get_serial_sequence('"CompanyLedgerEntry"', 'id'), 13, TRUE);
    SELECT setval(pg_get_serial_sequence('"PayrollPayment"', 'id'), 4, TRUE);
    SELECT setval(pg_get_serial_sequence('"PayrollAuditEvent"', 'id'), 5, TRUE);
  `);

  // The legacy schema permits independent foreign keys to point across
  // tenants. The migration must reject both an outside employee in the target
  // period and an outside order on a target employee, with its whole
  // transaction rolled back.
  await db.exec(`
    INSERT INTO "PayrollAccrual" (
      id, "employeeId", "periodId", "earnedPeriodId", type, direction, amount,
      "orderId", reason, "approvedById", "createdById", "idempotencyKey",
      "orderBonusUniquenessKey", "requestHash", "createdAt"
    ) VALUES
      (13, 6, 1, 1, 'BASE_SALARY', 'INCREASE', 1, NULL,
       'cross-tenant employee fixture', 1, 1, 'cross-tenant-employee', NULL,
       'cross-tenant-employee', TIMESTAMP '2026-09-23 12:00:00'),
      (14, 2, 1, 1, 'ORDER_BONUS', 'INCREASE', 1, 4,
       'cross-tenant order fixture', 1, 1, 'cross-tenant-order',
       'cross-tenant-order', 'cross-tenant-order',
       TIMESTAMP '2026-09-24 12:00:00');
  `);
  const beforeRejectedMigration = await one(`
    SELECT
      (SELECT COUNT(*)::int FROM "PayrollAccrual") AS accruals,
      (SELECT COUNT(*)::int FROM "CompanyLedgerEntry") AS ledger,
      (SELECT COUNT(*)::int FROM "PayrollAuditEvent") AS audits,
      (SELECT COUNT(*)::int FROM "PayrollPayment") AS payments,
      (SELECT "managerUserId" FROM "Order" WHERE id = 1) AS "companyOrderManager"
  `);
  await assert.rejects(db.exec(migration), /cross tenant boundary/);
  await db.exec("ROLLBACK");
  assert.deepEqual(await one(`
    SELECT
      (SELECT COUNT(*)::int FROM "PayrollAccrual") AS accruals,
      (SELECT COUNT(*)::int FROM "CompanyLedgerEntry") AS ledger,
      (SELECT COUNT(*)::int FROM "PayrollAuditEvent") AS audits,
      (SELECT COUNT(*)::int FROM "PayrollPayment") AS payments,
      (SELECT "managerUserId" FROM "Order" WHERE id = 1) AS "companyOrderManager"
  `), beforeRejectedMigration);
  assert.deepEqual(await one(`
    SELECT
      to_regclass('"PayrollOrderBonusDecision"')::text AS decisions,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'Order'
          AND column_name = 'responsibleType'
      ) AS responsibility
  `), { decisions: null, responsibility: false });
  await db.exec(`DELETE FROM "PayrollAccrual" WHERE id IN (13, 14)`);

  const paymentsBeforeMigration = await septemberPaymentSnapshot();
  await db.exec(migration);

  assert.deepEqual(await one(`
    SELECT "responsibleType"::text AS type, "managerUserId" AS manager, manager AS label
    FROM "Order" WHERE id = 1
  `), { type: "COMPANY", manager: null, label: "Компания" });
  assert.deepEqual(await one(`
    SELECT "responsibleType"::text AS type, "managerUserId" AS manager
    FROM "Order" WHERE id = 2
  `), { type: "EMPLOYEE", manager: 2 });
  assert.deepEqual(await one(`
    SELECT "responsibleType"::text AS type, "managerUserId" AS manager,
           manager AS label
    FROM "Order" WHERE id = 4
  `), {
    type: "COMPANY",
    manager: null,
    label: "Outside legacy label",
  });
  assert.deepEqual(await one(`
    SELECT "responsibleType"::text AS type, "managerUserId" AS "managerId",
           manager AS label
    FROM "Order" WHERE id = 5
  `), { type: "COMPANY", managerId: null, label: "Компания" });
  assert.deepEqual(await one(`
    SELECT "responsibleType"::text AS type, "managerUserId" AS "managerId",
           manager AS label
    FROM "Order" WHERE id = 6
  `), { type: "COMPANY", managerId: null, label: "Компания" });

  assert.deepEqual(await one(`
    SELECT "orderId" AS "orderId", "employeeId" AS "employeeId",
           "manualAmount"::text AS amount
    FROM "PayrollOrderBonusDecision" WHERE "orderId" = 2
  `), { orderId: 2, employeeId: 2, amount: "50000.00" });
  assert.deepEqual(await one(`
    SELECT "orderId" AS "orderId", "employeeId" AS "employeeId",
           "manualAmount"::text AS amount
    FROM "PayrollOrderBonusDecision" WHERE "orderId" = 7
  `), { orderId: 7, employeeId: 2, amount: "50000.00" });
  assert.equal(
    await count(`SELECT COUNT(*) FROM "PayrollOrderBonusDecision" WHERE "orderId" IN (1, 3, 8)`),
    0,
  );
  assert.deepEqual(await one(`
    SELECT
      COUNT(*) FILTER (WHERE accrual.id = 15)::int AS original,
      COUNT(*) FILTER (WHERE accrual."reversalOfId" = 15)::int AS reversals,
      (SELECT COUNT(*)::int FROM "PayrollOrderBonusDecision" decision
       WHERE decision."orderId" = 9) AS decisions
    FROM "PayrollAccrual" accrual
  `), { original: 1, reversals: 0, decisions: 0 });

  assert.equal(await count(`
    SELECT COUNT(*)
    FROM "PayrollAccrual" accrual
    JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
    WHERE period."companyId" = 1 AND period.year = 2026 AND period.month = 9
      AND accrual.type = 'BASE_SALARY' AND accrual.direction = 'INCREASE'
      AND accrual."reversalOfId" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "PayrollAccrual" reversal
        WHERE reversal."reversalOfId" = accrual.id
      )
  `), 0);
  assert.equal(await count(`
    SELECT COUNT(*)
    FROM "PayrollAccrual" accrual
    JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
    WHERE period."companyId" = 1 AND period.year = 2026 AND period.month = 9
      AND accrual.type IN ('ORDER_BONUS', 'GUARANTEED_ORDER_BONUS')
      AND accrual.direction = 'INCREASE' AND accrual."reversalOfId" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "PayrollAccrual" reversal
        WHERE reversal."reversalOfId" = accrual.id
      )
  `), 0);
  assert.equal(await count(`
    SELECT COUNT(*)
    FROM "PayrollAccrual" original
    JOIN "PayrollAccrual" reversal
      ON reversal."reversalOfId" = original.id
    WHERE original.id IN (1, 2, 3, 4, 5, 9, 12)
      AND reversal.type = 'BONUS_REVERSAL'
      AND reversal.direction = 'DECREASE'
      AND reversal.amount = original.amount
      AND reversal."employeeId" = original."employeeId"
      AND reversal."periodId" = original."periodId"
      AND reversal."earnedPeriodId" = COALESCE(original."earnedPeriodId", original."periodId")
      AND reversal."orderId" IS NOT DISTINCT FROM original."orderId"
  `), 7);
  assert.equal(await count(`
    SELECT COUNT(*) FROM "PayrollAccrual"
    WHERE "reversalOfId" = 4 AND "periodId" = 1 AND "earnedPeriodId" = 2
  `), 1);
  assert.equal(await count(`
    SELECT COUNT(*)
    FROM "PayrollAccrual" reversal
    JOIN "CompanyLedgerEntry" reversal_ledger
      ON reversal_ledger."payrollAccrualId" = reversal.id
    JOIN "CompanyLedgerEntry" original_ledger
      ON original_ledger."payrollAccrualId" = reversal."reversalOfId"
    WHERE reversal."reversalOfId" IN (1, 2, 3, 4, 5, 9, 12)
      AND reversal_ledger.direction = 'INCOME'
      AND reversal_ledger."companyId" = original_ledger."companyId"
      AND reversal_ledger.amount = original_ledger.amount
      AND reversal_ledger."employeeId" = original_ledger."employeeId"
      AND reversal_ledger."operationDate" = original_ledger."operationDate"
      AND reversal_ledger."affectsProfit" = original_ledger."affectsProfit"
  `), 7);
  assert.equal(await count(`
    SELECT COUNT(*) FROM "PayrollPayment"
    WHERE id = 1 AND "relatedAccrualId" = 1 AND amount = 50000
  `), 1);
  assert.equal(await count(`
    SELECT COUNT(*) FROM "PayrollAccrual" accrual
    JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
    WHERE period."companyId" = 2 AND accrual.id = 6
      AND NOT EXISTS (SELECT 1 FROM "PayrollAccrual" reversal WHERE reversal."reversalOfId" = accrual.id)
  `), 1);

  assert.deepEqual(
    await septemberPaymentSnapshot(),
    paymentsBeforeMigration,
  );

  assert.equal(await count(`
    SELECT COUNT(*)
    FROM "EmployeePayrollProfile" profile
    WHERE profile.id IN (4, 5)
      AND profile."hiredAt" = TIMESTAMP '2026-01-01 00:00:00'
      AND profile."baseSalary" = 0
      AND profile."salaryPlanEnabled" = FALSE
      AND NOT EXISTS (
        SELECT 1 FROM "EmployeeSalaryRate" rate
        WHERE rate."employeeId" = profile.id
          AND rate."planEnabled" = TRUE
      )
  `), 2);

  // Legacy writers omit responsibleType. The trigger must derive it before
  // the CHECK runs, including removal of a stale employee id for Company.
  await db.exec(`
    INSERT INTO "Order" (
      "companyId", number, "clientId", address, staircase, material,
      amount, manager, "managerUserId", "orderReceivedAt", "updatedAt"
    ) VALUES
      (1, 'POST-MIGRATION-EMPLOYEE', 1, 'E', 'Прямая', 'Металл', 100000, 'Акбота', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      (1, 'POST-MIGRATION-COMPANY', 1, 'F', 'Прямая', 'Металл', 100000, 'company', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
  `);
  assert.equal(await count(`
    SELECT COUNT(*) FROM "Order"
    WHERE number = 'POST-MIGRATION-EMPLOYEE'
      AND "responsibleType" = 'EMPLOYEE' AND "managerUserId" = 2
  `), 1);
  assert.equal(await count(`
    SELECT COUNT(*) FROM "Order"
    WHERE number = 'POST-MIGRATION-COMPANY'
      AND "responsibleType" = 'COMPANY' AND "managerUserId" IS NULL
      AND manager = 'Компания'
  `), 1);

  assert.equal(await count(`
    SELECT COUNT(*) FROM pg_constraint
    WHERE conname IN (
      'Order_responsibleType_managerUserId_check',
      'PayrollOrderBonusDecision_manualAmount_check'
    ) AND convalidated
  `), 2);
  await assert.rejects(
    db.exec(`
      INSERT INTO "PayrollOrderBonusDecision" (
        "companyId", "orderId", "employeeId", "manualAmount", "updatedById"
      ) VALUES (1, 4, 2, 10000, 1)
    `),
    /crosses tenant boundary/,
  );

  await db.exec(`
    INSERT INTO "PayrollPayment" (
      "employeeId", "periodId", amount, "paymentDate", type, "paidById",
      "idempotencyKey", "requestHash"
    ) VALUES (
      3, 1, 7000, TIMESTAMP '2026-09-25 10:00:00', 'ADVANCE', 1,
      'later-legitimate-payment', 'later-legitimate-payment'
    );
  `);
  const paymentsBeforeReplay = await septemberPaymentSnapshot();
  const beforeReplay = await one(`
    SELECT
      (SELECT COUNT(*)::int FROM "PayrollAccrual") AS accruals,
      (SELECT COUNT(*)::int FROM "CompanyLedgerEntry") AS ledger,
      (SELECT COUNT(*)::int FROM "PayrollAuditEvent") AS audits,
      (SELECT COUNT(*)::int FROM "PayrollOrderBonusDecision") AS decisions,
      (SELECT COUNT(*)::int FROM "EmployeeSalaryRate") AS rates,
      (SELECT COUNT(*)::int FROM "PayrollPayment") AS payments
  `);
  const beforeReplayProfiles = await db.query(`
    SELECT id, "hiredAt", "baseSalary"::text, "salaryPlanEnabled", "updatedAt"
    FROM "EmployeePayrollProfile"
    WHERE id IN (4, 5)
    ORDER BY id
  `);
  const beforeReplayOrders = await db.query(`
    SELECT id, manager, "managerUserId", "responsibleType"::text
    FROM "Order"
    ORDER BY id
  `);
  const beforeReplayDecisions = await db.query(`
    SELECT "companyId", "orderId", "employeeId", "manualAmount"::text,
           "updatedById", "createdAt", "updatedAt"
    FROM "PayrollOrderBonusDecision"
    ORDER BY "orderId", "employeeId"
  `);
  await db.exec(migration);
  const afterReplay = await one(`
    SELECT
      (SELECT COUNT(*)::int FROM "PayrollAccrual") AS accruals,
      (SELECT COUNT(*)::int FROM "CompanyLedgerEntry") AS ledger,
      (SELECT COUNT(*)::int FROM "PayrollAuditEvent") AS audits,
      (SELECT COUNT(*)::int FROM "PayrollOrderBonusDecision") AS decisions,
      (SELECT COUNT(*)::int FROM "EmployeeSalaryRate") AS rates,
      (SELECT COUNT(*)::int FROM "PayrollPayment") AS payments
  `);
  assert.deepEqual(afterReplay, beforeReplay);
  const afterReplayProfiles = await db.query(`
    SELECT id, "hiredAt", "baseSalary"::text, "salaryPlanEnabled", "updatedAt"
    FROM "EmployeePayrollProfile"
    WHERE id IN (4, 5)
    ORDER BY id
  `);
  assert.deepEqual(afterReplayProfiles.rows, beforeReplayProfiles.rows);
  const afterReplayOrders = await db.query(`
    SELECT id, manager, "managerUserId", "responsibleType"::text
    FROM "Order"
    ORDER BY id
  `);
  assert.deepEqual(afterReplayOrders.rows, beforeReplayOrders.rows);
  const afterReplayDecisions = await db.query(`
    SELECT "companyId", "orderId", "employeeId", "manualAmount"::text,
           "updatedById", "createdAt", "updatedAt"
    FROM "PayrollOrderBonusDecision"
    ORDER BY "orderId", "employeeId"
  `);
  assert.deepEqual(afterReplayDecisions.rows, beforeReplayDecisions.rows);
  assert.deepEqual(
    await septemberPaymentSnapshot(),
    paymentsBeforeReplay,
  );

  console.log("Payroll migration replay test passed");
} finally {
  await db.close();
}
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
