-- Keep salaries in payroll so they are not counted twice as ordinary expenses.
-- Apply the agreed 200,000 KZT manager base salary only where no non-zero
-- salary has already been configured by management.
UPDATE "EmployeePayrollProfile" AS employee
SET
  "baseSalary" = 200000,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "User" AS account
JOIN "Company" AS company ON company.id = account."companyId"
WHERE employee."userId" = account.id
  AND account.role = 'MANAGER'::"Role"
  AND account.active = TRUE
  AND company.active = TRUE
  AND company."isDemo" = FALSE
  AND employee."baseSalary" = 0;

INSERT INTO "EmployeePayrollProfile" (
  "companyId",
  "userId",
  "name",
  "position",
  "phone",
  "email",
  "hiredAt",
  "payrollEnabled",
  "baseSalary",
  "defaultGuaranteedBonus",
  "active",
  "createdAt",
  "updatedAt"
)
SELECT
  account."companyId",
  account.id,
  account.name,
  'Менеджер',
  account.phone,
  account.email,
  account."createdAt",
  TRUE,
  200000,
  20000,
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" AS account
JOIN "Company" AS company ON company.id = account."companyId"
WHERE account.role = 'MANAGER'::"Role"
  AND account.active = TRUE
  AND company.active = TRUE
  AND company."isDemo" = FALSE
  AND NOT EXISTS (
    SELECT 1
    FROM "EmployeePayrollProfile" AS employee
    WHERE employee."userId" = account.id
  );

UPDATE "EmployeeSalaryRate" AS rate
SET "amount" = 200000
FROM "EmployeePayrollProfile" AS employee
JOIN "User" AS account ON account.id = employee."userId"
JOIN "Company" AS company ON company.id = account."companyId"
WHERE rate."employeeId" = employee.id
  AND rate."effectiveTo" IS NULL
  AND rate.amount = 0
  AND account.role = 'MANAGER'::"Role"
  AND account.active = TRUE
  AND company.active = TRUE
  AND company."isDemo" = FALSE;
