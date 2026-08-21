ALTER TABLE "Partner"
  ADD COLUMN IF NOT EXISTS "managementDirectory" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Partner_companyId_managementDirectory_businessStatus_idx"
  ON "Partner"("companyId", "managementDirectory", "businessStatus");
