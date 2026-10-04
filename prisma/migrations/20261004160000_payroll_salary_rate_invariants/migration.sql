-- A salary profile may have exactly one open-ended rate. Application writes
-- also take a per-employee advisory lock, while this database invariant
-- protects imports and future writers from creating concurrent current rates.
BEGIN;

LOCK TABLE "EmployeeSalaryRate" IN SHARE ROW EXCLUSIVE MODE;

-- Preserve the newest open-ended condition and close only older overlapping
-- legacy rows. Amounts, approvers and comments are not rewritten.
WITH ranked_open_rates AS (
  SELECT
    id,
    "employeeId",
    "effectiveFrom",
    FIRST_VALUE("effectiveFrom") OVER (
      PARTITION BY "employeeId"
      ORDER BY "effectiveFrom" DESC, id DESC
    ) AS keeper_start,
    ROW_NUMBER() OVER (
      PARTITION BY "employeeId"
      ORDER BY "effectiveFrom" DESC, id DESC
    ) AS position
  FROM "EmployeeSalaryRate"
  WHERE "effectiveTo" IS NULL
)
UPDATE "EmployeeSalaryRate" rate
SET "effectiveTo" = GREATEST(rate."effectiveFrom", ranked.keeper_start)
FROM ranked_open_rates ranked
WHERE rate.id = ranked.id
  AND ranked.position > 1;

DO $$
DECLARE
  duplicate_employee_ids TEXT;
BEGIN
  SELECT string_agg(duplicate."employeeId"::TEXT, ', ' ORDER BY duplicate."employeeId")
  INTO duplicate_employee_ids
  FROM (
    SELECT "employeeId"
    FROM "EmployeeSalaryRate"
    WHERE "effectiveTo" IS NULL
    GROUP BY "employeeId"
    HAVING COUNT(*) > 1
  ) duplicate;

  IF duplicate_employee_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot enforce one current salary rate; duplicate employee ids: %',
      duplicate_employee_ids
      USING ERRCODE = '23505';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeSalaryRate_one_current_per_employee_key"
  ON "EmployeeSalaryRate" ("employeeId")
  WHERE "effectiveTo" IS NULL;

COMMIT;
