ALTER TABLE "EmployeePayrollProfile"
ADD COLUMN "salaryPlanEnabled" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "EmployeeSalaryRate"
ADD COLUMN "planEnabled" BOOLEAN NOT NULL DEFAULT FALSE;

-- Preserve every existing positive salary as an explicit plan.
UPDATE "EmployeePayrollProfile"
SET "salaryPlanEnabled" = TRUE
WHERE "baseSalary" > 0;

UPDATE "EmployeeSalaryRate"
SET "planEnabled" = TRUE
WHERE "amount" > 0;

-- Еркебулан and Нурасыл Кокбай start payroll in October. Correcting the hire
-- boundary keeps September at zero without deleting their October salary plan.
UPDATE "EmployeePayrollProfile" AS profile
SET "hiredAt" = GREATEST(profile."hiredAt", TIMESTAMP '2026-10-01 00:00:00')
FROM "User" AS account
WHERE profile."companyId" = (SELECT id FROM "Company" WHERE slug = 'altyn-sapa-company')
  AND profile."active" = TRUE
  AND account.id = profile."userId"
  AND (
    LOWER(BTRIM(COALESCE(account."name", profile."name"))) LIKE '%еркебулан%'
    OR (
      LOWER(BTRIM(COALESCE(account."name", profile."name"))) LIKE '%нурасыл%'
      AND LOWER(BTRIM(COALESCE(account."name", profile."name"))) LIKE '%кокбай%'
    )
  );
