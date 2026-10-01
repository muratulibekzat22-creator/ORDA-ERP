ALTER TABLE "SalesPlan"
  ADD COLUMN "marketingBudgetTarget" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "inquiryTarget" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "applicationTarget" INTEGER NOT NULL DEFAULT 0;

-- Для плана 50 млн ₸: 35 тыс. ₸ рекламы, 15 обращений и 8 оформленных
-- заявок в день. Месячные значения рассчитаны на 31 день октября.
UPDATE "SalesPlan" AS plan
SET
  "marketingBudgetTarget" = 1085000,
  "inquiryTarget" = 465,
  "applicationTarget" = 248,
  "recommendationBasis" = COALESCE(plan."recommendationBasis", '{}'::JSONB) || JSONB_BUILD_OBJECT(
    'funnel', JSONB_BUILD_OBJECT(
      'dailyAdBudget', 35000,
      'dailyInquiries', 15,
      'dailyApplications', 8,
      'targetCostPerInquiry', 2333.33,
      'targetLeadToOrderConversion', 9.27
    )
  ),
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Company" AS company
WHERE plan."companyId" = company."id"
  AND company."isDemo" = FALSE
  AND LOWER(company."name") LIKE '%altyn sapa%'
  AND plan."year" = 2026
  AND plan."month" = 10;
