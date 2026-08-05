CREATE TABLE "Attachment" (
  "id" SERIAL NOT NULL,
  "orderId" INTEGER NOT NULL,
  "documentId" INTEGER,
  "uploadedById" INTEGER,
  "fileName" TEXT NOT NULL,
  "pathname" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "idempotencyKey" TEXT,
  "requestHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Attachment_pathname_key" ON "Attachment"("pathname");
CREATE UNIQUE INDEX "Attachment_idempotencyKey_key" ON "Attachment"("idempotencyKey");
CREATE INDEX "Attachment_orderId_createdAt_idx" ON "Attachment"("orderId", "createdAt");
CREATE INDEX "Attachment_documentId_createdAt_idx" ON "Attachment"("documentId", "createdAt");
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
