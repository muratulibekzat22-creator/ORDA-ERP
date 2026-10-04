-- Forward-only reconciliation for three overly broad legacy payroll cleanups.
--
-- 1. A manual order-bonus choice that was removed only because it was stored
--    in the wrong month is migrated to PayrollOrderBonusDecision in the
--    factual order month. System suggestions and Company-owned orders stay
--    excluded.
-- 2. Real non-salary components removed by the old role-wide measurer sweep
--    are restored only when an exact audit record proves the original write.
-- 3. Mechanically restored BASE_SALARY rows without proof of a manual salary
--    confirmation are neutralized. Existing calculation snapshots are always
--    authoritative over those compatibility rows.
--
-- The repair is deliberately scoped to ALTYN SAPA and September/October 2026.
-- It never updates/deletes a payment or payment confirmation. Every new row
-- has a deterministic idempotency key and every pre-existing key is checked
-- for semantic equality before it can be treated as a replay.
BEGIN;

LOCK TABLE
  "Company",
  "User",
  "Order",
  "MeasurementAudit",
  "EmployeePayrollProfile",
  "PayrollPeriod",
  "PayrollOrderBonusDecision",
  "PayrollCalculationSnapshot",
  "PayrollAccrual",
  "PayrollPayment",
  "PayrollPaymentConfirmation",
  "PayrollAuditEvent",
  "CompanyLedgerEntry"
IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PayrollAccrual" legacy_reversal
    JOIN "PayrollAccrual" original
      ON original.id = legacy_reversal."reversalOfId"
    JOIN "PayrollPeriod" original_period
      ON original_period.id = original."periodId"
    JOIN "PayrollPeriod" reversal_period
      ON reversal_period.id = legacy_reversal."periodId"
    JOIN "Company" company ON company.id = original_period."companyId"
    JOIN "EmployeePayrollProfile" employee ON employee.id = original."employeeId"
    WHERE company.slug = 'altyn-sapa-company'
      AND original_period.year = 2026
      AND original_period.month IN (9, 10)
      AND (
        legacy_reversal."idempotencyKey" =
          'factual-order-month-bonus:v1:' || original.id
        OR legacy_reversal."idempotencyKey" =
          'measurer-zero-salary:v2:' || original.id
      )
      AND (
        reversal_period."companyId" <> original_period."companyId"
        OR employee."companyId" <> original_period."companyId"
      )
  ) THEN
    RAISE EXCEPTION 'Legacy payroll cleanup crosses tenant boundary'
      USING ERRCODE = '23514';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PayrollAccrual" replacement
    JOIN "PayrollAccrual" original
      ON replacement."idempotencyKey" =
        'salary-cleanup-restore:v2:' || original.id
    JOIN "PayrollPeriod" replacement_period
      ON replacement_period.id = replacement."periodId"
    JOIN "PayrollPeriod" original_period
      ON original_period.id = original."periodId"
    JOIN "Company" company ON company.id = replacement_period."companyId"
    JOIN "EmployeePayrollProfile" employee ON employee.id = replacement."employeeId"
    JOIN "User" approver ON approver.id = replacement."approvedById"
    JOIN "User" creator ON creator.id = replacement."createdById"
    WHERE company.slug = 'altyn-sapa-company'
      AND replacement_period.year = 2026
      AND replacement_period.month IN (9, 10)
      AND (
        original_period."companyId" <> replacement_period."companyId"
        OR original."employeeId" <> replacement."employeeId"
        OR employee."companyId" <> replacement_period."companyId"
        OR approver."companyId" <> replacement_period."companyId"
        OR creator."companyId" <> replacement_period."companyId"
      )
  ) THEN
    RAISE EXCEPTION 'Legacy salary restoration crosses tenant boundary'
      USING ERRCODE = '23514';
  END IF;
END $$;

CREATE TEMP TABLE "_LegacyFinancialSnapshot" AS
SELECT
  company.id AS "companyId",
  (
    SELECT COUNT(*)::INTEGER
    FROM "PayrollPayment" payment
    JOIN "PayrollPeriod" period ON period.id = payment."periodId"
    WHERE period."companyId" = company.id
      AND period.year = 2026
      AND period.month IN (9, 10)
  ) AS "paymentCount",
  (
    SELECT COALESCE(SUM(CASE
      WHEN payment.type = 'EMPLOYEE_REFUND'::"PayrollPaymentType"
        THEN -payment.amount
      ELSE payment.amount
    END), 0)::DECIMAL(14, 2)
    FROM "PayrollPayment" payment
    JOIN "PayrollPeriod" period ON period.id = payment."periodId"
    WHERE period."companyId" = company.id
      AND period.year = 2026
      AND period.month IN (9, 10)
  ) AS "paymentTotal",
  (
    SELECT COUNT(*)::INTEGER
    FROM "PayrollPaymentConfirmation" confirmation
    JOIN "PayrollPeriod" period ON period.id = confirmation."periodId"
    WHERE period."companyId" = company.id
      AND period.year = 2026
      AND period.month IN (9, 10)
  ) AS "confirmationCount",
  (
    SELECT COALESCE(SUM(confirmation.amount), 0)::DECIMAL(14, 2)
    FROM "PayrollPaymentConfirmation" confirmation
    JOIN "PayrollPeriod" period ON period.id = confirmation."periodId"
    WHERE period."companyId" = company.id
      AND period.year = 2026
      AND period.month IN (9, 10)
  ) AS "confirmationTotal"
FROM "Company" company
WHERE company.slug = 'altyn-sapa-company';

-- Recover only explicit employee choices removed by the wrong-month cleanup.
CREATE TEMP TABLE "_LegacyWrongMonthBonus" AS
SELECT DISTINCT ON (original."orderId", original."employeeId")
  original.id AS "originalId",
  original."employeeId",
  original."orderId",
  original.amount AS "manualAmount",
  original."createdById" AS "updatedById",
  original."periodId" AS "legacyPeriodId",
  original_period."companyId",
  customer_order."orderReceivedAt" AS "earnedAt",
  EXTRACT(
    YEAR FROM customer_order."orderReceivedAt" AT TIME ZONE 'UTC'
      AT TIME ZONE 'Asia/Almaty'
  )::INTEGER AS "earnedYear",
  EXTRACT(
    MONTH FROM customer_order."orderReceivedAt" AT TIME ZONE 'UTC'
      AT TIME ZONE 'Asia/Almaty'
  )::INTEGER AS "earnedMonth",
  NULL::INTEGER AS "periodId"
FROM "PayrollAccrual" legacy_reversal
JOIN "PayrollAccrual" original
  ON original.id = legacy_reversal."reversalOfId"
JOIN "PayrollPeriod" original_period
  ON original_period.id = original."periodId"
JOIN "Company" company ON company.id = original_period."companyId"
JOIN "EmployeePayrollProfile" employee
  ON employee.id = original."employeeId"
 AND employee."companyId" = original_period."companyId"
JOIN "User" employee_account
  ON employee_account.id = employee."userId"
 AND employee_account."companyId" = original_period."companyId"
JOIN "User" author
  ON author.id = original."createdById"
 AND author."companyId" = original_period."companyId"
JOIN "Order" customer_order
  ON customer_order.id = original."orderId"
 AND customer_order."companyId" = original_period."companyId"
WHERE company.slug = 'altyn-sapa-company'
  AND original_period.year = 2026
  AND original_period.month IN (9, 10)
  AND legacy_reversal."idempotencyKey" =
    'factual-order-month-bonus:v1:' || original.id
  AND legacy_reversal.type = 'BONUS_REVERSAL'
  AND legacy_reversal.direction = 'DECREASE'
  AND legacy_reversal.amount = original.amount
  AND original.type IN ('ORDER_BONUS', 'GUARANTEED_ORDER_BONUS')
  AND original.direction = 'INCREASE'
  AND original."reversalOfId" IS NULL
  AND customer_order."deletedAt" IS NULL
  AND customer_order.lifecycle <> 'CANCELLED'::"OrderLifecycle"
  AND customer_order."orderDateNeedsReview" = FALSE
  AND customer_order."responsibleType" = 'EMPLOYEE'::"OrderResponsibleType"
  AND customer_order."managerUserId" = employee."userId"
  AND (
    employee_account.role IN (
      'MANAGER'::"Role",
      'OPERATIONS_DIRECTOR'::"Role",
      'DIRECTOR'::"Role"
    )
    OR employee.position IN ('MANAGER', 'OPERATIONS_DIRECTOR', 'DIRECTOR')
  )
  AND (
    (
      employee.active = TRUE
      AND employee."terminatedAt" IS NULL
      AND employee_account.active = TRUE
    )
    OR (
      customer_order.lifecycle = 'COMPLETED'::"OrderLifecycle"
      AND customer_order."completedAt" IS NOT NULL
    )
  )
  AND EXTRACT(
    YEAR FROM customer_order."orderReceivedAt" AT TIME ZONE 'UTC'
      AT TIME ZONE 'Asia/Almaty'
  )::INTEGER = 2026
  AND EXTRACT(
    MONTH FROM customer_order."orderReceivedAt" AT TIME ZONE 'UTC'
      AT TIME ZONE 'Asia/Almaty'
  )::INTEGER IN (9, 10)
  AND (
    original.type = 'GUARANTEED_ORDER_BONUS'
    OR EXISTS (
      SELECT 1
      FROM "PayrollAuditEvent" manual_audit
      WHERE manual_audit.action IN (
          'PAYROLL_ACCRUAL_CREATED',
          'ORDER_BONUS_CORRECTED'
        )
        AND manual_audit."periodId" = original."periodId"
        AND manual_audit."employeeId" = original."employeeId"
        AND manual_audit."after" @> jsonb_build_object(
          'accrualId', original.id,
          'manualOverride', TRUE
        )
    )
  )
ORDER BY
  original."orderId",
  original."employeeId",
  CASE WHEN original.type = 'ORDER_BONUS' THEN 0 ELSE 1 END,
  original."createdAt" DESC,
  original.id DESC;

INSERT INTO "PayrollPeriod" (
  "companyId", year, month, "updatedAt"
)
SELECT DISTINCT
  candidate."companyId",
  candidate."earnedYear",
  candidate."earnedMonth",
  CURRENT_TIMESTAMP
FROM "_LegacyWrongMonthBonus" candidate
ON CONFLICT ("companyId", year, month) DO NOTHING;

UPDATE "_LegacyWrongMonthBonus" candidate
SET "periodId" = period.id
FROM "PayrollPeriod" period
WHERE period."companyId" = candidate."companyId"
  AND period.year = candidate."earnedYear"
  AND period.month = candidate."earnedMonth";

DO $$
DECLARE
  conflict_ids TEXT;
BEGIN
  SELECT string_agg(candidate."originalId"::TEXT, ', ' ORDER BY candidate."originalId")
  INTO conflict_ids
  FROM "_LegacyWrongMonthBonus" candidate
  JOIN "PayrollOrderBonusDecision" decision
    ON decision."orderId" = candidate."orderId"
   AND decision."employeeId" = candidate."employeeId"
  WHERE decision."companyId" IS DISTINCT FROM candidate."companyId"
     OR decision."periodId" IS DISTINCT FROM candidate."periodId"
     OR decision."earnedAt" IS DISTINCT FROM candidate."earnedAt"
     OR decision."manualAmount" IS DISTINCT FROM candidate."manualAmount";

  IF conflict_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'Conflicting saved bonus decision for legacy accrual id(s): %',
      conflict_ids;
  END IF;
END $$;

INSERT INTO "PayrollOrderBonusDecision" (
  "companyId", "orderId", "employeeId", "periodId", "earnedAt",
  "manualAmount", "updatedById", "createdAt", "updatedAt"
)
SELECT
  candidate."companyId",
  candidate."orderId",
  candidate."employeeId",
  candidate."periodId",
  candidate."earnedAt",
  candidate."manualAmount",
  candidate."updatedById",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_LegacyWrongMonthBonus" candidate
ON CONFLICT ("orderId", "employeeId") DO NOTHING;

INSERT INTO "PayrollAuditEvent" (
  action, "actorId", "periodId", "employeeId", before, after,
  reason, "idempotencyKey", "createdAt"
)
SELECT
  'LEGACY_ORDER_BONUS_DECISION_RECOVERED',
  candidate."updatedById",
  candidate."periodId",
  candidate."employeeId",
  jsonb_build_object(
    'legacyAccrualId', candidate."originalId",
    'legacyPeriodId', candidate."legacyPeriodId"
  ),
  jsonb_build_object(
    'orderId', candidate."orderId",
    'earnedAt', candidate."earnedAt",
    'manualAmount', candidate."manualAmount"
  ),
  'Ручной бонус восстановлен в фактическом месяце заказа',
  'legacy-wrong-month-order-bonus:v1:audit:' || candidate."originalId",
  CURRENT_TIMESTAMP
FROM "_LegacyWrongMonthBonus" candidate
ON CONFLICT ("idempotencyKey") DO NOTHING;

DO $$
DECLARE
  invalid_ids TEXT;
BEGIN
  SELECT string_agg(candidate."originalId"::TEXT, ', ' ORDER BY candidate."originalId")
  INTO invalid_ids
  FROM "_LegacyWrongMonthBonus" candidate
  WHERE NOT EXISTS (
    SELECT 1
    FROM "PayrollAuditEvent" audit
    WHERE audit."idempotencyKey" =
      'legacy-wrong-month-order-bonus:v1:audit:' || candidate."originalId"
      AND audit.action = 'LEGACY_ORDER_BONUS_DECISION_RECOVERED'
      AND audit."actorId" = candidate."updatedById"
      AND audit."periodId" = candidate."periodId"
      AND audit."employeeId" = candidate."employeeId"
      AND audit."after" @> jsonb_build_object(
        'orderId', candidate."orderId",
        'manualAmount', candidate."manualAmount"
      )
  );

  IF invalid_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'Invalid recovered bonus audit for legacy accrual id(s): %', invalid_ids;
  END IF;
END $$;

-- Recover only non-salary components whose original manual/system operation
-- can be tied to that exact accrual. A name, role, amount or reason alone is
-- never treated as evidence.
CREATE TEMP TABLE "_LegacyMeasurerComponent" AS
SELECT
  original.id AS "originalId",
  original."employeeId",
  original."periodId",
  COALESCE(original."earnedPeriodId", original."periodId") AS "earnedPeriodId",
  original.type AS "originalType",
  original.amount,
  original."orderId",
  original."measurementId",
  original."externalReference",
  original."paymentMode",
  original."approvedById",
  original."createdById",
  original."approvedAt",
  original."createdAt" AS "originalCreatedAt",
  original_period."companyId",
  original_ledger."operationDate" AS "originalOperationDate",
  NULL::INTEGER AS "replacementId"
FROM "PayrollAccrual" legacy_reversal
JOIN "PayrollAccrual" original
  ON original.id = legacy_reversal."reversalOfId"
JOIN "PayrollPeriod" original_period
  ON original_period.id = original."periodId"
JOIN "Company" company ON company.id = original_period."companyId"
JOIN "EmployeePayrollProfile" employee
  ON employee.id = original."employeeId"
 AND employee."companyId" = original_period."companyId"
JOIN "User" approver
  ON approver.id = original."approvedById"
 AND approver."companyId" = original_period."companyId"
JOIN "User" creator
  ON creator.id = original."createdById"
 AND creator."companyId" = original_period."companyId"
LEFT JOIN "Order" customer_order
  ON customer_order.id = original."orderId"
 AND customer_order."companyId" = original_period."companyId"
LEFT JOIN "CompanyLedgerEntry" original_ledger
  ON original_ledger."payrollAccrualId" = original.id
 AND original_ledger."companyId" = original_period."companyId"
WHERE company.slug = 'altyn-sapa-company'
  AND original_period.year = 2026
  AND original_period.month IN (9, 10)
  AND legacy_reversal."idempotencyKey" =
    'measurer-zero-salary:v2:' || original.id
  AND legacy_reversal.type = 'BONUS_REVERSAL'
  AND legacy_reversal.direction = 'DECREASE'
  AND legacy_reversal.amount = original.amount
  AND original.type IN (
    'MEASUREMENT_BONUS',
    'EXTRA_BONUS',
    'PREMIUM',
    'ADJUSTMENT_INCREASE'
  )
  AND original.direction = 'INCREASE'
  AND original."reversalOfId" IS NULL
  AND original."idempotencyKey" NOT LIKE 'payroll-policy:%'
  AND original.reason NOT LIKE 'Автопроверка бонуса за заказ%'
  AND (
    original."orderId" IS NULL
    OR (
      customer_order.id IS NOT NULL
      AND customer_order."deletedAt" IS NULL
      AND customer_order.lifecycle <> 'CANCELLED'::"OrderLifecycle"
      AND customer_order."responsibleType" = 'EMPLOYEE'::"OrderResponsibleType"
    )
  )
  AND (
    (
      original.type = 'MEASUREMENT_BONUS'
      AND original."measurementId" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "MeasurementAudit" measurement_audit
        JOIN "User" measurement_actor
          ON measurement_actor.id = measurement_audit."actorId"
         AND measurement_actor."companyId" = original_period."companyId"
        WHERE measurement_audit."measurementId" = original."measurementId"
          AND measurement_audit.action = 'BONUS_ACCRUED'
          AND measurement_audit."after" @> jsonb_build_object(
            'accrualId', original.id
          )
      )
    )
    OR (
      original.type <> 'MEASUREMENT_BONUS'
      AND EXISTS (
        SELECT 1
        FROM "PayrollAuditEvent" component_audit
        WHERE component_audit."periodId" = original."periodId"
          AND component_audit."employeeId" = original."employeeId"
          AND component_audit."actorId" = original."approvedById"
          AND component_audit.action = CASE
            WHEN original.type = 'PREMIUM' THEN 'PREMIUM_ACCRUED'
            ELSE 'PAYROLL_ACCRUAL_CREATED'
          END
          AND component_audit."after" @> jsonb_build_object(
            'accrualId', original.id,
            'type', original.type
          )
      )
    )
  );

DO $$
DECLARE
  conflict_ids TEXT;
BEGIN
  SELECT string_agg(component."originalId"::TEXT, ', ' ORDER BY component."originalId")
  INTO conflict_ids
  FROM "_LegacyMeasurerComponent" component
  JOIN "PayrollAccrual" replacement
    ON replacement."idempotencyKey" =
      'legacy-measurer-component-restore:v1:' || component."originalId"
  WHERE replacement."employeeId" IS DISTINCT FROM component."employeeId"
     OR replacement."periodId" IS DISTINCT FROM component."periodId"
     OR replacement."earnedPeriodId" IS DISTINCT FROM component."earnedPeriodId"
     OR replacement.type IS DISTINCT FROM component."originalType"
     OR replacement.direction IS DISTINCT FROM 'INCREASE'::"PayrollDirection"
     OR replacement.amount IS DISTINCT FROM component.amount
     OR replacement."orderId" IS DISTINCT FROM component."orderId";

  IF conflict_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'Conflicting restored payroll component for legacy accrual id(s): %',
      conflict_ids;
  END IF;
END $$;

INSERT INTO "PayrollAccrual" (
  "employeeId", "periodId", "earnedPeriodId", type, direction, amount,
  "orderId", reason, "externalReference", "paymentMode", "approvedAt",
  "approvedById", "createdById", "idempotencyKey", "requestHash", "createdAt"
)
SELECT
  component."employeeId",
  component."periodId",
  component."earnedPeriodId",
  component."originalType",
  'INCREASE',
  component.amount,
  component."orderId",
  'Восстановление подтверждённого компонента после ошибочной ролевой очистки',
  component."externalReference",
  component."paymentMode",
  component."approvedAt",
  component."approvedById",
  component."createdById",
  'legacy-measurer-component-restore:v1:' || component."originalId",
  md5('legacy-measurer-component-restore:v1:' || component."originalId"::TEXT),
  CURRENT_TIMESTAMP
FROM "_LegacyMeasurerComponent" component
WHERE NOT EXISTS (
  SELECT 1
  FROM "PayrollAccrual" replacement
  WHERE replacement."idempotencyKey" =
    'legacy-measurer-component-restore:v1:' || component."originalId"
);

UPDATE "_LegacyMeasurerComponent" component
SET "replacementId" = replacement.id
FROM "PayrollAccrual" replacement
WHERE replacement."idempotencyKey" =
  'legacy-measurer-component-restore:v1:' || component."originalId";

INSERT INTO "CompanyLedgerEntry" (
  "companyId", type, category, source, direction, amount, "operationDate",
  "orderId", "employeeId", comment, "authorId", "idempotencyKey",
  "requestHash", "affectsProfit", "payrollAccrualId", "createdAt", "updatedAt"
)
SELECT
  component."companyId",
  'PAYROLL_ACCRUAL',
  'SALARY',
  'PAYROLL_ACCRUAL',
  'EXPENSE',
  component.amount,
  COALESCE(component."originalOperationDate", component."originalCreatedAt"),
  component."orderId",
  component."employeeId",
  'Восстановленный компонент расчёта после ошибочной ролевой очистки',
  component."approvedById",
  'payroll-accrual:' || component."replacementId",
  md5('legacy-measurer-component-restore:v1:' || component."originalId"::TEXT),
  FALSE,
  component."replacementId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_LegacyMeasurerComponent" component
WHERE component."replacementId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

DO $$
DECLARE
  invalid_ids TEXT;
BEGIN
  SELECT string_agg(component."originalId"::TEXT, ', ' ORDER BY component."originalId")
  INTO invalid_ids
  FROM "_LegacyMeasurerComponent" component
  WHERE component."replacementId" IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM "CompanyLedgerEntry" ledger
       WHERE ledger."idempotencyKey" = 'payroll-accrual:' || component."replacementId"
         AND ledger."companyId" = component."companyId"
         AND ledger."payrollAccrualId" = component."replacementId"
         AND ledger.direction = 'EXPENSE'
         AND ledger.amount = component.amount
         AND ledger."operationDate" = COALESCE(
           component."originalOperationDate",
           component."originalCreatedAt"
         )
         AND ledger."employeeId" = component."employeeId"
         AND ledger."orderId" IS NOT DISTINCT FROM component."orderId"
         AND ledger."affectsProfit" = FALSE
     );

  IF invalid_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'Invalid restored component ledger for legacy accrual id(s): %',
      invalid_ids;
  END IF;
END $$;

INSERT INTO "PayrollAuditEvent" (
  action, "actorId", "periodId", "employeeId", before, after,
  reason, "idempotencyKey", "createdAt"
)
SELECT
  'LEGACY_PAYROLL_COMPONENT_RESTORED',
  component."approvedById",
  component."periodId",
  component."employeeId",
  jsonb_build_object(
    'legacyAccrualId', component."originalId",
    'legacyType', component."originalType",
    'measurementId', component."measurementId"
  ),
  jsonb_build_object(
    'replacementAccrualId', component."replacementId",
    'amount', component.amount,
    'orderId', component."orderId"
  ),
  'Подтверждённый компонент восстановлен после ошибочной очистки всех начислений замерщика',
  'legacy-measurer-component-restore:v1:audit:' || component."originalId",
  CURRENT_TIMESTAMP
FROM "_LegacyMeasurerComponent" component
WHERE component."replacementId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

DO $$
DECLARE
  invalid_ids TEXT;
BEGIN
  SELECT string_agg(component."originalId"::TEXT, ', ' ORDER BY component."originalId")
  INTO invalid_ids
  FROM "_LegacyMeasurerComponent" component
  WHERE NOT EXISTS (
    SELECT 1
    FROM "PayrollAuditEvent" audit
    WHERE audit."idempotencyKey" =
      'legacy-measurer-component-restore:v1:audit:' || component."originalId"
      AND audit.action = 'LEGACY_PAYROLL_COMPONENT_RESTORED'
      AND audit."actorId" = component."approvedById"
      AND audit."periodId" = component."periodId"
      AND audit."employeeId" = component."employeeId"
      AND audit."after" @> jsonb_build_object(
        'replacementAccrualId', component."replacementId",
        'amount', component.amount
      )
  );

  IF invalid_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'Invalid restored component audit for legacy accrual id(s): %',
      invalid_ids;
  END IF;
END $$;

-- salary-cleanup-restore:v2 was a mechanical compensation, not a user
-- confirmation. Retire it when no exact legacy confirmation exists, or when a
-- calculation snapshot already supersedes the row.
CREATE TEMP TABLE "_LegacyAutomaticSalaryRestore" AS
SELECT
  replacement.id AS "replacementId",
  replacement."employeeId",
  replacement."periodId",
  COALESCE(replacement."earnedPeriodId", replacement."periodId") AS "earnedPeriodId",
  replacement.amount,
  replacement."approvedById",
  replacement."createdById",
  period."companyId",
  replacement_ledger."operationDate",
  replacement_ledger."affectsProfit",
  NULL::INTEGER AS "reversalId"
FROM "PayrollAccrual" replacement
JOIN "PayrollAccrual" original
  ON replacement."idempotencyKey" =
    'salary-cleanup-restore:v2:' || original.id
JOIN "PayrollPeriod" period ON period.id = replacement."periodId"
JOIN "Company" company ON company.id = period."companyId"
JOIN "EmployeePayrollProfile" employee
  ON employee.id = replacement."employeeId"
 AND employee."companyId" = period."companyId"
LEFT JOIN "CompanyLedgerEntry" replacement_ledger
  ON replacement_ledger."payrollAccrualId" = replacement.id
 AND replacement_ledger."companyId" = period."companyId"
WHERE company.slug = 'altyn-sapa-company'
  AND period.year = 2026
  AND period.month IN (9, 10)
  AND replacement.type = 'BASE_SALARY'
  AND replacement.direction = 'INCREASE'
  AND replacement."reversalOfId" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "PayrollAccrual" reversal
    WHERE reversal."reversalOfId" = replacement.id
  )
  AND (
    EXISTS (
      SELECT 1
      FROM "PayrollCalculationSnapshot" snapshot
      WHERE snapshot."companyId" = period."companyId"
        AND snapshot."periodId" = replacement."periodId"
        AND snapshot."employeeId" = replacement."employeeId"
    )
    OR NOT EXISTS (
      SELECT 1
      FROM "PayrollAuditEvent" manual_audit
      WHERE manual_audit."periodId" = original."periodId"
        AND manual_audit."employeeId" = original."employeeId"
        AND manual_audit."actorId" = original."approvedById"
        AND manual_audit.action = 'PAYROLL_ACCRUAL_CREATED'
        AND manual_audit."after" @> jsonb_build_object(
          'accrualId', original.id,
          'type', 'BASE_SALARY'
        )
        AND original."idempotencyKey" NOT LIKE 'payroll-policy:%'
        AND original.reason NOT LIKE 'Автопроверка оклада%'
    )
  );

INSERT INTO "PayrollAccrual" (
  "employeeId", "periodId", "earnedPeriodId", type, direction, amount,
  reason, "approvedById", "createdById", "reversalOfId",
  "idempotencyKey", "requestHash", "createdAt"
)
SELECT
  restore."employeeId",
  restore."periodId",
  restore."earnedPeriodId",
  'BONUS_REVERSAL',
  'DECREASE',
  restore.amount,
  'Сторно автоматического восстановления оклада без отдельного подтверждения',
  restore."approvedById",
  restore."createdById",
  restore."replacementId",
  'legacy-auto-salary-restore-reset:v1:' || restore."replacementId",
  md5('legacy-auto-salary-restore-reset:v1:' || restore."replacementId"::TEXT),
  CURRENT_TIMESTAMP
FROM "_LegacyAutomaticSalaryRestore" restore
ON CONFLICT ("idempotencyKey") DO NOTHING;

UPDATE "_LegacyAutomaticSalaryRestore" restore
SET "reversalId" = reversal.id
FROM "PayrollAccrual" reversal
WHERE reversal."idempotencyKey" =
  'legacy-auto-salary-restore-reset:v1:' || restore."replacementId";

DO $$
DECLARE
  invalid_ids TEXT;
BEGIN
  SELECT string_agg(restore."replacementId"::TEXT, ', ' ORDER BY restore."replacementId")
  INTO invalid_ids
  FROM "_LegacyAutomaticSalaryRestore" restore
  LEFT JOIN "PayrollAccrual" reversal ON reversal.id = restore."reversalId"
  WHERE reversal.id IS NULL
     OR reversal."employeeId" IS DISTINCT FROM restore."employeeId"
     OR reversal."periodId" IS DISTINCT FROM restore."periodId"
     OR reversal."earnedPeriodId" IS DISTINCT FROM restore."earnedPeriodId"
     OR reversal.type IS DISTINCT FROM 'BONUS_REVERSAL'::"PayrollAccrualType"
     OR reversal.direction IS DISTINCT FROM 'DECREASE'::"PayrollDirection"
     OR reversal.amount IS DISTINCT FROM restore.amount
     OR reversal."reversalOfId" IS DISTINCT FROM restore."replacementId";

  IF invalid_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'Invalid automatic salary restoration reversal for accrual id(s): %',
      invalid_ids;
  END IF;
END $$;

INSERT INTO "CompanyLedgerEntry" (
  "companyId", type, category, source, direction, amount, "operationDate",
  "employeeId", comment, "authorId", "idempotencyKey", "requestHash",
  "affectsProfit", "payrollAccrualId", "createdAt", "updatedAt"
)
SELECT
  restore."companyId",
  'PAYROLL_ACCRUAL',
  'SALARY',
  'PAYROLL_ACCRUAL',
  'INCOME',
  restore.amount,
  COALESCE(restore."operationDate", CURRENT_TIMESTAMP),
  restore."employeeId",
  'Сторно автоматического восстановления оклада без подтверждения',
  restore."approvedById",
  'payroll-accrual:' || restore."reversalId",
  md5('legacy-auto-salary-restore-reset:v1:' || restore."replacementId"::TEXT),
  COALESCE(restore."affectsProfit", FALSE),
  restore."reversalId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_LegacyAutomaticSalaryRestore" restore
WHERE restore."reversalId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

DO $$
DECLARE
  invalid_ids TEXT;
BEGIN
  SELECT string_agg(restore."replacementId"::TEXT, ', ' ORDER BY restore."replacementId")
  INTO invalid_ids
  FROM "_LegacyAutomaticSalaryRestore" restore
  WHERE NOT EXISTS (
    SELECT 1
    FROM "CompanyLedgerEntry" ledger
    WHERE ledger."idempotencyKey" = 'payroll-accrual:' || restore."reversalId"
      AND ledger."companyId" = restore."companyId"
      AND ledger."payrollAccrualId" = restore."reversalId"
      AND ledger.direction = 'INCOME'
      AND ledger.amount = restore.amount
      AND ledger."operationDate" = COALESCE(
        restore."operationDate",
        CURRENT_TIMESTAMP
      )
      AND ledger."employeeId" = restore."employeeId"
      AND ledger."affectsProfit" = COALESCE(restore."affectsProfit", FALSE)
  );

  IF invalid_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'Invalid automatic salary restoration ledger for accrual id(s): %',
      invalid_ids;
  END IF;
END $$;

INSERT INTO "PayrollAuditEvent" (
  action, "actorId", "periodId", "employeeId", before, after,
  reason, "idempotencyKey", "createdAt"
)
SELECT
  'LEGACY_AUTOMATIC_SALARY_RESTORE_REVERSED',
  restore."approvedById",
  restore."periodId",
  restore."employeeId",
  jsonb_build_object(
    'replacementAccrualId', restore."replacementId",
    'amount', restore.amount
  ),
  jsonb_build_object('reversalId', restore."reversalId"),
  'Автоматически восстановленный оклад не является подтверждённым начислением',
  'legacy-auto-salary-restore-reset:v1:audit:' || restore."replacementId",
  CURRENT_TIMESTAMP
FROM "_LegacyAutomaticSalaryRestore" restore
WHERE restore."reversalId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

DO $$
DECLARE
  invalid_ids TEXT;
BEGIN
  SELECT string_agg(restore."replacementId"::TEXT, ', ' ORDER BY restore."replacementId")
  INTO invalid_ids
  FROM "_LegacyAutomaticSalaryRestore" restore
  WHERE NOT EXISTS (
    SELECT 1
    FROM "PayrollAuditEvent" audit
    WHERE audit."idempotencyKey" =
      'legacy-auto-salary-restore-reset:v1:audit:' || restore."replacementId"
      AND audit.action = 'LEGACY_AUTOMATIC_SALARY_RESTORE_REVERSED'
      AND audit."actorId" = restore."approvedById"
      AND audit."periodId" = restore."periodId"
      AND audit."employeeId" = restore."employeeId"
      AND audit."after" @> jsonb_build_object(
        'reversalId', restore."reversalId"
      )
  );

  IF invalid_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'Invalid automatic salary restoration audit for accrual id(s): %',
      invalid_ids;
  END IF;
END $$;

DO $$
DECLARE
  expected_payment_count INTEGER;
  actual_payment_count INTEGER;
  expected_payment_total NUMERIC(14, 2);
  actual_payment_total NUMERIC(14, 2);
  expected_confirmation_count INTEGER;
  actual_confirmation_count INTEGER;
  expected_confirmation_total NUMERIC(14, 2);
  actual_confirmation_total NUMERIC(14, 2);
BEGIN
  SELECT
    COALESCE(MAX("paymentCount"), 0),
    COALESCE(MAX("paymentTotal"), 0),
    COALESCE(MAX("confirmationCount"), 0),
    COALESCE(MAX("confirmationTotal"), 0)
  INTO
    expected_payment_count,
    expected_payment_total,
    expected_confirmation_count,
    expected_confirmation_total
  FROM "_LegacyFinancialSnapshot";

  SELECT
    (
      SELECT COUNT(*)::INTEGER
      FROM "PayrollPayment" payment
      JOIN "PayrollPeriod" period ON period.id = payment."periodId"
      WHERE period."companyId" = company.id
        AND period.year = 2026
        AND period.month IN (9, 10)
    ),
    (
      SELECT COALESCE(SUM(CASE
        WHEN payment.type = 'EMPLOYEE_REFUND'::"PayrollPaymentType"
          THEN -payment.amount
        ELSE payment.amount
      END), 0)::DECIMAL(14, 2)
      FROM "PayrollPayment" payment
      JOIN "PayrollPeriod" period ON period.id = payment."periodId"
      WHERE period."companyId" = company.id
        AND period.year = 2026
        AND period.month IN (9, 10)
    ),
    (
      SELECT COUNT(*)::INTEGER
      FROM "PayrollPaymentConfirmation" confirmation
      JOIN "PayrollPeriod" period ON period.id = confirmation."periodId"
      WHERE period."companyId" = company.id
        AND period.year = 2026
        AND period.month IN (9, 10)
    ),
    (
      SELECT COALESCE(SUM(confirmation.amount), 0)::DECIMAL(14, 2)
      FROM "PayrollPaymentConfirmation" confirmation
      JOIN "PayrollPeriod" period ON period.id = confirmation."periodId"
      WHERE period."companyId" = company.id
        AND period.year = 2026
        AND period.month IN (9, 10)
    )
  INTO
    actual_payment_count,
    actual_payment_total,
    actual_confirmation_count,
    actual_confirmation_total
  FROM "Company" company
  WHERE company.slug = 'altyn-sapa-company';

  IF expected_payment_count IS DISTINCT FROM actual_payment_count
    OR expected_payment_total IS DISTINCT FROM actual_payment_total
    OR expected_confirmation_count IS DISTINCT FROM actual_confirmation_count
    OR expected_confirmation_total IS DISTINCT FROM actual_confirmation_total THEN
    RAISE EXCEPTION
      'Legacy reconciliation changed payments/confirmations';
  END IF;
END $$;

DROP TABLE "_LegacyAutomaticSalaryRestore";
DROP TABLE "_LegacyMeasurerComponent";
DROP TABLE "_LegacyWrongMonthBonus";
DROP TABLE "_LegacyFinancialSnapshot";

COMMIT;
