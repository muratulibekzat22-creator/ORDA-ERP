-- Additive order-economy layer. Planned costs stay separate from cash ledger.
ALTER TABLE "CompanySettings"
ADD COLUMN "defaultWorkshopPartnerId" INTEGER;

CREATE TABLE "OrderCostPlan" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL DEFAULT current_setting('app.current_company_id')::integer,
    "orderId" INTEGER NOT NULL,
    "materialOutsideWorkshop" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "delivery" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "bankFees" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otherDirect" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "confirmedAt" TIMESTAMP(3),
    "updatedById" INTEGER NOT NULL,
    "updatedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrderCostPlan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OrderCostPlan_non_negative" CHECK (
      "materialOutsideWorkshop" >= 0 AND "delivery" >= 0 AND
      "bankFees" >= 0 AND "otherDirect" >= 0
    )
);

CREATE TABLE "OrderCostPlanRevision" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL DEFAULT current_setting('app.current_company_id')::integer,
    "orderId" INTEGER NOT NULL,
    "actorId" INTEGER NOT NULL,
    "actorName" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderCostPlanRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderCostPlan_orderId_key" ON "OrderCostPlan"("orderId");
CREATE INDEX "OrderCostPlan_companyId_confirmedAt_idx" ON "OrderCostPlan"("companyId", "confirmedAt");
CREATE INDEX "OrderCostPlanRevision_companyId_orderId_createdAt_idx" ON "OrderCostPlanRevision"("companyId", "orderId", "createdAt");
CREATE INDEX "CompanySettings_companyId_defaultWorkshopPartnerId_idx" ON "CompanySettings"("companyId", "defaultWorkshopPartnerId");

ALTER TABLE "CompanySettings"
ADD CONSTRAINT "CompanySettings_defaultWorkshopPartnerId_fkey"
FOREIGN KEY ("defaultWorkshopPartnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderCostPlan"
ADD CONSTRAINT "OrderCostPlan_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderCostPlan"
ADD CONSTRAINT "OrderCostPlan_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderCostPlanRevision"
ADD CONSTRAINT "OrderCostPlanRevision_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderCostPlanRevision"
ADD CONSTRAINT "OrderCostPlanRevision_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
