-- Еркебулан and Нурасыл Кокбай must have no salary plan and no payable
-- base salary in either September or October 2026. Keep all original payroll
-- rows and neutralize only unpaid active accruals with immutable reversals.
CREATE TEMP TABLE "_NamedMeasurersZeroSalaryTargets" AS
SELECT profile.id AS "employeeId"
FROM "EmployeePayrollProfile" profile
JOIN "Company" company ON company.id = profile."companyId"
LEFT JOIN "User" account ON account.id = profile."userId"
WHERE company.slug = 'altyn-sapa-company'
  AND (
    LOWER(BTRIM(COALESCE(NULLIF(account."name", ''), profile."name"))) LIKE '%еркебулан%'
    OR (
      LOWER(BTRIM(COALESCE(NULLIF(account."name", ''), profile."name"))) LIKE '%нурасыл%'
      AND LOWER(BTRIM(COALESCE(NULLIF(account."name", ''), profile."name"))) LIKE '%кокбай%'
    )
  );

UPDATE "EmployeePayrollProfile" profile
SET "baseSalary" = 0,
    "salaryPlanEnabled" = FALSE,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_NamedMeasurersZeroSalaryTargets" target
WHERE profile.id = target."employeeId";

UPDATE "EmployeeSalaryRate" rate
SET "planEnabled" = FALSE
FROM "_NamedMeasurersZeroSalaryTargets" target
WHERE rate."employeeId" = target."employeeId";

CREATE TEMP TABLE "_NamedMeasurersSalaryAccrualCleanup" AS
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
JOIN "_NamedMeasurersZeroSalaryTargets" target
  ON target."employeeId" = accrual."employeeId"
WHERE period."year" = 2026
  AND period."month" IN (9, 10)
  AND accrual."type" = 'BASE_SALARY'
  AND accrual."direction" = 'INCREASE'
  AND accrual."reversalOfId" IS NULL
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
      AND payment."type" IN ('ADVANCE', 'SALARY_PAYMENT', 'FINAL_SETTLEMENT')
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
  'Сторно оклада: для сотрудника установлен нулевой оклад за сентябрь и октябрь',
  cleanup."approvedById",
  cleanup."createdById",
  cleanup."originalId",
  'named-measurers-zero-salary:v1:' || cleanup."originalId",
  cleanup."requestHash",
  CURRENT_TIMESTAMP
FROM "_NamedMeasurersSalaryAccrualCleanup" cleanup
ON CONFLICT ("idempotencyKey") DO NOTHING;

UPDATE "_NamedMeasurersSalaryAccrualCleanup" cleanup
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
  'Сторно оклада: для сотрудника установлен нулевой оклад за сентябрь и октябрь',
  cleanup."employeeId",
  cleanup."approvedById",
  'payroll-accrual:' || cleanup."reversalId",
  cleanup."requestHash",
  TRUE,
  cleanup."reversalId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_NamedMeasurersSalaryAccrualCleanup" cleanup
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
  'Оклад Еркебулана или Нурасыла Кокбая за сентябрь/октябрь установлен 0',
  'named-measurers-zero-salary:v1:audit:' || cleanup."originalId",
  CURRENT_TIMESTAMP
FROM "_NamedMeasurersSalaryAccrualCleanup" cleanup
WHERE cleanup."reversalId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

DROP TABLE "_NamedMeasurersSalaryAccrualCleanup";
DROP TABLE "_NamedMeasurersZeroSalaryTargets";
