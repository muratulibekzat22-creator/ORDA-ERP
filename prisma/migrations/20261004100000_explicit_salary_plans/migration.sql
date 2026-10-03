ALTER TABLE "EmployeePayrollProfile"
ADD COLUMN "salaryPlanEnabled" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "EmployeeSalaryRate"
ADD COLUMN "planEnabled" BOOLEAN NOT NULL DEFAULT FALSE;

-- Preserve existing salary plans for other tenants. Only the currently
-- disputed roles in ALTYN SAPA are changed by this release.
UPDATE "EmployeePayrollProfile"
SET "salaryPlanEnabled" = TRUE
WHERE "baseSalary" > 0;

UPDATE "EmployeeSalaryRate"
SET "planEnabled" = TRUE
WHERE "amount" > 0;

UPDATE "EmployeePayrollProfile" AS profile
SET "salaryPlanEnabled" = FALSE,
    "baseSalary" = 0
WHERE profile."companyId" = (SELECT id FROM "Company" WHERE slug = 'altyn-sapa-company')
  AND profile."active" = TRUE
  AND COALESCE(
    (SELECT account."role"::text FROM "User" account WHERE account.id = profile."userId"),
    profile."position"
  ) NOT IN ('MANAGER', 'OPERATIONS_DIRECTOR');

UPDATE "EmployeeSalaryRate" AS rate
SET "planEnabled" = FALSE
FROM "EmployeePayrollProfile" AS profile
WHERE rate."employeeId" = profile.id
  AND profile."companyId" = (SELECT id FROM "Company" WHERE slug = 'altyn-sapa-company')
  AND profile."active" = TRUE
  AND profile."salaryPlanEnabled" = FALSE;
