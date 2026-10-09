ALTER TABLE "Order"
ADD COLUMN "designStyle" TEXT NOT NULL DEFAULT '',
ADD COLUMN "designNotes" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Attachment"
ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'GENERAL';

CREATE INDEX "Attachment_orderId_purpose_createdAt_idx"
ON "Attachment"("orderId", "purpose", "createdAt");
