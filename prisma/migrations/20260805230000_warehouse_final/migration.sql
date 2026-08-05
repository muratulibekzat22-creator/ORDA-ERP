ALTER TABLE "Material"
ADD COLUMN "lookupKey" TEXT,
ADD COLUMN "reserved" DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "Material" SET "lookupKey" = lower(trim("name")) || '::' || lower(trim("unit"));
ALTER TABLE "Material" ALTER COLUMN "lookupKey" SET NOT NULL;
CREATE UNIQUE INDEX "Material_lookupKey_key" ON "Material"("lookupKey");

ALTER TABLE "MaterialMovement"
ADD COLUMN "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "stockAfter" DOUBLE PRECISION,
ADD COLUMN "reservedAfter" DOUBLE PRECISION,
ADD COLUMN "stockDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "reserveDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "employeeId" INTEGER,
ADD COLUMN "operationAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "MaterialMovement" SET "amount" = "price" * "quantity", "operationAt" = "createdAt";

CREATE TABLE "MaterialReservation" (
  "id" SERIAL NOT NULL,
  "materialId" INTEGER NOT NULL,
  "orderId" INTEGER NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "consumed" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdById" INTEGER,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaterialReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MaterialReservation_orderId_materialId_key" ON "MaterialReservation"("orderId", "materialId");
CREATE INDEX "MaterialReservation_materialId_status_idx" ON "MaterialReservation"("materialId", "status");
CREATE INDEX "MaterialReservation_orderId_status_idx" ON "MaterialReservation"("orderId", "status");

CREATE TABLE "WarehouseMutation" (
  "id" SERIAL NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "actorId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WarehouseMutation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WarehouseMutation_key_key" ON "WarehouseMutation"("key");
CREATE INDEX "WarehouseMutation_createdAt_idx" ON "WarehouseMutation"("createdAt");
ALTER TABLE "MaterialMovement" ADD CONSTRAINT "MaterialMovement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MaterialReservation" ADD CONSTRAINT "MaterialReservation_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialReservation" ADD CONSTRAINT "MaterialReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialReservation" ADD CONSTRAINT "MaterialReservation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WarehouseMutation" ADD CONSTRAINT "WarehouseMutation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "RolePermission" ("role", "permission", "createdAt", "updatedAt")
SELECT role_value::"Role", 'warehouse'::"Permission", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES ('DIRECTOR'), ('MANAGER'), ('ACCOUNTANT'), ('PRODUCTION')) AS roles(role_value)
ON CONFLICT ("role", "permission") DO NOTHING;
