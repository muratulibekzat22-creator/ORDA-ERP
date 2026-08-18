-- Restore ALTYN SAPA as the canonical live tenant and keep demo data in a
-- separate tenant. This migration is additive and intentionally preserves
-- every business row.

DO $$ BEGIN
  CREATE TYPE "CompanyMode" AS ENUM ('LIVE', 'DEMO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Company" (
  "id" SERIAL NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'KZT',
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Almaty',
  "mode" "CompanyMode" NOT NULL DEFAULT 'LIVE',
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Company_slug_key" ON "Company"("slug");

-- The failed demo release used tenant id=1. Move those rows as a unit before
-- restoring id=1 as the real company. Legacy NULL rows are the preserved real
-- production data and are backfilled below.
DO $$
DECLARE
  repair_required BOOLEAN;
  tenant_table RECORD;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM "Company"
    WHERE "id" = 1 AND ("isDemo" = true OR "slug" = 'altyn-sapa-demo')
  ) INTO repair_required;

  IF repair_required THEN
    INSERT INTO "Company" ("id", "slug", "name", "currency", "timezone", "mode", "isDemo", "active", "createdAt", "updatedAt")
    VALUES (2, 'orda-demo', 'ORDA DEMO', 'KZT', 'Asia/Almaty', 'DEMO', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE SET
      "slug" = EXCLUDED."slug", "name" = EXCLUDED."name", "mode" = 'DEMO',
      "isDemo" = true, "active" = true, "updatedAt" = CURRENT_TIMESTAMP;

    FOR tenant_table IN
      SELECT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'companyId'
        AND table_name <> 'Company'
    LOOP
      EXECUTE format('UPDATE %I SET "companyId" = 2 WHERE "companyId" = 1', tenant_table.table_name);
    END LOOP;

    UPDATE "Company" SET
      "slug" = 'altyn-sapa-company',
      "name" = 'ТОО ALTYN SAPA COMPANY',
      "currency" = 'KZT',
      "timezone" = 'Asia/Almaty',
      "mode" = 'LIVE',
      "isDemo" = false,
      "active" = true,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = 1;
  ELSE
    INSERT INTO "Company" ("id", "slug", "name", "currency", "timezone", "mode", "isDemo", "active", "createdAt", "updatedAt")
    VALUES (1, 'altyn-sapa-company', 'ТОО ALTYN SAPA COMPANY', 'KZT', 'Asia/Almaty', 'LIVE', false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE SET
      "slug" = EXCLUDED."slug", "name" = EXCLUDED."name", "mode" = 'LIVE',
      "isDemo" = false, "active" = true, "updatedAt" = CURRENT_TIMESTAMP;

    INSERT INTO "Company" ("id", "slug", "name", "currency", "timezone", "mode", "isDemo", "active", "createdAt", "updatedAt")
    VALUES (2, 'orda-demo', 'ORDA DEMO', 'KZT', 'Asia/Almaty', 'DEMO', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO NOTHING;
  END IF;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "CommercialProposal" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "CalendarTask" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "CompanyLedgerEntry" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "FinanceCategory" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "EmployeePayrollProfile" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "PayrollPeriod" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "PersonalLedgerEntry" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "Attachment" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "CompanySettings" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "MaterialMovement" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "PurchaseBatch" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "InventoryValuationEntry" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "InventoryCogsEntry" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "MaterialReservation" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "WarehouseMutation" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "Measurement" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "CashShift" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "CommercialAdjustment" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "Production" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "CalculatorTariff" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "OrderEvent" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
ALTER TABLE "RolePermission" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;

-- Relation-aware recovery for columns introduced only by this release.
UPDATE "CommercialProposal" p SET "companyId" = c."companyId" FROM "Client" c WHERE p."companyId" IS NULL AND c.id = p."clientId" AND c."companyId" IS NOT NULL;
UPDATE "CalendarTask" t SET "companyId" = COALESCE(
  (SELECT c."companyId" FROM "Client" c WHERE c.id = t."clientId"),
  (SELECT o."companyId" FROM "Order" o WHERE o.id = t."orderId"),
  (SELECT a."companyId" FROM "User" a WHERE a.id = t."assigneeId")
) WHERE t."companyId" IS NULL;
UPDATE "Attachment" a SET "companyId" = o."companyId" FROM "Order" o WHERE a."companyId" IS NULL AND o.id = a."orderId" AND o."companyId" IS NOT NULL;
UPDATE "MaterialMovement" m SET "companyId" = material."companyId" FROM "Material" material WHERE m."companyId" IS NULL AND material.id = m."materialId" AND material."companyId" IS NOT NULL;
UPDATE "PurchaseBatch" b SET "companyId" = s."companyId" FROM "Supplier" s WHERE b."companyId" IS NULL AND s.id = b."supplierId" AND s."companyId" IS NOT NULL;
UPDATE "InventoryValuationEntry" v SET "companyId" = m."companyId" FROM "Material" m WHERE v."companyId" IS NULL AND m.id = v."materialId" AND m."companyId" IS NOT NULL;
UPDATE "InventoryCogsEntry" c SET "companyId" = m."companyId" FROM "Material" m WHERE c."companyId" IS NULL AND m.id = c."materialId" AND m."companyId" IS NOT NULL;
UPDATE "MaterialReservation" r SET "companyId" = o."companyId" FROM "Order" o WHERE r."companyId" IS NULL AND o.id = r."orderId" AND o."companyId" IS NOT NULL;
UPDATE "CommercialAdjustment" a SET "companyId" = o."companyId" FROM "Order" o WHERE a."companyId" IS NULL AND o.id = a."orderId" AND o."companyId" IS NOT NULL;

DO $$
DECLARE
  tenant_table TEXT;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'User','Client','CommercialProposal','Partner','Order','CalendarTask',
    'CompanyLedgerEntry','FinanceCategory','EmployeePayrollProfile','PayrollPeriod',
    'PersonalLedgerEntry','Document','Attachment','Material','CompanySettings',
    'SystemSettings','MaterialMovement','Supplier','PurchaseBatch',
    'InventoryValuationEntry','InventoryCogsEntry','MaterialReservation',
    'WarehouseMutation','Measurement','Payment','CashShift','CommercialAdjustment',
    'Production','Settings','CalculatorTariff','OrderEvent','RolePermission'
  ]
  LOOP
    EXECUTE format('UPDATE %I SET "companyId" = 1 WHERE "companyId" IS NULL', tenant_table);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "companyId" SET NOT NULL', tenant_table);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', tenant_table, tenant_table || '_companyId_fkey');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE', tenant_table, tenant_table || '_companyId_fkey');
  END LOOP;
END $$;

DROP INDEX IF EXISTS "FinanceCategory_direction_code_key";
DROP INDEX IF EXISTS "PayrollPeriod_year_month_key";
DROP INDEX IF EXISTS "CalculatorTariff_code_key";
DROP INDEX IF EXISTS "RolePermission_role_permission_key";
CREATE UNIQUE INDEX IF NOT EXISTS "FinanceCategory_companyId_direction_code_key" ON "FinanceCategory"("companyId", "direction", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollPeriod_companyId_year_month_key" ON "PayrollPeriod"("companyId", "year", "month");
CREATE UNIQUE INDEX IF NOT EXISTS "CalculatorTariff_companyId_code_key" ON "CalculatorTariff"("companyId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "RolePermission_companyId_role_permission_key" ON "RolePermission"("companyId", "role", "permission");
CREATE UNIQUE INDEX IF NOT EXISTS "CompanySettings_companyId_key" ON "CompanySettings"("companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "SystemSettings_companyId_key" ON "SystemSettings"("companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "Settings_companyId_key" ON "Settings"("companyId");

CREATE INDEX IF NOT EXISTS "User_companyId_active_role_idx" ON "User"("companyId", "active", "role");
CREATE INDEX IF NOT EXISTS "Client_companyId_active_deletedAt_idx" ON "Client"("companyId", "active", "deletedAt");
CREATE INDEX IF NOT EXISTS "CommercialProposal_companyId_createdAt_idx" ON "CommercialProposal"("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "Order_companyId_deletedAt_createdAt_idx" ON "Order"("companyId", "deletedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "CalendarTask_companyId_dueAt_status_idx" ON "CalendarTask"("companyId", "dueAt", "status");
CREATE INDEX IF NOT EXISTS "Document_companyId_documentDate_id_idx" ON "Document"("companyId", "documentDate", "id");
CREATE INDEX IF NOT EXISTS "Measurement_companyId_status_visitDate_idx" ON "Measurement"("companyId", "status", "visitDate");
CREATE INDEX IF NOT EXISTS "Payment_companyId_operationDate_id_idx" ON "Payment"("companyId", "operationDate", "id");

CREATE SEQUENCE IF NOT EXISTS "CompanySettings_id_seq";
CREATE SEQUENCE IF NOT EXISTS "SystemSettings_id_seq";
CREATE SEQUENCE IF NOT EXISTS "Settings_id_seq";
ALTER SEQUENCE "CompanySettings_id_seq" OWNED BY "CompanySettings"."id";
ALTER SEQUENCE "SystemSettings_id_seq" OWNED BY "SystemSettings"."id";
ALTER SEQUENCE "Settings_id_seq" OWNED BY "Settings"."id";
SELECT setval('"CompanySettings_id_seq"', GREATEST(COALESCE((SELECT MAX(id) FROM "CompanySettings"), 1), 1), true);
SELECT setval('"SystemSettings_id_seq"', GREATEST(COALESCE((SELECT MAX(id) FROM "SystemSettings"), 1), 1), true);
SELECT setval('"Settings_id_seq"', GREATEST(COALESCE((SELECT MAX(id) FROM "Settings"), 1), 1), true);
ALTER TABLE "CompanySettings" ALTER COLUMN "id" SET DEFAULT nextval('"CompanySettings_id_seq"');
ALTER TABLE "SystemSettings" ALTER COLUMN "id" SET DEFAULT nextval('"SystemSettings_id_seq"');
ALTER TABLE "Settings" ALTER COLUMN "id" SET DEFAULT nextval('"Settings_id_seq"');
SELECT setval(pg_get_serial_sequence('"Company"', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM "Company"), 2), 2), true);
