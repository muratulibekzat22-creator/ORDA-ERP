-- Repair a production schema drift without removing or rewriting legacy supplier data.
-- The legacy supplier columns remain in place and are mapped by Prisma.
ALTER TABLE "Supplier"
  ADD COLUMN IF NOT EXISTS "country" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "defaultCurrency" TEXT NOT NULL DEFAULT 'KZT',
  ADD COLUMN IF NOT EXISTS "contact" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "comment" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Supplier"
  ALTER COLUMN "phoneMask" SET DEFAULT '',
  ALTER COLUMN "city" SET DEFAULT '';

CREATE INDEX IF NOT EXISTS "Supplier_active_name_idx"
  ON "Supplier"("active", "name");

CREATE INDEX IF NOT EXISTS "Supplier_companyId_active_name_idx"
  ON "Supplier"("companyId", "active", "name");
