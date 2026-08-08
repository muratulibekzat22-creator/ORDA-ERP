ALTER TYPE "PayrollAccrualType" ADD VALUE IF NOT EXISTS 'MEASUREMENT_BONUS';

CREATE TYPE "MeasurementStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'HANDED_TO_MANAGER', 'CANCELLED');
CREATE TYPE "MeasurementPhotoType" AS ENUM ('SHEET', 'OPENING', 'OBJECT', 'EXTRA');

ALTER TABLE "SystemSettings"
  ADD COLUMN "measurerOrderBonus" INTEGER NOT NULL DEFAULT 20000;

ALTER TABLE "Measurement"
  ADD COLUMN "clientId" INTEGER,
  ADD COLUMN "calendarTaskId" INTEGER,
  ADD COLUMN "status" "MeasurementStatus" NOT NULL DEFAULT 'ASSIGNED',
  ADD COLUMN "city" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "address" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "mapLink" TEXT,
  ADD COLUMN "managerComment" TEXT,
  ADD COLUMN "sameSize" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "stepLength" DOUBLE PRECISION,
  ADD COLUMN "stepWidth" DOUBLE PRECISION,
  ADD COLUMN "stepHeight" DOUBLE PRECISION,
  ADD COLUMN "individualSteps" JSONB,
  ADD COLUMN "riserHeight" DOUBLE PRECISION,
  ADD COLUMN "winderCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "winders" JSONB,
  ADD COLUMN "platformsCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "platforms" JSONB,
  ADD COLUMN "railingLength" DOUBLE PRECISION,
  ADD COLUMN "railingComment" TEXT,
  ADD COLUMN "objectNotes" TEXT,
  ADD COLUMN "completedSnapshot" JSONB,
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "handedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "readyForContractAt" TIMESTAMP(3);

UPDATE "Measurement" AS measurement
SET "clientId" = orders."clientId",
    "city" = clients."city",
    "address" = CASE WHEN measurement."comment" IS NULL THEN clients."address" ELSE clients."address" END
FROM "Order" AS orders
JOIN "Client" AS clients ON clients."id" = orders."clientId"
WHERE orders."id" = measurement."orderId";

ALTER TABLE "Measurement" ALTER COLUMN "clientId" SET NOT NULL;
ALTER TABLE "Measurement" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "Measurement" DROP CONSTRAINT "Measurement_orderId_fkey";
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_calendarTaskId_fkey" FOREIGN KEY ("calendarTaskId") REFERENCES "CalendarTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Measurement_calendarTaskId_key" ON "Measurement"("calendarTaskId");
CREATE INDEX "Measurement_measurerUserId_visitDate_idx" ON "Measurement"("measurerUserId", "visitDate");
CREATE INDEX "Measurement_clientId_status_visitDate_idx" ON "Measurement"("clientId", "status", "visitDate");
CREATE INDEX "Measurement_orderId_idx" ON "Measurement"("orderId");

CREATE TABLE "MeasurementAttachment" (
  "id" SERIAL NOT NULL,
  "measurementId" INTEGER NOT NULL,
  "type" "MeasurementPhotoType" NOT NULL DEFAULT 'EXTRA',
  "uploadedById" INTEGER,
  "fileName" TEXT NOT NULL,
  "pathname" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeasurementAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MeasurementAttachment_pathname_key" ON "MeasurementAttachment"("pathname");
CREATE INDEX "MeasurementAttachment_measurementId_type_createdAt_idx" ON "MeasurementAttachment"("measurementId", "type", "createdAt");
ALTER TABLE "MeasurementAttachment" ADD CONSTRAINT "MeasurementAttachment_measurementId_fkey" FOREIGN KEY ("measurementId") REFERENCES "Measurement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MeasurementAttachment" ADD CONSTRAINT "MeasurementAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MeasurementAudit" (
  "id" SERIAL NOT NULL,
  "measurementId" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" INTEGER NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MeasurementAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MeasurementAudit_measurementId_createdAt_idx" ON "MeasurementAudit"("measurementId", "createdAt");
CREATE INDEX "MeasurementAudit_actorId_createdAt_idx" ON "MeasurementAudit"("actorId", "createdAt");
ALTER TABLE "MeasurementAudit" ADD CONSTRAINT "MeasurementAudit_measurementId_fkey" FOREIGN KEY ("measurementId") REFERENCES "Measurement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MeasurementAudit" ADD CONSTRAINT "MeasurementAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PayrollAccrual" ADD COLUMN "measurementId" INTEGER;
CREATE UNIQUE INDEX "PayrollAccrual_measurementId_key" ON "PayrollAccrual"("measurementId");
ALTER TABLE "PayrollAccrual" ADD CONSTRAINT "PayrollAccrual_measurementId_fkey" FOREIGN KEY ("measurementId") REFERENCES "Measurement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
