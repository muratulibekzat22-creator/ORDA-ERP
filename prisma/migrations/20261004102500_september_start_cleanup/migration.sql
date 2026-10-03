-- Enforce the explicit September zero for Еркебулан and Нурасыл Кокбай even
-- if their payroll role was outside the earlier role-based cleanup.
CREATE TEMP TABLE "_SeptemberStartSalaryCleanup" AS
SELECT
  accrual.id AS "originalId",
  accrual."employeeId",
  accrual."periodId",
  accrual."amount",
  accrual."approvedById",
  accrual."createdById",
  accrual."requestHash",
  period."companyId",
  NULL::INTEGER AS "reversalId"
FROM "PayrollAccrual" accrual
JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
JOIN "Company" company ON company.id = period."companyId"
JOIN "EmployeePayrollProfile" employee ON employee.id = accrual."employeeId"
LEFT JOIN "User" account ON account.id = employee."userId"
WHERE company.slug = 'altyn-sapa-company'
  AND period."year" = 2026
  AND period."month" = 9
  AND accrual."type" = 'BASE_SALARY'
  AND accrual."direction" = 'INCREASE'
  AND accrual."reversalOfId" IS NULL
  AND (
    LOWER(BTRIM(COALESCE(account."name", employee."name"))) LIKE '%еркебулан%'
    OR (
      LOWER(BTRIM(COALESCE(account."name", employee."name"))) LIKE '%нурасыл%'
      AND LOWER(BTRIM(COALESCE(account."name", employee."name"))) LIKE '%кокбай%'
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "PayrollAccrual" reversal
    WHERE reversal."reversalOfId" = accrual.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "PayrollPayment" payment
    WHERE payment."employeeId" = accrual."employeeId"
      AND payment."periodId" = accrual."periodId"
      AND payment."reversalOfId" IS NULL
      AND payment."reversedAt" IS NULL
  );

INSERT INTO "PayrollAccrual" (
  "employeeId", "periodId", "earnedPeriodId", "type", "direction",
  "amount", "reason", "approvedById", "createdById", "reversalOfId",
  "idempotencyKey", "requestHash", "createdAt"
)
SELECT
  cleanup."employeeId",
  cleanup."periodId",
  cleanup."periodId",
  'BONUS_REVERSAL',
  'DECREASE',
  cleanup."amount",
  'Сторно сентябрьского оклада: сотрудник начинает работу с октября',
  cleanup."approvedById",
  cleanup."createdById",
  cleanup."originalId",
  'september-start-salary:v1:' || cleanup."originalId",
  cleanup."requestHash",
  CURRENT_TIMESTAMP
FROM "_SeptemberStartSalaryCleanup" cleanup
ON CONFLICT ("idempotencyKey") DO NOTHING;

UPDATE "_SeptemberStartSalaryCleanup" cleanup
SET "reversalId" = reversal.id
FROM "PayrollAccrual" reversal
WHERE reversal."reversalOfId" = cleanup."originalId";

INSERT INTO "CompanyLedgerEntry" (
  "companyId", "type", "category", "direction", "source", "amount",
  "operationDate", "comment", "employeeId", "authorId", "idempotencyKey",
  "requestHash", "affectsProfit", "payrollAccrualId", "createdAt", "updatedAt"
)
SELECT
  cleanup."companyId",
  'PAYROLL_ACCRUAL',
  'SALARY',
  'INCOME',
  'OTHER_SYSTEM',
  cleanup."amount",
  CURRENT_TIMESTAMP,
  'Сторно сентябрьского оклада: сотрудник начинает работу с октября',
  cleanup."employeeId",
  cleanup."approvedById",
  'payroll-accrual:' || cleanup."reversalId",
  cleanup."requestHash",
  TRUE,
  cleanup."reversalId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_SeptemberStartSalaryCleanup" cleanup
WHERE cleanup."reversalId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

INSERT INTO "PayrollAuditEvent" (
  "action", "actorId", "periodId", "employeeId", "before", "after",
  "reason", "idempotencyKey", "createdAt"
)
SELECT
  'PAYROLL_ACCRUAL_REVERSED',
  cleanup."approvedById",
  cleanup."periodId",
  cleanup."employeeId",
  jsonb_build_object(
    'accrualId', cleanup."originalId",
    'type', 'BASE_SALARY',
    'amount', cleanup."amount"
  ),
  jsonb_build_object('reversalId', cleanup."reversalId"),
  'Сентябрьский оклад обнулён: сотрудник начинает работу с октября',
  'september-start-salary:v1:audit:' || cleanup."originalId",
  CURRENT_TIMESTAMP
FROM "_SeptemberStartSalaryCleanup" cleanup
WHERE cleanup."reversalId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

DROP TABLE "_SeptemberStartSalaryCleanup";
