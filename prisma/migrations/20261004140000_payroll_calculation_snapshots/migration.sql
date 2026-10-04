-- Separate a prepared payroll calculation from its explicit confirmation.
-- Bonus decisions are pinned to one earned payroll period so later edits do
-- not move the bonus into the month in which the edit happened.
BEGIN;

LOCK TABLE
  "Company",
  "User",
  "Order",
  "EmployeePayrollProfile",
  "PayrollPeriod",
  "PayrollOrderBonusDecision",
  "PayrollAccrual",
  "CompanyLedgerEntry",
  "PayrollAuditEvent"
IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "PayrollOrderBonusDecision"
  ADD COLUMN IF NOT EXISTS "periodId" INTEGER,
  ADD COLUMN IF NOT EXISTS "earnedAt" TIMESTAMP(3);

-- orderReceivedAt is the factual business date. Prisma stores it as a UTC
-- timestamp without zone, so convert through UTC before extracting the
-- company's local (normally Asia/Almaty) year and month.
INSERT INTO "PayrollPeriod" ("companyId", "year", "month", "createdAt", "updatedAt")
SELECT DISTINCT
  decision."companyId",
  EXTRACT(YEAR FROM (
    customer_order."orderReceivedAt" AT TIME ZONE 'UTC'
      AT TIME ZONE COALESCE(NULLIF(company."timezone", ''), 'Asia/Almaty')
  ))::INTEGER,
  EXTRACT(MONTH FROM (
    customer_order."orderReceivedAt" AT TIME ZONE 'UTC'
      AT TIME ZONE COALESCE(NULLIF(company."timezone", ''), 'Asia/Almaty')
  ))::INTEGER,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "PayrollOrderBonusDecision" decision
JOIN "Order" customer_order ON customer_order.id = decision."orderId"
JOIN "Company" company ON company.id = decision."companyId"
WHERE decision."periodId" IS NULL
ON CONFLICT ("companyId", "year", "month") DO NOTHING;

UPDATE "PayrollOrderBonusDecision" decision
SET
  "periodId" = period.id,
  "earnedAt" = customer_order."orderReceivedAt"
FROM "Order" customer_order
JOIN "Company" company ON company.id = customer_order."companyId"
JOIN "PayrollPeriod" period
  ON period."companyId" = customer_order."companyId"
 AND period."year" = EXTRACT(YEAR FROM (
      customer_order."orderReceivedAt" AT TIME ZONE 'UTC'
        AT TIME ZONE COALESCE(NULLIF(company."timezone", ''), 'Asia/Almaty')
    ))::INTEGER
 AND period."month" = EXTRACT(MONTH FROM (
      customer_order."orderReceivedAt" AT TIME ZONE 'UTC'
        AT TIME ZONE COALESCE(NULLIF(company."timezone", ''), 'Asia/Almaty')
    ))::INTEGER
WHERE decision."orderId" = customer_order.id
  AND decision."companyId" = customer_order."companyId"
  AND (decision."periodId" IS NULL OR decision."earnedAt" IS NULL);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "PayrollOrderBonusDecision"
    WHERE "periodId" IS NULL OR "earnedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Unable to assign an earned payroll period to every order bonus decision';
  END IF;
END $$;

ALTER TABLE "PayrollOrderBonusDecision"
  ALTER COLUMN "periodId" SET NOT NULL,
  ALTER COLUMN "earnedAt" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PayrollOrderBonusDecision_periodId_fkey'
  ) THEN
    ALTER TABLE "PayrollOrderBonusDecision"
      ADD CONSTRAINT "PayrollOrderBonusDecision_periodId_fkey"
      FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "PayrollOrderBonusDecision_periodId_employeeId_idx"
  ON "PayrollOrderBonusDecision" ("periodId", "employeeId");

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
    JOIN "PayrollPeriod" period
      ON period.id = NEW."periodId"
    WHERE customer_order.id = NEW."orderId"
      AND customer_order."companyId" = NEW."companyId"
      AND employee."companyId" = NEW."companyId"
      AND author."companyId" = NEW."companyId"
      AND period."companyId" = NEW."companyId"
  ) THEN
    RAISE EXCEPTION
      'Payroll order bonus decision crosses tenant boundary'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS "PayrollCalculationSnapshot" (
  "id" SERIAL PRIMARY KEY,
  "companyId" INTEGER NOT NULL
    DEFAULT current_setting('app.current_company_id', true)::integer,
  "employeeId" INTEGER NOT NULL,
  "periodId" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL,
  "salaryAmount" DECIMAL(14, 2) NOT NULL,
  "orderBonusAmount" DECIMAL(14, 2) NOT NULL,
  "otherBonusAmount" DECIMAL(14, 2) NOT NULL,
  "premiumAmount" DECIMAL(14, 2) NOT NULL,
  "deductionAmount" DECIMAL(14, 2) NOT NULL,
  "preparedAmount" DECIMAL(14, 2) NOT NULL,
  "calculationHash" TEXT NOT NULL,
  "source" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "approvedById" INTEGER NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "previousSnapshotId" INTEGER,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollCalculationSnapshot_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayrollCalculationSnapshot_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "EmployeePayrollProfile"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayrollCalculationSnapshot_periodId_fkey"
    FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayrollCalculationSnapshot_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayrollCalculationSnapshot_previousSnapshotId_fkey"
    FOREIGN KEY ("previousSnapshotId") REFERENCES "PayrollCalculationSnapshot"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayrollCalculationSnapshot_component_amounts_check"
    CHECK (
      "salaryAmount" >= 0
      AND "orderBonusAmount" >= 0
      AND "otherBonusAmount" >= 0
      AND "premiumAmount" >= 0
      AND "deductionAmount" >= 0
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "PayrollCalculationSnapshot_idempotencyKey_key"
  ON "PayrollCalculationSnapshot" ("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollCalculationSnapshot_previousSnapshotId_key"
  ON "PayrollCalculationSnapshot" ("previousSnapshotId");
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollCalculationSnapshot_periodId_employeeId_revision_key"
  ON "PayrollCalculationSnapshot" ("periodId", "employeeId", "revision");
CREATE INDEX IF NOT EXISTS "PayrollCalculationSnapshot_companyId_periodId_employeeId_revision_idx"
  ON "PayrollCalculationSnapshot" ("companyId", "periodId", "employeeId", "revision");
CREATE INDEX IF NOT EXISTS "PayrollCalculationSnapshot_employeeId_periodId_approvedAt_idx"
  ON "PayrollCalculationSnapshot" ("employeeId", "periodId", "approvedAt");

ALTER TABLE "CompanyLedgerEntry"
  ADD COLUMN IF NOT EXISTS "payrollCalculationSnapshotId" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CompanyLedgerEntry_payrollCalculationSnapshotId_fkey'
  ) THEN
    ALTER TABLE "CompanyLedgerEntry"
      ADD CONSTRAINT "CompanyLedgerEntry_payrollCalculationSnapshotId_fkey"
      FOREIGN KEY ("payrollCalculationSnapshotId")
      REFERENCES "PayrollCalculationSnapshot"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS
  "CompanyLedgerEntry_payrollCalculationSnapshotId_key"
  ON "CompanyLedgerEntry" ("payrollCalculationSnapshotId");

CREATE OR REPLACE FUNCTION "validate_payroll_calculation_ledger_tenant"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."payrollCalculationSnapshotId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "PayrollCalculationSnapshot" snapshot
    WHERE snapshot.id = NEW."payrollCalculationSnapshotId"
      AND snapshot."companyId" = NEW."companyId"
      AND snapshot."employeeId" = NEW."employeeId"
  ) THEN
    RAISE EXCEPTION
      'Payroll calculation ledger entry crosses tenant or employee boundary'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "CompanyLedgerEntry_validate_payroll_calculation"
  ON "CompanyLedgerEntry";
CREATE TRIGGER "CompanyLedgerEntry_validate_payroll_calculation"
BEFORE INSERT OR UPDATE ON "CompanyLedgerEntry"
FOR EACH ROW
EXECUTE FUNCTION "validate_payroll_calculation_ledger_tenant"();

CREATE OR REPLACE FUNCTION "validate_payroll_calculation_snapshot_tenant"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "EmployeePayrollProfile" employee
    JOIN "PayrollPeriod" period ON period.id = NEW."periodId"
    JOIN "User" approver ON approver.id = NEW."approvedById"
    WHERE employee.id = NEW."employeeId"
      AND employee."companyId" = NEW."companyId"
      AND period."companyId" = NEW."companyId"
      AND approver."companyId" = NEW."companyId"
  ) THEN
    RAISE EXCEPTION
      'Payroll calculation snapshot crosses tenant boundary'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."previousSnapshotId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "PayrollCalculationSnapshot" previous
    WHERE previous.id = NEW."previousSnapshotId"
      AND previous."companyId" = NEW."companyId"
      AND previous."employeeId" = NEW."employeeId"
      AND previous."periodId" = NEW."periodId"
      AND previous."revision" + 1 = NEW."revision"
  ) THEN
    RAISE EXCEPTION
      'Payroll calculation correction does not continue the same calculation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "PayrollCalculationSnapshot_validate_tenant"
  ON "PayrollCalculationSnapshot";
CREATE TRIGGER "PayrollCalculationSnapshot_validate_tenant"
BEFORE INSERT OR UPDATE ON "PayrollCalculationSnapshot"
FOR EACH ROW
EXECUTE FUNCTION "validate_payroll_calculation_snapshot_tenant"();

-- Preserve legacy manual confirmations as revision 1. Automatic order bonus
-- accruals and automatic reconciliation rows are intentionally excluded.
WITH active_legacy AS (
  SELECT accrual.*
  FROM "PayrollAccrual" accrual
  WHERE accrual."reversalOfId" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "PayrollAccrual" reversal
      WHERE reversal."reversalOfId" = accrual.id
    )
    AND accrual."type" NOT IN ('ORDER_BONUS', 'GUARANTEED_ORDER_BONUS')
    AND (
      accrual."type" <> 'MEASUREMENT_BONUS'
      OR EXISTS (
        SELECT 1
        FROM "Order" measurement_order
        WHERE measurement_order.id = accrual."orderId"
          AND measurement_order."companyId" = (
            SELECT employee."companyId"
            FROM "EmployeePayrollProfile" employee
            WHERE employee.id = accrual."employeeId"
          )
          AND measurement_order."responsibleType" = 'EMPLOYEE'
      )
    )
    AND accrual."reason" NOT LIKE 'Автопроверка бонуса за заказ%'
    AND accrual."reason" NOT LIKE 'Автопроверка оклада%'
    AND accrual."idempotencyKey" NOT LIKE 'payroll-policy:%'
    AND (
      accrual."type" <> 'BASE_SALARY'
      OR EXISTS (
        SELECT 1
        FROM "PayrollAuditEvent" confirmation_audit
        WHERE confirmation_audit."periodId" = accrual."periodId"
          AND confirmation_audit."employeeId" = accrual."employeeId"
          AND confirmation_audit."actorId" = accrual."approvedById"
          AND confirmation_audit."action" = 'PAYROLL_ACCRUAL_CREATED'
          AND confirmation_audit."after" @> jsonb_build_object(
            'accrualId', accrual.id,
            'type', 'BASE_SALARY'
          )
      )
    )
), grouped AS (
  SELECT
    period."companyId",
    accrual."employeeId",
    accrual."periodId",
    GREATEST(COALESCE(SUM(CASE
      WHEN accrual."type" = 'BASE_SALARY'
      THEN CASE WHEN accrual."direction" = 'INCREASE' THEN accrual."amount" ELSE -accrual."amount" END
      ELSE 0 END), 0), 0)::DECIMAL(14, 2) AS salary,
    COALESCE(SUM(CASE
      WHEN accrual."type" IN ('MEASUREMENT_BONUS', 'EXTRA_BONUS', 'ADJUSTMENT_INCREASE')
        AND accrual."direction" = 'INCREASE'
      THEN accrual."amount" ELSE 0 END), 0)::DECIMAL(14, 2) AS other_bonus,
    COALESCE(SUM(CASE
      WHEN accrual."type" = 'PREMIUM' AND accrual."direction" = 'INCREASE'
      THEN accrual."amount" ELSE 0 END), 0)::DECIMAL(14, 2) AS premium,
    COALESCE(SUM(CASE
      WHEN accrual."direction" = 'DECREASE'
      THEN accrual."amount" ELSE 0 END), 0)::DECIMAL(14, 2) AS deduction,
    (ARRAY_AGG(accrual."approvedById" ORDER BY accrual."approvedAt" DESC, accrual.id DESC))[1] AS approver,
    MAX(accrual."approvedAt") AS approved_at,
    JSONB_AGG(accrual.id ORDER BY accrual.id) AS accrual_ids,
    COALESCE(
      JSONB_AGG(
        jsonb_build_object(
          'id', accrual.id,
          'type', accrual.type,
          'direction', accrual.direction,
          'amount', accrual.amount
        ) ORDER BY accrual.id
      ) FILTER (WHERE accrual.type <> 'BASE_SALARY'),
      '[]'::jsonb
    ) AS calculation_accruals
  FROM active_legacy accrual
  JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
  GROUP BY period."companyId", accrual."employeeId", accrual."periodId"
  HAVING COUNT(*) FILTER (WHERE accrual."type" = 'BASE_SALARY') > 0
), legacy_order_bonuses AS (
  SELECT
    decision."companyId",
    decision."employeeId",
    decision."periodId",
    COALESCE(SUM(decision."manualAmount"), 0)::DECIMAL(14, 2) AS order_bonus,
    JSONB_AGG(
      jsonb_build_object(
        'orderId', decision."orderId",
        'decisionId', decision.id,
        'earnedAt', decision."earnedAt",
        'manualAmount', decision."manualAmount"
      ) ORDER BY decision."orderId", decision.id
    ) AS order_bonuses
  FROM "PayrollOrderBonusDecision" decision
  JOIN "Order" customer_order
    ON customer_order.id = decision."orderId"
   AND customer_order."companyId" = decision."companyId"
  JOIN "EmployeePayrollProfile" employee
    ON employee.id = decision."employeeId"
   AND employee."companyId" = decision."companyId"
  WHERE decision."manualAmount" IS NOT NULL
    AND customer_order."responsibleType" = 'EMPLOYEE'
    AND customer_order."managerUserId" = employee."userId"
  GROUP BY decision."companyId", decision."employeeId", decision."periodId"
)
INSERT INTO "PayrollCalculationSnapshot" (
  "companyId", "employeeId", "periodId", "revision",
  "salaryAmount", "orderBonusAmount", "otherBonusAmount", "premiumAmount",
  "deductionAmount", "preparedAmount", "calculationHash", "source", "reason",
  "approvedById", "approvedAt", "previousSnapshotId", "idempotencyKey",
  "requestHash", "createdAt"
)
SELECT
  grouped."companyId",
  grouped."employeeId",
  grouped."periodId",
  1,
  grouped.salary,
  COALESCE(bonus.order_bonus, 0),
  grouped.other_bonus,
  grouped.premium,
  grouped.deduction,
  grouped.salary + COALESCE(bonus.order_bonus, 0) + grouped.other_bonus + grouped.premium - grouped.deduction,
  md5(grouped."periodId"::TEXT || ':' || grouped."employeeId"::TEXT || ':' || grouped.accrual_ids::TEXT || ':' || COALESCE(bonus.order_bonuses, '[]'::jsonb)::TEXT),
  jsonb_build_object(
    'legacyAccrualIds', grouped.accrual_ids,
    'calculationAccruals', grouped.calculation_accruals,
    'orderBonuses', COALESCE(bonus.order_bonuses, '[]'::jsonb),
    'migrated', TRUE
  ),
  'Перенос ранее подтверждённого ручного начисления',
  grouped.approver,
  grouped.approved_at,
  NULL,
  'legacy-payroll-calculation-snapshot:v1:' || grouped."periodId" || ':' || grouped."employeeId",
  md5('legacy:' || grouped."periodId"::TEXT || ':' || grouped."employeeId"::TEXT || ':' || grouped.accrual_ids::TEXT || ':' || COALESCE(bonus.order_bonuses, '[]'::jsonb)::TEXT),
  grouped.approved_at
FROM grouped
LEFT JOIN legacy_order_bonuses bonus
  ON bonus."companyId" = grouped."companyId"
 AND bonus."employeeId" = grouped."employeeId"
 AND bonus."periodId" = grouped."periodId"
ON CONFLICT ("idempotencyKey") DO NOTHING;

-- Only components absorbed into a migrated explicit confirmation are
-- neutralised. Historical component-only premiums/deductions/extras have no
-- provable full-calculation confirmation, so silently disabling all of their
-- existing P&L entries would lose accounting history.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "CompanyLedgerEntry" ledger
    JOIN "PayrollAccrual" accrual ON accrual.id = ledger."payrollAccrualId"
    JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
    WHERE ledger."companyId" <> period."companyId"
  ) THEN
    RAISE EXCEPTION
      'Payroll component ledger entry crosses tenant boundary'
      USING ERRCODE = '23514';
  END IF;
END $$;

UPDATE "CompanyLedgerEntry" ledger
SET "affectsProfit" = FALSE,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "PayrollAccrual" accrual
JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
WHERE ledger."payrollAccrualId" = accrual.id
  AND ledger."companyId" = period."companyId"
  AND ledger."affectsProfit" = TRUE
  AND EXISTS (
    SELECT 1
    FROM "PayrollCalculationSnapshot" snapshot
    WHERE snapshot."companyId" = ledger."companyId"
      AND snapshot."employeeId" = accrual."employeeId"
      AND snapshot."periodId" = accrual."periodId"
      AND snapshot."idempotencyKey" LIKE
        'legacy-payroll-calculation-snapshot:v1:%'
      AND snapshot.source -> 'legacyAccrualIds' @>
        jsonb_build_array(accrual.id)
  );

-- Recognise the complete confirmed calculation once. Late migration or a
-- replay remains idempotent, and the accounting date stays in its payroll
-- month instead of the date on which the correction was approved.
INSERT INTO "CompanyLedgerEntry" (
  "companyId", type, category, source, direction, amount, "operationDate",
  "employeeId", comment, "authorId", "idempotencyKey", "requestHash",
  "affectsProfit", "payrollCalculationSnapshotId", "createdAt", "updatedAt"
)
SELECT
  snapshot."companyId",
  'PAYROLL_ACCRUAL',
  'SALARY',
  'PAYROLL_CALCULATION',
  CASE WHEN snapshot."preparedAmount" >= 0 THEN 'EXPENSE' ELSE 'INCOME' END,
  ABS(snapshot."preparedAmount"),
  (
    (
      (make_date(period.year, period.month, 1) + INTERVAL '1 month')
        AT TIME ZONE COALESCE(NULLIF(company.timezone, ''), 'Asia/Almaty')
        AT TIME ZONE 'UTC'
    ) - INTERVAL '1 millisecond'
  )::timestamp,
  snapshot."employeeId",
  'Перенос подтверждённого начисления зарплаты',
  snapshot."approvedById",
  'payroll-calculation-snapshot:' || snapshot.id,
  snapshot."requestHash",
  TRUE,
  snapshot.id,
  snapshot."approvedAt",
  CURRENT_TIMESTAMP
FROM "PayrollCalculationSnapshot" snapshot
JOIN "PayrollPeriod" period ON period.id = snapshot."periodId"
JOIN "Company" company ON company.id = snapshot."companyId"
WHERE snapshot."idempotencyKey" LIKE 'legacy-payroll-calculation-snapshot:v1:%'
  AND ABS(snapshot."preparedAmount") >= 0.005
ON CONFLICT ("idempotencyKey") DO NOTHING;

INSERT INTO "PayrollAuditEvent" (
  "action", "actorId", "periodId", "employeeId", "before", "after",
  "reason", "idempotencyKey", "createdAt"
)
SELECT
  'PAYROLL_CALCULATION_MIGRATED',
  snapshot."approvedById",
  snapshot."periodId",
  snapshot."employeeId",
  NULL,
  jsonb_build_object(
    'snapshotId', snapshot.id,
    'revision', snapshot.revision,
    'preparedAmount', snapshot."preparedAmount",
    'calculationHash', snapshot."calculationHash"
  ),
  snapshot.reason,
  snapshot."idempotencyKey" || ':audit',
  snapshot."approvedAt"
FROM "PayrollCalculationSnapshot" snapshot
WHERE snapshot."idempotencyKey" LIKE 'legacy-payroll-calculation-snapshot:v1:%'
ON CONFLICT ("idempotencyKey") DO NOTHING;

COMMIT;
