-- Make an internal brass request usable before a supplier or photo is known.
ALTER TABLE "Order"
  ADD COLUMN "brassCostBearer" TEXT NOT NULL DEFAULT 'COMPANY';

ALTER TABLE "OrderBrassProcurement"
  ALTER COLUMN "photoAttachmentId" DROP NOT NULL,
  ADD COLUMN "modelQuantities" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "costBearer" TEXT NOT NULL DEFAULT 'COMPANY';

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_brassCostBearer_check"
  CHECK ("brassCostBearer" IN ('COMPANY', 'CONTRACTOR'));

ALTER TABLE "OrderBrassProcurement"
  ADD CONSTRAINT "OrderBrassProcurement_costBearer_check"
  CHECK ("costBearer" IN ('COMPANY', 'CONTRACTOR')),
  ADD CONSTRAINT "OrderBrassProcurement_modelQuantities_check"
  CHECK (jsonb_typeof("modelQuantities") = 'object');
