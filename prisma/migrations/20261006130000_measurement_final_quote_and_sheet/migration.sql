ALTER TABLE "Measurement"
  ADD COLUMN "sourceProposalId" INTEGER,
  ADD COLUMN "finalProposalId" INTEGER,
  ADD COLUMN "quoteMaterial" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "quoteBasePrice" DECIMAL(12,2),
  ADD COLUMN "quoteDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "quoteFinalPrice" DECIMAL(12,2),
  ADD COLUMN "quoteComment" TEXT,
  ADD COLUMN "quoteConfirmedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Measurement_finalProposalId_key" ON "Measurement"("finalProposalId");
CREATE INDEX "Measurement_sourceProposalId_idx" ON "Measurement"("sourceProposalId");

ALTER TABLE "Measurement"
  ADD CONSTRAINT "Measurement_sourceProposalId_fkey"
  FOREIGN KEY ("sourceProposalId") REFERENCES "CommercialProposal"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Measurement"
  ADD CONSTRAINT "Measurement_finalProposalId_fkey"
  FOREIGN KEY ("finalProposalId") REFERENCES "CommercialProposal"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
