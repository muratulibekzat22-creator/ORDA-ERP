-- Separate payroll calculation inputs from a director's confirmed monthly
-- accrual.  This migration is additive: previously applied migrations remain
-- immutable, payments are never changed, and every data correction has a
-- deterministic key so the script is safe to re-run.
BEGIN;

-- Keep the payment snapshot, reversals, salary-rate repair, and final
-- assertions in one stable view of the affected accounting data. Reads stay
-- available while payroll/order/profile writes wait for this short migration.
LOCK TABLE
  "Company",
  "User",
  "Order",
  "EmployeePayrollProfile",
  "EmployeeSalaryRate",
  "PayrollPeriod",
  "PayrollAccrual",
  "PayrollPayment",
  "PayrollPaymentConfirmation",
  "PayrollAuditEvent",
  "CompanyLedgerEntry"
IN SHARE ROW EXCLUSIVE MODE;

-- The legacy schema has independent foreign keys, so it can represent an
-- accrual whose period belongs to this company while its employee, order,
-- earned period, actors, or ledger row belongs to another tenant.  Refuse to
-- repair such a row under the target company's accounting identity.  This is
-- intentionally before every DDL/DML statement so a bad production snapshot
-- fails fast and leaves the database untouched.
DO $$
DECLARE
  cross_tenant_accrual_ids TEXT;
BEGIN
  SELECT string_agg(accrual.id::TEXT, ', ' ORDER BY accrual.id)
  INTO cross_tenant_accrual_ids
  FROM "PayrollAccrual" accrual
  JOIN "PayrollPeriod" period
    ON period.id = accrual."periodId"
  JOIN "Company" company
    ON company.id = period."companyId"
  JOIN "EmployeePayrollProfile" employee
    ON employee.id = accrual."employeeId"
  JOIN "User" approved_by
    ON approved_by.id = accrual."approvedById"
  JOIN "User" created_by
    ON created_by.id = accrual."createdById"
  LEFT JOIN "PayrollPeriod" earned_period
    ON earned_period.id = accrual."earnedPeriodId"
  LEFT JOIN "Order" customer_order
    ON customer_order.id = accrual."orderId"
  LEFT JOIN "CompanyLedgerEntry" original_ledger
    ON original_ledger."payrollAccrualId" = accrual.id
  WHERE company.slug = 'altyn-sapa-company'
    AND period."year" = 2026
    AND period."month" IN (9, 10)
    AND (
      employee."companyId" <> period."companyId"
      OR approved_by."companyId" <> period."companyId"
      OR created_by."companyId" <> period."companyId"
      OR (
        earned_period.id IS NOT NULL
        AND earned_period."companyId" <> period."companyId"
      )
      OR (
        customer_order.id IS NOT NULL
        AND customer_order."companyId" <> period."companyId"
      )
      OR (
        original_ledger.id IS NOT NULL
        AND original_ledger."companyId" <> period."companyId"
      )
    );

  IF cross_tenant_accrual_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'Target September payroll accrual(s) cross tenant boundary: %',
      cross_tenant_accrual_ids
      USING ERRCODE = '23514';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type type_row
    JOIN pg_namespace namespace_row
      ON namespace_row.oid = type_row.typnamespace
    WHERE type_row.typname = 'OrderResponsibleType'
      AND namespace_row.nspname = current_schema()
  ) THEN
    CREATE TYPE "OrderResponsibleType" AS ENUM ('EMPLOYEE', 'COMPANY');
  END IF;
END $$;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "responsibleType" "OrderResponsibleType"
  NOT NULL DEFAULT 'COMPANY';

-- A replay may already have the compatibility trigger installed. Remove it
-- before the structural backfill so updating responsibleType cannot rewrite
-- another tenant's display label or legacy manager id as a side effect.
DROP TRIGGER IF EXISTS "Order_normalize_responsibility" ON "Order";

-- Populate the new structural type for every tenant without rewriting any
-- tenant's existing responsible name/id. The actual legacy data correction is
-- deliberately scoped to the requested live company below.
UPDATE "Order"
SET "responsibleType" = CASE
  WHEN "managerUserId" IS NULL THEN 'COMPANY'::"OrderResponsibleType"
  ELSE 'EMPLOYEE'::"OrderResponsibleType"
END;

-- For ALTYN SAPA, the saved Company label is positive structural evidence that
-- a stale employee link must be removed. This is current structural order
-- state rather than a historical payroll-period rewrite, so it is normalized
-- once and then enforced by the trigger for future edits.
-- Other companies remain untouched by this data correction.
UPDATE "Order" customer_order
SET
  "responsibleType" = 'COMPANY'::"OrderResponsibleType",
  "managerUserId" = NULL,
  "manager" = 'Компания'
FROM "Company" company
WHERE company.id = customer_order."companyId"
  AND company.slug = 'altyn-sapa-company'
  AND (
    customer_order."managerUserId" IS NULL
    OR TRANSLATE(
      BTRIM(COALESCE(customer_order."manager", '')),
      'ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯӘҒҚҢӨҰҮҺІ',
      'abcdefghijklmnopqrstuvwxyzабвгдеёжзийклмнопрстуфхцчшщъыьэюяәғқңөұүһі'
    ) IN ('компания', 'company')
  );

-- Compatibility guard for legacy writers that still provide only
-- manager/managerUserId.  The trigger derives the normalized pair before the
-- CHECK constraint is evaluated, while newer application code may write the
-- same values explicitly.
CREATE OR REPLACE FUNCTION "normalize_order_responsibility"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."managerUserId" IS NULL
    OR TRANSLATE(
      BTRIM(COALESCE(NEW."manager", '')),
      'ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯӘҒҚҢӨҰҮҺІ',
      'abcdefghijklmnopqrstuvwxyzабвгдеёжзийклмнопрстуфхцчшщъыьэюяәғқңөұүһі'
    ) IN ('компания', 'company')
  THEN
    NEW."responsibleType" := 'COMPANY'::"OrderResponsibleType";
    NEW."managerUserId" := NULL;
    NEW."manager" := 'Компания';
  ELSE
    NEW."responsibleType" := 'EMPLOYEE'::"OrderResponsibleType";
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Order_normalize_responsibility" ON "Order";
CREATE TRIGGER "Order_normalize_responsibility"
BEFORE INSERT OR UPDATE ON "Order"
FOR EACH ROW
EXECUTE FUNCTION "normalize_order_responsibility"();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Order_responsibleType_managerUserId_check'
      AND conrelid = '"Order"'::regclass
  ) THEN
    ALTER TABLE "Order"
      ADD CONSTRAINT "Order_responsibleType_managerUserId_check"
      CHECK (
        ("responsibleType" = 'COMPANY' AND "managerUserId" IS NULL)
        OR
        ("responsibleType" = 'EMPLOYEE' AND "managerUserId" IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Order_responsibleType_managerUserId_orderReceivedAt_idx"
  ON "Order" ("responsibleType", "managerUserId", "orderReceivedAt");

CREATE TABLE IF NOT EXISTS "PayrollOrderBonusDecision" (
  "id" SERIAL PRIMARY KEY,
  "companyId" INTEGER NOT NULL
    DEFAULT current_setting('app.current_company_id', true)::integer,
  "orderId" INTEGER NOT NULL,
  "employeeId" INTEGER NOT NULL,
  "periodId" INTEGER,
  "earnedAt" TIMESTAMP(3),
  "manualAmount" DECIMAL(14, 2),
  "updatedById" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollOrderBonusDecision_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayrollOrderBonusDecision_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayrollOrderBonusDecision_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "EmployeePayrollProfile"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayrollOrderBonusDecision_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayrollOrderBonusDecision_manualAmount_check"
    CHECK ("manualAmount" IS NULL OR "manualAmount" >= 0)
);

-- A replay after the period-pinning migration already has these columns;
-- ADD IF NOT EXISTS keeps this migration independently repeatable.
ALTER TABLE "PayrollOrderBonusDecision"
  ADD COLUMN IF NOT EXISTS "periodId" INTEGER,
  ADD COLUMN IF NOT EXISTS "earnedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS
  "PayrollOrderBonusDecision_orderId_employeeId_key"
  ON "PayrollOrderBonusDecision" ("orderId", "employeeId");

CREATE INDEX IF NOT EXISTS
  "PayrollOrderBonusDecision_companyId_employeeId_updatedAt_idx"
  ON "PayrollOrderBonusDecision" ("companyId", "employeeId", "updatedAt");

CREATE OR REPLACE FUNCTION "validate_payroll_order_bonus_decision_tenant"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "Order" customer_order
    JOIN "EmployeePayrollProfile" employee
      ON employee.id = NEW."employeeId"
    JOIN "User" author
      ON author.id = NEW."updatedById"
    LEFT JOIN "PayrollPeriod" period
      ON period.id = NEW."periodId"
    WHERE customer_order.id = NEW."orderId"
      AND customer_order."companyId" = NEW."companyId"
      AND employee."companyId" = NEW."companyId"
      AND author."companyId" = NEW."companyId"
      AND (
        NEW."periodId" IS NULL
        OR period."companyId" = NEW."companyId"
      )
  ) THEN
    RAISE EXCEPTION
      'Payroll order bonus decision crosses tenant boundary'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "PayrollOrderBonusDecision_validate_tenant"
  ON "PayrollOrderBonusDecision";
CREATE TRIGGER "PayrollOrderBonusDecision_validate_tenant"
BEFORE INSERT OR UPDATE ON "PayrollOrderBonusDecision"
FOR EACH ROW
EXECUTE FUNCTION "validate_payroll_order_bonus_decision_tenant"();

-- Capture the live September payment invariant before touching any accruals.
-- These rows are checked again at the end; this migration contains no write to
-- PayrollPayment or PayrollPaymentConfirmation.
CREATE TEMP TABLE "_SeptemberPaymentSnapshot" AS
SELECT
  company.id AS "companyId",
  period.id AS "periodId",
  COUNT(payment.id)::INTEGER AS "paymentCount",
  COALESCE(SUM(
    CASE
      WHEN payment."type" = 'EMPLOYEE_REFUND'::"PayrollPaymentType"
        THEN -payment."amount"
      ELSE payment."amount"
    END
  ), 0)::DECIMAL(14, 2) AS "signedTotal"
FROM "Company" company
JOIN "PayrollPeriod" period
  ON period."companyId" = company.id
  AND period."year" = 2026
  AND period."month" = 9
LEFT JOIN "PayrollPayment" payment
  ON payment."periodId" = period.id
  AND payment."reversalOfId" IS NULL
  AND payment."reversedAt" IS NULL
WHERE company.slug = 'altyn-sapa-company'
GROUP BY company.id, period.id;

-- Preserve explicit employee choices from the retired accrual-based bonus UI.
-- ORDER_BONUS is manual only when its creation/correction audit positively
-- records manualOverride=true for this exact accrual.  Legacy bonus edits
-- wrote ORDER_BONUS_CORRECTED for the active replacement accrual, while
-- initial decisions wrote PAYROLL_ACCRUAL_CREATED.  The old UI used both the
-- generic label "Бонус за заказ" and the automatic-reason prefix for system
-- suggestions, so reason text is not evidence of a manual choice.
-- GUARANTEED_ORDER_BONUS was always an explicitly supplied amount and had no
-- automatic-policy mode.
CREATE TEMP TABLE "_LegacyManualBonusDecision" AS
SELECT DISTINCT ON (accrual."orderId", accrual."employeeId")
  period."companyId",
  period.id AS "periodId",
  accrual.id AS "accrualId",
  accrual."orderId",
  accrual."employeeId",
  customer_order."orderReceivedAt" AS "earnedAt",
  accrual."amount" AS "manualAmount",
  accrual."createdById" AS "updatedById"
FROM "PayrollAccrual" accrual
JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
JOIN "Company" company ON company.id = period."companyId"
JOIN "Order" customer_order ON customer_order.id = accrual."orderId"
JOIN "EmployeePayrollProfile" employee ON employee.id = accrual."employeeId"
WHERE company.slug = 'altyn-sapa-company'
  AND period."year" = 2026
  AND period."month" IN (9, 10)
  AND customer_order."responsibleType" = 'EMPLOYEE'
  AND customer_order."managerUserId" = employee."userId"
  AND customer_order."companyId" = period."companyId"
  AND employee."companyId" = period."companyId"
  AND accrual."type" IN ('ORDER_BONUS', 'GUARANTEED_ORDER_BONUS')
  AND accrual."direction" = 'INCREASE'
  AND accrual."reversalOfId" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "PayrollAccrual" reversal
    WHERE reversal."reversalOfId" = accrual.id
  )
  AND (
    accrual."type" = 'GUARANTEED_ORDER_BONUS'
    OR EXISTS (
      SELECT 1
      FROM "PayrollAuditEvent" manual_audit
      WHERE manual_audit.action IN (
          'PAYROLL_ACCRUAL_CREATED',
          'ORDER_BONUS_CORRECTED'
        )
        AND manual_audit."periodId" = accrual."periodId"
        AND manual_audit."employeeId" = accrual."employeeId"
        AND manual_audit."after" @> jsonb_build_object(
          'accrualId', accrual.id,
          'manualOverride', TRUE
        )
    )
  )
ORDER BY
  accrual."orderId",
  accrual."employeeId",
  CASE WHEN accrual."type" = 'ORDER_BONUS' THEN 0 ELSE 1 END,
  accrual."createdAt" DESC,
  accrual.id DESC;

INSERT INTO "PayrollOrderBonusDecision" (
  "companyId", "orderId", "employeeId", "periodId", "earnedAt",
  "manualAmount", "updatedById",
  "createdAt", "updatedAt"
)
SELECT
  legacy."companyId",
  legacy."orderId",
  legacy."employeeId",
  legacy."periodId",
  legacy."earnedAt",
  legacy."manualAmount",
  legacy."updatedById",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_LegacyManualBonusDecision" legacy
ON CONFLICT ("orderId", "employeeId") DO NOTHING;

INSERT INTO "PayrollAuditEvent" (
  "action", "actorId", "periodId", "employeeId", "before", "after",
  "reason", "idempotencyKey", "createdAt"
)
SELECT
  'ORDER_BONUS_DECISION_MIGRATED',
  legacy."updatedById",
  legacy."periodId",
  legacy."employeeId",
  jsonb_build_object(
    'legacyAccrualId', legacy."accrualId",
    'manualBonus', legacy."manualAmount",
    'effectiveBonus', legacy."manualAmount"
  ),
  jsonb_build_object(
    'orderId', legacy."orderId",
    'manualBonus', legacy."manualAmount",
    'effectiveBonus', legacy."manualAmount"
  ),
  'Ручное решение по бонусу перенесено отдельно от начисления зарплаты',
  'payroll-order-bonus-decision:v1:audit:' || legacy."accrualId",
  CURRENT_TIMESTAMP
FROM "_LegacyManualBonusDecision" legacy
ON CONFLICT ("idempotencyKey") DO NOTHING;

DROP TABLE "_LegacyManualBonusDecision";

-- September 2026 was never manually accrued.  Neutralize every still-active
-- base-salary posting in this one company/period, but preserve its immutable
-- history and every factual payment.
CREATE TEMP TABLE "_SeptemberBaseSalaryReset" AS
SELECT
  accrual.id AS "originalId",
  accrual."employeeId",
  accrual."periodId",
  accrual."earnedPeriodId",
  accrual."amount",
  accrual."approvedById",
  accrual."createdById",
  accrual."requestHash",
  period."companyId",
  original_ledger.id AS "originalLedgerId",
  original_ledger."operationDate" AS "originalOperationDate",
  original_ledger."affectsProfit" AS "originalAffectsProfit",
  NULL::INTEGER AS "reversalId"
FROM "PayrollAccrual" accrual
JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
JOIN "Company" company ON company.id = period."companyId"
JOIN "EmployeePayrollProfile" employee
  ON employee.id = accrual."employeeId"
  AND employee."companyId" = period."companyId"
LEFT JOIN "CompanyLedgerEntry" original_ledger
  ON original_ledger."payrollAccrualId" = accrual.id
  AND original_ledger."companyId" = period."companyId"
WHERE company.slug = 'altyn-sapa-company'
  AND period."year" = 2026
  AND period."month" = 9
  AND accrual."type" = 'BASE_SALARY'
  AND accrual."direction" = 'INCREASE'
  AND accrual."reversalOfId" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "PayrollAccrual" reversal
    WHERE reversal."reversalOfId" = accrual.id
  );

INSERT INTO "PayrollAccrual" (
  "employeeId", "periodId", "earnedPeriodId", "type", "direction",
  "amount", "reason", "approvedById", "createdById", "reversalOfId",
  "idempotencyKey", "requestHash", "createdAt"
)
SELECT
  reset."employeeId",
  reset."periodId",
  COALESCE(reset."earnedPeriodId", reset."periodId"),
  'BONUS_REVERSAL',
  'DECREASE',
  reset."amount",
  'Сторно сентябрьского начисления: зарплата за месяц вручную не начислялась',
  reset."approvedById",
  reset."createdById",
  reset."originalId",
  'september-2026-accrual-reset:v1:' || reset."originalId",
  reset."requestHash",
  CURRENT_TIMESTAMP
FROM "_SeptemberBaseSalaryReset" reset
ON CONFLICT ("idempotencyKey") DO NOTHING;

UPDATE "_SeptemberBaseSalaryReset" reset
SET "reversalId" = reversal.id
FROM "PayrollAccrual" reversal
WHERE reversal."reversalOfId" = reset."originalId";

INSERT INTO "CompanyLedgerEntry" (
  "companyId", "type", "category", "direction", "source", "amount",
  "operationDate", "comment", "employeeId", "authorId", "idempotencyKey",
  "requestHash", "affectsProfit", "payrollAccrualId", "createdAt", "updatedAt"
)
SELECT
  reset."companyId",
  'PAYROLL_ACCRUAL',
  'SALARY',
  'INCOME',
  'OTHER_SYSTEM',
  reset."amount",
  reset."originalOperationDate",
  'Сторно сентябрьского начисления: зарплата за месяц вручную не начислялась',
  reset."employeeId",
  reset."approvedById",
  'payroll-accrual:' || reset."reversalId",
  reset."requestHash",
  reset."originalAffectsProfit",
  reset."reversalId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_SeptemberBaseSalaryReset" reset
WHERE reset."reversalId" IS NOT NULL
  AND reset."originalLedgerId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

INSERT INTO "PayrollAuditEvent" (
  "action", "actorId", "periodId", "employeeId", "before", "after",
  "reason", "idempotencyKey", "createdAt"
)
SELECT
  'PAYROLL_ACCRUAL_REVERSED',
  reset."approvedById",
  reset."periodId",
  reset."employeeId",
  jsonb_build_object(
    'accrualId', reset."originalId",
    'type', 'BASE_SALARY',
    'amount', reset."amount"
  ),
  jsonb_build_object('reversalId', reset."reversalId"),
  'Сентябрь 2026 ещё не был начислен вручную; выплата сохранена отдельно',
  'september-2026-accrual-reset:v1:audit:' || reset."originalId",
  CURRENT_TIMESTAMP
FROM "_SeptemberBaseSalaryReset" reset
WHERE reset."reversalId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

DROP TABLE "_SeptemberBaseSalaryReset";

-- Order bonuses are calculation inputs, not confirmed salary accruals.  Move
-- every still-active September/October order-bonus posting for the target
-- company out of the accrual ledger
-- after preserving explicit employee choices above.  Related payments remain
-- factual payment rows and current COMPANY ownership still forces entitlement
-- to zero in the application service.
CREATE TEMP TABLE "_SeptemberOrderBonusReset" AS
SELECT
  accrual.id AS "originalId",
  accrual."employeeId",
  accrual."periodId",
  accrual."earnedPeriodId",
  accrual."type" AS "originalType",
  accrual."amount",
  accrual."orderId",
  accrual."approvedById",
  accrual."createdById",
  accrual."requestHash",
  period."companyId",
  original_ledger.id AS "originalLedgerId",
  original_ledger."operationDate" AS "originalOperationDate",
  original_ledger."affectsProfit" AS "originalAffectsProfit",
  NULL::INTEGER AS "reversalId"
FROM "PayrollAccrual" accrual
JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
JOIN "Company" company ON company.id = period."companyId"
JOIN "EmployeePayrollProfile" employee
  ON employee.id = accrual."employeeId"
  AND employee."companyId" = period."companyId"
LEFT JOIN "Order" customer_order
  ON customer_order.id = accrual."orderId"
  AND customer_order."companyId" = period."companyId"
LEFT JOIN "CompanyLedgerEntry" original_ledger
  ON original_ledger."payrollAccrualId" = accrual.id
  AND original_ledger."companyId" = period."companyId"
WHERE company.slug = 'altyn-sapa-company'
  AND period."year" = 2026
  AND period."month" IN (9, 10)
  AND accrual."type" IN ('ORDER_BONUS', 'GUARANTEED_ORDER_BONUS')
  AND accrual."direction" = 'INCREASE'
  AND (accrual."orderId" IS NULL OR customer_order.id IS NOT NULL)
  AND accrual."reversalOfId" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "PayrollAccrual" reversal
    WHERE reversal."reversalOfId" = accrual.id
  );

UPDATE "PayrollAccrual" accrual
SET "orderBonusUniquenessKey" = NULL
FROM "_SeptemberOrderBonusReset" reset
WHERE accrual.id = reset."originalId";

INSERT INTO "PayrollAccrual" (
  "employeeId", "periodId", "earnedPeriodId", "type", "direction",
  "amount", "orderId", "reason", "approvedById", "createdById",
  "reversalOfId", "idempotencyKey", "requestHash", "createdAt"
)
SELECT
  reset."employeeId",
  reset."periodId",
  COALESCE(reset."earnedPeriodId", reset."periodId"),
  'BONUS_REVERSAL',
  'DECREASE',
  reset."amount",
  reset."orderId",
  CASE
    WHEN reset."orderId" IS NOT NULL THEN
      'Сторно старого бонус-начисления: бонус заказа хранится как решение расчёта'
    ELSE
      'Сторно старого бонус-начисления без заказа'
  END,
  reset."approvedById",
  reset."createdById",
  reset."originalId",
  'september-2026-order-bonus-reset:v1:' || reset."originalId",
  reset."requestHash",
  CURRENT_TIMESTAMP
FROM "_SeptemberOrderBonusReset" reset
ON CONFLICT ("idempotencyKey") DO NOTHING;

UPDATE "_SeptemberOrderBonusReset" reset
SET "reversalId" = reversal.id
FROM "PayrollAccrual" reversal
WHERE reversal."reversalOfId" = reset."originalId";

INSERT INTO "CompanyLedgerEntry" (
  "companyId", "type", "category", "direction", "source", "amount",
  "operationDate", "comment", "orderId", "employeeId", "authorId",
  "idempotencyKey", "requestHash", "affectsProfit", "payrollAccrualId",
  "createdAt", "updatedAt"
)
SELECT
  reset."companyId",
  'PAYROLL_ACCRUAL',
  'SALARY',
  'INCOME',
  'OTHER_SYSTEM',
  reset."amount",
  reset."originalOperationDate",
  'Сторно старого бонус-начисления: бонус заказа хранится отдельно от начисления зарплаты',
  reset."orderId",
  reset."employeeId",
  reset."approvedById",
  'payroll-accrual:' || reset."reversalId",
  reset."requestHash",
  reset."originalAffectsProfit",
  reset."reversalId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_SeptemberOrderBonusReset" reset
WHERE reset."reversalId" IS NOT NULL
  AND reset."originalLedgerId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

INSERT INTO "PayrollAuditEvent" (
  "action", "actorId", "periodId", "employeeId", "before", "after",
  "reason", "idempotencyKey", "createdAt"
)
SELECT
  'ORDER_BONUS_ACCRUAL_RETIRED',
  reset."approvedById",
  reset."periodId",
  reset."employeeId",
  jsonb_build_object(
    'accrualId', reset."originalId",
    'type', reset."originalType",
    'orderId', reset."orderId",
    'amount', reset."amount"
  ),
  jsonb_build_object('reversalId', reset."reversalId"),
  'Старое бонус-начисление отделено от расчётного решения; фактические выплаты сохранены',
  'september-2026-order-bonus-reset:v1:audit:' || reset."originalId",
  CURRENT_TIMESTAMP
FROM "_SeptemberOrderBonusReset" reset
WHERE reset."reversalId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

DROP TABLE "_SeptemberOrderBonusReset";

-- Empty compatibility relation retained only because the final verification
-- below predates the removal of an unverified salary-autofill draft. A fresh
-- migration never selects an employee or writes a salary condition. Migration
-- 15:00 remains the backward repair for a database that ran the old draft.
CREATE TEMP TABLE "_OctoberMeasurerTargets" AS
SELECT NULL::INTEGER AS "employeeId", NULL::INTEGER AS "approvedById"
WHERE FALSE;

-- If the later revocation migration has already removed this unverified
-- autofill, replaying the chain must not recreate it.

DO $$
DECLARE
  target_count INTEGER;
  missing_approver_count INTEGER;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE "approvedById" IS NULL)
  INTO target_count, missing_approver_count
  FROM "_OctoberMeasurerTargets";

  IF target_count NOT IN (0, 2) THEN
    RAISE EXCEPTION
      'Expected either zero corrected or two pending October measurers, found %',
      target_count;
  END IF;

  IF missing_approver_count <> 0 THEN
    RAISE EXCEPTION
      'Cannot restore October measurer salary without an approving director';
  END IF;
END $$;

UPDATE "EmployeePayrollProfile" profile
SET
  "hiredAt" = TIMESTAMP '2026-09-30 19:00:00',
  "baseSalary" = 0.00,
  "salaryPlanEnabled" = FALSE,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_OctoberMeasurerTargets" target
WHERE profile.id = target."employeeId"
  AND (
    profile."hiredAt" IS DISTINCT FROM TIMESTAMP '2026-09-30 19:00:00'
    OR profile."baseSalary" IS DISTINCT FROM 0.00
    OR profile."salaryPlanEnabled" IS DISTINCT FROM FALSE
  );

-- Rates before October end exactly at the local month boundary.
UPDATE "EmployeeSalaryRate" rate
SET "effectiveTo" = TIMESTAMP '2026-09-30 19:00:00',
    "planEnabled" = FALSE
FROM "_OctoberMeasurerTargets" target
WHERE rate."employeeId" = target."employeeId"
  AND rate."effectiveFrom" < TIMESTAMP '2026-09-30 19:00:00'
  AND (rate."effectiveTo" IS NULL OR rate."effectiveTo" > TIMESTAMP '2026-09-30 19:00:00');

CREATE TEMP TABLE "_OctoberMeasurerCanonicalRate" AS
SELECT
  target."employeeId",
  target."approvedById",
  (
    SELECT rate.id
    FROM "EmployeeSalaryRate" rate
    WHERE rate."employeeId" = target."employeeId"
      AND rate."effectiveFrom" >= TIMESTAMP '2026-09-30 19:00:00'
      AND rate."effectiveFrom" < TIMESTAMP '2026-10-31 19:00:00'
    ORDER BY rate."effectiveFrom", rate.id
    LIMIT 1
  ) AS "rateId"
FROM "_OctoberMeasurerTargets" target;

INSERT INTO "EmployeeSalaryRate" (
  "employeeId", "amount", "planEnabled", "effectiveFrom", "effectiveTo",
  "approvedById", "comment", "createdAt"
)
SELECT
  canonical."employeeId",
  0.00,
  FALSE,
  TIMESTAMP '2026-09-30 19:00:00',
  (
    SELECT MIN(rate."effectiveFrom")
    FROM "EmployeeSalaryRate" rate
    WHERE rate."employeeId" = canonical."employeeId"
      AND rate."effectiveFrom" >= TIMESTAMP '2026-10-31 19:00:00'
  ),
  canonical."approvedById",
  'Retired salary-autofill compatibility row',
  CURRENT_TIMESTAMP
FROM "_OctoberMeasurerCanonicalRate" canonical
WHERE canonical."rateId" IS NULL;

UPDATE "_OctoberMeasurerCanonicalRate" canonical
SET "rateId" = rate.id
FROM "EmployeeSalaryRate" rate
WHERE rate."employeeId" = canonical."employeeId"
  AND rate."effectiveFrom" >= TIMESTAMP '2026-09-30 19:00:00'
  AND rate."effectiveFrom" < TIMESTAMP '2026-10-31 19:00:00'
  AND rate.id = (
    SELECT candidate.id
    FROM "EmployeeSalaryRate" candidate
    WHERE candidate."employeeId" = canonical."employeeId"
      AND candidate."effectiveFrom" >= TIMESTAMP '2026-09-30 19:00:00'
      AND candidate."effectiveFrom" < TIMESTAMP '2026-10-31 19:00:00'
    ORDER BY candidate."effectiveFrom", candidate.id
    LIMIT 1
  );

-- Retire redundant October rows outside the employee's employment interval so
-- the service cannot accidentally select a disabled legacy rate first.
UPDATE "EmployeeSalaryRate" rate
SET
  "effectiveFrom" = TIMESTAMP '2026-09-30 18:59:59.999',
  "effectiveTo" = TIMESTAMP '2026-09-30 18:59:59.999',
  "planEnabled" = FALSE
FROM "_OctoberMeasurerCanonicalRate" canonical
WHERE rate."employeeId" = canonical."employeeId"
  AND rate.id <> canonical."rateId"
  AND rate."effectiveFrom" >= TIMESTAMP '2026-09-30 19:00:00'
  AND rate."effectiveFrom" < TIMESTAMP '2026-10-31 19:00:00';

UPDATE "EmployeeSalaryRate" rate
SET
  "amount" = 0.00,
  "planEnabled" = FALSE,
  "effectiveFrom" = TIMESTAMP '2026-09-30 19:00:00',
  "effectiveTo" = (
    SELECT MIN(next_rate."effectiveFrom")
    FROM "EmployeeSalaryRate" next_rate
    WHERE next_rate."employeeId" = rate."employeeId"
      AND next_rate.id <> rate.id
      AND next_rate."effectiveFrom" >= TIMESTAMP '2026-10-31 19:00:00'
  ),
  "approvedById" = canonical."approvedById",
  "comment" = 'Retired salary-autofill compatibility row'
FROM "_OctoberMeasurerCanonicalRate" canonical
WHERE rate.id = canonical."rateId";

INSERT INTO "PayrollAuditEvent" (
  "action", "actorId", "periodId", "employeeId", "before", "after",
  "reason", "idempotencyKey", "createdAt"
)
SELECT
  'SALARY_CHANGED',
  target."approvedById",
  period.id,
  target."employeeId",
  NULL,
  jsonb_build_object(
    'amount', 0,
    'effectiveFrom', '2026-10-01T00:00:00+05:00',
    'timeZone', 'Asia/Almaty'
  ),
  'Retired salary-autofill compatibility audit',
  'october-2026-measurer-rate:v1:audit:' || target."employeeId",
  CURRENT_TIMESTAMP
FROM "_OctoberMeasurerTargets" target
LEFT JOIN "EmployeePayrollProfile" profile ON profile.id = target."employeeId"
LEFT JOIN "PayrollPeriod" period
  ON period."companyId" = profile."companyId"
  AND period."year" = 2026
  AND period."month" = 10
ON CONFLICT ("idempotencyKey") DO NOTHING;

DROP TABLE "_OctoberMeasurerCanonicalRate";

-- Fail atomically if any scoped accounting invariant is not true.
DO $$
DECLARE
  snapshot_count INTEGER;
  payment_count_before INTEGER;
  payment_count_after INTEGER;
  payment_total_before NUMERIC(14, 2);
  payment_total_after NUMERIC(14, 2);
  active_salary_count INTEGER;
  active_order_bonus_count INTEGER;
  invalid_responsibility_count INTEGER;
  invalid_measurer_count INTEGER;
BEGIN
  SELECT COUNT(*), COALESCE(MAX("paymentCount"), 0), COALESCE(MAX("signedTotal"), 0)
  INTO snapshot_count, payment_count_before, payment_total_before
  FROM "_SeptemberPaymentSnapshot";

  IF snapshot_count <> 1 THEN
    RAISE EXCEPTION
      'Expected one ALTYN SAPA September 2026 payroll period, found %',
      snapshot_count;
  END IF;

  SELECT
    COUNT(payment.id)::INTEGER,
    COALESCE(SUM(
      CASE
        WHEN payment."type" = 'EMPLOYEE_REFUND'::"PayrollPaymentType"
          THEN -payment."amount"
        ELSE payment."amount"
      END
    ), 0)::DECIMAL(14, 2)
  INTO payment_count_after, payment_total_after
  FROM "PayrollPayment" payment
  JOIN "PayrollPeriod" period ON period.id = payment."periodId"
  JOIN "Company" company ON company.id = period."companyId"
  WHERE company.slug = 'altyn-sapa-company'
    AND period."year" = 2026
    AND period."month" = 9
    AND payment."reversalOfId" IS NULL
    AND payment."reversedAt" IS NULL;

  IF payment_count_before IS DISTINCT FROM payment_count_after
    OR payment_total_before IS DISTINCT FROM payment_total_after THEN
    RAISE EXCEPTION
      'September payments changed (before % / %, after % / %)',
      payment_count_before,
      payment_total_before,
      payment_count_after,
      payment_total_after;
  END IF;

  SELECT COUNT(*)
  INTO active_salary_count
  FROM "PayrollAccrual" accrual
  JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
  JOIN "Company" company ON company.id = period."companyId"
  WHERE company.slug = 'altyn-sapa-company'
    AND period."year" = 2026
    AND period."month" = 9
    AND accrual."type" = 'BASE_SALARY'
    AND accrual."direction" = 'INCREASE'
    AND accrual."reversalOfId" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "PayrollAccrual" reversal
      WHERE reversal."reversalOfId" = accrual.id
    );

  IF active_salary_count <> 0 THEN
    RAISE EXCEPTION
      'September 2026 still has % active salary accrual(s)',
      active_salary_count;
  END IF;

  SELECT COUNT(*)
  INTO active_order_bonus_count
  FROM "PayrollAccrual" accrual
  JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
  JOIN "Company" company ON company.id = period."companyId"
  WHERE company.slug = 'altyn-sapa-company'
    AND period."year" = 2026
    AND period."month" = 9
    AND accrual."type" IN ('ORDER_BONUS', 'GUARANTEED_ORDER_BONUS')
    AND accrual."direction" = 'INCREASE'
    AND accrual."reversalOfId" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "PayrollAccrual" reversal
      WHERE reversal."reversalOfId" = accrual.id
    );

  IF active_order_bonus_count <> 0 THEN
    RAISE EXCEPTION
      'September 2026 still has % active legacy order-bonus accrual(s)',
      active_order_bonus_count;
  END IF;

  SELECT COUNT(*)
  INTO invalid_responsibility_count
  FROM "Order"
  WHERE ("responsibleType" = 'COMPANY' AND "managerUserId" IS NOT NULL)
     OR ("responsibleType" = 'EMPLOYEE' AND "managerUserId" IS NULL);

  IF invalid_responsibility_count <> 0 THEN
    RAISE EXCEPTION
      'Order responsibility verification found % inconsistent row(s)',
      invalid_responsibility_count;
  END IF;

  SELECT COUNT(*)
  INTO invalid_measurer_count
  FROM "_OctoberMeasurerTargets" target
  JOIN "EmployeePayrollProfile" profile ON profile.id = target."employeeId"
  WHERE profile."hiredAt" <> TIMESTAMP '2026-09-30 19:00:00'
    OR profile."baseSalary" <> 0.00
    OR profile."salaryPlanEnabled" = TRUE
    OR NOT EXISTS (
      SELECT 1
      FROM "EmployeeSalaryRate" rate
      WHERE rate."employeeId" = profile.id
        AND rate."amount" = 0.00
        AND rate."planEnabled" = FALSE
        AND rate."effectiveFrom" = TIMESTAMP '2026-09-30 19:00:00'
        AND (rate."effectiveTo" IS NULL OR rate."effectiveTo" > TIMESTAMP '2026-09-30 19:00:00')
    );

  IF invalid_measurer_count <> 0 THEN
    RAISE EXCEPTION
      'October salary verification failed for % measurer(s)',
      invalid_measurer_count;
  END IF;
END $$;

DROP TABLE "_OctoberMeasurerTargets";
DROP TABLE "_SeptemberPaymentSnapshot";

COMMIT;
