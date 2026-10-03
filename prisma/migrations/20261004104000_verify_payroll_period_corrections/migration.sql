-- The production verification showed that one measurer's saved name differs
-- from the spoken name. Apply the zero-salary rule by payroll role, then fail
-- the release if any September/October payroll invariant is still violated.
BEGIN;

CREATE TEMP TABLE "_MeasurerZeroSalaryTargets" AS
SELECT profile.id AS "employeeId"
FROM "EmployeePayrollProfile" profile
JOIN "Company" company ON company.id = profile."companyId"
LEFT JOIN "User" account ON account.id = profile."userId"
WHERE company.slug = 'altyn-sapa-company'
  AND (
    account."role"::text = 'MEASURER'
    OR UPPER(BTRIM(profile."position")) = 'MEASURER'
    OR LOWER(BTRIM(profile."position")) LIKE '%замер%'
  );

UPDATE "EmployeePayrollProfile" profile
SET "baseSalary" = 0,
    "salaryPlanEnabled" = FALSE,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "_MeasurerZeroSalaryTargets" target
WHERE profile.id = target."employeeId";

UPDATE "EmployeeSalaryRate" rate
SET "planEnabled" = FALSE
FROM "_MeasurerZeroSalaryTargets" target
WHERE rate."employeeId" = target."employeeId";

CREATE TEMP TABLE "_MeasurerPayrollAccrualCleanup" AS
SELECT
  accrual.id AS "originalId",
  accrual."employeeId",
  accrual."periodId",
  accrual."type" AS "originalType",
  accrual."amount",
  accrual."orderId",
  accrual."measurementId",
  accrual."approvedById",
  accrual."createdById",
  accrual."requestHash",
  period."companyId",
  NULL::INTEGER AS "reversalId"
FROM "PayrollAccrual" accrual
JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
JOIN "_MeasurerZeroSalaryTargets" target
  ON target."employeeId" = accrual."employeeId"
WHERE period."year" = 2026
  AND period."month" IN (9, 10)
  AND accrual."direction" = 'INCREASE'
  AND accrual."reversalOfId" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "PayrollAccrual" reversal
    WHERE reversal."reversalOfId" = accrual.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "PayrollPayment" payment
    WHERE payment."employeeId" = accrual."employeeId"
      AND payment."periodId" = accrual."periodId"
      AND payment."reversalOfId" IS NULL
      AND payment."reversedAt" IS NULL
  );

INSERT INTO "PayrollAccrual" (
  "employeeId", "periodId", "earnedPeriodId", "type", "direction",
  "amount", "orderId", "reason", "approvedById", "createdById", "reversalOfId",
  "idempotencyKey", "requestHash", "createdAt"
)
SELECT
  cleanup."employeeId",
  cleanup."periodId",
  cleanup."periodId",
  'BONUS_REVERSAL',
  'DECREASE',
  cleanup."amount",
  cleanup."orderId",
  'Сторно начисления замерщика: к выплате за сентябрь и октябрь установлено 0',
  cleanup."approvedById",
  cleanup."createdById",
  cleanup."originalId",
  'measurer-zero-salary:v2:' || cleanup."originalId",
  cleanup."requestHash",
  CURRENT_TIMESTAMP
FROM "_MeasurerPayrollAccrualCleanup" cleanup
ON CONFLICT ("idempotencyKey") DO NOTHING;

UPDATE "_MeasurerPayrollAccrualCleanup" cleanup
SET "reversalId" = reversal.id
FROM "PayrollAccrual" reversal
WHERE reversal."reversalOfId" = cleanup."originalId";

INSERT INTO "CompanyLedgerEntry" (
  "companyId", "type", "category", "direction", "source", "amount",
  "operationDate", "comment", "orderId", "employeeId", "authorId", "idempotencyKey",
  "requestHash", "affectsProfit", "payrollAccrualId", "createdAt", "updatedAt"
)
SELECT
  cleanup."companyId",
  'PAYROLL_ACCRUAL',
  'SALARY',
  'INCOME',
  'OTHER_SYSTEM',
  cleanup."amount",
  CURRENT_TIMESTAMP,
  'Сторно начисления замерщика: к выплате за сентябрь и октябрь установлено 0',
  cleanup."orderId",
  cleanup."employeeId",
  cleanup."approvedById",
  'payroll-accrual:' || cleanup."reversalId",
  cleanup."requestHash",
  TRUE,
  cleanup."reversalId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "_MeasurerPayrollAccrualCleanup" cleanup
WHERE cleanup."reversalId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

INSERT INTO "PayrollAuditEvent" (
  "action", "actorId", "periodId", "employeeId", "before", "after",
  "reason", "idempotencyKey", "createdAt"
)
SELECT
  'PAYROLL_ACCRUAL_REVERSED',
  cleanup."approvedById",
  cleanup."periodId",
  cleanup."employeeId",
  jsonb_build_object(
    'accrualId', cleanup."originalId",
    'type', cleanup."originalType",
    'orderId', cleanup."orderId",
    'measurementId', cleanup."measurementId",
    'amount', cleanup."amount"
  ),
  jsonb_build_object('reversalId', cleanup."reversalId"),
  'Начисления замерщика за сентябрь/октябрь сторнированы: к выплате 0',
  'measurer-zero-salary:v2:audit:' || cleanup."originalId",
  CURRENT_TIMESTAMP
FROM "_MeasurerPayrollAccrualCleanup" cleanup
WHERE cleanup."reversalId" IS NOT NULL
ON CONFLICT ("idempotencyKey") DO NOTHING;

DO $$
DECLARE
  target_count INTEGER;
  erkebulan_count INTEGER;
  nurasyl_count INTEGER;
  invalid_plan_count INTEGER;
  active_accrual_count INTEGER;
  active_payment_count INTEGER;
  pending_confirmation_count INTEGER;
  nonzero_payable_count INTEGER;
  wrong_period_bonus_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO target_count FROM "_MeasurerZeroSalaryTargets";

  IF target_count < 2 THEN
    RAISE EXCEPTION
      'Payroll zero-salary verification expected at least two measurers, found %',
      target_count;
  END IF;

  SELECT
    COUNT(*) FILTER (
      WHERE TRANSLATE(
        LOWER(CONCAT_WS(' ', account."name", profile."name")),
        'әғқңөұүһі',
        'агкноуухи'
      ) LIKE '%еркебулан%'
      OR LOWER(CONCAT_WS(' ', account."name", profile."name")) LIKE '%erkebulan%'
    ),
    COUNT(*) FILTER (
      WHERE TRANSLATE(
        LOWER(CONCAT_WS(' ', account."name", profile."name")),
        'әғқңөұүһі',
        'агкноуухи'
      ) LIKE '%нурасыл%'
      OR LOWER(CONCAT_WS(' ', account."name", profile."name")) LIKE '%nurasyl%'
    )
  INTO erkebulan_count, nurasyl_count
  FROM "_MeasurerZeroSalaryTargets" target
  JOIN "EmployeePayrollProfile" profile ON profile.id = target."employeeId"
  LEFT JOIN "User" account ON account.id = profile."userId";

  IF erkebulan_count < 1 OR nurasyl_count < 1 THEN
    RAISE EXCEPTION
      'Payroll zero-payable verification did not identify both named measurers (Еркебулан: %, Нурасыл: %)',
      erkebulan_count,
      nurasyl_count;
  END IF;

  SELECT COUNT(*)
  INTO invalid_plan_count
  FROM "EmployeePayrollProfile" profile
  JOIN "_MeasurerZeroSalaryTargets" target ON target."employeeId" = profile.id
  WHERE profile."baseSalary" <> 0
    OR profile."salaryPlanEnabled" = TRUE
    OR EXISTS (
      SELECT 1
      FROM "EmployeeSalaryRate" rate
      WHERE rate."employeeId" = profile.id
        AND rate."planEnabled" = TRUE
    );

  IF invalid_plan_count <> 0 THEN
    RAISE EXCEPTION
      'Payroll zero-salary verification found % measurer(s) with an enabled salary plan',
      invalid_plan_count;
  END IF;

  SELECT COUNT(*)
  INTO active_accrual_count
  FROM "PayrollAccrual" accrual
  JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
  JOIN "_MeasurerZeroSalaryTargets" target
    ON target."employeeId" = accrual."employeeId"
  WHERE period."year" = 2026
    AND period."month" IN (9, 10)
    AND accrual."reversalOfId" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "PayrollAccrual" reversal
      WHERE reversal."reversalOfId" = accrual.id
    );

  IF active_accrual_count <> 0 THEN
    RAISE EXCEPTION
      'Payroll zero-payable verification found % active September/October accrual(s)',
      active_accrual_count;
  END IF;

  SELECT COUNT(*)
  INTO active_payment_count
  FROM "PayrollPayment" payment
  JOIN "PayrollPeriod" period ON period.id = payment."periodId"
  JOIN "_MeasurerZeroSalaryTargets" target
    ON target."employeeId" = payment."employeeId"
  WHERE period."year" = 2026
    AND period."month" IN (9, 10)
    AND payment."reversalOfId" IS NULL
    AND payment."reversedAt" IS NULL;

  IF active_payment_count <> 0 THEN
    RAISE EXCEPTION
      'Payroll zero-payable verification found % active September/October payment(s)',
      active_payment_count;
  END IF;

  SELECT COUNT(*)
  INTO pending_confirmation_count
  FROM "PayrollPaymentConfirmation" confirmation
  JOIN "PayrollPeriod" period ON period.id = confirmation."periodId"
  JOIN "_MeasurerZeroSalaryTargets" target
    ON target."employeeId" = confirmation."employeeId"
  WHERE period."year" = 2026
    AND period."month" IN (9, 10)
    AND confirmation."status" = 'PENDING';

  IF pending_confirmation_count <> 0 THEN
    RAISE EXCEPTION
      'Payroll zero-payable verification found % pending September/October payment confirmation(s)',
      pending_confirmation_count;
  END IF;

  SELECT COUNT(*)
  INTO nonzero_payable_count
  FROM "_MeasurerZeroSalaryTargets" target
  JOIN "PayrollPeriod" period
    ON period."companyId" = (
      SELECT profile."companyId"
      FROM "EmployeePayrollProfile" profile
      WHERE profile.id = target."employeeId"
    )
    AND period."year" = 2026
    AND period."month" IN (9, 10)
  WHERE (
    COALESCE((
      SELECT SUM(
        CASE WHEN accrual."direction" = 'INCREASE'
          THEN accrual."amount"
          ELSE -accrual."amount"
        END
      )
      FROM "PayrollAccrual" accrual
      WHERE accrual."employeeId" = target."employeeId"
        AND accrual."periodId" = period.id
    ), 0)
    - COALESCE((
      SELECT SUM(
        CASE WHEN payment."type" = 'EMPLOYEE_REFUND'
          THEN -payment."amount"
          ELSE payment."amount"
        END
      )
      FROM "PayrollPayment" payment
      WHERE payment."employeeId" = target."employeeId"
        AND payment."periodId" = period.id
    ), 0)
  ) <> 0;

  IF nonzero_payable_count <> 0 THEN
    RAISE EXCEPTION
      'Payroll zero-payable verification found % non-zero September/October employee period(s)',
      nonzero_payable_count;
  END IF;

  SELECT COUNT(*)
  INTO wrong_period_bonus_count
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
    AND NOT EXISTS (
      SELECT 1
      FROM "PayrollAccrual" reversal
      WHERE reversal."reversalOfId" = accrual.id
    )
    AND (
      EXTRACT(
        YEAR FROM customer_order."orderReceivedAt" AT TIME ZONE 'UTC'
          AT TIME ZONE 'Asia/Almaty'
      )::INTEGER <> period."year"
      OR EXTRACT(
        MONTH FROM customer_order."orderReceivedAt" AT TIME ZONE 'UTC'
          AT TIME ZONE 'Asia/Almaty'
      )::INTEGER <> period."month"
    );

  IF wrong_period_bonus_count <> 0 THEN
    RAISE EXCEPTION
      'Factual-order-month verification found % active bonus(es) in the wrong payroll period',
      wrong_period_bonus_count;
  END IF;
END $$;

DROP TABLE "_MeasurerPayrollAccrualCleanup";
DROP TABLE "_MeasurerZeroSalaryTargets";

COMMIT;
