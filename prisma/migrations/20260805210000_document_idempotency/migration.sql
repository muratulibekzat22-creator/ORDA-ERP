ALTER TABLE "Document"
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "requestHash" TEXT;

CREATE UNIQUE INDEX "Document_idempotencyKey_key" ON "Document"("idempotencyKey");
