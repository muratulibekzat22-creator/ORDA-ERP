-- Unassigned salaries for the founder, marketer and measurers were shown as
-- payable in the September/October 2026 statement. Reverse only unpaid base
-- accruals for those roles in the live tenant, retaining the original audit.
CREATE TEMP TABLE "_UnassignedSalaryCleanup" AS
SELECT
  accrual."id" AS "originalId",
  accrual."employeeId",
  accrual."periodId",
  accrual."amount",
  accrual."approvedById",
  accrual."createdById",
  accrual."requestHash",
  period."companyId",
  NULL::INTEGER AS "reversalId"
FROM "PayrollAccrual" accrual
JOIN "PayrollPeriod" period ON period."id" = accrual."periodId"
JOIN "Company" company ON company."id" = period."companyId"
JOIN "EmployeePayrollProfile" employee ON employee."id" = accrual."employeeId"
LEFT JOIN "User" account ON account."id" = employee."userId"
WHERE company."slug" = 'altyn-sapa-company'
  AND period."year" = 2026
  AND period."month" IN (9, 10)
  AND COALESCE(account."role"::text, employee."position") IN ('DIRECTOR', 'MARKETER', 'MEASURER')
  AND accrual."type" = 'BASE_SALARY'
  AND accrual."direction" = 'INCREASE'
  AND accrual."reversalOfId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "PayrollAccrual" reversal
    WHERE reversal."reversalOfId" = accrual."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "PayrollPayment" payment
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
  cleanup."employeeId", cleanup."periodId", cleanup."periodId",
  'BONUS_REVERSAL', 'DECREASE', cleanup."amount",
  'Сторно оклада без решения об установлении зарплаты',
  cleanup."approvedById", cleanup."createdById", cleanup."originalId",
  'unassigned-salary-cleanup:v1:' || cleanup."originalId",
  cleanup."requestHash", CURRENT_TIMESTAMP
FROM "_UnassignedSalaryCleanup" cleanup
ON CONFLICT ("idempotencyKey") DO NOTHING;

UPDATE "_UnassignedSalaryCleanup" cleanup
SET "reversalId" = reversal."id"
FROM "PayrollAccrual" reversal
WHERE reversal."reversalOfId" = cleanup."originalId";

INSERT INTO "CompanyLedgerEntry" (
  "companyId", "type", "category", "direction", "source", "amount",
  "operationDate", "comment", "authorId", "idempotencyKey", "requestHash",
  "affectsProfit", "payrollAccrualId", "createdAt", "updatedAt"
)
SELECT
  cleanup."companyId", 'PAYROLL_ACCRUAL', 'SALARY', 'INCOME', 'OTHER_SYSTEM',
  cleanup."amount", CURRENT_TIMESTAMP,
  'Сторно оклада без решения об установлении зарплаты',
  cleanup."approvedById", 'payroll-accrual:' || cleanup."reversalId",
  cleanup."requestHash", TRUE, cleanup."reversalId",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "_UnassignedSalaryCleanup" cleanup
WHERE cleanup."reversalId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

INSERT INTO "PayrollAuditEvent" (
  "action", "actorId", "periodId", "employeeId", "before", "after",
  "reason", "idempotencyKey", "createdAt"
)
SELECT
  'PAYROLL_ACCRUAL_REVERSED', cleanup."approvedById", cleanup."periodId",
  cleanup."employeeId",
  jsonb_build_object('accrualId', cleanup."originalId", 'type', 'BASE_SALARY', 'amount', cleanup."amount"),
  jsonb_build_object('reversalId', cleanup."reversalId"),
  'Оклад не назначен; ошибочное неоплаченное начисление сторнировано',
  'unassigned-salary-cleanup:v1:audit:' || cleanup."originalId",
  CURRENT_TIMESTAMP
FROM "_UnassignedSalaryCleanup" cleanup
WHERE cleanup."reversalId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

DROP TABLE "_UnassignedSalaryCleanup";
