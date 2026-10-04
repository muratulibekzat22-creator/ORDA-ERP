CREATE TYPE "EmployeeHandoverStatus" AS ENUM ('PREPARED', 'CANCELLED', 'COMPLETED', 'ROLLED_BACK');

ALTER TABLE "LeadFollowUp" ADD COLUMN "createdByUserId" INTEGER, ADD COLUMN "createdByName" TEXT;
UPDATE "LeadFollowUp" SET "createdByUserId" = "managerUserId", "createdByName" = "managerName";
ALTER TABLE "PriceApprovalRequest" ADD COLUMN "requestedByUserId" INTEGER, ADD COLUMN "requestedByName" TEXT;
UPDATE "PriceApprovalRequest" SET "requestedByUserId" = "managerUserId", "requestedByName" = "managerName";

CREATE TABLE "EmployeeHandover" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "fromUserId" INTEGER NOT NULL,
  "toUserId" INTEGER NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "categories" JSONB NOT NULL,
  "status" "EmployeeHandoverStatus" NOT NULL DEFAULT 'PREPARED',
  "preparedById" INTEGER NOT NULL,
  "confirmedById" INTEGER,
  "confirmedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "rolledBackAt" TIMESTAMP(3),
  "report" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeHandover_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmployeeHandoverItem" (
  "id" SERIAL NOT NULL,
  "handoverId" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "entityId" INTEGER NOT NULL,
  "oldName" TEXT,
  "newName" TEXT,
  "snapshot" JSONB,
  "transferredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmployeeHandoverItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmployeeHandoverNotice" (
  "id" SERIAL NOT NULL,
  "handoverId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmployeeHandoverNotice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmployeeHandover_companyId_status_scheduledAt_idx" ON "EmployeeHandover"("companyId", "status", "scheduledAt");
CREATE INDEX "EmployeeHandover_fromUserId_status_idx" ON "EmployeeHandover"("fromUserId", "status");
CREATE INDEX "EmployeeHandover_toUserId_status_idx" ON "EmployeeHandover"("toUserId", "status");
CREATE UNIQUE INDEX "EmployeeHandoverItem_handoverId_kind_entityId_key" ON "EmployeeHandoverItem"("handoverId", "kind", "entityId");
CREATE INDEX "EmployeeHandoverItem_kind_entityId_idx" ON "EmployeeHandoverItem"("kind", "entityId");
CREATE INDEX "EmployeeHandoverNotice_userId_readAt_createdAt_idx" ON "EmployeeHandoverNotice"("userId", "readAt", "createdAt");

ALTER TABLE "EmployeeHandover" ADD CONSTRAINT "EmployeeHandover_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeHandover" ADD CONSTRAINT "EmployeeHandover_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeHandover" ADD CONSTRAINT "EmployeeHandover_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeHandover" ADD CONSTRAINT "EmployeeHandover_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeHandover" ADD CONSTRAINT "EmployeeHandover_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeHandoverItem" ADD CONSTRAINT "EmployeeHandoverItem_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "EmployeeHandover"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeHandoverNotice" ADD CONSTRAINT "EmployeeHandoverNotice_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "EmployeeHandover"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeHandoverNotice" ADD CONSTRAINT "EmployeeHandoverNotice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
