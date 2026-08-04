ALTER TABLE "Payment" ADD COLUMN "requestHash" TEXT;
ALTER TABLE "MaterialMovement" ADD COLUMN "requestHash" TEXT;
ALTER TABLE "Measurement" ADD COLUMN "requestHash" TEXT;
ALTER TABLE "Production" ADD COLUMN "requestHash" TEXT;
ALTER TABLE "OrderEvent" ADD COLUMN "requestHash" TEXT;
