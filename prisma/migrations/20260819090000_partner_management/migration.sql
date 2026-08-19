DO $$ BEGIN
  CREATE TYPE "PartnerBusinessType" AS ENUM ('REFERRER', 'SALES_AGENT', 'DEALER', 'DESIGNER', 'ARCHITECT', 'CONSTRUCTION_COMPANY', 'CONTRACTOR', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PartnerBusinessStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PartnerRewardRule" AS ENUM ('FIXED', 'ORDER_PERCENT', 'PAID_PERCENT', 'PROFIT_PERCENT', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PartnerSettlementStatus" AS ENUM ('NOT_CALCULATED', 'CALCULATED', 'PARTIALLY_PAID', 'CLOSED', 'PARTNER_OWES_COMPANY', 'COMPANY_OWES_PARTNER', 'DISPUTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PartnerSettlementOperationType" AS ENUM ('CLIENT_TO_COMPANY', 'CLIENT_TO_PARTNER', 'PARTNER_TO_COMPANY', 'COMPANY_TO_PARTNER', 'CLIENT_REFUND', 'PARTNER_REFUND', 'ADJUSTMENT', 'REVERSAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PartnerSettlementOperationStatus" AS ENUM ('POSTED', 'REVERSED', 'DISPUTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Partner"
  ADD COLUMN IF NOT EXISTS "secondaryPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "iinBin" TEXT,
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "bankDetails" TEXT,
  ADD COLUMN IF NOT EXISTS "contactPerson" TEXT,
  ADD COLUMN IF NOT EXISTS "cooperationStartedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "kind" "PartnerBusinessType" NOT NULL DEFAULT 'CONTRACTOR',
  ADD COLUMN IF NOT EXISTS "businessStatus" "PartnerBusinessStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "defaultRewardRule" "PartnerRewardRule" NOT NULL DEFAULT 'FIXED',
  ADD COLUMN IF NOT EXISTS "defaultRewardPercent" DECIMAL(7,4),
  ADD COLUMN IF NOT EXISTS "defaultRewardFixedAmount" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "comment" TEXT,
  ADD COLUMN IF NOT EXISTS "createdById" INTEGER;

DO $$ BEGIN
  ALTER TABLE "Partner" ADD CONSTRAINT "Partner_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "PartnerOrderRelation" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL DEFAULT current_setting('app.current_company_id', true)::integer,
  "partnerId" INTEGER NOT NULL,
  "orderId" INTEGER NOT NULL,
  "rewardRule" "PartnerRewardRule" NOT NULL,
  "rewardPercent" DECIMAL(7,4),
  "fixedAmount" DECIMAL(14,2),
  "manualAmount" DECIMAL(14,2),
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settlementStatus" "PartnerSettlementStatus" NOT NULL DEFAULT 'NOT_CALCULATED',
  "comment" TEXT,
  "closedAt" TIMESTAMP(3),
  "createdById" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerOrderRelation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PartnerSettlementOperation" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL DEFAULT current_setting('app.current_company_id', true)::integer,
  "relationId" INTEGER NOT NULL,
  "partnerId" INTEGER NOT NULL,
  "orderId" INTEGER NOT NULL,
  "type" "PartnerSettlementOperationType" NOT NULL,
  "status" "PartnerSettlementOperationStatus" NOT NULL DEFAULT 'POSTED',
  "amount" DECIMAL(14,2) NOT NULL,
  "adjustmentEffect" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "operationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "method" TEXT,
  "account" TEXT,
  "comment" TEXT,
  "paymentId" INTEGER,
  "reversalOfId" INTEGER,
  "createdById" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerSettlementOperation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PartnerAuditEvent" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL DEFAULT current_setting('app.current_company_id', true)::integer,
  "partnerId" INTEGER,
  "relationId" INTEGER,
  "operationId" INTEGER,
  "action" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "comment" TEXT,
  "actorId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerAuditEvent_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN ALTER TABLE "PartnerOrderRelation" ADD CONSTRAINT "PartnerOrderRelation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PartnerOrderRelation" ADD CONSTRAINT "PartnerOrderRelation_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PartnerOrderRelation" ADD CONSTRAINT "PartnerOrderRelation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PartnerOrderRelation" ADD CONSTRAINT "PartnerOrderRelation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "PartnerSettlementOperation" ADD CONSTRAINT "PartnerSettlementOperation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PartnerSettlementOperation" ADD CONSTRAINT "PartnerSettlementOperation_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "PartnerOrderRelation"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PartnerSettlementOperation" ADD CONSTRAINT "PartnerSettlementOperation_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PartnerSettlementOperation" ADD CONSTRAINT "PartnerSettlementOperation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PartnerSettlementOperation" ADD CONSTRAINT "PartnerSettlementOperation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PartnerSettlementOperation" ADD CONSTRAINT "PartnerSettlementOperation_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "PartnerSettlementOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PartnerSettlementOperation" ADD CONSTRAINT "PartnerSettlementOperation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN ALTER TABLE "PartnerAuditEvent" ADD CONSTRAINT "PartnerAuditEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PartnerAuditEvent" ADD CONSTRAINT "PartnerAuditEvent_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PartnerAuditEvent" ADD CONSTRAINT "PartnerAuditEvent_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "PartnerOrderRelation"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PartnerAuditEvent" ADD CONSTRAINT "PartnerAuditEvent_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "PartnerSettlementOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PartnerAuditEvent" ADD CONSTRAINT "PartnerAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "PartnerOrderRelation_orderId_key" ON "PartnerOrderRelation"("orderId");
CREATE UNIQUE INDEX IF NOT EXISTS "PartnerOrderRelation_companyId_orderId_key" ON "PartnerOrderRelation"("companyId", "orderId");
CREATE INDEX IF NOT EXISTS "PartnerOrderRelation_companyId_partnerId_settlementStatus_idx" ON "PartnerOrderRelation"("companyId", "partnerId", "settlementStatus");
CREATE INDEX IF NOT EXISTS "PartnerOrderRelation_partnerId_createdAt_idx" ON "PartnerOrderRelation"("partnerId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "PartnerSettlementOperation_paymentId_key" ON "PartnerSettlementOperation"("paymentId");
CREATE UNIQUE INDEX IF NOT EXISTS "PartnerSettlementOperation_reversalOfId_key" ON "PartnerSettlementOperation"("reversalOfId");
CREATE UNIQUE INDEX IF NOT EXISTS "PartnerSettlementOperation_idempotencyKey_key" ON "PartnerSettlementOperation"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "PartnerSettlementOperation_companyId_operationDate_id_idx" ON "PartnerSettlementOperation"("companyId", "operationDate", "id");
CREATE INDEX IF NOT EXISTS "PartnerSettlementOperation_partnerId_operationDate_idx" ON "PartnerSettlementOperation"("partnerId", "operationDate");
CREATE INDEX IF NOT EXISTS "PartnerSettlementOperation_orderId_operationDate_idx" ON "PartnerSettlementOperation"("orderId", "operationDate");
CREATE INDEX IF NOT EXISTS "PartnerSettlementOperation_relationId_operationDate_idx" ON "PartnerSettlementOperation"("relationId", "operationDate");
CREATE INDEX IF NOT EXISTS "PartnerAuditEvent_companyId_createdAt_idx" ON "PartnerAuditEvent"("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "PartnerAuditEvent_partnerId_createdAt_idx" ON "PartnerAuditEvent"("partnerId", "createdAt");
CREATE INDEX IF NOT EXISTS "PartnerAuditEvent_relationId_createdAt_idx" ON "PartnerAuditEvent"("relationId", "createdAt");
CREATE INDEX IF NOT EXISTS "PartnerAuditEvent_operationId_createdAt_idx" ON "PartnerAuditEvent"("operationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Partner_companyId_businessStatus_name_idx" ON "Partner"("companyId", "businessStatus", "name");
