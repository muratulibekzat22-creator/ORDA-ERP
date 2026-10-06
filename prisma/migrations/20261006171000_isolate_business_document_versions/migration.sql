-- Preserve the legacy DocumentVersion contract-snapshot history and create the
-- current document store under an unambiguous physical table name.

CREATE TABLE IF NOT EXISTS "BusinessDocumentVersion" (
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
  CONSTRAINT "BusinessDocumentVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BusinessDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BusinessDocumentVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "BusinessDocumentVersion_pathname_key" ON "BusinessDocumentVersion"("pathname");
CREATE UNIQUE INDEX IF NOT EXISTS "BusinessDocumentVersion_idempotencyKey_key" ON "BusinessDocumentVersion"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "BusinessDocumentVersion_pdfPathname_key" ON "BusinessDocumentVersion"("pdfPathname");
CREATE UNIQUE INDEX IF NOT EXISTS "BusinessDocumentVersion_documentId_version_key" ON "BusinessDocumentVersion"("documentId", "version");
CREATE INDEX IF NOT EXISTS "BusinessDocumentVersion_documentId_createdAt_idx" ON "BusinessDocumentVersion"("documentId", "createdAt");
