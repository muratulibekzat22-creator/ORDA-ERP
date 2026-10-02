-- Salary accruals are a deliberate monthly director action. The retired daily
-- reconciliation job incorrectly posted the 200,000 KZT manager salary for
-- September and October 2026. Preserve the immutable history and neutralize
-- only those system-created, unpaid entries for the live ALTYN SAPA tenant.
CREATE TEMP TABLE "_PayrollManualAccrualCleanup" AS
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
WHERE company."slug" = 'altyn-sapa-company'
  AND period."year" = 2026
  AND period."month" IN (9, 10)
  AND accrual."type" = 'BASE_SALARY'
  AND accrual."direction" = 'INCREASE'
  AND accrual."amount" = 200000.00
  AND accrual."reason" LIKE 'Автопроверка оклада:%'
  AND accrual."idempotencyKey" LIKE 'payroll-policy:v1:%:salary:%'
  AND accrual."reversalOfId" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "PayrollAccrual" reversal
    WHERE reversal."reversalOfId" = accrual."id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "PayrollPayment" payment
    WHERE payment."employeeId" = accrual."employeeId"
      AND payment."periodId" = accrual."periodId"
      AND payment."reversalOfId" IS NULL
      AND payment."reversedAt" IS NULL
  );

DO $$
DECLARE
  candidate_count INTEGER;
  candidate_total NUMERIC(14, 2);
BEGIN
  SELECT COUNT(*), COALESCE(SUM("amount"), 0)
  INTO candidate_count, candidate_total
  FROM "_PayrollManualAccrualCleanup";

  IF candidate_count <> 4 OR candidate_total <> 800000.00 THEN
    RAISE EXCEPTION
      'Expected exactly four unpaid automated salary accruals totalling 800000.00 KZT, found % totalling %',
      candidate_count,
      candidate_total;
  END IF;
END $$;

INSERT INTO "PayrollAccrual" (
  "employeeId",
  "periodId",
  "earnedPeriodId",
  "type",
  "direction",
  "amount",
  "reason",
  "approvedById",
  "createdById",
  "reversalOfId",
  "idempotencyKey",
  "requestHash",
  "createdAt"
)
SELECT
  cleanup."employeeId",
  cleanup."periodId",
  cleanup."periodId",
  'BONUS_REVERSAL',
  'DECREASE',
  cleanup."amount",
  'Сторно ошибочного автоматического оклада: оклад начисляет директор вручную после завершения месяца',
  cleanup."approvedById",
  cleanup."createdById",
  cleanup."originalId",
  'payroll-manual-cleanup:v1:' || cleanup."originalId",
  cleanup."requestHash",
  CURRENT_TIMESTAMP
FROM "_PayrollManualAccrualCleanup" cleanup
ON CONFLICT ("idempotencyKey") DO NOTHING;

UPDATE "_PayrollManualAccrualCleanup" cleanup
SET "reversalId" = reversal."id"
FROM "PayrollAccrual" reversal
WHERE reversal."reversalOfId" = cleanup."originalId";

INSERT INTO "CompanyLedgerEntry" (
  "companyId",
  "type",
  "category",
  "direction",
  "source",
  "amount",
  "operationDate",
  "comment",
  "authorId",
  "idempotencyKey",
  "requestHash",
  "affectsProfit",
  "payrollAccrualId",
  "createdAt",
  "updatedAt"
)
SELECT
  cleanup."companyId",
  'PAYROLL_ACCRUAL',
  'SALARY',
  'INCOME',
  'OTHER_SYSTEM',
  cleanup."amount",
  CURRENT_TIMESTAMP,
  'Сторно ошибочного автоматического оклада: оклад начисляет директор вручную после завершения месяца',
  cleanup."approvedById",
  'payroll-accrual:' || cleanup."reversalId",
  cleanup."requestHash",
  TRUE,
  cleanup."reversalId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_PayrollManualAccrualCleanup" cleanup
WHERE cleanup."reversalId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

INSERT INTO "PayrollAuditEvent" (
  "action",
  "actorId",
  "periodId",
  "employeeId",
  "before",
  "after",
  "reason",
  "idempotencyKey",
  "createdAt"
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
  'Исправление ошибочного автоматического оклада; переход на ручное ежемесячное начисление директором',
  'payroll-manual-cleanup:v1:audit:' || cleanup."originalId",
  CURRENT_TIMESTAMP
FROM "_PayrollManualAccrualCleanup" cleanup
WHERE cleanup."reversalId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

DROP TABLE "_PayrollManualAccrualCleanup";
