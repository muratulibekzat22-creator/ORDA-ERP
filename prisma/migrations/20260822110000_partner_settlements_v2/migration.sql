ALTER TABLE "PartnerOrderRelation"
ADD COLUMN "workDueAt" TIMESTAMP(3),
ADD COLUMN "paymentDueAt" TIMESTAMP(3),
ADD COLUMN "disputeReason" TEXT;

CREATE INDEX "PartnerOrderRelation_companyId_paymentDueAt_settlementStatus_idx"
ON "PartnerOrderRelation"("companyId", "paymentDueAt", "settlementStatus");
