ALTER TABLE "Payment" ALTER COLUMN "amount" TYPE DECIMAL(14,2) USING ROUND("amount"::numeric, 2);
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_orderId_fkey";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderCalculation" DROP CONSTRAINT "OrderCalculation_orderId_fkey";
ALTER TABLE "OrderCalculation" ADD CONSTRAINT "OrderCalculation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialMovement" DROP CONSTRAINT "MaterialMovement_orderId_fkey";
ALTER TABLE "MaterialMovement" ADD CONSTRAINT "MaterialMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Production" DROP CONSTRAINT "Production_orderId_fkey";
ALTER TABLE "Production" ADD CONSTRAINT "Production_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD COLUMN "reversalOfId" INTEGER,
ADD COLUMN "reversalReason" TEXT;
CREATE UNIQUE INDEX "Payment_reversalOfId_key" ON "Payment"("reversalOfId");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MaterialMovement" ADD COLUMN "reversalOfId" INTEGER;
CREATE UNIQUE INDEX "MaterialMovement_reversalOfId_key" ON "MaterialMovement"("reversalOfId");
ALTER TABLE "MaterialMovement" ADD CONSTRAINT "MaterialMovement_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "MaterialMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CommercialAdjustment" (
  "id" SERIAL NOT NULL, "orderId" INTEGER NOT NULL,
  "previousAmount" DECIMAL(14,2) NOT NULL, "newAmount" DECIMAL(14,2) NOT NULL,
  "balanceImpact" DECIMAL(14,2) NOT NULL, "reason" TEXT NOT NULL,
  "authorId" INTEGER NOT NULL, "idempotencyKey" TEXT, "requestHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialAdjustment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommercialAdjustment_idempotencyKey_key" ON "CommercialAdjustment"("idempotencyKey");
CREATE INDEX "CommercialAdjustment_orderId_createdAt_idx" ON "CommercialAdjustment"("orderId", "createdAt");
ALTER TABLE "CommercialAdjustment" ADD CONSTRAINT "CommercialAdjustment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommercialAdjustment" ADD CONSTRAINT "CommercialAdjustment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PartnerAssignmentHistory" (
  "id" SERIAL NOT NULL, "orderId" INTEGER NOT NULL, "previousPartnerId" INTEGER,
  "newPartnerId" INTEGER NOT NULL, "previousPayable" DECIMAL(14,2) NOT NULL,
  "newPayable" DECIMAL(14,2) NOT NULL, "paidAtChange" DECIMAL(14,2) NOT NULL,
  "remainingAtChange" DECIMAL(14,2) NOT NULL, "reason" TEXT NOT NULL,
  "authorId" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerAssignmentHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PartnerAssignmentHistory_orderId_createdAt_idx" ON "PartnerAssignmentHistory"("orderId", "createdAt");
CREATE INDEX "PartnerAssignmentHistory_previousPartnerId_createdAt_idx" ON "PartnerAssignmentHistory"("previousPartnerId", "createdAt");
CREATE INDEX "PartnerAssignmentHistory_newPartnerId_createdAt_idx" ON "PartnerAssignmentHistory"("newPartnerId", "createdAt");
ALTER TABLE "PartnerAssignmentHistory" ADD CONSTRAINT "PartnerAssignmentHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerAssignmentHistory" ADD CONSTRAINT "PartnerAssignmentHistory_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FinanceAuditEvent" (
  "id" SERIAL NOT NULL, "orderId" INTEGER, "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL, "entityId" INTEGER, "before" JSONB, "after" JSONB,
  "reason" TEXT NOT NULL, "authorId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceAuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FinanceAuditEvent_orderId_createdAt_idx" ON "FinanceAuditEvent"("orderId", "createdAt");
CREATE INDEX "FinanceAuditEvent_entityType_entityId_createdAt_idx" ON "FinanceAuditEvent"("entityType", "entityId", "createdAt");
ALTER TABLE "FinanceAuditEvent" ADD CONSTRAINT "FinanceAuditEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinanceAuditEvent" ADD CONSTRAINT "FinanceAuditEvent_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
