-- Production still contains the immutable legacy binary DocumentVersion table
-- (snapshotId/format/content). Preserve it byte-for-byte and add the canonical
-- Blob-backed representation under a separate physical table.
CREATE TABLE IF NOT EXISTS "DocumentVersionCanonical" (
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
  "templateVersion" TEXT,
  "snapshot" JSONB,
  "idempotencyKey" TEXT,
  "pdfFileName" TEXT,
  "pdfPathname" TEXT,
  "pdfContentType" TEXT,
  "pdfSize" INTEGER,
  "pdfChecksum" TEXT,
  "pdfStatus" "PdfGenerationStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  "pdfGeneratedAt" TIMESTAMP(3),
  "pdfErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DocumentVersionCanonical_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentVersionCanonical_pathname_key"
  ON "DocumentVersionCanonical"("pathname");
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentVersionCanonical_idempotencyKey_key"
  ON "DocumentVersionCanonical"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentVersionCanonical_pdfPathname_key"
  ON "DocumentVersionCanonical"("pdfPathname");
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentVersionCanonical_documentId_version_key"
  ON "DocumentVersionCanonical"("documentId", "version");
CREATE INDEX IF NOT EXISTS "DocumentVersionCanonical_documentId_createdAt_idx"
  ON "DocumentVersionCanonical"("documentId", "createdAt");

DO $$
BEGIN
  ALTER TABLE "DocumentVersionCanonical"
    ADD CONSTRAINT "DocumentVersionCanonical_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "DocumentVersionCanonical"
    ADD CONSTRAINT "DocumentVersionCanonical_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
