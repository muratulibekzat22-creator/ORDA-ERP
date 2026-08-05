ALTER TABLE "Payment" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "Payment" ADD COLUMN "partnerId" INTEGER;
ALTER TABLE "Payment" ADD COLUMN "operationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Payment" ADD COLUMN "author" TEXT;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_partnerId_fkey"
  FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Payment_operationDate_idx" ON "Payment"("operationDate");
CREATE INDEX "Payment_partnerId_idx" ON "Payment"("partnerId");
