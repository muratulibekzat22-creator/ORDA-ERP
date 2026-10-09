-- План продаж является единым командным планом; персональные цели не используются.
DELETE FROM "SalesPlanManagerTarget" AS target
USING "SalesPlan" AS plan, "Company" AS company
WHERE target."planId" = plan."id"
  AND plan."companyId" = company."id"
  AND company."isDemo" = FALSE
  AND LOWER(company."name") LIKE '%altyn sapa%';

UPDATE "SalesPlan" AS plan
SET
  "recommendationBasis" = COALESCE(plan."recommendationBasis", '{}'::JSONB) || JSONB_BUILD_OBJECT(
    'method', 'OWNER_APPROVED_TEAM_50_MILLION',
    'note', 'Единый командный план: 50 млн ₸ и 23 заказа. Персональных планов менеджеров нет; отображается только вклад каждого.'
  ),
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Company" AS company
WHERE plan."companyId" = company."id"
  AND company."isDemo" = FALSE
  AND LOWER(company."name") LIKE '%altyn sapa%'
  AND plan."year" = 2026
  AND plan."month" = 10;
