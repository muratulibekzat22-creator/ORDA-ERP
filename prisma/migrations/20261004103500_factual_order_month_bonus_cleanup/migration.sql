-- A manager bonus belongs to the month of the confirmed factual order date.
-- Completion only unlocks a terminated employee's bonus and must not move a
-- September order into October. Reverse unpaid legacy rows in the wrong month
-- while preserving their complete audit trail.
CREATE TEMP TABLE "_FactualOrderMonthBonusCleanup" AS
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
  AND customer_order."orderDateNeedsReview" = FALSE
  AND accrual."type" IN ('ORDER_BONUS', 'GUARANTEED_ORDER_BONUS')
  AND accrual."direction" = 'INCREASE'
  AND accrual."reversalOfId" IS NULL
  AND (
    EXTRACT(
      YEAR FROM customer_order."orderReceivedAt" AT TIME ZONE 'UTC'
        AT TIME ZONE 'Asia/Almaty'
    )::INTEGER <> period."year"
    OR EXTRACT(
      MONTH FROM customer_order."orderReceivedAt" AT TIME ZONE 'UTC'
        AT TIME ZONE 'Asia/Almaty'
    )::INTEGER <> period."month"
  )
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
FROM "_FactualOrderMonthBonusCleanup" cleanup
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
  'Сторно бонуса: расчётный месяц определяется фактической датой заказа',
  cleanup."approvedById",
  cleanup."createdById",
  cleanup."originalId",
  'factual-order-month-bonus:v1:' || cleanup."originalId",
  cleanup."requestHash",
  CURRENT_TIMESTAMP
FROM "_FactualOrderMonthBonusCleanup" cleanup
ON CONFLICT ("idempotencyKey") DO NOTHING;

UPDATE "_FactualOrderMonthBonusCleanup" cleanup
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
  'Сторно бонуса: расчётный месяц определяется фактической датой заказа',
  cleanup."orderId",
  cleanup."employeeId",
  cleanup."approvedById",
  'payroll-accrual:' || cleanup."reversalId",
  cleanup."requestHash",
  TRUE,
  cleanup."reversalId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_FactualOrderMonthBonusCleanup" cleanup
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
  'Ошибочный бонус удалён из месяца, не совпадающего с фактической датой заказа',
  'factual-order-month-bonus:v1:audit:' || cleanup."originalId",
  CURRENT_TIMESTAMP
FROM "_FactualOrderMonthBonusCleanup" cleanup
WHERE cleanup."reversalId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

DROP TABLE "_FactualOrderMonthBonusCleanup";
