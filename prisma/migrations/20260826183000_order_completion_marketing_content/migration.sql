-- CreateEnum
CREATE TYPE "MarketingContentTaskStatus" AS ENUM (
  'NEW',
  'NEED_CONTACT',
  'CONTACTED',
  'SHOOT_SCHEDULED',
  'REVIEW_RECEIVED',
  'PHOTOS_RECEIVED',
  'VIDEO_RECEIVED',
  'CONTENT_READY',
  'PUBLISHED',
  'REFUSED'
);

-- CreateEnum
CREATE TYPE "MarketingContentConsent" AS ENUM ('UNKNOWN', 'YES', 'NO');

-- CreateEnum
CREATE TYPE "MarketingContentAssetType" AS ENUM ('PHOTO', 'VIDEO');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "financialClosedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MarketingContentTask" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "orderId" INTEGER NOT NULL,
  "clientId" INTEGER NOT NULL,
  "assignedMarketerId" INTEGER,
  "status" "MarketingContentTaskStatus" NOT NULL DEFAULT 'NEW',
  "completedAt" TIMESTAMP(3),
  "contactConsent" "MarketingContentConsent" NOT NULL DEFAULT 'UNKNOWN',
  "photoVideoConsent" "MarketingContentConsent" NOT NULL DEFAULT 'UNKNOWN',
  "scheduledAt" TIMESTAMP(3),
  "contentReceivedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "reviewText" TEXT,
  "publicationUrl" TEXT,
  "comment" TEXT,
  "createdById" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MarketingContentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingContentAsset" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "taskId" INTEGER NOT NULL,
  "type" "MarketingContentAssetType" NOT NULL,
  "fileName" TEXT NOT NULL,
  "pathname" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "uploadedById" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MarketingContentAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingContentTask_orderId_key" ON "MarketingContentTask"("orderId");
CREATE INDEX "MarketingContentTask_companyId_status_createdAt_idx" ON "MarketingContentTask"("companyId", "status", "createdAt");
CREATE INDEX "MarketingContentTask_companyId_assignedMarketerId_status_idx" ON "MarketingContentTask"("companyId", "assignedMarketerId", "status");
CREATE INDEX "MarketingContentTask_companyId_scheduledAt_status_idx" ON "MarketingContentTask"("companyId", "scheduledAt", "status");
CREATE UNIQUE INDEX "MarketingContentAsset_pathname_key" ON "MarketingContentAsset"("pathname");
CREATE UNIQUE INDEX "MarketingContentAsset_idempotencyKey_key" ON "MarketingContentAsset"("idempotencyKey");
CREATE INDEX "MarketingContentAsset_companyId_taskId_createdAt_idx" ON "MarketingContentAsset"("companyId", "taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "MarketingContentTask" ADD CONSTRAINT "MarketingContentTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingContentTask" ADD CONSTRAINT "MarketingContentTask_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingContentTask" ADD CONSTRAINT "MarketingContentTask_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingContentTask" ADD CONSTRAINT "MarketingContentTask_assignedMarketerId_fkey" FOREIGN KEY ("assignedMarketerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MarketingContentTask" ADD CONSTRAINT "MarketingContentTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingContentAsset" ADD CONSTRAINT "MarketingContentAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingContentAsset" ADD CONSTRAINT "MarketingContentAsset_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MarketingContentTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingContentAsset" ADD CONSTRAINT "MarketingContentAsset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
