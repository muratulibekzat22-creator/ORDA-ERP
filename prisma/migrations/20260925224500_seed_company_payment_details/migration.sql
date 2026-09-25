UPDATE "CompanySettings" settings
SET
  "bank" = CASE WHEN BTRIM(settings."bank") = '' THEN 'АО «Kaspi Bank»' ELSE settings."bank" END,
  "bik" = CASE WHEN BTRIM(settings."bik") = '' THEN 'CASPKZKA' ELSE settings."bik" END,
  "iik" = CASE WHEN BTRIM(settings."iik") = '' THEN 'KZ87722S000047797063' ELSE settings."iik" END,
  "bankDetails" = CASE WHEN BTRIM(settings."bankDetails") = '' THEN 'КБе: 17' ELSE settings."bankDetails" END,
  "kaspiGoldName" = CASE WHEN BTRIM(settings."kaspiGoldName") = '' THEN 'ABDULLAH I' ELSE settings."kaspiGoldName" END,
  "kaspiGoldPhone" = CASE WHEN BTRIM(settings."kaspiGoldPhone") = '' THEN '+77085935234' ELSE settings."kaspiGoldPhone" END,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Company" company
WHERE settings."companyId" = company."id"
  AND company."active" = true
  AND company."isDemo" = false;
