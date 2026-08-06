ALTER TABLE "CalculatorTariff" ADD COLUMN "managerMinimumPrice" DECIMAL(12,2) NOT NULL DEFAULT 0;
UPDATE "CalculatorTariff" SET "managerMinimumPrice" = "salePrice" WHERE "managerMinimumPrice" = 0;
ALTER TABLE "CommercialProposal" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "CommercialProposal" ADD COLUMN "rootNumber" TEXT;

CREATE TABLE "LeadFollowUp" (
  "id" SERIAL PRIMARY KEY, "clientId" INTEGER NOT NULL, "calculationId" INTEGER, "proposalId" INTEGER,
  "oldPrice" DECIMAL(12,2) NOT NULL, "proposedPrice" DECIMAL(12,2) NOT NULL, "standardPrice" DECIMAL(12,2) NOT NULL,
  "discount" DECIMAL(12,2) NOT NULL, "reason" TEXT NOT NULL, "comment" TEXT, "channel" TEXT NOT NULL,
  "managerUserId" INTEGER NOT NULL, "managerName" TEXT NOT NULL, "nextActionAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "LeadFollowUp_managerUserId_nextActionAt_idx" ON "LeadFollowUp"("managerUserId", "nextActionAt");
CREATE INDEX "LeadFollowUp_clientId_createdAt_idx" ON "LeadFollowUp"("clientId", "createdAt");
ALTER TABLE "LeadFollowUp" ADD CONSTRAINT "LeadFollowUp_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE;

CREATE TABLE "PriceApprovalRequest" (
  "id" SERIAL PRIMARY KEY, "clientId" INTEGER NOT NULL, "calculationId" INTEGER NOT NULL, "proposalId" INTEGER,
  "managerUserId" INTEGER NOT NULL, "managerName" TEXT NOT NULL, "standardSalePrice" DECIMAL(12,2) NOT NULL,
  "currentSalePrice" DECIMAL(12,2) NOT NULL, "requestedSalePrice" DECIMAL(12,2) NOT NULL,
  "approvedSalePrice" DECIMAL(12,2), "snapshotHash" TEXT NOT NULL, "reason" TEXT NOT NULL, "comment" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "reviewedAt" TIMESTAMP(3), "reviewedByUserId" INTEGER,
  "reviewedByName" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "PriceApprovalRequest_status_createdAt_idx" ON "PriceApprovalRequest"("status", "createdAt");
CREATE INDEX "PriceApprovalRequest_managerUserId_createdAt_idx" ON "PriceApprovalRequest"("managerUserId", "createdAt");
CREATE UNIQUE INDEX "PriceApprovalRequest_calculationId_managerUserId_status_key" ON "PriceApprovalRequest"("calculationId", "managerUserId", "status");
ALTER TABLE "PriceApprovalRequest" ADD CONSTRAINT "PriceApprovalRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE;
ALTER TABLE "PriceApprovalRequest" ADD CONSTRAINT "PriceApprovalRequest_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "LeadCalculation"("id") ON DELETE CASCADE;
ALTER TABLE "PriceApprovalRequest" ADD CONSTRAINT "PriceApprovalRequest_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CommercialProposal"("id") ON DELETE SET NULL;
