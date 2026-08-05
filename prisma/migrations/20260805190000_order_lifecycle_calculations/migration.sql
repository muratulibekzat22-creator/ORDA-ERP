ALTER TABLE "Order"
ADD COLUMN "partnerPlannedReadyAt" TIMESTAMP(3),
ADD COLUMN "partnerComment" TEXT NOT NULL DEFAULT '',
ADD COLUMN "readyForInstallation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "installationCompleted" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "OrderStatusHistory" (
  "id" SERIAL NOT NULL,
  "orderId" INTEGER NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT NOT NULL,
  "changedByUserId" INTEGER,
  "changedByName" TEXT NOT NULL,
  "changedByRole" "Role" NOT NULL,
  "comment" TEXT,
  "idempotencyKey" TEXT,
  "requestHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderCalculation" (
  "id" SERIAL NOT NULL,
  "orderId" INTEGER NOT NULL,
  "material" TEXT NOT NULL,
  "regularSteps" INTEGER NOT NULL,
  "platformEquivalents" INTEGER[],
  "equivalentSteps" INTEGER NOT NULL,
  "workshopRate" DECIMAL(12,2) NOT NULL,
  "saleRate" DECIMAL(12,2) NOT NULL,
  "baseWorkshopCost" DECIMAL(12,2) NOT NULL,
  "workshopCost" DECIMAL(12,2) NOT NULL,
  "baseClientPrice" DECIMAL(12,2) NOT NULL,
  "clientPrice" DECIMAL(12,2) NOT NULL,
  "grossDifference" DECIMAL(12,2) NOT NULL,
  "workshopAdjustment" DECIMAL(12,2) NOT NULL,
  "clientAdjustment" DECIMAL(12,2) NOT NULL,
  "createdByUserId" INTEGER,
  "createdByName" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "requestHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderCalculation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderStatusHistory_idempotencyKey_key" ON "OrderStatusHistory"("idempotencyKey");
CREATE INDEX "OrderStatusHistory_orderId_createdAt_idx" ON "OrderStatusHistory"("orderId", "createdAt");
CREATE UNIQUE INDEX "OrderCalculation_idempotencyKey_key" ON "OrderCalculation"("idempotencyKey");
CREATE INDEX "OrderCalculation_orderId_createdAt_idx" ON "OrderCalculation"("orderId", "createdAt");
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderCalculation" ADD CONSTRAINT "OrderCalculation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "Order" SET "status" = CASE "status"
  WHEN 'Замер' THEN 'Замер назначен'
  WHEN 'Проектирование' THEN 'Контрольный замер'
  WHEN 'Каркас' THEN 'Заготовка'
  WHEN 'Дерево' THEN 'Заготовка'
  WHEN 'Заказ готов' THEN 'Заказ готов'
  WHEN 'Монтаж' THEN 'Установка'
  WHEN 'Сдано' THEN 'Заказ завершён'
  ELSE "status"
END;
