-- A fresh tenant may not have opened Settings yet. Ensure its document
-- requisites exist, while preserving every non-empty value already entered.
INSERT INTO "CompanySettings" (
  "companyId",
  "bank",
  "bik",
  "iik",
  "bankDetails",
  "kaspiGoldName",
  "kaspiGoldPhone",
  "updatedAt"
)
SELECT
  company.id,
  'АО «Kaspi Bank»',
  'CASPKZKA',
  'KZ87722S000047797063',
  'КБе: 17',
  'ABDULLAH I',
  '+77085935234',
  CURRENT_TIMESTAMP
FROM "Company" AS company
WHERE company.active = TRUE
  AND company."isDemo" = FALSE
ON CONFLICT ("companyId") DO UPDATE SET
  "bank" = CASE WHEN BTRIM("CompanySettings"."bank") = '' THEN EXCLUDED."bank" ELSE "CompanySettings"."bank" END,
  "bik" = CASE WHEN BTRIM("CompanySettings"."bik") = '' THEN EXCLUDED."bik" ELSE "CompanySettings"."bik" END,
  "iik" = CASE WHEN BTRIM("CompanySettings"."iik") = '' THEN EXCLUDED."iik" ELSE "CompanySettings"."iik" END,
  "bankDetails" = CASE WHEN BTRIM("CompanySettings"."bankDetails") = '' THEN EXCLUDED."bankDetails" ELSE "CompanySettings"."bankDetails" END,
  "kaspiGoldName" = CASE WHEN BTRIM("CompanySettings"."kaspiGoldName") = '' THEN EXCLUDED."kaspiGoldName" ELSE "CompanySettings"."kaspiGoldName" END,
  "kaspiGoldPhone" = CASE WHEN BTRIM("CompanySettings"."kaspiGoldPhone") = '' THEN EXCLUDED."kaspiGoldPhone" ELSE "CompanySettings"."kaspiGoldPhone" END,
  "updatedAt" = CURRENT_TIMESTAMP;
