import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";

const migrationPath = resolve(
  "prisma/migrations/20261004150000_revoke_unverified_measurer_salary_autofill/migration.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const sourceMigration = readFileSync(
  resolve(
    "prisma/migrations/20261004110000_payroll_accounting_source_of_truth/migration.sql",
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

assert.doesNotMatch(
  sourceMigration,
  /Еркебулан|Нурасыл|еркебулан|нурасыл|erkebulan|nurasyl|200000|200 000/u,
  "the fresh 11:00 migration must not identify employees by name or invent a salary",
);
assert.match(
  sourceMigration,
  /company\.slug = 'altyn-sapa-company'[\s\S]*IN \('компания', 'company'\)/,
  "company-labelled orders must be normalized for the target tenant across all dates",
);
assert.doesNotMatch(
  migration,
  /Еркебулан|Нурасыл|Кокбай/u,
  "the correction must use the source audit marker, not employee names",
);
assert.doesNotMatch(
  migration,
  /UPDATE\s+"Payroll(?:Accrual|Payment|PaymentConfirmation)"/u,
  "the correction must never rewrite accounting operations",
);

const db = new PGlite();

async function one(sql: string) {
  const result = await db.query<Record<string, unknown>>(sql);
  assert.equal(result.rows.length, 1, `Expected one row for query:\n${sql}`);
  return result.rows[0];
}

async function rows(sql: string) {
  return (await db.query<Record<string, unknown>>(sql)).rows;
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
    await db.exec(schemaSql);
    await db.exec(`
      INSERT INTO "Company" (id, slug, name, "updatedAt") VALUES
        (1, 'altyn-sapa-company', 'ALTYN SAPA', CURRENT_TIMESTAMP),
        (2, 'outside-company', 'OUTSIDE', CURRENT_TIMESTAMP);

      INSERT INTO "User" (
        id, "companyId", name, email, password, role, "updatedAt"
      ) VALUES
        (1, 1, 'Алихан', 'director@target.test', 'x', 'DIRECTOR', CURRENT_TIMESTAMP),
        (2, 1, 'Первый замерщик', 'first@target.test', 'x', 'MEASURER', CURRENT_TIMESTAMP),
        (3, 1, 'Второй замерщик', 'second@target.test', 'x', 'MEASURER', CURRENT_TIMESTAMP),
        (4, 1, 'Акбота', 'manager@target.test', 'x', 'MANAGER', CURRENT_TIMESTAMP),
        (5, 2, 'Outside director', 'director@outside.test', 'x', 'DIRECTOR', CURRENT_TIMESTAMP),
        (6, 2, 'Outside employee', 'employee@outside.test', 'x', 'MEASURER', CURRENT_TIMESTAMP);

      INSERT INTO "Client" (
        id, "companyId", name, phone, city, manager, amount, status,
        "managerUserId", "updatedAt"
      ) VALUES
        (1, 1, 'Target client', '+77000000001', 'Алматы', 'Акбота', '100000', 'Клиент', 4, CURRENT_TIMESTAMP),
        (2, 2, 'Outside client', '+77000000002', 'Астана', 'Outside', '100000', 'Клиент', NULL, CURRENT_TIMESTAMP);

      INSERT INTO "Order" (
        id, "companyId", number, "clientId", address, staircase, material,
        amount, manager, "managerUserId", "responsibleType",
        "orderReceivedAt", "updatedAt"
      ) VALUES
        (1, 1, 'TARGET-COMPANY', 1, 'A', 'Прямая', 'Металл', 100000,
         'Компания', NULL, 'COMPANY', TIMESTAMP '2026-09-30 18:59:59.999', CURRENT_TIMESTAMP),
        (2, 1, 'TARGET-EMPLOYEE', 1, 'B', 'Прямая', 'Металл', 100000,
         'Акбота', 4, 'EMPLOYEE', TIMESTAMP '2026-09-30 19:00:00', CURRENT_TIMESTAMP),
        (3, 2, 'OUTSIDE-UNCHANGED', 2, 'C', 'Прямая', 'Металл', 100000,
         'Legacy outside', 6, 'COMPANY', TIMESTAMP '2026-09-30 19:00:00', CURRENT_TIMESTAMP);

      INSERT INTO "EmployeePayrollProfile" (
        id, "companyId", "userId", name, position, "hiredAt", "baseSalary",
        "salaryPlanEnabled", "updatedAt"
      ) VALUES
        (1, 1, 1, 'Алихан', 'DIRECTOR', TIMESTAMP '2026-01-01 00:00:00', 400000, TRUE, CURRENT_TIMESTAMP),
        (2, 1, 2, 'Первый замерщик', 'Замерщик', TIMESTAMP '2026-09-30 19:00:00', 200000, TRUE, CURRENT_TIMESTAMP),
        (3, 1, 3, 'Второй замерщик', 'MEASURER', TIMESTAMP '2026-09-30 19:00:00', 200000, TRUE, CURRENT_TIMESTAMP),
        (4, 1, 4, 'Акбота', 'MANAGER', TIMESTAMP '2026-01-01 00:00:00', 200000, TRUE, CURRENT_TIMESTAMP),
        (5, 2, 6, 'Outside employee', 'MEASURER', TIMESTAMP '2026-01-01 00:00:00', 200000, TRUE, CURRENT_TIMESTAMP);

      INSERT INTO "EmployeeSalaryRate" (
        id, "employeeId", amount, "planEnabled", "effectiveFrom", "effectiveTo",
        "approvedById", comment, "createdAt"
      ) VALUES
        (1, 2, 0, FALSE, TIMESTAMP '2026-01-01 00:00:00', TIMESTAMP '2026-09-30 19:00:00', 1, 'Earlier disabled condition', TIMESTAMP '2026-01-01 00:00:00'),
        (2, 2, 200000, TRUE, TIMESTAMP '2026-09-30 19:00:00', NULL, 1, 'Оклад 200 000 ₸ действует с 01.10.2026 Asia/Almaty', TIMESTAMP '2026-10-04 11:00:00'),
        (3, 3, 0, FALSE, TIMESTAMP '2026-01-01 00:00:00', TIMESTAMP '2026-09-30 19:00:00', 1, 'Earlier disabled condition', TIMESTAMP '2026-01-01 00:00:00'),
        (4, 3, 200000, TRUE, TIMESTAMP '2026-09-30 19:00:00', NULL, 1, 'Оклад 200 000 ₸ действует с 01.10.2026 Asia/Almaty', TIMESTAMP '2026-10-04 11:00:00'),
        (5, 1, 400000, TRUE, TIMESTAMP '2026-01-01 00:00:00', NULL, 1, 'Director salary', TIMESTAMP '2026-01-01 00:00:00'),
        (6, 4, 200000, TRUE, TIMESTAMP '2026-01-01 00:00:00', NULL, 1, 'Manager salary', TIMESTAMP '2026-01-01 00:00:00'),
        (7, 5, 200000, TRUE, TIMESTAMP '2026-01-01 00:00:00', NULL, 5, 'Outside salary', TIMESTAMP '2026-01-01 00:00:00');

      INSERT INTO "PayrollPeriod" (
        id, "companyId", year, month, "updatedAt"
      ) VALUES
        (1, 1, 2026, 9, CURRENT_TIMESTAMP),
        (2, 1, 2026, 10, CURRENT_TIMESTAMP),
        (3, 2, 2026, 10, CURRENT_TIMESTAMP);

      INSERT INTO "PayrollPayment" (
        id, "employeeId", "periodId", amount, "paymentDate", type, "paidById",
        "idempotencyKey", "requestHash"
      ) VALUES
        (1, 4, 1, 50000, TIMESTAMP '2026-09-15 10:00:00', 'ADVANCE', 1, 'akbota-advance', 'p1'),
        (2, 1, 1, 83001, TIMESTAMP '2026-09-16 10:00:00', 'ADVANCE', 1, 'alikhan-advance', 'p2'),
        (3, 5, 3, 10000, TIMESTAMP '2026-10-01 10:00:00', 'ADVANCE', 5, 'outside-payment', 'p3');

      INSERT INTO "PayrollAuditEvent" (
        id, action, "actorId", "periodId", "employeeId", after, reason,
        "idempotencyKey", "createdAt"
      ) VALUES
        (1, 'SALARY_CHANGED', 1, 2, 2,
         '{"amount":200000,"effectiveFrom":"2026-10-01T00:00:00+05:00","timeZone":"Asia/Almaty"}'::jsonb,
         '11:00 automatic salary condition',
         'october-2026-measurer-rate:v1:audit:2', TIMESTAMP '2026-10-04 11:00:01'),
        (2, 'SALARY_CHANGED', 1, 2, 3,
         '{"amount":200000,"effectiveFrom":"2026-10-01T00:00:00+05:00","timeZone":"Asia/Almaty"}'::jsonb,
         '11:00 automatic salary condition',
         'october-2026-measurer-rate:v1:audit:3', TIMESTAMP '2026-10-04 11:00:01');

      SELECT setval(pg_get_serial_sequence('"PayrollPayment"', 'id'), 3, TRUE);
      SELECT setval(pg_get_serial_sequence('"PayrollAuditEvent"', 'id'), 2, TRUE);
      SELECT setval(pg_get_serial_sequence('"EmployeeSalaryRate"', 'id'), 7, TRUE);
    `);

    // A real October operation makes the source ambiguous.  The migration
    // must fail atomically and leave the automatic salary values untouched.
    await db.exec(`
      INSERT INTO "PayrollPayment" (
        id, "employeeId", "periodId", amount, "paymentDate", type, "paidById",
        "idempotencyKey", "requestHash"
      ) VALUES
        (4, 2, 2, 1, TIMESTAMP '2026-10-02 10:00:00', 'ADVANCE', 1,
         'ambiguous-october-operation', 'p4');
    `);
    const beforeRejectedRun = await rows(`
      SELECT id, "baseSalary"::text, "salaryPlanEnabled", "hiredAt", "updatedAt"
      FROM "EmployeePayrollProfile" ORDER BY id
    `);
    await assert.rejects(
      db.exec(migration),
      /factual October-or-later payroll operations/,
    );
    await db.exec("ROLLBACK");
    assert.deepEqual(
      await rows(`
        SELECT id, "baseSalary"::text, "salaryPlanEnabled", "hiredAt", "updatedAt"
        FROM "EmployeePayrollProfile" ORDER BY id
      `),
      beforeRejectedRun,
    );
    await db.exec(`DELETE FROM "PayrollPayment" WHERE id = 4`);

    const hiredAtBefore = await rows(`
      SELECT id, "hiredAt" FROM "EmployeePayrollProfile" WHERE id IN (2, 3) ORDER BY id
    `);
    const accountingBefore = {
      accruals: await rows(`SELECT * FROM "PayrollAccrual" ORDER BY id`),
      payments: await rows(`SELECT * FROM "PayrollPayment" ORDER BY id`),
      confirmations: await rows(`SELECT * FROM "PayrollPaymentConfirmation" ORDER BY id`),
    };
    const outsideBefore = {
      profile: await rows(`SELECT * FROM "EmployeePayrollProfile" WHERE id = 5`),
      rates: await rows(`SELECT * FROM "EmployeeSalaryRate" WHERE "employeeId" = 5 ORDER BY id`),
      order: await rows(`SELECT * FROM "Order" WHERE id = 3`),
    };

    const paymentsBeforeMigration = await septemberPaymentSnapshot();
    await db.exec(migration);

    assert.deepEqual(
      await rows(`
        SELECT id, "baseSalary"::text AS salary, "salaryPlanEnabled" AS enabled
        FROM "EmployeePayrollProfile" WHERE id IN (2, 3) ORDER BY id
      `),
      [
        { id: 2, salary: "0.00", enabled: false },
        { id: 3, salary: "0.00", enabled: false },
      ],
    );
    assert.deepEqual(
      await rows(`
        SELECT "employeeId", amount::text, "planEnabled",
               "effectiveFrom"::text AS "effectiveFrom",
               "effectiveTo"::text AS "effectiveTo", comment
        FROM "EmployeeSalaryRate"
        WHERE id IN (2, 4)
        ORDER BY "employeeId"
      `),
      [
        {
          employeeId: 2,
          amount: "0.00",
          planEnabled: false,
          effectiveFrom: "2026-09-30 19:00:00",
          effectiveTo: null,
          comment: "Оклад не задан: неподтверждённая автоподстановка 200 000 ₸ отменена",
        },
        {
          employeeId: 3,
          amount: "0.00",
          planEnabled: false,
          effectiveFrom: "2026-09-30 19:00:00",
          effectiveTo: null,
          comment: "Оклад не задан: неподтверждённая автоподстановка 200 000 ₸ отменена",
        },
      ],
    );
    assert.deepEqual(
      await rows(`
        SELECT id, "hiredAt" FROM "EmployeePayrollProfile" WHERE id IN (2, 3) ORDER BY id
      `),
      hiredAtBefore,
      "employment start must remain at the October Asia/Almaty boundary",
    );
    assert.deepEqual(
      {
        accruals: await rows(`SELECT * FROM "PayrollAccrual" ORDER BY id`),
        payments: await rows(`SELECT * FROM "PayrollPayment" ORDER BY id`),
        confirmations: await rows(`SELECT * FROM "PayrollPaymentConfirmation" ORDER BY id`),
      },
      accountingBefore,
      "salary-condition repair must not mutate accounting operations",
    );
    assert.deepEqual(
      {
        profile: await rows(`SELECT * FROM "EmployeePayrollProfile" WHERE id = 5`),
        rates: await rows(`SELECT * FROM "EmployeeSalaryRate" WHERE "employeeId" = 5 ORDER BY id`),
        order: await rows(`SELECT * FROM "Order" WHERE id = 3`),
      },
      outsideBefore,
      "another tenant must be untouched, including its deliberately inconsistent legacy order",
    );
    assert.deepEqual(
      await septemberPaymentSnapshot(),
      paymentsBeforeMigration,
    );
    assert.deepEqual(
      await one(`
        SELECT
          COUNT(*) FILTER (
            WHERE "idempotencyKey" LIKE 'october-2026-measurer-rate:v1:audit:%'
          )::int AS sources,
          COUNT(*) FILTER (
            WHERE "idempotencyKey" LIKE 'revoke-unverified-measurer-salary:v1:audit:%'
          )::int AS corrections
        FROM "PayrollAuditEvent"
      `),
      { sources: 2, corrections: 2 },
    );
    assert.deepEqual(
      await one(`
        SELECT
          COUNT(*) FILTER (
            WHERE "responsibleType" = 'COMPANY' AND "managerUserId" IS NULL
          )::int AS company,
          COUNT(*) FILTER (
            WHERE "responsibleType" = 'EMPLOYEE' AND "managerUserId" = 4
          )::int AS employee
        FROM "Order" WHERE "companyId" = 1
      `),
      { company: 1, employee: 1 },
    );
    assert.deepEqual(
      await one(`
        SELECT
          COUNT(*) FILTER (
            WHERE "orderReceivedAt" >= TIMESTAMP '2026-08-31 19:00:00'
              AND "orderReceivedAt" < TIMESTAMP '2026-09-30 19:00:00'
          )::int AS september,
          COUNT(*) FILTER (
            WHERE "orderReceivedAt" >= TIMESTAMP '2026-09-30 19:00:00'
              AND "orderReceivedAt" < TIMESTAMP '2026-10-31 19:00:00'
          )::int AS october
        FROM "Order" WHERE "companyId" = 1
      `),
      { september: 1, october: 1 },
      "orders on the Asia/Almaty boundary must not mix September and October",
    );

    await db.exec(`
      INSERT INTO "PayrollPayment" (
        "employeeId", "periodId", amount, "paymentDate", type, "paidById",
        "idempotencyKey", "requestHash"
      ) VALUES (
        4, 1, 7000, TIMESTAMP '2026-09-25 10:00:00', 'ADVANCE', 1,
        'later-legitimate-payment', 'later-legitimate-payment'
      );
    `);
    const beforeReplay = {
      profiles: await rows(`
        SELECT * FROM "EmployeePayrollProfile" WHERE id IN (2, 3) ORDER BY id
      `),
      rates: await rows(`
        SELECT * FROM "EmployeeSalaryRate" WHERE "employeeId" IN (2, 3) ORDER BY id
      `),
      audits: await rows(`
        SELECT * FROM "PayrollAuditEvent" ORDER BY id
      `),
      accounting: {
        accruals: await rows(`SELECT * FROM "PayrollAccrual" ORDER BY id`),
        payments: await rows(`SELECT * FROM "PayrollPayment" ORDER BY id`),
        confirmations: await rows(`SELECT * FROM "PayrollPaymentConfirmation" ORDER BY id`),
      },
      septemberPayments: await septemberPaymentSnapshot(),
    };
    await db.exec(migration);
    const afterReplay = {
      profiles: await rows(`
        SELECT * FROM "EmployeePayrollProfile" WHERE id IN (2, 3) ORDER BY id
      `),
      rates: await rows(`
        SELECT * FROM "EmployeeSalaryRate" WHERE "employeeId" IN (2, 3) ORDER BY id
      `),
      audits: await rows(`
        SELECT * FROM "PayrollAuditEvent" ORDER BY id
      `),
      accounting: {
        accruals: await rows(`SELECT * FROM "PayrollAccrual" ORDER BY id`),
        payments: await rows(`SELECT * FROM "PayrollPayment" ORDER BY id`),
        confirmations: await rows(`SELECT * FROM "PayrollPaymentConfirmation" ORDER BY id`),
      },
      septemberPayments: await septemberPaymentSnapshot(),
    };
    assert.deepEqual(afterReplay, beforeReplay, "direct SQL replay must be a no-op");

    // Replaying the earlier source migration after the revocation must not
    // recreate the unverified 200k salary condition.
    await db.exec(sourceMigration);
    assert.deepEqual(
      {
        profiles: await rows(`
          SELECT * FROM "EmployeePayrollProfile" WHERE id IN (2, 3) ORDER BY id
        `),
        rates: await rows(`
          SELECT * FROM "EmployeeSalaryRate" WHERE "employeeId" IN (2, 3) ORDER BY id
        `),
        audits: await rows(`SELECT * FROM "PayrollAuditEvent" ORDER BY id`),
        accounting: {
          accruals: await rows(`SELECT * FROM "PayrollAccrual" ORDER BY id`),
          payments: await rows(`SELECT * FROM "PayrollPayment" ORDER BY id`),
          confirmations: await rows(`SELECT * FROM "PayrollPaymentConfirmation" ORDER BY id`),
        },
        septemberPayments: await septemberPaymentSnapshot(),
      },
      beforeReplay,
      "source migration replay after revocation must be a no-op",
    );

    // Recreate the shape seen when management explicitly records a zero salary
    // after the automatic 200k source but before this repair reaches a
    // database.  The later zero decision must win and the migration must be a
    // no-op for that employee even though the original source audit remains.
    await db.exec(`
      DELETE FROM "PayrollAuditEvent"
      WHERE "idempotencyKey" = 'revoke-unverified-measurer-salary:v1:audit:2';

      UPDATE "EmployeeSalaryRate"
      SET amount = 200000, "planEnabled" = TRUE,
          comment = 'Оклад 200 000 ₸ действует с 01.10.2026 Asia/Almaty',
          "effectiveTo" = TIMESTAMP '2026-10-09 19:00:00'
      WHERE id = 2;

      INSERT INTO "EmployeeSalaryRate" (
        "employeeId", amount, "planEnabled", "effectiveFrom", "effectiveTo",
        "approvedById", comment, "createdAt"
      ) VALUES (
        2, 0, FALSE, TIMESTAMP '2026-10-09 19:00:00', NULL,
        1, 'Explicit management zero salary decision', TIMESTAMP '2026-10-10 08:00:00'
      );

      UPDATE "EmployeePayrollProfile"
      SET "baseSalary" = 0, "salaryPlanEnabled" = FALSE,
          "updatedAt" = TIMESTAMP '2026-10-10 08:00:00'
      WHERE id = 2;

      INSERT INTO "PayrollAuditEvent" (
        action, "actorId", "periodId", "employeeId", before, after, reason,
        "createdAt"
      ) VALUES (
        'SALARY_CHANGED', 1, 2, 2,
        '{"amount":200000,"effectiveFrom":"2026-10-01T00:00:00+05:00"}'::jsonb,
        '{"amount":0,"effectiveFrom":"2026-10-10T00:00:00+05:00"}'::jsonb,
        'Explicit management zero salary decision', TIMESTAMP '2026-10-10 08:00:00'
      );
    `);
    const explicitSalaryBeforeReplay = {
      profile: await rows(`
        SELECT * FROM "EmployeePayrollProfile" WHERE id = 2
      `),
      rates: await rows(`
        SELECT * FROM "EmployeeSalaryRate" WHERE "employeeId" = 2 ORDER BY id
      `),
    };
    await db.exec(migration);
    assert.deepEqual(
      {
        profile: await rows(`
          SELECT * FROM "EmployeePayrollProfile" WHERE id = 2
        `),
        rates: await rows(`
          SELECT * FROM "EmployeeSalaryRate" WHERE "employeeId" = 2 ORDER BY id
        `),
      },
      explicitSalaryBeforeReplay,
      "a later explicit management zero salary condition must remain authoritative",
    );

    console.log("Unverified measurer salary-autofill reversal migration test passed");
  } finally {
    await db.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
