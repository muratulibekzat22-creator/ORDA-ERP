ALTER TABLE "Material"
ADD COLUMN "code" TEXT,
ADD COLUMN "model" TEXT,
ADD COLUMN "description" TEXT,
ADD COLUMN "sellingPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN "locationName" TEXT NOT NULL DEFAULT 'Офис / Шоурум',
ADD COLUMN "mainImagePath" TEXT,
ADD COLUMN "mainImageName" TEXT,
ADD COLUMN "mainImageType" TEXT,
ADD COLUMN "mainImageSize" INTEGER;

UPDATE "Material"
SET "code" = 'MAT-' || lpad("id"::text, 6, '0')
WHERE "code" IS NULL;

CREATE UNIQUE INDEX "Material_code_key" ON "Material"("code");
CREATE UNIQUE INDEX "Material_mainImagePath_key" ON "Material"("mainImagePath");
CREATE INDEX "Material_active_category_name_idx" ON "Material"("active", "category", "name");
CREATE INDEX "Material_code_idx" ON "Material"("code");

CREATE TABLE "WarehouseCodeCounter" (
  "prefix" TEXT NOT NULL,
  "value" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WarehouseCodeCounter_pkey" PRIMARY KEY ("prefix")
);

INSERT INTO "WarehouseCodeCounter" ("prefix", "value", "updatedAt")
SELECT 'MAT', COALESCE(MAX("id"), 0), CURRENT_TIMESTAMP FROM "Material";

CREATE TABLE "MaterialPriceHistory" (
  "id" SERIAL NOT NULL,
  "materialId" INTEGER NOT NULL,
  "sellingPrice" DECIMAL(18,2) NOT NULL,
  "changedById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaterialPriceHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaterialPriceHistory_materialId_createdAt_idx"
ON "MaterialPriceHistory"("materialId", "createdAt");

ALTER TABLE "MaterialPriceHistory"
ADD CONSTRAINT "MaterialPriceHistory_materialId_fkey"
FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaterialPriceHistory"
ADD CONSTRAINT "MaterialPriceHistory_changedById_fkey"
FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
