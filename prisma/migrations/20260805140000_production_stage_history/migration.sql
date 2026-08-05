ALTER TABLE "Production" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Production" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "Production" ADD COLUMN "plannedStartAt" TIMESTAMP(3);
ALTER TABLE "Production" ADD COLUMN "plannedEndAt" TIMESTAMP(3);
ALTER TABLE "Production" ADD COLUMN "actualEndAt" TIMESTAMP(3);

CREATE TABLE "ProductionStageHistory" (
  "id" SERIAL NOT NULL,
  "productionId" INTEGER NOT NULL,
  "fromStage" TEXT,
  "toStage" TEXT NOT NULL,
  "changedByUserId" INTEGER,
  "comment" TEXT,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductionStageHistory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductionStageHistory_idempotencyKey_key" ON "ProductionStageHistory"("idempotencyKey");
CREATE INDEX "ProductionStageHistory_productionId_createdAt_idx" ON "ProductionStageHistory"("productionId", "createdAt");
ALTER TABLE "ProductionStageHistory" ADD CONSTRAINT "ProductionStageHistory_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE CASCADE ON UPDATE CASCADE;
