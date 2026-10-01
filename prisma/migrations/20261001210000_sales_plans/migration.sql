CREATE TABLE "SalesPlan" (
  "id" SERIAL PRIMARY KEY,
  "companyId" INTEGER NOT NULL DEFAULT current_setting('app.current_company_id', true)::INTEGER,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "revenueTarget" DECIMAL(14,2) NOT NULL,
  "orderTarget" INTEGER NOT NULL,
  "recommendationRevenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "recommendationOrders" INTEGER NOT NULL DEFAULT 0,
  "recommendationBasis" JSONB,
  "createdById" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "SalesPlanTier" (
  "id" SERIAL PRIMARY KEY,
  "planId" INTEGER NOT NULL,
  "thresholdPercent" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "rewardAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "SalesPlanManagerTarget" (
  "id" SERIAL PRIMARY KEY,
  "planId" INTEGER NOT NULL,
  "managerId" INTEGER NOT NULL,
  "revenueTarget" DECIMAL(14,2) NOT NULL,
  "orderTarget" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "SalesPlan_companyId_year_month_key" ON "SalesPlan"("companyId", "year", "month");
CREATE INDEX "SalesPlan_companyId_year_month_idx" ON "SalesPlan"("companyId", "year", "month");
CREATE UNIQUE INDEX "SalesPlanTier_planId_thresholdPercent_key" ON "SalesPlanTier"("planId", "thresholdPercent");
CREATE INDEX "SalesPlanTier_planId_position_idx" ON "SalesPlanTier"("planId", "position");
CREATE UNIQUE INDEX "SalesPlanManagerTarget_planId_managerId_key" ON "SalesPlanManagerTarget"("planId", "managerId");
CREATE INDEX "SalesPlanManagerTarget_managerId_planId_idx" ON "SalesPlanManagerTarget"("managerId", "planId");

ALTER TABLE "SalesPlan" ADD CONSTRAINT "SalesPlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesPlan" ADD CONSTRAINT "SalesPlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesPlanTier" ADD CONSTRAINT "SalesPlanTier_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SalesPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesPlanManagerTarget" ADD CONSTRAINT "SalesPlanManagerTarget_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SalesPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesPlanManagerTarget" ADD CONSTRAINT "SalesPlanManagerTarget_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
