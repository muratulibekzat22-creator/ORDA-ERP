-- Reconcile legacy payroll component ledgers after the snapshot model becomes
-- authoritative. Preserve historical recognition, but keep every reversal in
-- the original operation month and remove invalid Company-order measurement
-- bonuses from P&L. Scoped to the requested company and the two periods under
-- repair: September and October 2026.
BEGIN;

LOCK TABLE
  "Company",
  "Order",
  "PayrollPeriod",
  "PayrollAccrual",
  "CompanyLedgerEntry"
IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PayrollAccrual" reversal
    JOIN "PayrollAccrual" original ON original.id = reversal."reversalOfId"
    JOIN "PayrollPeriod" reversal_period ON reversal_period.id = reversal."periodId"
    JOIN "PayrollPeriod" original_period ON original_period.id = original."periodId"
    WHERE reversal_period."companyId" <> original_period."companyId"
  ) THEN
    RAISE EXCEPTION 'Payroll reversal crosses tenant boundary'
      USING ERRCODE = '23514';
  END IF;
END $$;

-- Retire the stale employee component itself, not only its ledger impact.
-- Otherwise assigning the order back to an employee later would make the old
-- bonus active again. The reversal stays in the original payroll period and
-- is fully auditable/idempotent.
CREATE TEMP TABLE "_CompanyMeasurementBonusReset" AS
SELECT
  accrual.id AS "originalId",
  accrual."employeeId",
  accrual."periodId",
  COALESCE(accrual."earnedPeriodId", accrual."periodId") AS "earnedPeriodId",
  accrual."orderId",
  accrual.amount,
  accrual."approvedById",
  accrual."createdById",
  ledger."operationDate" AS "originalOperationDate",
  NULL::INTEGER AS "reversalId"
FROM "PayrollAccrual" accrual
JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
JOIN "Company" company ON company.id = period."companyId"
JOIN "Order" customer_order
  ON customer_order.id = accrual."orderId"
 AND customer_order."companyId" = period."companyId"
LEFT JOIN "CompanyLedgerEntry" ledger
  ON ledger."payrollAccrualId" = accrual.id
 AND ledger."companyId" = period."companyId"
WHERE company.slug = 'altyn-sapa-company'
  AND period.year = 2026
  AND period.month IN (9, 10)
  AND accrual.type = 'MEASUREMENT_BONUS'
  AND accrual.direction = 'INCREASE'
  AND accrual."reversalOfId" IS NULL
  AND customer_order."responsibleType" = 'COMPANY'
  AND NOT EXISTS (
    SELECT 1
    FROM "PayrollAccrual" reversal
    WHERE reversal."reversalOfId" = accrual.id
  );

INSERT INTO "PayrollAccrual" (
  "employeeId", "periodId", "earnedPeriodId", type, direction, amount,
  "orderId", reason, "approvedById", "createdById", "reversalOfId",
  "idempotencyKey", "requestHash", "createdAt"
)
SELECT
  reset."employeeId",
  reset."periodId",
  reset."earnedPeriodId",
  'BONUS_REVERSAL',
  'DECREASE',
  reset.amount,
  reset."orderId",
  'Ответственный заказа — Компания; старый бонус замерщика исключён',
  reset."approvedById",
  reset."createdById",
  reset."originalId",
  'company-measurement-bonus-reset:v1:' || reset."originalId",
  md5('company-measurement-bonus-reset:v1:' || reset."originalId"::TEXT),
  CURRENT_TIMESTAMP
FROM "_CompanyMeasurementBonusReset" reset
ON CONFLICT ("idempotencyKey") DO NOTHING;

UPDATE "_CompanyMeasurementBonusReset" reset
SET "reversalId" = reversal.id
FROM "PayrollAccrual" reversal
WHERE reversal."idempotencyKey" =
  'company-measurement-bonus-reset:v1:' || reset."originalId";

INSERT INTO "CompanyLedgerEntry" (
  "companyId", type, category, source, direction, amount, "operationDate",
  "orderId", "employeeId", comment, "authorId", "idempotencyKey",
  "requestHash", "affectsProfit", "payrollAccrualId", "createdAt", "updatedAt"
)
SELECT
  period."companyId",
  'PAYROLL_ACCRUAL',
  'SALARY',
  'PAYROLL_ACCRUAL',
  'INCOME',
  reset.amount,
  COALESCE(reset."originalOperationDate", CURRENT_TIMESTAMP),
  reset."orderId",
  reset."employeeId",
  'Сторно старого бонуса замерщика для заказа компании',
  reset."approvedById",
  'payroll-accrual:' || reset."reversalId",
  md5('company-measurement-bonus-reset:v1:' || reset."originalId"::TEXT),
  FALSE,
  reset."reversalId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_CompanyMeasurementBonusReset" reset
JOIN "PayrollPeriod" period ON period.id = reset."periodId"
WHERE reset."reversalId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

INSERT INTO "PayrollAuditEvent" (
  action, "actorId", "periodId", "employeeId", before, after, reason,
  "idempotencyKey", "createdAt"
)
SELECT
  'MEASUREMENT_BONUS_INVALIDATED',
  reset."approvedById",
  reset."periodId",
  reset."employeeId",
  jsonb_build_object(
    'accrualId', reset."originalId",
    'orderId', reset."orderId",
    'amount', reset.amount
  ),
  jsonb_build_object('reversalId', reset."reversalId"),
  'Ответственный заказа — Компания; старый бонус замерщика исключён из зарплаты',
  'company-measurement-bonus-reset:v1:audit:' || reset."originalId",
  CURRENT_TIMESTAMP
FROM "_CompanyMeasurementBonusReset" reset
WHERE reset."reversalId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

-- Old cleanup drafts posted compensating income on migration day. Matching the
-- original ledger date prevents a September expense from becoming artificial
-- October income. affectsProfit also mirrors the original snapshot treatment.
UPDATE "CompanyLedgerEntry" reversal_ledger
SET
  "operationDate" = original_ledger."operationDate",
  "affectsProfit" = original_ledger."affectsProfit",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "PayrollAccrual" reversal
JOIN "PayrollAccrual" original ON original.id = reversal."reversalOfId"
JOIN "PayrollPeriod" original_period ON original_period.id = original."periodId"
JOIN "Company" company ON company.id = original_period."companyId"
JOIN "CompanyLedgerEntry" original_ledger
  ON original_ledger."payrollAccrualId" = original.id
 AND original_ledger."companyId" = original_period."companyId"
WHERE reversal_ledger."payrollAccrualId" = reversal.id
  AND reversal_ledger."companyId" = original_period."companyId"
  AND company.slug = 'altyn-sapa-company'
  AND original_period.year = 2026
  AND original_period.month IN (9, 10)
  AND (
    reversal_ledger."operationDate" IS DISTINCT FROM original_ledger."operationDate"
    OR reversal_ledger."affectsProfit" IS DISTINCT FROM original_ledger."affectsProfit"
  );

-- Current responsibility is the only source of truth. A measurement component
-- linked to a Company-owned order is not employee payroll and must not affect
-- profit, regardless of the stale creator/former-responsible relationship.
UPDATE "CompanyLedgerEntry" ledger
SET "affectsProfit" = FALSE,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "PayrollAccrual" accrual
JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
JOIN "Company" company ON company.id = period."companyId"
JOIN "Order" customer_order
  ON customer_order.id = accrual."orderId"
 AND customer_order."companyId" = period."companyId"
WHERE ledger."payrollAccrualId" = accrual.id
  AND ledger."companyId" = period."companyId"
  AND company.slug = 'altyn-sapa-company'
  AND period.year = 2026
  AND period.month IN (9, 10)
  AND accrual.type = 'MEASUREMENT_BONUS'
  AND customer_order."responsibleType" = 'COMPANY'
  AND ledger."affectsProfit" = TRUE;

UPDATE "CompanyLedgerEntry" ledger
SET "affectsProfit" = FALSE,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_CompanyMeasurementBonusReset" reset
WHERE ledger."payrollAccrualId" IN (
    reset."originalId",
    reset."reversalId"
  )
  AND ledger."affectsProfit" = TRUE;

DROP TABLE "_CompanyMeasurementBonusReset";

COMMIT;
