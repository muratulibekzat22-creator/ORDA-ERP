-- A terminated manager earns an order bonus only after that order reaches the
-- completed lifecycle. Move premature, unpaid September/October accruals out
-- of payable salary while preserving the original audit history.
CREATE TEMP TABLE "_DeferredTerminatedManagerBonus" AS
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
JOIN "EmployeePayrollProfile" employee ON employee."id" = accrual."employeeId"
LEFT JOIN "User" account ON account."id" = employee."userId"
JOIN "Order" customer_order ON customer_order."id" = accrual."orderId"
LEFT JOIN "LeadConversion" lead_conversion ON lead_conversion."orderId" = customer_order."id"
WHERE company."slug" = 'altyn-sapa-company'
  AND period."year" = 2026
  AND period."month" IN (9, 10)
  AND accrual."type" IN ('ORDER_BONUS', 'GUARANTEED_ORDER_BONUS')
  AND accrual."direction" = 'INCREASE'
  AND accrual."reversalOfId" IS NULL
  AND (employee."active" = FALSE OR employee."terminatedAt" IS NOT NULL OR account."active" = FALSE)
  AND (account."role" = 'MANAGER' OR employee."position" IN ('MANAGER', 'Менеджер'))
  AND LOWER(BTRIM(customer_order."manager")) NOT IN ('компания', 'company')
  AND (
    (customer_order."managerUserId" IS NOT NULL AND customer_order."managerUserId" = employee."userId")
    OR (
      customer_order."managerUserId" IS NULL
      AND LOWER(BTRIM(customer_order."manager")) = LOWER(BTRIM(COALESCE(NULLIF(employee."name", ''), account."name")))
    )
    OR (
      customer_order."managerUserId" IS NULL
      AND BTRIM(customer_order."manager") = ''
      AND lead_conversion."managerId" = employee."userId"
    )
  )
  AND NOT (
    customer_order."lifecycle" = 'COMPLETED'
    AND customer_order."completedAt" IS NOT NULL
    AND EXTRACT(YEAR FROM customer_order."completedAt" AT TIME ZONE 'Asia/Almaty')::INTEGER = period."year"
    AND EXTRACT(MONTH FROM customer_order."completedAt" AT TIME ZONE 'Asia/Almaty')::INTEGER = period."month"
  )
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
FROM "_DeferredTerminatedManagerBonus" cleanup
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
  'Начисление уволенного сотрудника отложено до завершения заказа',
  cleanup."approvedById",
  cleanup."createdById",
  cleanup."originalId",
  'terminated-manager-order-bonus-deferred:v1:' || cleanup."originalId",
  cleanup."requestHash",
  CURRENT_TIMESTAMP
FROM "_DeferredTerminatedManagerBonus" cleanup
ON CONFLICT ("idempotencyKey") DO NOTHING;

UPDATE "_DeferredTerminatedManagerBonus" cleanup
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
  'Начисление уволенного сотрудника отложено до завершения заказа',
  cleanup."orderId",
  cleanup."employeeId",
  cleanup."approvedById",
  'payroll-accrual:' || cleanup."reversalId",
  cleanup."requestHash",
  TRUE,
  cleanup."reversalId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_DeferredTerminatedManagerBonus" cleanup
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
  'TERMINATED_MANAGER_BONUS_DEFERRED',
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
  'Невыплаченный бонус будет начислен после завершения заказа',
  'terminated-manager-order-bonus-deferred:v1:audit:' || cleanup."originalId",
  CURRENT_TIMESTAMP
FROM "_DeferredTerminatedManagerBonus" cleanup
WHERE cleanup."reversalId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

DROP TABLE "_DeferredTerminatedManagerBonus";
