import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  resolve(
    "prisma/migrations/20261004160000_payroll_salary_rate_invariants/migration.sql",
  ),
  "utf8",
);

const db = new PGlite();

async function main() {
 try {
  await db.exec(`
    CREATE TABLE "EmployeeSalaryRate" (
      id SERIAL PRIMARY KEY,
      "employeeId" INTEGER NOT NULL,
      "effectiveFrom" TIMESTAMP(3) NOT NULL,
      "effectiveTo" TIMESTAMP(3)
    );
    INSERT INTO "EmployeeSalaryRate" ("employeeId", "effectiveFrom", "effectiveTo")
    VALUES
      (1, TIMESTAMP '2026-10-01 00:00:00', NULL),
      (1, TIMESTAMP '2026-09-01 00:00:00', TIMESTAMP '2026-10-01 00:00:00'),
      (2, TIMESTAMP '2026-09-01 00:00:00', NULL),
      (2, TIMESTAMP '2026-10-01 00:00:00', NULL);
  `);

  await db.exec(migration);
  await db.exec(migration);

  await assert.rejects(
    db.exec(`
      INSERT INTO "EmployeeSalaryRate" ("employeeId", "effectiveFrom", "effectiveTo")
      VALUES (1, TIMESTAMP '2026-11-01 00:00:00', NULL)
    `),
    /unique|duplicate/u,
  );

  await db.exec(`
    INSERT INTO "EmployeeSalaryRate" ("employeeId", "effectiveFrom", "effectiveTo")
    VALUES
      (1, TIMESTAMP '2026-11-01 00:00:00', TIMESTAMP '2026-12-01 00:00:00'),
      (3, TIMESTAMP '2026-11-01 00:00:00', NULL)
  `);

  const result = await db.query<{ employeeId: number; count: number }>(`
    SELECT "employeeId", COUNT(*)::int AS count
    FROM "EmployeeSalaryRate"
    WHERE "effectiveTo" IS NULL
    GROUP BY "employeeId"
    ORDER BY "employeeId"
  `);
  assert.deepEqual(result.rows, [
    { employeeId: 1, count: 1 },
    { employeeId: 2, count: 1 },
    { employeeId: 3, count: 1 },
  ]);

  console.log("Payroll salary-rate invariant migration test passed");
  } finally {
    await db.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
