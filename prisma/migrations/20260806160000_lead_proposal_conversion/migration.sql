ALTER TABLE "Client" ADD COLUMN "nextContactAt" TIMESTAMP(3);
CREATE INDEX "Client_status_nextContactAt_idx" ON "Client"("status", "nextContactAt");
CREATE INDEX "Client_manager_status_idx" ON "Client"("manager", "status");
CREATE INDEX "Client_source_createdAt_idx" ON "Client"("source", "createdAt");

CREATE TABLE "LeadActivity" ("id" SERIAL PRIMARY KEY, "clientId" INTEGER NOT NULL, "type" TEXT NOT NULL, "comment" TEXT NOT NULL, "authorId" INTEGER, "authorName" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "LeadActivity_clientId_createdAt_idx" ON "LeadActivity"("clientId", "createdAt");
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LeadStatusHistory" ("id" SERIAL PRIMARY KEY, "clientId" INTEGER NOT NULL, "fromStatus" TEXT, "toStatus" TEXT NOT NULL, "authorId" INTEGER, "authorName" TEXT NOT NULL, "comment" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "LeadStatusHistory_clientId_createdAt_idx" ON "LeadStatusHistory"("clientId", "createdAt");
ALTER TABLE "LeadStatusHistory" ADD CONSTRAINT "LeadStatusHistory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LeadCalculation" ("id" SERIAL PRIMARY KEY, "clientId" INTEGER NOT NULL, "material" TEXT NOT NULL, "baseClientPrice" DECIMAL(12,2) NOT NULL, "clientPrice" DECIMAL(12,2) NOT NULL, "internalCost" DECIMAL(12,2) NOT NULL, "snapshot" JSONB NOT NULL, "comment" TEXT, "authorId" INTEGER, "authorName" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "LeadCalculation_clientId_createdAt_idx" ON "LeadCalculation"("clientId", "createdAt");
ALTER TABLE "LeadCalculation" ADD CONSTRAINT "LeadCalculation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LeadPriceAdjustment" ("id" SERIAL PRIMARY KEY, "calculationId" INTEGER NOT NULL, "originalPrice" DECIMAL(12,2) NOT NULL, "newPrice" DECIMAL(12,2) NOT NULL, "authorId" INTEGER, "authorName" TEXT NOT NULL, "comment" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "LeadPriceAdjustment_calculationId_createdAt_idx" ON "LeadPriceAdjustment"("calculationId", "createdAt");
ALTER TABLE "LeadPriceAdjustment" ADD CONSTRAINT "LeadPriceAdjustment_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "LeadCalculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CommercialProposal" ("id" SERIAL PRIMARY KEY, "clientId" INTEGER NOT NULL, "calculationId" INTEGER NOT NULL, "number" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'Черновик', "snapshot" JSONB NOT NULL, "validUntil" TIMESTAMP(3) NOT NULL, "executionTerm" TEXT NOT NULL, "paymentTerms" TEXT NOT NULL, "warranty" TEXT NOT NULL, "managerContact" TEXT NOT NULL, "sentAt" TIMESTAMP(3), "acceptedAt" TIMESTAMP(3), "createdById" INTEGER, "createdByName" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE UNIQUE INDEX "CommercialProposal_number_key" ON "CommercialProposal"("number");
CREATE INDEX "CommercialProposal_clientId_createdAt_idx" ON "CommercialProposal"("clientId", "createdAt");
CREATE INDEX "CommercialProposal_status_validUntil_idx" ON "CommercialProposal"("status", "validUntil");
ALTER TABLE "CommercialProposal" ADD CONSTRAINT "CommercialProposal_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommercialProposal" ADD CONSTRAINT "CommercialProposal_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "LeadCalculation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "LeadConversion" ("id" SERIAL PRIMARY KEY, "clientId" INTEGER NOT NULL, "proposalId" INTEGER NOT NULL, "orderId" INTEGER NOT NULL, "managerId" INTEGER, "managerName" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "LeadConversion_clientId_key" ON "LeadConversion"("clientId");
CREATE UNIQUE INDEX "LeadConversion_proposalId_key" ON "LeadConversion"("proposalId");
CREATE UNIQUE INDEX "LeadConversion_orderId_key" ON "LeadConversion"("orderId");
ALTER TABLE "LeadConversion" ADD CONSTRAINT "LeadConversion_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadConversion" ADD CONSTRAINT "LeadConversion_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CommercialProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadConversion" ADD CONSTRAINT "LeadConversion_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
