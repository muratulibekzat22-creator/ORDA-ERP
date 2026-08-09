ALTER TABLE "Order"
  ADD COLUMN "mapUrl" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "orderReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "frameComment" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "railingType" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "supportType" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "color" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "lighting" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lightingDetails" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "cladding" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "claddingDetails" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "additionalDetails" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT '';

UPDATE "Order" SET "orderReceivedAt" = "createdAt";

CREATE INDEX "Order_orderReceivedAt_idx" ON "Order"("orderReceivedAt");
