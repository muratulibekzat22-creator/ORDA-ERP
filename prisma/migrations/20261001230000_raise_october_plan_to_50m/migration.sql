-- Собственник утвердил усиленный план на октябрь 2026 года.
UPDATE "SalesPlan" AS plan
SET
  "revenueTarget" = 50000000,
  "orderTarget" = 23,
  "recommendationRevenue" = 50000000,
  "recommendationOrders" = 23,
  "recommendationBasis" = COALESCE(plan."recommendationBasis", '{}'::JSONB) || JSONB_BUILD_OBJECT(
    'method', 'OWNER_APPROVED_50_MILLION',
    'note', 'План 50 млн ₸ и 23 заказа утверждён собственником. Незарегистрированные заказы учитываются только после внесения в ORDA.'
  ),
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Company" AS company
WHERE plan."companyId" = company."id"
  AND company."isDemo" = FALSE
  AND LOWER(company."name") LIKE '%altyn sapa%'
  AND plan."year" = 2026
  AND plan."month" = 10;

UPDATE "SalesPlanManagerTarget" AS target
SET
  "revenueTarget" = CASE
    WHEN LOWER(TRIM(manager."name")) = LOWER('Акбота') THEN 22000000
    WHEN LOWER(TRIM(manager."name")) = LOWER('Гулсим') THEN 28000000
    ELSE target."revenueTarget"
  END,
  "orderTarget" = CASE
    WHEN LOWER(TRIM(manager."name")) = LOWER('Акбота') THEN 10
    WHEN LOWER(TRIM(manager."name")) = LOWER('Гулсим') THEN 13
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
