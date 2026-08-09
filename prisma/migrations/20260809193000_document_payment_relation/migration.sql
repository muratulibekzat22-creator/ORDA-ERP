ALTER TABLE "Document" ADD COLUMN "paymentId" INTEGER;

CREATE INDEX "Document_paymentId_idx" ON "Document"("paymentId");

ALTER TABLE "Document"
ADD CONSTRAINT "Document_paymentId_fkey"
FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
