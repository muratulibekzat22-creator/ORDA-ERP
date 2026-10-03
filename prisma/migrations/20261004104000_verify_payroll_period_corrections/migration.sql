-- Fail the release instead of silently accepting a partial payroll cleanup.
-- This migration is read-only: it verifies the postconditions established by
-- the two preceding immutable correction migrations.
DO $$
DECLARE
  target_count INTEGER;
  invalid_plan_count INTEGER;
  active_salary_count INTEGER;
  wrong_period_bonus_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO target_count
  FROM "EmployeePayrollProfile" profile
  JOIN "Company" company ON company.id = profile."companyId"
  LEFT JOIN "User" account ON account.id = profile."userId"
  WHERE company.slug = 'altyn-sapa-company'
    AND (
      LOWER(BTRIM(COALESCE(NULLIF(account."name", ''), profile."name"))) LIKE '%еркебулан%'
      OR (
        LOWER(BTRIM(COALESCE(NULLIF(account."name", ''), profile."name"))) LIKE '%нурасыл%'
        AND LOWER(BTRIM(COALESCE(NULLIF(account."name", ''), profile."name"))) LIKE '%кокбай%'
      )
    );

  IF target_count <> 2 THEN
    RAISE EXCEPTION
      'Payroll zero-salary verification expected exactly two named employees, found %',
      target_count;
  END IF;

  SELECT COUNT(*)
  INTO invalid_plan_count
  FROM "EmployeePayrollProfile" profile
  JOIN "Company" company ON company.id = profile."companyId"
  LEFT JOIN "User" account ON account.id = profile."userId"
  WHERE company.slug = 'altyn-sapa-company'
    AND (
      LOWER(BTRIM(COALESCE(NULLIF(account."name", ''), profile."name"))) LIKE '%еркебулан%'
      OR (
        LOWER(BTRIM(COALESCE(NULLIF(account."name", ''), profile."name"))) LIKE '%нурасыл%'
        AND LOWER(BTRIM(COALESCE(NULLIF(account."name", ''), profile."name"))) LIKE '%кокбай%'
      )
    )
    AND (
      profile."baseSalary" <> 0
      OR profile."salaryPlanEnabled" = TRUE
      OR EXISTS (
        SELECT 1
        FROM "EmployeeSalaryRate" rate
        WHERE rate."employeeId" = profile.id
          AND rate."planEnabled" = TRUE
      )
    );

  IF invalid_plan_count <> 0 THEN
    RAISE EXCEPTION
      'Payroll zero-salary verification found % employee(s) with an enabled salary plan',
      invalid_plan_count;
  END IF;

  SELECT COUNT(*)
  INTO active_salary_count
  FROM "PayrollAccrual" accrual
  JOIN "PayrollPeriod" period ON period.id = accrual."periodId"
  JOIN "Company" company ON company.id = period."companyId"
  JOIN "EmployeePayrollProfile" profile ON profile.id = accrual."employeeId"
  LEFT JOIN "User" account ON account.id = profile."userId"
  WHERE company.slug = 'altyn-sapa-company'
    AND period."year" = 2026
    AND period."month" IN (9, 10)
    AND accrual."type" = 'BASE_SALARY'
    AND accrual."direction" = 'INCREASE'
    AND accrual."reversalOfId" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "PayrollAccrual" reversal
      WHERE reversal."reversalOfId" = accrual.id
    )
    AND (
      LOWER(BTRIM(COALESCE(NULLIF(account."name", ''), profile."name"))) LIKE '%еркебулан%'
      OR (
        LOWER(BTRIM(COALESCE(NULLIF(account."name", ''), profile."name"))) LIKE '%нурасыл%'
        AND LOWER(BTRIM(COALESCE(NULLIF(account."name", ''), profile."name"))) LIKE '%кокбай%'
      )
    );

  IF active_salary_count <> 0 THEN
    RAISE EXCEPTION
      'Payroll zero-salary verification found % active September/October salary accrual(s)',
      active_salary_count;
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
