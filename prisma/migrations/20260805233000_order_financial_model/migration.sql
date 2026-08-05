ALTER TABLE "OrderCalculation"
ADD COLUMN "installationRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "deliveryRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "otherCity" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "pickup" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "materialCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "installationCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "deliveryCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "otherDirectCosts" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "totalCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "grossProfit" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TABLE "OrderCalculationLine" (
  "id" SERIAL NOT NULL,
  "calculationId" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "quantity" DECIMAL(12,3) NOT NULL,
  "unit" TEXT NOT NULL,
  "unitCost" DECIMAL(12,2) NOT NULL,
  "unitSale" DECIMAL(12,2) NOT NULL,
  "totalCost" DECIMAL(12,2) NOT NULL,
  "totalSale" DECIMAL(12,2) NOT NULL,
  "comment" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "position" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "OrderCalculationLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrderCalculationLine_calculationId_position_idx" ON "OrderCalculationLine"("calculationId", "position");
ALTER TABLE "OrderCalculationLine" ADD CONSTRAINT "OrderCalculationLine_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "OrderCalculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CompanyLedgerEntry" (
  "id" SERIAL NOT NULL,
  "type" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "operationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "orderId" INTEGER,
  "comment" TEXT,
  "authorId" INTEGER,
  "idempotencyKey" TEXT,
  "requestHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanyLedgerEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CompanyLedgerEntry_idempotencyKey_key" ON "CompanyLedgerEntry"("idempotencyKey");
CREATE INDEX "CompanyLedgerEntry_operationDate_idx" ON "CompanyLedgerEntry"("operationDate");
CREATE INDEX "CompanyLedgerEntry_orderId_idx" ON "CompanyLedgerEntry"("orderId");
ALTER TABLE "CompanyLedgerEntry" ADD CONSTRAINT "CompanyLedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanyLedgerEntry" ADD CONSTRAINT "CompanyLedgerEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PersonalLedgerEntry" (
  "id" SERIAL NOT NULL,
  "type" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "operationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "comment" TEXT,
  "authorId" INTEGER,
  "idempotencyKey" TEXT,
  "requestHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonalLedgerEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PersonalLedgerEntry_idempotencyKey_key" ON "PersonalLedgerEntry"("idempotencyKey");
CREATE INDEX "PersonalLedgerEntry_operationDate_idx" ON "PersonalLedgerEntry"("operationDate");
ALTER TABLE "PersonalLedgerEntry" ADD CONSTRAINT "PersonalLedgerEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
