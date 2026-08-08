ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'ESTIMATE';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'PROJECT';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'MEASUREMENT_SHEET';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'PAYMENT_RECEIPT';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'PHOTO';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'OTHER';

CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'READY', 'SIGNED', 'ARCHIVED');
CREATE TYPE "DocumentSource" AS ENUM ('UPLOADED', 'GENERATED_ORDER', 'GENERATED_PROPOSAL', 'MEASUREMENT_ATTACHMENT', 'ORDER_ATTACHMENT');

ALTER TABLE "Document"
  ALTER COLUMN "orderId" DROP NOT NULL,
  ADD COLUMN "clientId" INTEGER,
  ADD COLUMN "title" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "source" "DocumentSource" NOT NULL DEFAULT 'UPLOADED',
  ADD COLUMN "comment" TEXT,
  ADD COLUMN "authorId" INTEGER,
  ADD COLUMN "signedAt" TIMESTAMP(3),
  ADD COLUMN "signedComment" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedById" INTEGER,
  ADD COLUMN "currentVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Document" DROP CONSTRAINT "Document_orderId_fkey";
ALTER TABLE "Document" ADD CONSTRAINT "Document_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "Document" d
SET "clientId" = o."clientId",
    "title" = CASE d."type"::text
      WHEN 'OFFER' THEN 'Коммерческое предложение'
      WHEN 'CONTRACT' THEN 'Договор'
      WHEN 'ACT' THEN 'Акт выполненных работ'
      WHEN 'INVOICE' THEN 'Счёт'
      ELSE 'Документ'
    END,
    "source" = 'GENERATED_ORDER'
FROM "Order" o
WHERE d."orderId" = o.id;

DROP INDEX IF EXISTS "Document_orderId_type_key";

CREATE TABLE "DocumentVersion" (
  "id" SERIAL NOT NULL,
  "documentId" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "uploadedById" INTEGER,
  "comment" TEXT,
  "fileName" TEXT NOT NULL,
  "pathname" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "checksum" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentAudit" (
  "id" SERIAL NOT NULL,
  "documentId" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" INTEGER NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentVersion_pathname_key" ON "DocumentVersion"("pathname");
CREATE UNIQUE INDEX "DocumentVersion_documentId_version_key" ON "DocumentVersion"("documentId", "version");
CREATE INDEX "DocumentVersion_documentId_createdAt_idx" ON "DocumentVersion"("documentId", "createdAt");
CREATE INDEX "DocumentAudit_documentId_createdAt_idx" ON "DocumentAudit"("documentId", "createdAt");
CREATE INDEX "DocumentAudit_actorId_createdAt_idx" ON "DocumentAudit"("actorId", "createdAt");
CREATE INDEX "Document_clientId_documentDate_idx" ON "Document"("clientId", "documentDate");
CREATE INDEX "Document_orderId_documentDate_idx" ON "Document"("orderId", "documentDate");
CREATE INDEX "Document_status_documentDate_idx" ON "Document"("status", "documentDate");
CREATE INDEX "Document_authorId_documentDate_idx" ON "Document"("authorId", "documentDate");

ALTER TABLE "Document" ADD CONSTRAINT "Document_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocumentAudit" ADD CONSTRAINT "DocumentAudit_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentAudit" ADD CONSTRAINT "DocumentAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "RolePermission" ("role", "permission", "createdAt", "updatedAt")
SELECT role_value::"Role", 'documents'::"Permission", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM unnest(ARRAY['ACCOUNTANT', 'MEASURER', 'PRODUCTION', 'INSTALLER']) AS role_value
ON CONFLICT ("role", "permission") DO NOTHING;
