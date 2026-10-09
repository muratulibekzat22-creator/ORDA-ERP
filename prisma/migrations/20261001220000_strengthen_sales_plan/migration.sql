ALTER TABLE "SalesPlan"
  ADD COLUMN "minimumMarginPercent" DECIMAL(5,2) NOT NULL DEFAULT 25,
  ADD COLUMN "requiredCostCoveragePercent" DECIMAL(5,2) NOT NULL DEFAULT 100;

-- Утверждённый собственником серьёзный план на октябрь 2026 года.
UPDATE "SalesPlan" AS plan
SET
  "revenueTarget" = 25000000,
  "orderTarget" = 11,
  "recommendationRevenue" = 25000000,
  "recommendationOrders" = 11,
  "recommendationBasis" = COALESCE(plan."recommendationBasis", '{}'::JSONB) || JSONB_BUILD_OBJECT(
    'method', 'OWNER_APPROVED_25_MILLION',
    'note', 'План 25 млн ₸: на 31% выше лучшего месяца 19,046 млн ₸; цель утверждена собственником.'
  ),
  "minimumMarginPercent" = 25,
  "requiredCostCoveragePercent" = 100,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Company" AS company
WHERE plan."companyId" = company."id"
  AND company."isDemo" = FALSE
  AND LOWER(company."name") LIKE '%altyn sapa%'
  AND plan."year" = 2026
  AND plan."month" = 10;

UPDATE "SalesPlanTier" AS tier
SET
  "rewardAmount" = CASE tier."thresholdPercent"
    WHEN 100 THEN 50000
    WHEN 110 THEN 100000
    WHEN 120 THEN 150000
    ELSE tier."rewardAmount"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "SalesPlan" AS plan, "Company" AS company
WHERE tier."planId" = plan."id"
  AND plan."companyId" = company."id"
  AND company."isDemo" = FALSE
  AND LOWER(company."name") LIKE '%altyn sapa%'
  AND plan."year" = 2026
  AND plan."month" = 10
  AND tier."thresholdPercent" IN (100, 110, 120);

UPDATE "SalesPlanManagerTarget" AS target
SET
  "revenueTarget" = CASE
    WHEN LOWER(TRIM(manager."name")) = LOWER('Акбота') THEN 11000000
    WHEN LOWER(TRIM(manager."name")) = LOWER('Гулсим') THEN 14000000
    ELSE target."revenueTarget"
  END,
  "orderTarget" = CASE
    WHEN LOWER(TRIM(manager."name")) = LOWER('Акбота') THEN 5
    WHEN LOWER(TRIM(manager."name")) = LOWER('Гулсим') THEN 6
    ELSE target."orderTarget"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "SalesPlan" AS plan, "Company" AS company, "User" AS manager
WHERE target."planId" = plan."id"
  AND target."managerId" = manager."id"
  AND plan."companyId" = company."id"
  AND company."isDemo" = FALSE
  AND LOWER(company."name") LIKE '%altyn sapa%'
  AND plan."year" = 2026
  AND plan."month" = 10
  AND LOWER(TRIM(manager."name")) IN (LOWER('Акбота'), LOWER('Гулсим'));
