-- CreateTable
CREATE TABLE "ManagerDailyReview" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "managerUserId" INTEGER NOT NULL,
  "businessDate" DATE NOT NULL,
  "inventoryOrderCount" INTEGER NOT NULL,
  "actionOrderCount" INTEGER NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ManagerDailyReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManagerDailyReview_companyId_managerUserId_businessDate_key"
ON "ManagerDailyReview"("companyId", "managerUserId", "businessDate");

CREATE INDEX "ManagerDailyReview_companyId_businessDate_idx"
ON "ManagerDailyReview"("companyId", "businessDate");

CREATE INDEX "ManagerDailyReview_companyId_managerUserId_completedAt_idx"
ON "ManagerDailyReview"("companyId", "managerUserId", "completedAt");

-- AddForeignKey
ALTER TABLE "ManagerDailyReview"
ADD CONSTRAINT "ManagerDailyReview_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManagerDailyReview"
ADD CONSTRAINT "ManagerDailyReview_managerUserId_fkey"
FOREIGN KEY ("managerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
