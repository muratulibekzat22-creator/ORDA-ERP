import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  resolve(
    "prisma/migrations/20261004123000_payroll_september_nonparticipant_rates/migration.sql",
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
  FROM "PayrollPeriod" period
  JOIN "Company" company ON company.id = period."companyId"
  LEFT JOIN "PayrollPayment" payment
    ON payment."periodId" = period.id
    AND payment."reversalOfId" IS NULL
    AND payment."reversedAt" IS NULL
  WHERE company.slug = 'altyn-sapa-company'
    AND period.year = 2026
    AND period.month = 9
`);

async function main() {
  try {
    await db.exec(schemaSql);
    await db.exec(`
      INSERT INTO "Company" (id, slug, name, "updatedAt") VALUES
        (1, 'altyn-sapa-company', 'ALTYN SAPA', CURRENT_TIMESTAMP),
        (2, 'outside-company', 'OUTSIDE', CURRENT_TIMESTAMP);

      INSERT INTO "User" (
        id, "companyId", name, email, password, role, "updatedAt"
      ) VALUES
        (1, 1, 'Бекзат', 'founder@target.test', 'x', 'DIRECTOR', CURRENT_TIMESTAMP),
        (2, 1, 'Маркетолог ALTYN SAPA', 'marketer@target.test', 'x', 'MARKETER', CURRENT_TIMESTAMP),
        (3, 1, 'Алихан', 'operations@target.test', 'x', 'OPERATIONS_DIRECTOR', CURRENT_TIMESTAMP),
        (4, 1, 'Акбота', 'manager@target.test', 'x', 'MANAGER', CURRENT_TIMESTAMP),
        (5, 2, 'Outside founder', 'founder@outside.test', 'x', 'DIRECTOR', CURRENT_TIMESTAMP),
        (6, 1, 'Второй маркетолог', 'marketer-2@target.test', 'x', 'MARKETER', CURRENT_TIMESTAMP);

      INSERT INTO "EmployeePayrollProfile" (
        id, "companyId", "userId", name, position, "hiredAt", "baseSalary",
        "salaryPlanEnabled", "updatedAt"
      ) VALUES
        (1, 1, 1, 'Бекзат', 'DIRECTOR', TIMESTAMP '2026-08-22 00:00:00', 735000.55, TRUE, CURRENT_TIMESTAMP),
        (2, 1, 2, 'Маркетолог ALTYN SAPA', 'MARKETER', TIMESTAMP '2026-08-22 00:00:00', 412345.67, TRUE, CURRENT_TIMESTAMP),
        (3, 1, 3, 'Алихан', 'OPERATIONS_DIRECTOR', TIMESTAMP '2026-08-01 00:00:00', 400000, TRUE, CURRENT_TIMESTAMP),
        (4, 1, 4, 'Акбота', 'MANAGER', TIMESTAMP '2026-08-01 00:00:00', 200000, TRUE, CURRENT_TIMESTAMP),
        (5, 2, 5, 'Outside founder', 'DIRECTOR', TIMESTAMP '2026-08-01 00:00:00', 900000, TRUE, CURRENT_TIMESTAMP),
        (6, 1, 6, 'Второй маркетолог', 'MARKETER', TIMESTAMP '2026-08-15 00:00:00', 123456.78, TRUE, CURRENT_TIMESTAMP);

      INSERT INTO "EmployeeSalaryRate" (
        id, "employeeId", amount, "planEnabled", "effectiveFrom", "effectiveTo",
        "approvedById", comment
      ) VALUES
        (1, 1, 735000.55, TRUE, TIMESTAMP '2026-08-22 00:00:00', NULL, 1, 'Founder salary'),
        (2, 2, 412345.67, TRUE, TIMESTAMP '2026-08-22 00:00:00', NULL, 1, 'Marketer salary'),
        (3, 3, 400000, TRUE, TIMESTAMP '2026-08-01 00:00:00', NULL, 1, 'Operations salary'),
        (4, 4, 200000, TRUE, TIMESTAMP '2026-08-01 00:00:00', NULL, 1, 'Manager salary'),
        (5, 5, 900000, TRUE, TIMESTAMP '2026-08-01 00:00:00', NULL, 5, 'Outside salary'),
        (6, 6, 123456.78, TRUE, TIMESTAMP '2026-08-15 00:00:00', NULL, 1, 'Second marketer salary');

      INSERT INTO "PayrollPeriod" (
        id, "companyId", year, month, "updatedAt"
      ) VALUES
        (1, 1, 2026, 9, CURRENT_TIMESTAMP),
        (2, 1, 2026, 10, CURRENT_TIMESTAMP),
        (3, 2, 2026, 9, CURRENT_TIMESTAMP);

      INSERT INTO "PayrollPayment" (
        id, "employeeId", "periodId", amount, "paymentDate", type, "paidById",
        "idempotencyKey", "requestHash"
      ) VALUES
        (1, 4, 1, 50000, TIMESTAMP '2026-09-15 10:00:00', 'ADVANCE', 1, 'akbota-advance', 'p1'),
        (2, 3, 1, 83001, TIMESTAMP '2026-09-16 10:00:00', 'ADVANCE', 1, 'alikhan-advance', 'p2');

      SELECT setval(pg_get_serial_sequence('"EmployeeSalaryRate"', 'id'), 6, TRUE);
      SELECT setval(pg_get_serial_sequence('"PayrollPayment"', 'id'), 2, TRUE);
    `);

    // A profile with a factual September payment is out of scope. It must be
    // skipped without preventing other independently qualified profiles from
    // being repaired.
    await db.exec(`
      INSERT INTO "PayrollPayment" (
        id, "employeeId", "periodId", amount, "paymentDate", type, "paidById",
        "idempotencyKey", "requestHash"
      ) VALUES
        (3, 2, 1, 1, TIMESTAMP '2026-09-20 10:00:00', 'ADVANCE', 1,
         'marketer-factual-payment', 'p3');
    `);
    await db.exec(migration);
    assert.deepEqual(await one(`
      SELECT
        COUNT(*) FILTER (WHERE "employeeId" = 1)::int AS founder,
        COUNT(*) FILTER (WHERE "employeeId" = 2)::int AS paid_marketer,
        COUNT(*) FILTER (WHERE "employeeId" = 6)::int AS second_marketer
      FROM "PayrollAuditEvent"
      WHERE action = 'SALARY_PERIOD_EXCLUDED'
    `), { founder: 1, paid_marketer: 0, second_marketer: 1 });
    assert.deepEqual(await one(`
      SELECT COUNT(*)::int AS count, MIN(amount)::text AS amount
      FROM "EmployeeSalaryRate"
      WHERE "employeeId" = 2 AND "effectiveTo" IS NULL
    `), { count: 1, amount: "412345.67" });

    await db.exec(`DELETE FROM "PayrollPayment" WHERE id = 3`);

    // Ambiguous saved conditions fail atomically; the migration never guesses
    // which amount should be copied.
    await db.exec(`
      INSERT INTO "EmployeeSalaryRate" (
        id, "employeeId", amount, "planEnabled", "effectiveFrom", "effectiveTo",
        "approvedById", comment
      ) VALUES
        (20, 2, 999999.99, TRUE, TIMESTAMP '2026-08-25 00:00:00', NULL, 1,
         'Ambiguous overlapping condition');
    `);
    const beforeRejectedRun = await db.query(`
      SELECT id, "employeeId", amount::text, "planEnabled", "effectiveFrom", "effectiveTo"
      FROM "EmployeeSalaryRate" ORDER BY id
    `);
    await assert.rejects(
      db.exec(migration),
      /Expected one saved salary condition spanning September/,
    );
    await db.exec("ROLLBACK");
    const afterRejectedRun = await db.query(`
      SELECT id, "employeeId", amount::text, "planEnabled", "effectiveFrom", "effectiveTo"
      FROM "EmployeeSalaryRate" ORDER BY id
    `);
    assert.deepEqual(afterRejectedRun.rows, beforeRejectedRun.rows);
    await db.exec(`DELETE FROM "EmployeeSalaryRate" WHERE id = 20`);

    const protectedBefore = await db.query(`
      SELECT id, "employeeId", amount::text, "planEnabled", "effectiveFrom", "effectiveTo", comment
      FROM "EmployeeSalaryRate" WHERE "employeeId" IN (3, 4, 5) ORDER BY id
    `);
    const profilesBefore = await db.query(`
      SELECT id, "baseSalary"::text, "salaryPlanEnabled", "hiredAt", "updatedAt"
      FROM "EmployeePayrollProfile" ORDER BY id
    `);

    const paymentsBeforeMigration = await septemberPaymentSnapshot();
    await db.exec(migration);

    assert.deepEqual(
      await septemberPaymentSnapshot(),
      paymentsBeforeMigration,
    );

    assert.deepEqual(await one(`
      SELECT
        COUNT(*) FILTER (
          WHERE amount = 0 AND "planEnabled" = FALSE
            AND "effectiveFrom" = TIMESTAMP '2026-08-31 19:00:00'
            AND "effectiveTo" = TIMESTAMP '2026-09-30 19:00:00'
        )::int AS "septemberZeroRates",
        COUNT(*) FILTER (
          WHERE "effectiveFrom" = TIMESTAMP '2026-09-30 19:00:00'
            AND "planEnabled" = TRUE
        )::int AS "octoberRestoredRates"
      FROM "EmployeeSalaryRate" WHERE "employeeId" IN (1, 2, 6)
    `), { septemberZeroRates: 3, octoberRestoredRates: 3 });

    assert.deepEqual(await one(`
      SELECT
        COUNT(*) FILTER (WHERE "employeeId" = 1 AND amount = 735000.55)::int AS founder,
        COUNT(*) FILTER (WHERE "employeeId" = 2 AND amount = 412345.67)::int AS marketer,
        COUNT(*) FILTER (WHERE "employeeId" = 6 AND amount = 123456.78)::int AS second_marketer
      FROM "EmployeeSalaryRate"
      WHERE "effectiveTo" = TIMESTAMP '2026-08-31 19:00:00'
    `), { founder: 1, marketer: 1, second_marketer: 1 });

    assert.deepEqual(await one(`
      SELECT COUNT(*)::int AS count
      FROM "PayrollAuditEvent"
      WHERE action = 'SALARY_PERIOD_EXCLUDED'
        AND "employeeId" IN (1, 2, 6)
    `), { count: 3 });

    const protectedAfter = await db.query(`
      SELECT id, "employeeId", amount::text, "planEnabled", "effectiveFrom", "effectiveTo", comment
      FROM "EmployeeSalaryRate" WHERE "employeeId" IN (3, 4, 5) ORDER BY id
    `);
    assert.deepEqual(protectedAfter.rows, protectedBefore.rows);
    const profilesAfter = await db.query(`
      SELECT id, "baseSalary"::text, "salaryPlanEnabled", "hiredAt", "updatedAt"
      FROM "EmployeePayrollProfile" ORDER BY id
    `);
    assert.deepEqual(profilesAfter.rows, profilesBefore.rows);

    // A factual payment may legitimately be registered after the migration.
    // Replaying the idempotent migration must preserve the then-current state
    // instead of comparing it with a deployment-time magic total.
    await db.exec(`
      INSERT INTO "PayrollPayment" (
        "employeeId", "periodId", amount, "paymentDate", type, "paidById",
        "idempotencyKey", "requestHash"
      ) VALUES (
        4, 1, 7000, TIMESTAMP '2026-09-25 10:00:00', 'ADVANCE', 1,
        'later-legitimate-advance', 'later-payment'
      );
    `);
    const paymentsBeforeReplay = await septemberPaymentSnapshot();

    // Legitimate later HR changes must not make an already-applied historical
    // repair run again or try to rediscover its former role/rate.
    await db.exec(`
      UPDATE "User" SET role = 'MANAGER' WHERE id = 1;
      UPDATE "EmployeePayrollProfile"
      SET "baseSalary" = 888888.88, position = 'MANAGER', "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = 1;
      UPDATE "EmployeeSalaryRate"
      SET "effectiveTo" = TIMESTAMP '2026-10-15 00:00:00'
      WHERE "employeeId" = 1
        AND "effectiveFrom" = TIMESTAMP '2026-09-30 19:00:00';
      INSERT INTO "EmployeeSalaryRate" (
        "employeeId", amount, "planEnabled", "effectiveFrom", "effectiveTo",
        "approvedById", comment
      ) VALUES (
        1, 888888.88, TRUE, TIMESTAMP '2026-10-15 00:00:00', NULL, 1,
        'Later legitimate salary change'
      );
    `);

    const beforeReplay = await db.query(`
      SELECT id, "employeeId", amount::text, "planEnabled", "effectiveFrom", "effectiveTo",
             "approvedById", comment, "createdAt"
      FROM "EmployeeSalaryRate" ORDER BY id
    `);
    const auditsBeforeReplay = await db.query(`
      SELECT action, "actorId", "periodId", "employeeId", before, after, reason,
             "idempotencyKey", "createdAt"
      FROM "PayrollAuditEvent" ORDER BY id
    `);
    await db.exec(migration);
    const afterReplay = await db.query(`
      SELECT id, "employeeId", amount::text, "planEnabled", "effectiveFrom", "effectiveTo",
             "approvedById", comment, "createdAt"
      FROM "EmployeeSalaryRate" ORDER BY id
    `);
    const auditsAfterReplay = await db.query(`
      SELECT action, "actorId", "periodId", "employeeId", before, after, reason,
             "idempotencyKey", "createdAt"
      FROM "PayrollAuditEvent" ORDER BY id
    `);
    assert.deepEqual(afterReplay.rows, beforeReplay.rows);
    assert.deepEqual(auditsAfterReplay.rows, auditsBeforeReplay.rows);
    assert.deepEqual(
      await septemberPaymentSnapshot(),
      paymentsBeforeReplay,
    );

    console.log("September non-participant salary-rate migration test passed");
  } finally {
    await db.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
