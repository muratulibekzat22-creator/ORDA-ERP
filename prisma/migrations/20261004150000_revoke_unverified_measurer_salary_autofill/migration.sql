-- The 11:00 payroll repair wrote a 200,000 KZT October salary condition for
-- two measurers from an implementation assumption rather than from a saved,
-- management-approved salary setting.  The audit key written by that repair
-- is the only source-of-truth marker used here; employee names and ids are not
-- used.  A later salary action by management always wins and is left intact.
--
-- Asia/Almaty local midnight on 1 October 2026 is stored as
-- 2026-09-30 19:00:00 UTC.  The employment start date is intentionally kept;
-- only the unverified salary condition is disabled.  Payroll accruals,
-- confirmations and payments are never changed by this migration.
BEGIN;

LOCK TABLE
  "Company",
  "User",
  "EmployeePayrollProfile",
  "EmployeeSalaryRate",
  "PayrollPeriod",
  "PayrollAuditEvent",
  "PayrollCalculationSnapshot",
  "PayrollAccrual",
  "PayrollPayment",
  "PayrollPaymentConfirmation",
  "Order"
IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE "_UnverifiedMeasurerSalaryTargets" AS
SELECT
  profile.id AS "employeeId",
  profile."companyId",
  profile."hiredAt" AS "hiredAtBefore",
  source_audit.id AS "sourceAuditId",
  source_audit."actorId" AS "sourceActorId",
  source_audit."periodId",
  EXISTS (
    SELECT 1
    FROM "PayrollAuditEvent" later_audit
    WHERE later_audit."employeeId" = profile.id
      AND later_audit.id > source_audit.id
      AND later_audit.action IN (
        'SALARY_CHANGED',
        'SALARY_EFFECTIVE_DATE_CORRECTED',
        'PAYROLL_PROFILE_CONFIGURED'
      )
      AND later_audit."idempotencyKey" IS DISTINCT FROM
        'october-2026-measurer-rate:v1:audit:' || profile.id
  ) AS "protectedByLaterSalaryAction",
  EXISTS (
    SELECT 1
    FROM "PayrollAuditEvent" correction_audit
    WHERE correction_audit."idempotencyKey" =
      'revoke-unverified-measurer-salary:v1:audit:' || profile.id
  ) AS "alreadyCorrected"
FROM "EmployeePayrollProfile" profile
JOIN "Company" company
  ON company.id = profile."companyId"
JOIN "PayrollAuditEvent" source_audit
  ON source_audit."employeeId" = profile.id
  AND source_audit."idempotencyKey" =
    'october-2026-measurer-rate:v1:audit:' || profile.id
LEFT JOIN "User" account
  ON account.id = profile."userId"
WHERE company.slug = 'altyn-sapa-company'
  AND source_audit.action = 'SALARY_CHANGED'
  AND source_audit."after" ->> 'amount' = '200000'
  AND source_audit."after" ->> 'effectiveFrom' =
    '2026-10-01T00:00:00+05:00'
  AND (
    account.role = 'MEASURER'::"Role"
    OR UPPER(BTRIM(profile.position)) = 'MEASURER'
    OR TRANSLATE(
      LOWER(BTRIM(profile.position)),
      'әғқңөұүһі',
      'агкноуухи'
    ) LIKE '%замер%'
  );

DO $$
DECLARE
  target_count INTEGER;
  invalid_source_count INTEGER;
  factual_operation_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO target_count
  FROM "_UnverifiedMeasurerSalaryTargets";

  IF target_count NOT IN (0, 2) THEN
    RAISE EXCEPTION
      'Expected zero fresh-chain or two deployed measurer salary-autofill sources, found %',
      target_count;
  END IF;

  -- Before the first correction, each unprotected source must still have the
  -- exact row and profile values written by the 11:00 repair.  Refuse to guess
  -- if anything else has edited those values without a salary audit.
  SELECT COUNT(*)
  INTO invalid_source_count
  FROM "_UnverifiedMeasurerSalaryTargets" target
  JOIN "EmployeePayrollProfile" profile
    ON profile.id = target."employeeId"
  WHERE target."protectedByLaterSalaryAction" = FALSE
    AND target."alreadyCorrected" = FALSE
    AND (
      profile."baseSalary" <> 200000.00
      OR profile."salaryPlanEnabled" = FALSE
      OR (
        SELECT COUNT(*)
        FROM "EmployeeSalaryRate" rate
        WHERE rate."employeeId" = target."employeeId"
          AND rate.amount = 200000.00
          AND rate."planEnabled" = TRUE
          AND rate."effectiveFrom" = TIMESTAMP '2026-09-30 19:00:00'
          AND rate.comment =
            'Оклад 200 000 ₸ действует с 01.10.2026 Asia/Almaty'
      ) <> 1
    );

  IF invalid_source_count <> 0 THEN
    RAISE EXCEPTION
      'Unverified measurer salary source drifted for % target(s); refusing an ambiguous correction',
      invalid_source_count;
  END IF;

  -- There were no factual October payroll operations for these profiles when
  -- the automatic condition was introduced.  If that is no longer true and
  -- management has not recorded a later salary decision, stop for review
  -- rather than changing a condition beneath real accounting history.
  SELECT COUNT(*)
  INTO factual_operation_count
  FROM "_UnverifiedMeasurerSalaryTargets" target
  WHERE target."protectedByLaterSalaryAction" = FALSE
    AND target."alreadyCorrected" = FALSE
    AND (
      EXISTS (
        SELECT 1
        FROM "PayrollAccrual" accrual
        JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
        WHERE accrual."employeeId" = target."employeeId"
          AND (
            period.year > 2026
            OR (period.year = 2026 AND period.month >= 10)
          )
          AND accrual.direction = 'INCREASE'::"PayrollDirection"
          AND accrual."reversalOfId" IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM "PayrollAccrual" reversal
            WHERE reversal."reversalOfId" = accrual.id
          )
      )
      OR EXISTS (
        SELECT 1
        FROM "PayrollCalculationSnapshot" snapshot
        JOIN "PayrollPeriod" period ON period.id = snapshot."periodId"
        WHERE snapshot."employeeId" = target."employeeId"
          AND (
            period.year > 2026
            OR (period.year = 2026 AND period.month >= 10)
          )
      )
      OR EXISTS (
        SELECT 1
        FROM "PayrollPayment" payment
        JOIN "PayrollPeriod" period ON period.id = payment."periodId"
        WHERE payment."employeeId" = target."employeeId"
          AND (
            period.year > 2026
            OR (period.year = 2026 AND period.month >= 10)
          )
          AND payment."reversalOfId" IS NULL
          AND payment."reversedAt" IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM "PayrollPaymentConfirmation" confirmation
        JOIN "PayrollPeriod" period ON period.id = confirmation."periodId"
        WHERE confirmation."employeeId" = target."employeeId"
          AND (
            period.year > 2026
            OR (period.year = 2026 AND period.month >= 10)
          )
          AND confirmation.status <> 'REJECTED'::"PayrollConfirmationStatus"
      )
    );

  IF factual_operation_count <> 0 THEN
    RAISE EXCEPTION
      'Found factual October-or-later payroll operations for % unprotected measurer target(s)',
      factual_operation_count;
  END IF;
END $$;

-- Snapshot the accounting tables and the employment boundary.  The post-check
-- makes accidental mutation of real payroll history fail the transaction.
CREATE TEMP TABLE "_UnverifiedMeasurerPayrollSnapshot" AS
SELECT
  (
    SELECT COUNT(*)::INTEGER
    FROM "PayrollAccrual" accrual
    JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
    WHERE period."companyId" = company.id
      AND period.year = 2026
      AND period.month IN (9, 10)
  ) AS "accrualCount",
  (
    SELECT COALESCE(SUM(
      CASE
        WHEN accrual.direction = 'INCREASE'::"PayrollDirection"
          THEN accrual.amount
        ELSE -accrual.amount
      END
    ), 0)::DECIMAL(14, 2)
    FROM "PayrollAccrual" accrual
    JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
    WHERE period."companyId" = company.id
      AND period.year = 2026
      AND period.month IN (9, 10)
  ) AS "accrualTotal",
  (
    SELECT COUNT(*)::INTEGER
    FROM "PayrollPayment" payment
    JOIN "PayrollPeriod" period ON period.id = payment."periodId"
    WHERE period."companyId" = company.id
      AND period.year = 2026
      AND period.month IN (9, 10)
  ) AS "paymentCount",
  (
    SELECT COALESCE(SUM(
      CASE
        WHEN payment.type = 'EMPLOYEE_REFUND'::"PayrollPaymentType"
          THEN -payment.amount
        ELSE payment.amount
      END
    ), 0)::DECIMAL(14, 2)
    FROM "PayrollPayment" payment
    JOIN "PayrollPeriod" period ON period.id = payment."periodId"
    WHERE period."companyId" = company.id
      AND period.year = 2026
      AND period.month IN (9, 10)
  ) AS "paymentTotal"
FROM "Company" company
WHERE company.slug = 'altyn-sapa-company';

CREATE TEMP TABLE "_UnverifiedMeasurerAutofillRates" AS
SELECT
  rate.id AS "rateId",
  target."employeeId",
  rate.amount AS "amountBefore",
  rate."planEnabled" AS "planEnabledBefore",
  rate."effectiveFrom" AS "effectiveFromBefore",
  rate."effectiveTo" AS "effectiveToBefore",
  rate."approvedById" AS "approvedByIdBefore",
  rate.comment AS "commentBefore"
FROM "_UnverifiedMeasurerSalaryTargets" target
JOIN "EmployeeSalaryRate" rate
  ON rate."employeeId" = target."employeeId"
  AND rate.amount = 200000.00
  AND rate."planEnabled" = TRUE
  AND rate."effectiveFrom" = TIMESTAMP '2026-09-30 19:00:00'
  AND rate.comment =
    'Оклад 200 000 ₸ действует с 01.10.2026 Asia/Almaty'
WHERE target."protectedByLaterSalaryAction" = FALSE
  AND target."alreadyCorrected" = FALSE;

UPDATE "EmployeeSalaryRate" rate
SET
  amount = 0.00,
  "planEnabled" = FALSE,
  comment =
    'Оклад не задан: неподтверждённая автоподстановка 200 000 ₸ отменена'
FROM "_UnverifiedMeasurerAutofillRates" source
WHERE rate.id = source."rateId";

UPDATE "EmployeePayrollProfile" profile
SET
  "baseSalary" = 0.00,
  "salaryPlanEnabled" = FALSE,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_UnverifiedMeasurerSalaryTargets" target
WHERE profile.id = target."employeeId"
  AND target."protectedByLaterSalaryAction" = FALSE
  AND target."alreadyCorrected" = FALSE;

INSERT INTO "PayrollAuditEvent" (
  action, "actorId", "periodId", "employeeId", before, after,
  reason, "idempotencyKey", "createdAt"
)
SELECT
  'SALARY_AUTOFILL_REVOKED',
  target."sourceActorId",
  target."periodId",
  target."employeeId",
  jsonb_build_object(
    'source', 'october-2026-measurer-rate:v1',
    'sourceAuditId', target."sourceAuditId",
    'rateId', rate."rateId",
    'amount', rate."amountBefore",
    'planEnabled', rate."planEnabledBefore",
    'effectiveFrom', '2026-10-01T00:00:00+05:00',
    'effectiveTo', rate."effectiveToBefore"
  ),
  jsonb_build_object(
    'salaryCondition', NULL,
    'storageAmount', 0,
    'planEnabled', FALSE,
    'employmentStartPreserved', target."hiredAtBefore",
    'timeZone', 'Asia/Almaty',
    'source', 'SYSTEM_DATA_REPAIR'
  ),
  'Автоподстановка оклада 200 000 ₸ не имела сохранённого управленческого основания; оклад не задан',
  'revoke-unverified-measurer-salary:v1:audit:' || target."employeeId",
  CURRENT_TIMESTAMP
FROM "_UnverifiedMeasurerSalaryTargets" target
JOIN "_UnverifiedMeasurerAutofillRates" rate
  ON rate."employeeId" = target."employeeId"
ON CONFLICT ("idempotencyKey") DO NOTHING;

DO $$
DECLARE
  invalid_target_count INTEGER;
  correction_audit_count INTEGER;
  changed_hired_at_count INTEGER;
  responsibility_error_count INTEGER;
  payment_count_before INTEGER;
  payment_count_after INTEGER;
  accrual_count_before INTEGER;
  accrual_count_after INTEGER;
  payment_total_before NUMERIC(14, 2);
  payment_total_after NUMERIC(14, 2);
  accrual_total_before NUMERIC(14, 2);
  accrual_total_after NUMERIC(14, 2);
BEGIN
  SELECT COUNT(*)
  INTO invalid_target_count
  FROM "_UnverifiedMeasurerSalaryTargets" target
  JOIN "EmployeePayrollProfile" profile
    ON profile.id = target."employeeId"
  WHERE target."protectedByLaterSalaryAction" = FALSE
    AND (
      profile."baseSalary" <> 0.00
      OR profile."salaryPlanEnabled" = TRUE
      OR NOT EXISTS (
        SELECT 1
        FROM "EmployeeSalaryRate" rate
        WHERE rate."employeeId" = target."employeeId"
          AND rate.amount = 0.00
          AND rate."planEnabled" = FALSE
          AND rate."effectiveFrom" = TIMESTAMP '2026-09-30 19:00:00'
          AND rate.comment =
            'Оклад не задан: неподтверждённая автоподстановка 200 000 ₸ отменена'
      )
      OR EXISTS (
        SELECT 1
        FROM "EmployeeSalaryRate" rate
        WHERE rate."employeeId" = target."employeeId"
          AND rate."planEnabled" = TRUE
          AND rate."effectiveFrom" < TIMESTAMP '9999-12-31 00:00:00'
          AND (
            rate."effectiveTo" IS NULL
            OR rate."effectiveTo" > TIMESTAMP '2026-09-30 19:00:00'
          )
      )
    );

  IF invalid_target_count <> 0 THEN
    RAISE EXCEPTION
      'Unverified salary removal verification failed for % measurer target(s)',
      invalid_target_count;
  END IF;

  SELECT COUNT(*)
  INTO correction_audit_count
  FROM "_UnverifiedMeasurerSalaryTargets" target
  JOIN "PayrollAuditEvent" audit
    ON audit."idempotencyKey" =
      'revoke-unverified-measurer-salary:v1:audit:' || target."employeeId"
  WHERE target."protectedByLaterSalaryAction" = FALSE;

  IF correction_audit_count <> (
    SELECT COUNT(*)
    FROM "_UnverifiedMeasurerSalaryTargets"
    WHERE "protectedByLaterSalaryAction" = FALSE
  ) THEN
    RAISE EXCEPTION
      'Expected one deterministic correction audit for every unprotected target';
  END IF;

  SELECT COUNT(*)
  INTO changed_hired_at_count
  FROM "_UnverifiedMeasurerSalaryTargets" target
  JOIN "EmployeePayrollProfile" profile ON profile.id = target."employeeId"
  WHERE profile."hiredAt" IS DISTINCT FROM target."hiredAtBefore";

  IF changed_hired_at_count <> 0 THEN
    RAISE EXCEPTION
      'Employment start changed for % measurer target(s)',
      changed_hired_at_count;
  END IF;

  SELECT "paymentCount", "paymentTotal", "accrualCount", "accrualTotal"
  INTO payment_count_before, payment_total_before,
       accrual_count_before, accrual_total_before
  FROM "_UnverifiedMeasurerPayrollSnapshot";

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
  FROM "PayrollPayment" payment
  JOIN "PayrollPeriod" period ON period.id = payment."periodId"
  JOIN "Company" company ON company.id = period."companyId"
  WHERE company.slug = 'altyn-sapa-company'
    AND period.year = 2026
    AND period.month IN (9, 10);

  SELECT
    COUNT(accrual.id)::INTEGER,
    COALESCE(SUM(
      CASE
        WHEN accrual.direction = 'INCREASE'::"PayrollDirection"
          THEN accrual.amount
        ELSE -accrual.amount
      END
    ), 0)::DECIMAL(14, 2)
  INTO accrual_count_after, accrual_total_after
  FROM "PayrollAccrual" accrual
  JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
  JOIN "Company" company ON company.id = period."companyId"
  WHERE company.slug = 'altyn-sapa-company'
    AND period.year = 2026
    AND period.month IN (9, 10);

  IF payment_count_before IS DISTINCT FROM payment_count_after
    OR payment_total_before IS DISTINCT FROM payment_total_after
    OR accrual_count_before IS DISTINCT FROM accrual_count_after
    OR accrual_total_before IS DISTINCT FROM accrual_total_after THEN
    RAISE EXCEPTION
      'Payroll operations changed while removing the unverified salary condition';
  END IF;

  SELECT COUNT(*)
  INTO responsibility_error_count
  FROM "Order" customer_order
  JOIN "Company" company ON company.id = customer_order."companyId"
  WHERE company.slug = 'altyn-sapa-company'
    AND (
      (customer_order."responsibleType" = 'COMPANY'::"OrderResponsibleType"
        AND customer_order."managerUserId" IS NOT NULL)
      OR
      (customer_order."responsibleType" = 'EMPLOYEE'::"OrderResponsibleType"
        AND customer_order."managerUserId" IS NULL)
    );

  IF responsibility_error_count <> 0 THEN
    RAISE EXCEPTION
      'Current order responsibility contains % inconsistent row(s)',
      responsibility_error_count;
  END IF;
END $$;

DROP TABLE "_UnverifiedMeasurerAutofillRates";
DROP TABLE "_UnverifiedMeasurerPayrollSnapshot";
DROP TABLE "_UnverifiedMeasurerSalaryTargets";

COMMIT;
