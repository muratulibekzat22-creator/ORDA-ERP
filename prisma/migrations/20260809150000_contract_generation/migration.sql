ALTER TYPE "DocumentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TABLE "Client" ADD COLUMN "iin" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Document"
  ADD COLUMN "templateVersion" TEXT,
  ADD COLUMN "snapshot" JSONB,
  ADD COLUMN "signedFileName" TEXT,
  ADD COLUMN "signedPathname" TEXT,
  ADD COLUMN "signedContentType" TEXT,
  ADD COLUMN "signedSize" INTEGER,
  ADD COLUMN "signedChecksum" TEXT;
CREATE UNIQUE INDEX "Document_signedPathname_key" ON "Document"("signedPathname");
ALTER TABLE "Material" ADD COLUMN "warrantyMonths" INTEGER;
ALTER TABLE "CompanySettings"
  ADD COLUMN "directorFullName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "iik" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "bank" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "bik" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SystemSettings" ADD COLUMN "nextContractNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "DocumentVersion"
  ADD COLUMN "templateVersion" TEXT,
  ADD COLUMN "snapshot" JSONB,
  ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "DocumentVersion_idempotencyKey_key" ON "DocumentVersion"("idempotencyKey");
