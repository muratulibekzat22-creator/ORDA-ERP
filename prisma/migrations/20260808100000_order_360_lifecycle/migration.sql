-- CreateEnum
CREATE TYPE "OrderLifecycle" AS ENUM ('CREATED', 'PREPARATION', 'READY_FOR_PRODUCTION', 'IN_PRODUCTION', 'READY_FOR_INSTALLATION', 'INSTALLATION', 'ACCEPTANCE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderBlockerSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "OrderBlockerStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "completenessConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "contractConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "controlMeasurementCompletedAt" TIMESTAMP(3),
ADD COLUMN     "drawingApprovedAt" TIMESTAMP(3),
ADD COLUMN     "lifecycle" "OrderLifecycle" NOT NULL DEFAULT 'CREATED',
ADD COLUMN     "managerUserId" INTEGER,
ADD COLUMN     "materialsReadyAt" TIMESTAMP(3),
ADD COLUMN     "operationalAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "productionDeadline" TIMESTAMP(3),
ADD COLUMN     "promisedAt" TIMESTAMP(3),
ADD COLUMN     "qaApprovedAt" TIMESTAMP(3),
ADD COLUMN     "qaRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requiredPrepayment" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "specificationDefinedAt" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "workshopConfirmedAt" TIMESTAMP(3);

-- Preserve legacy orders while establishing stable lifecycle and manager FK projections.
UPDATE "Order" o
SET "managerUserId" = (
  SELECT MIN(u.id) FROM "User" u
  WHERE u.name = o.manager AND u.role IN ('DIRECTOR', 'MANAGER')
)
WHERE o."managerUserId" IS NULL;

UPDATE "Order"
SET lifecycle = CASE
  WHEN status ILIKE '%отмен%' OR status ILIKE '%отказ%' THEN 'CANCELLED'::"OrderLifecycle"
  WHEN status ILIKE '%заверш%' OR status = 'Сдано' THEN 'COMPLETED'::"OrderLifecycle"
  WHEN status ILIKE '%установ%' OR status ILIKE '%монтаж%' THEN 'INSTALLATION'::"OrderLifecycle"
  WHEN status ILIKE '%готов%' THEN 'READY_FOR_INSTALLATION'::"OrderLifecycle"
  WHEN status ILIKE '%покрас%' OR status ILIKE '%заготов%' OR status ILIKE '%каркас%' THEN 'IN_PRODUCTION'::"OrderLifecycle"
  WHEN status ILIKE '%договор%' OR status ILIKE '%замер%' OR status = 'Оформлен' THEN 'PREPARATION'::"OrderLifecycle"
  ELSE 'CREATED'::"OrderLifecycle"
END;

-- CreateTable
CREATE TABLE "OrderBlocker" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "OrderBlockerSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "comment" TEXT,
    "responsibleUserId" INTEGER,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedById" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" INTEGER,
    "resolution" TEXT,
    "status" "OrderBlockerStatus" NOT NULL DEFAULT 'OPEN',
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderBlocker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderGateOverride" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "gate" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "authorId" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderGateOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLifecycleEvent" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "fromLifecycle" "OrderLifecycle",
    "toLifecycle" "OrderLifecycle",
    "message" TEXT,
    "actorId" INTEGER,
    "actorName" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "metadata" JSONB,
    "idempotencyKey" TEXT,
    "requestHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderLifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderInstallation" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "installerUserId" INTEGER NOT NULL,
    "packageConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderBlocker_idempotencyKey_key" ON "OrderBlocker"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OrderBlocker_orderId_status_severity_idx" ON "OrderBlocker"("orderId", "status", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "OrderGateOverride_idempotencyKey_key" ON "OrderGateOverride"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OrderGateOverride_orderId_gate_createdAt_idx" ON "OrderGateOverride"("orderId", "gate", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLifecycleEvent_idempotencyKey_key" ON "OrderLifecycleEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OrderLifecycleEvent_orderId_createdAt_idx" ON "OrderLifecycleEvent"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderInstallation_orderId_key" ON "OrderInstallation"("orderId");

-- CreateIndex
CREATE INDEX "Order_lifecycle_promisedAt_idx" ON "Order"("lifecycle", "promisedAt");

-- CreateIndex
CREATE INDEX "Order_managerUserId_lifecycle_idx" ON "Order"("managerUserId", "lifecycle");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderBlocker" ADD CONSTRAINT "OrderBlocker_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderBlocker" ADD CONSTRAINT "OrderBlocker_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderBlocker" ADD CONSTRAINT "OrderBlocker_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderBlocker" ADD CONSTRAINT "OrderBlocker_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderGateOverride" ADD CONSTRAINT "OrderGateOverride_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderGateOverride" ADD CONSTRAINT "OrderGateOverride_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLifecycleEvent" ADD CONSTRAINT "OrderLifecycleEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLifecycleEvent" ADD CONSTRAINT "OrderLifecycleEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderInstallation" ADD CONSTRAINT "OrderInstallation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderInstallation" ADD CONSTRAINT "OrderInstallation_installerUserId_fkey" FOREIGN KEY ("installerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
