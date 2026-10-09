-- Add an order-scoped brass procurement workflow without changing existing orders.
CREATE TABLE "OrderBrassProcurement" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL DEFAULT current_setting('app.current_company_id', true)::INTEGER,
  "orderId" INTEGER NOT NULL,
  "quantityPairs" DECIMAL(12,3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "photoAttachmentId" INTEGER NOT NULL,
  "materialId" INTEGER NOT NULL,
  "orderItemId" INTEGER NOT NULL,
  "supplierId" INTEGER,
  "purchaseBatchId" INTEGER,
  "purchaseBatchLineId" INTEGER,
  "responsibleUserId" INTEGER NOT NULL,
  "reminderTaskId" INTEGER,
  "expectedArrivalDate" TIMESTAMP(3),
  "purchaseCurrency" TEXT NOT NULL DEFAULT 'KZT',
  "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
  "unitPurchasePrice" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "goodsCostKzt" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "cargoCostKzt" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "landedCostKzt" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "supplierPaidKzt" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "cargoPaidKzt" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "receivedAt" TIMESTAMP(3),
  "notes" TEXT NOT NULL DEFAULT '',
  "createdById" INTEGER NOT NULL,
  "updatedById" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderBrassProcurement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderBrassProcurement_orderId_key" ON "OrderBrassProcurement"("orderId");
CREATE UNIQUE INDEX "OrderBrassProcurement_photoAttachmentId_key" ON "OrderBrassProcurement"("photoAttachmentId");
CREATE UNIQUE INDEX "OrderBrassProcurement_orderItemId_key" ON "OrderBrassProcurement"("orderItemId");
CREATE UNIQUE INDEX "OrderBrassProcurement_purchaseBatchId_key" ON "OrderBrassProcurement"("purchaseBatchId");
CREATE UNIQUE INDEX "OrderBrassProcurement_purchaseBatchLineId_key" ON "OrderBrassProcurement"("purchaseBatchLineId");
CREATE UNIQUE INDEX "OrderBrassProcurement_reminderTaskId_key" ON "OrderBrassProcurement"("reminderTaskId");
CREATE UNIQUE INDEX "OrderBrassProcurement_idempotencyKey_key" ON "OrderBrassProcurement"("idempotencyKey");
CREATE INDEX "OrderBrassProcurement_companyId_status_createdAt_idx" ON "OrderBrassProcurement"("companyId", "status", "createdAt");
CREATE INDEX "OrderBrassProcurement_responsibleUserId_status_expectedArrivalDate_idx" ON "OrderBrassProcurement"("responsibleUserId", "status", "expectedArrivalDate");

ALTER TABLE "OrderBrassProcurement" ADD CONSTRAINT "OrderBrassProcurement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderBrassProcurement" ADD CONSTRAINT "OrderBrassProcurement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderBrassProcurement" ADD CONSTRAINT "OrderBrassProcurement_photoAttachmentId_fkey" FOREIGN KEY ("photoAttachmentId") REFERENCES "Attachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderBrassProcurement" ADD CONSTRAINT "OrderBrassProcurement_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderBrassProcurement" ADD CONSTRAINT "OrderBrassProcurement_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderBrassProcurement" ADD CONSTRAINT "OrderBrassProcurement_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderBrassProcurement" ADD CONSTRAINT "OrderBrassProcurement_purchaseBatchId_fkey" FOREIGN KEY ("purchaseBatchId") REFERENCES "PurchaseBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderBrassProcurement" ADD CONSTRAINT "OrderBrassProcurement_purchaseBatchLineId_fkey" FOREIGN KEY ("purchaseBatchLineId") REFERENCES "PurchaseBatchLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderBrassProcurement" ADD CONSTRAINT "OrderBrassProcurement_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderBrassProcurement" ADD CONSTRAINT "OrderBrassProcurement_reminderTaskId_fkey" FOREIGN KEY ("reminderTaskId") REFERENCES "CalendarTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderBrassProcurement" ADD CONSTRAINT "OrderBrassProcurement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderBrassProcurement" ADD CONSTRAINT "OrderBrassProcurement_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
