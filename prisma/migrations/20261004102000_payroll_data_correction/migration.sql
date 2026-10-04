-- Correct the first explicit-plan rollout without deleting payroll history.
-- The original rollout had already reached production before its scope was
-- narrowed, so this follow-up is intentionally idempotent and additive.

-- Restore positive salary plans that the first rollout disabled for active
-- non-manager roles. The latest salary-rate record is the source of truth.
WITH latest_rate AS (
  SELECT DISTINCT ON (rate."employeeId")
    rate."employeeId",
    rate."amount"
  FROM "EmployeeSalaryRate" rate
  JOIN "EmployeePayrollProfile" profile ON profile.id = rate."employeeId"
  JOIN "Company" company ON company.id = profile."companyId"
  WHERE company.slug = 'altyn-sapa-company'
  ORDER BY
    rate."employeeId",
    (rate."effectiveTo" IS NULL) DESC,
    rate."effectiveFrom" DESC,
    rate.id DESC
)
UPDATE "EmployeePayrollProfile" profile
SET "baseSalary" = latest_rate."amount",
    "salaryPlanEnabled" = latest_rate."amount" > 0
FROM latest_rate
WHERE profile.id = latest_rate."employeeId";

UPDATE "EmployeeSalaryRate" rate
SET "planEnabled" = rate."amount" > 0
FROM "EmployeePayrollProfile" profile
JOIN "Company" company ON company.id = profile."companyId"
WHERE rate."employeeId" = profile.id
  AND company.slug = 'altyn-sapa-company';

-- These two employees start payroll in October. The employment boundary keeps
-- September at zero while preserving their October salary plans.
UPDATE "EmployeePayrollProfile" profile
SET "hiredAt" = GREATEST(
  profile."hiredAt",
  TIMESTAMP '2026-10-01 00:00:00'
)
WHERE profile."companyId" = (
  SELECT id FROM "Company" WHERE slug = 'altyn-sapa-company'
)
  AND (
    LOWER(BTRIM(COALESCE(
      (SELECT account."name" FROM "User" account WHERE account.id = profile."userId"),
      profile."name"
    ))) LIKE '%еркебулан%'
    OR (
      LOWER(BTRIM(COALESCE(
        (SELECT account."name" FROM "User" account WHERE account.id = profile."userId"),
        profile."name"
      ))) LIKE '%нурасыл%'
      AND LOWER(BTRIM(COALESCE(
        (SELECT account."name" FROM "User" account WHERE account.id = profile."userId"),
        profile."name"
      ))) LIKE '%кокбай%'
    )
  );

-- Restore base-salary accruals that were swept too broadly. Keep only the
-- explicitly requested September zero for Еркебулан and Нурасыл Кокбай.
CREATE TEMP TABLE "_SalaryCleanupRestore" AS
SELECT
  original.id AS "originalId",
  original."employeeId",
  original."periodId",
  original."earnedPeriodId",
  original."amount",
  original."externalReference",
  original."approvedById",
  original."createdById",
  original."requestHash",
  period."companyId",
  NULL::INTEGER AS "replacementId"
FROM "PayrollAccrual" reversal
JOIN "PayrollAccrual" original ON original.id = reversal."reversalOfId"
JOIN "PayrollPeriod" period ON period.id = original."periodId"
JOIN "Company" company ON company.id = period."companyId"
JOIN "EmployeePayrollProfile" employee ON employee.id = original."employeeId"
LEFT JOIN "User" account ON account.id = employee."userId"
WHERE company.slug = 'altyn-sapa-company'
  AND reversal."idempotencyKey" LIKE 'unassigned-salary-cleanup:v1:%'
  AND original."type" = 'BASE_SALARY'
  AND NOT (
    period."year" = 2026
    AND period."month" = 9
    AND (
      LOWER(BTRIM(COALESCE(account."name", employee."name"))) LIKE '%еркебулан%'
      OR (
        LOWER(BTRIM(COALESCE(account."name", employee."name"))) LIKE '%нурасыл%'
        AND LOWER(BTRIM(COALESCE(account."name", employee."name"))) LIKE '%кокбай%'
      )
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "PayrollAccrual" replacement
    WHERE replacement."idempotencyKey" =
      'salary-cleanup-restore:v2:' || original.id
  );

INSERT INTO "PayrollAccrual" (
  "employeeId", "periodId", "earnedPeriodId", "type", "direction",
  "amount", "reason", "externalReference", "approvedById", "createdById",
  "idempotencyKey", "requestHash", "createdAt"
)
SELECT
  restore."employeeId",
  restore."periodId",
  restore."earnedPeriodId",
  'BASE_SALARY',
  'INCREASE',
  restore."amount",
  'Восстановление оклада после уточнения границ сентябрьской очистки',
  restore."externalReference",
  restore."approvedById",
  restore."createdById",
  'salary-cleanup-restore:v2:' || restore."originalId",
  restore."requestHash",
  CURRENT_TIMESTAMP
FROM "_SalaryCleanupRestore" restore
ON CONFLICT ("idempotencyKey") DO NOTHING;

UPDATE "_SalaryCleanupRestore" restore
SET "replacementId" = replacement.id
FROM "PayrollAccrual" replacement
WHERE replacement."idempotencyKey" =
  'salary-cleanup-restore:v2:' || restore."originalId";

INSERT INTO "CompanyLedgerEntry" (
  "companyId", "type", "category", "direction", "source", "amount",
  "operationDate", "comment", "employeeId", "authorId",
  "idempotencyKey", "requestHash", "affectsProfit", "payrollAccrualId",
  "createdAt", "updatedAt"
)
SELECT
  restore."companyId",
  'PAYROLL_ACCRUAL',
  'SALARY',
  'EXPENSE',
  'OTHER_SYSTEM',
  restore."amount",
  CURRENT_TIMESTAMP,
  'Восстановление оклада после уточнения границ сентябрьской очистки',
  restore."employeeId",
  restore."approvedById",
  'payroll-accrual:' || restore."replacementId",
  restore."requestHash",
  TRUE,
  restore."replacementId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_SalaryCleanupRestore" restore
WHERE restore."replacementId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

INSERT INTO "PayrollAuditEvent" (
  "action", "actorId", "periodId", "employeeId", "before", "after",
  "reason", "idempotencyKey", "createdAt"
)
SELECT
  'PAYROLL_ACCRUAL_RESTORED',
  restore."approvedById",
  restore."periodId",
  restore."employeeId",
  jsonb_build_object('reversedAccrualId', restore."originalId"),
  jsonb_build_object(
    'replacementAccrualId', restore."replacementId",
    'amount', restore."amount"
  ),
  'Оклад восстановлен: сентябрьский ноль относится только к двум указанным сотрудникам',
  'salary-cleanup-restore:v2:audit:' || restore."originalId",
  CURRENT_TIMESTAMP
FROM "_SalaryCleanupRestore" restore
WHERE restore."replacementId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

DROP TABLE "_SalaryCleanupRestore";

-- A null current manager means the order is company-owned even if a legacy
-- manager name remains. Neutralize only unpaid bonuses and preserve the audit.
CREATE TEMP TABLE "_NullManagerBonusCleanup" AS
SELECT
  accrual.id AS "originalId",
  accrual."employeeId",
  accrual."periodId",
  accrual."type" AS "originalType",
  accrual."amount",
  accrual."orderId",
  accrual."approvedById",
  accrual."createdById",
  accrual."requestHash",
  period."companyId",
  NULL::INTEGER AS "reversalId"
FROM "PayrollAccrual" accrual
JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
JOIN "Company" company ON company.id = period."companyId"
JOIN "Order" customer_order ON customer_order.id = accrual."orderId"
WHERE company.slug = 'altyn-sapa-company'
  AND period."year" = 2026
  AND period."month" IN (9, 10)
  AND customer_order."managerUserId" IS NULL
  AND accrual."type" IN ('ORDER_BONUS', 'GUARANTEED_ORDER_BONUS')
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
    WHERE payment."relatedAccrualId" = accrual.id
      AND payment."reversalOfId" IS NULL
      AND payment."reversedAt" IS NULL
  );

UPDATE "PayrollAccrual" accrual
SET "orderBonusUniquenessKey" = NULL
FROM "_NullManagerBonusCleanup" cleanup
WHERE accrual.id = cleanup."originalId";

INSERT INTO "PayrollAccrual" (
  "employeeId", "periodId", "earnedPeriodId", "type", "direction",
  "amount", "orderId", "reason", "approvedById", "createdById",
  "reversalOfId", "idempotencyKey", "requestHash", "createdAt"
)
SELECT
  cleanup."employeeId",
  cleanup."periodId",
  cleanup."periodId",
  'BONUS_REVERSAL',
  'DECREASE',
  cleanup."amount",
  cleanup."orderId",
  'Заказ без закреплённого менеджера относится к компании: бонус не начисляется',
  cleanup."approvedById",
  cleanup."createdById",
  cleanup."originalId",
  'null-manager-order-bonus:v2:' || cleanup."originalId",
  cleanup."requestHash",
  CURRENT_TIMESTAMP
FROM "_NullManagerBonusCleanup" cleanup
ON CONFLICT ("idempotencyKey") DO NOTHING;

UPDATE "_NullManagerBonusCleanup" cleanup
SET "reversalId" = reversal.id
FROM "PayrollAccrual" reversal
WHERE reversal."reversalOfId" = cleanup."originalId";

INSERT INTO "CompanyLedgerEntry" (
  "companyId", "type", "category", "direction", "source", "amount",
  "operationDate", "comment", "orderId", "employeeId", "authorId",
  "idempotencyKey", "requestHash", "affectsProfit", "payrollAccrualId",
  "createdAt", "updatedAt"
)
SELECT
  cleanup."companyId",
  'PAYROLL_ACCRUAL',
  'SALARY',
  'INCOME',
  'OTHER_SYSTEM',
  cleanup."amount",
  CURRENT_TIMESTAMP,
  'Заказ без закреплённого менеджера относится к компании: бонус не начисляется',
  cleanup."orderId",
  cleanup."employeeId",
  cleanup."approvedById",
  'payroll-accrual:' || cleanup."reversalId",
  cleanup."requestHash",
  TRUE,
  cleanup."reversalId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_NullManagerBonusCleanup" cleanup
WHERE cleanup."reversalId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

INSERT INTO "PayrollAuditEvent" (
  "action", "actorId", "periodId", "employeeId", "before", "after",
  "reason", "idempotencyKey", "createdAt"
)
SELECT
  'ORDER_BONUS_CANCELLED',
  cleanup."approvedById",
  cleanup."periodId",
  cleanup."employeeId",
  jsonb_build_object(
    'accrualId', cleanup."originalId",
    'type', cleanup."originalType",
    'orderId', cleanup."orderId",
    'amount', cleanup."amount"
  ),
  jsonb_build_object('reversalId', cleanup."reversalId"),
  'Заказ без закреплённого менеджера исключён из менеджерской зарплаты',
  'null-manager-order-bonus:v2:audit:' || cleanup."originalId",
  CURRENT_TIMESTAMP
FROM "_NullManagerBonusCleanup" cleanup
WHERE cleanup."reversalId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

DROP TABLE "_NullManagerBonusCleanup";
