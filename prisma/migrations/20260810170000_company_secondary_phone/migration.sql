ALTER TABLE "CompanySettings"
  ADD COLUMN "secondaryPhone" TEXT NOT NULL DEFAULT '+77760027555';

ALTER TABLE "CompanySettings"
  ALTER COLUMN "phone" SET DEFAULT '+77085750881';

UPDATE "CompanySettings"
SET "phone" = '+77085750881'
WHERE BTRIM("phone") = ''
   OR REGEXP_REPLACE("phone", '\D', '', 'g') IN ('77085750881', '87085750881');
