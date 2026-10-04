-- Exclude qualifying founder/marketer profiles from the September 2026 salary
-- plan only when that month has no saved payroll calculation. Saved salary
-- rates, not role-based constants, are the source of the amount restored from
-- October onward. An existing audit marker makes a replay a true no-op even
-- after a later salary, role, employment, or account-status change.
--
-- Asia/Almaty month boundaries are stored as UTC timestamps:
--   September: [2026-08-31 19:00:00, 2026-09-30 19:00:00)
BEGIN;

LOCK TABLE
  "Company",
  "User",
  "EmployeePayrollProfile",
  "EmployeeSalaryRate",
  "PayrollPeriod",
  "PayrollOrderBonusDecision",
  "PayrollAccrual",
  "PayrollPayment",
  "PayrollPaymentConfirmation",
  "PayrollAuditEvent"
IN SHARE ROW EXCLUSIVE MODE;

-- PayrollCalculationSnapshot is introduced by a later migration on a fresh
-- chain, but it already exists when this SQL is deliberately replayed after a
-- deployment. Capture it dynamically so a confirmed calculation can never be
-- mistaken for an unused September profile during such a replay.
CREATE TEMP TABLE "_SeptemberSnapshotFacts" (
  "employeeId" INTEGER PRIMARY KEY
);

DO $$
BEGIN
  IF to_regclass('"PayrollCalculationSnapshot"') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO "_SeptemberSnapshotFacts" ("employeeId")
      SELECT DISTINCT snapshot."employeeId"
      FROM "PayrollCalculationSnapshot" snapshot
      JOIN "PayrollPeriod" period ON period.id = snapshot."periodId"
      JOIN "Company" company ON company.id = period."companyId"
      WHERE company.slug = 'altyn-sapa-company'
        AND period.year = 2026
        AND period.month = 9
      ON CONFLICT ("employeeId") DO NOTHING
    $sql$;
  END IF;
END $$;

CREATE TEMP TABLE "_SeptemberNoPlanTargets" AS
WITH applied AS (
  SELECT DISTINCT ON (profile.id)
    profile.id AS "employeeId",
    profile."companyId",
    period.id AS "periodId",
    TRUE AS "alreadyApplied"
  FROM "PayrollAuditEvent" audit
  JOIN "EmployeePayrollProfile" profile
    ON profile.id = audit."employeeId"
  JOIN "Company" company
    ON company.id = profile."companyId"
  JOIN "PayrollPeriod" period
    ON period.id = audit."periodId"
   AND period."companyId" = profile."companyId"
   AND period.year = 2026
   AND period.month = 9
  WHERE company.slug = 'altyn-sapa-company'
    AND audit."idempotencyKey" =
      'september-2026-no-salary-plan:v1:' || profile.id
  ORDER BY profile.id, audit.id DESC
), fresh AS (
  SELECT
    profile.id AS "employeeId",
    profile."companyId",
    period.id AS "periodId",
    FALSE AS "alreadyApplied"
  FROM "EmployeePayrollProfile" profile
  JOIN "Company" company
    ON company.id = profile."companyId"
  JOIN "User" account
    ON account.id = profile."userId"
   AND account."companyId" = profile."companyId"
  JOIN "PayrollPeriod" period
    ON period."companyId" = profile."companyId"
   AND period.year = 2026
   AND period.month = 9
  WHERE company.slug = 'altyn-sapa-company'
    AND profile.active = TRUE
    AND profile."payrollEnabled" = TRUE
    AND profile."hiredAt" < TIMESTAMP '2026-09-30 19:00:00'
    AND (
      profile."terminatedAt" IS NULL
      OR profile."terminatedAt" > TIMESTAMP '2026-08-31 19:00:00'
    )
    AND account.active = TRUE
    AND account.role IN ('MARKETER'::"Role", 'DIRECTOR'::"Role")
    AND NOT EXISTS (
      SELECT 1
      FROM "PayrollAuditEvent" prior_audit
      WHERE prior_audit."idempotencyKey" =
        'september-2026-no-salary-plan:v1:' || profile.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "PayrollPayment" payment
      WHERE payment."periodId" = period.id
        AND payment."employeeId" = profile.id
        AND payment."reversalOfId" IS NULL
        AND payment."reversedAt" IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "PayrollPaymentConfirmation" confirmation
      WHERE confirmation."periodId" = period.id
        AND confirmation."employeeId" = profile.id
        AND confirmation.status <> 'REJECTED'::"PayrollConfirmationStatus"
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "PayrollAccrual" accrual
      WHERE accrual."periodId" = period.id
        AND accrual."employeeId" = profile.id
        AND accrual.direction = 'INCREASE'::"PayrollDirection"
        AND accrual."reversalOfId" IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "PayrollAccrual" reversal
          WHERE reversal."reversalOfId" = accrual.id
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "PayrollOrderBonusDecision" decision
      WHERE decision."periodId" = period.id
        AND decision."employeeId" = profile.id
        AND decision."manualAmount" IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "_SeptemberSnapshotFacts" snapshot_fact
      WHERE snapshot_fact."employeeId" = profile.id
    )
)
SELECT
  candidate."employeeId",
  candidate."companyId",
  candidate."periodId",
  candidate."alreadyApplied",
  NULL::INTEGER AS "sourceRateId",
  NULL::DECIMAL(14, 2) AS "sourceAmount",
  NULL::BOOLEAN AS "sourcePlanEnabled",
  NULL::TIMESTAMP AS "sourceEffectiveFrom",
  NULL::TIMESTAMP AS "sourceEffectiveTo",
  NULL::INTEGER AS "sourceApprovedById"
FROM (
  SELECT * FROM applied
  UNION ALL
  SELECT * FROM fresh
) candidate;

-- Every first-run target must have one and only one positive, approved salary
-- condition spanning September and the October boundary. This is the saved
-- condition that is split; no amount is inferred from a role or employee name.
DO $$
DECLARE
  ambiguous_employee_ids TEXT;
BEGIN
  SELECT string_agg(target."employeeId"::TEXT, ', ' ORDER BY target."employeeId")
  INTO ambiguous_employee_ids
  FROM "_SeptemberNoPlanTargets" target
  WHERE target."alreadyApplied" = FALSE
    AND (
      SELECT COUNT(*)
      FROM "EmployeeSalaryRate" rate
      JOIN "User" approver
        ON approver.id = rate."approvedById"
       AND approver."companyId" = target."companyId"
      WHERE rate."employeeId" = target."employeeId"
        AND rate.amount > 0
        AND rate."planEnabled" = TRUE
        AND rate."effectiveFrom" <= TIMESTAMP '2026-08-31 19:00:00'
        AND (
          rate."effectiveTo" IS NULL
          OR rate."effectiveTo" > TIMESTAMP '2026-09-30 19:00:00'
        )
    ) <> 1;

  IF ambiguous_employee_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'Expected one saved salary condition spanning September for employee id(s): %',
      ambiguous_employee_ids;
  END IF;
END $$;

UPDATE "_SeptemberNoPlanTargets" target
SET
  "sourceRateId" = rate.id,
  "sourceAmount" = rate.amount,
  "sourcePlanEnabled" = rate."planEnabled",
  "sourceEffectiveFrom" = rate."effectiveFrom",
  "sourceEffectiveTo" = rate."effectiveTo",
  "sourceApprovedById" = rate."approvedById"
FROM "EmployeeSalaryRate" rate
JOIN "User" approver ON approver.id = rate."approvedById"
WHERE target."alreadyApplied" = FALSE
  AND rate."employeeId" = target."employeeId"
  AND approver."companyId" = target."companyId"
  AND rate.amount > 0
  AND rate."planEnabled" = TRUE
  AND rate."effectiveFrom" <= TIMESTAMP '2026-08-31 19:00:00'
  AND (rate."effectiveTo" IS NULL OR rate."effectiveTo" > TIMESTAMP '2026-09-30 19:00:00');

DO $$
DECLARE
  invalid_employee_ids TEXT;
BEGIN
  SELECT string_agg(target."employeeId"::TEXT, ', ' ORDER BY target."employeeId")
  INTO invalid_employee_ids
  FROM "_SeptemberNoPlanTargets" target
  JOIN "EmployeePayrollProfile" profile
    ON profile.id = target."employeeId"
   AND profile."companyId" = target."companyId"
  WHERE target."alreadyApplied" = FALSE
    AND (
      target."sourceRateId" IS NULL
      OR target."sourceApprovedById" IS NULL
      OR target."sourceAmount" IS NULL
      OR target."sourceAmount" <= 0
      OR target."sourcePlanEnabled" IS DISTINCT FROM TRUE
      OR profile."salaryPlanEnabled" IS DISTINCT FROM TRUE
      OR profile."baseSalary" IS DISTINCT FROM target."sourceAmount"
    );

  IF invalid_employee_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'Saved payroll profile/rate mismatch for September exclusion employee id(s): %',
      invalid_employee_ids;
  END IF;
END $$;

CREATE TEMP TABLE "_SeptemberPaymentSnapshot" AS
SELECT
  COUNT(payment.id)::INTEGER AS "paymentCount",
  COALESCE(SUM(
    CASE
      WHEN payment.type = 'EMPLOYEE_REFUND'::"PayrollPaymentType"
        THEN -payment.amount
      ELSE payment.amount
    END
  ), 0)::DECIMAL(14, 2) AS "signedTotal"
FROM "PayrollPeriod" period
JOIN "Company" company ON company.id = period."companyId"
LEFT JOIN "PayrollPayment" payment
  ON payment."periodId" = period.id
  AND payment."reversalOfId" IS NULL
  AND payment."reversedAt" IS NULL
WHERE company.slug = 'altyn-sapa-company'
  AND period.year = 2026
  AND period.month = 9;

UPDATE "EmployeeSalaryRate" rate
SET "effectiveTo" = TIMESTAMP '2026-08-31 19:00:00'
FROM "_SeptemberNoPlanTargets" target
WHERE target."alreadyApplied" = FALSE
  AND rate.id = target."sourceRateId";

INSERT INTO "EmployeeSalaryRate" (
  "employeeId", amount, "planEnabled", "effectiveFrom", "effectiveTo",
  "approvedById", comment, "createdAt"
)
SELECT
  target."employeeId",
  0.00,
  FALSE,
  TIMESTAMP '2026-08-31 19:00:00',
  TIMESTAMP '2026-09-30 19:00:00',
  target."sourceApprovedById",
  'Сентябрь 2026: отдельный расчёт зарплаты отсутствует',
  CURRENT_TIMESTAMP
FROM "_SeptemberNoPlanTargets" target
WHERE target."alreadyApplied" = FALSE;

INSERT INTO "EmployeeSalaryRate" (
  "employeeId", amount, "planEnabled", "effectiveFrom", "effectiveTo",
  "approvedById", comment, "createdAt"
)
SELECT
  target."employeeId",
  target."sourceAmount",
  target."sourcePlanEnabled",
  TIMESTAMP '2026-09-30 19:00:00',
  target."sourceEffectiveTo",
  target."sourceApprovedById",
  'Оклад восстановлен с 01.10.2026 Asia/Almaty',
  CURRENT_TIMESTAMP
FROM "_SeptemberNoPlanTargets" target
WHERE target."alreadyApplied" = FALSE;

INSERT INTO "PayrollAuditEvent" (
  action, "actorId", "periodId", "employeeId", before, after,
  reason, "idempotencyKey", "createdAt"
)
SELECT
  'SALARY_PERIOD_EXCLUDED',
  target."sourceApprovedById",
  target."periodId",
  target."employeeId",
  jsonb_build_object(
    'rateId', target."sourceRateId",
    'amount', target."sourceAmount",
    'planEnabled', target."sourcePlanEnabled",
    'effectiveFrom', target."sourceEffectiveFrom",
    'effectiveTo', target."sourceEffectiveTo"
  ),
  jsonb_build_object(
    'amount', 0,
    'planEnabled', FALSE,
    'period', '2026-09',
    'periodStart', '2026-09-01T00:00:00+05:00',
    'periodEnd', '2026-10-01T00:00:00+05:00',
    'restoredAmountFromOctober', target."sourceAmount"
  ),
  'За сентябрь 2026 отдельный расчёт зарплаты не создавался; другие месяцы сохранены',
  'september-2026-no-salary-plan:v1:' || target."employeeId",
  CURRENT_TIMESTAMP
FROM "_SeptemberNoPlanTargets" target
WHERE target."alreadyApplied" = FALSE
ON CONFLICT ("idempotencyKey") DO NOTHING;

-- Validate only rows changed by this transaction. Already-applied rows may
-- legitimately have a different current salary, role, or employment state.
DO $$
DECLARE
  invalid_employee_ids TEXT;
  payment_count_before INTEGER;
  payment_count_after INTEGER;
  payment_total_before NUMERIC(14, 2);
  payment_total_after NUMERIC(14, 2);
BEGIN
  SELECT string_agg(target."employeeId"::TEXT, ', ' ORDER BY target."employeeId")
  INTO invalid_employee_ids
  FROM "_SeptemberNoPlanTargets" target
  WHERE target."alreadyApplied" = FALSE
    AND (
      (
        SELECT COUNT(*)
        FROM "EmployeeSalaryRate" rate
        WHERE rate."employeeId" = target."employeeId"
          AND rate.amount = 0
          AND rate."planEnabled" = FALSE
          AND rate."effectiveFrom" = TIMESTAMP '2026-08-31 19:00:00'
          AND rate."effectiveTo" = TIMESTAMP '2026-09-30 19:00:00'
      ) <> 1
      OR (
        SELECT COUNT(*)
        FROM "EmployeeSalaryRate" rate
        WHERE rate."employeeId" = target."employeeId"
          AND rate.amount = target."sourceAmount"
          AND rate."planEnabled" = target."sourcePlanEnabled"
          AND rate."effectiveFrom" = TIMESTAMP '2026-09-30 19:00:00'
          AND rate."effectiveTo" IS NOT DISTINCT FROM target."sourceEffectiveTo"
      ) <> 1
      OR NOT EXISTS (
        SELECT 1
        FROM "PayrollAuditEvent" audit
        WHERE audit."idempotencyKey" =
          'september-2026-no-salary-plan:v1:' || target."employeeId"
      )
    );

  IF invalid_employee_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'September salary exclusion verification failed for employee id(s): %',
      invalid_employee_ids;
  END IF;

  SELECT "paymentCount", "signedTotal"
  INTO payment_count_before, payment_total_before
  FROM "_SeptemberPaymentSnapshot";

  SELECT
    COUNT(payment.id)::INTEGER,
    COALESCE(SUM(
      CASE
        WHEN payment.type = 'EMPLOYEE_REFUND'::"PayrollPaymentType"
          THEN -payment.amount
        ELSE payment.amount
      END
    ), 0)::DECIMAL(14, 2)
  INTO payment_count_after, payment_total_after
  FROM "PayrollPeriod" period
  JOIN "Company" company ON company.id = period."companyId"
  LEFT JOIN "PayrollPayment" payment
    ON payment."periodId" = period.id
    AND payment."reversalOfId" IS NULL
    AND payment."reversedAt" IS NULL
  WHERE company.slug = 'altyn-sapa-company'
    AND period.year = 2026
    AND period.month = 9;

  IF payment_count_before IS DISTINCT FROM payment_count_after
    OR payment_total_before IS DISTINCT FROM payment_total_after THEN
    RAISE EXCEPTION
      'September payments changed (before % / %, after % / %)',
      payment_count_before,
      payment_total_before,
      payment_count_after,
      payment_total_after;
  END IF;
END $$;

DROP TABLE "_SeptemberPaymentSnapshot";
DROP TABLE "_SeptemberNoPlanTargets";
DROP TABLE "_SeptemberSnapshotFacts";

COMMIT;
