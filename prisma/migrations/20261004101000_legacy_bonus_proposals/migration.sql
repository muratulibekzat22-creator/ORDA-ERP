-- Automatically posted bonuses for active managers were only proposals.
-- Reverse the unpaid postings and preserve the audit trail. The current
-- order amount still supplies the suggested amount in the payroll statement.
CREATE TEMP TABLE "_AutomaticBonusProposalCleanup" AS
SELECT
  accrual."id" AS "originalId",
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
JOIN "PayrollPeriod" period ON period."id" = accrual."periodId"
JOIN "Company" company ON company."id" = period."companyId"
JOIN "Order" customer_order ON customer_order."id" = accrual."orderId"
JOIN "EmployeePayrollProfile" employee ON employee."id" = accrual."employeeId"
LEFT JOIN "User" account ON account."id" = employee."userId"
WHERE company."slug" = 'altyn-sapa-company'
  AND period."year" = 2026
  AND period."month" IN (9, 10)
  AND accrual."type" IN ('ORDER_BONUS', 'GUARANTEED_ORDER_BONUS')
  AND accrual."direction" = 'INCREASE'
  AND accrual."reversalOfId" IS NULL
  AND accrual."reason" LIKE 'Автоматический бонус по сумме заказа%'
  AND employee."active" = TRUE
  AND employee."terminatedAt" IS NULL
  AND (account."active" IS NULL OR account."active" = TRUE)
  AND (account."role"::text = 'MANAGER' OR employee."position" IN ('MANAGER', 'Менеджер'))
  AND NOT EXISTS (
    SELECT 1
    FROM "PayrollAccrual" reversal
    WHERE reversal."reversalOfId" = accrual."id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "PayrollPayment" payment
    WHERE payment."relatedAccrualId" = accrual."id"
      AND payment."reversalOfId" IS NULL
      AND payment."reversedAt" IS NULL
  );

UPDATE "PayrollAccrual" accrual
SET "orderBonusUniquenessKey" = NULL
FROM "_AutomaticBonusProposalCleanup" cleanup
WHERE accrual."id" = cleanup."originalId";

INSERT INTO "PayrollAccrual" (
  "employeeId",
  "periodId",
  "earnedPeriodId",
  "type",
  "direction",
  "amount",
  "orderId",
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
  cleanup."orderId",
  'Автоматическое предложение бонуса отменено: итоговую сумму утверждает менеджер или руководитель',
  cleanup."approvedById",
  cleanup."createdById",
  cleanup."originalId",
  'automatic-bonus-proposal:v1:' || cleanup."originalId",
  cleanup."requestHash",
  CURRENT_TIMESTAMP
FROM "_AutomaticBonusProposalCleanup" cleanup
ON CONFLICT ("idempotencyKey") DO NOTHING;

UPDATE "_AutomaticBonusProposalCleanup" cleanup
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
  "orderId",
  "employeeId",
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
  'Автоматическое предложение бонуса отменено: итоговую сумму утверждает менеджер или руководитель',
  cleanup."orderId",
  cleanup."employeeId",
  cleanup."approvedById",
  'payroll-accrual:' || cleanup."reversalId",
  cleanup."requestHash",
  TRUE,
  cleanup."reversalId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_AutomaticBonusProposalCleanup" cleanup
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
  'Автоматический бонус сторнирован; сумма остаётся предложением до ручного подтверждения',
  'automatic-bonus-proposal:v1:audit:' || cleanup."originalId",
  CURRENT_TIMESTAMP
FROM "_AutomaticBonusProposalCleanup" cleanup
WHERE cleanup."reversalId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

DROP TABLE "_AutomaticBonusProposalCleanup";
