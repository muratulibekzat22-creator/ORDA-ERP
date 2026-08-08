CREATE SEQUENCE IF NOT EXISTS "commercial_proposal_number_seq" START WITH 100000 INCREMENT BY 1 MINVALUE 100000;

ALTER TABLE "CommercialProposal"
  ADD COLUMN "total" DECIMAL(12,2),
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "requestHash" TEXT,
  ADD COLUMN "providerMessageId" TEXT,
  ADD COLUMN "sendIdempotencyKey" TEXT;

CREATE UNIQUE INDEX "CommercialProposal_idempotencyKey_key" ON "CommercialProposal"("idempotencyKey");
CREATE UNIQUE INDEX "CommercialProposal_sendIdempotencyKey_key" ON "CommercialProposal"("sendIdempotencyKey");
CREATE INDEX "CommercialProposal_rootNumber_version_idx" ON "CommercialProposal"("rootNumber", "version");
CREATE INDEX "CommercialProposal_createdById_createdAt_idx" ON "CommercialProposal"("createdById", "createdAt");

INSERT INTO "CalculatorTariff" ("code", "uiName", "kind", "unit", "internalPrice", "salePrice", "defaultQuantity", "manualPriceAllowed", "active", "sortOrder", "updatedAt")
VALUES ('MEASUREMENT', 'Замер', 'MEASUREMENT', 'выезд', 0, 0, 1, true, true, 220, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
