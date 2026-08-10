-- Orders are removed from active work without destroying financial,
-- document, measurement, partner, payroll, or production history.
ALTER TABLE "Order"
ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedById" INTEGER;

ALTER TABLE "Production"
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "archiveReason" TEXT;

CREATE INDEX "Order_deletedAt_managerUserId_idx"
ON "Order"("deletedAt", "managerUserId");

CREATE INDEX "Order_deletedAt_lifecycle_idx"
ON "Order"("deletedAt", "lifecycle");

CREATE INDEX "Production_archivedAt_stage_idx"
ON "Production"("archivedAt", "stage");

ALTER TABLE "Order"
ADD CONSTRAINT "Order_deletedById_fkey"
FOREIGN KEY ("deletedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
