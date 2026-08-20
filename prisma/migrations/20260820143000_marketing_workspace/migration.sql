-- CreateEnum
CREATE TYPE "MarketingCampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MarketingInquiryStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'LINKED', 'CONVERTED', 'DUPLICATE', 'CLOSED');

-- CreateEnum
CREATE TYPE "MarketingSpendStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RECONCILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "MarketingAttributionStatus" AS ENUM ('AUTOMATIC', 'MANUAL', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "MarketingVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'DISPUTED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'MARKETER';

-- AlterEnum
ALTER TYPE "Permission" ADD VALUE 'marketing';

-- CreateSequence
CREATE SEQUENCE IF NOT EXISTS "employee_code_mkt_seq" START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

-- CreateTable
CREATE TABLE "MarketingSource" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingContactChannel" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingContactChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "sourceId" INTEGER,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "advertisingAccount" TEXT,
    "objective" TEXT,
    "region" TEXT,
    "audience" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "plannedBudget" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "dailyBudget" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "responsibleId" INTEGER,
    "status" "MarketingCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "comment" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAdSet" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "externalId" TEXT,
    "audience" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingAdSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAd" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "adSetId" INTEGER,
    "name" TEXT NOT NULL,
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingAd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCreative" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "adId" INTEGER,
    "name" TEXT NOT NULL,
    "format" TEXT,
    "assetUrl" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCreative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingInquiry" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "normalizedPhone" TEXT NOT NULL,
    "additionalPhone" TEXT,
    "instagramUsername" TEXT,
    "city" TEXT NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "channelId" INTEGER NOT NULL,
    "campaignId" INTEGER,
    "adSetId" INTEGER,
    "adId" INTEGER,
    "creativeId" INTEGER,
    "message" TEXT,
    "externalLeadId" TEXT,
    "platformConversationId" TEXT,
    "status" "MarketingInquiryStatus" NOT NULL DEFAULT 'NEW',
    "assignedManagerId" INTEGER,
    "firstResponseAt" TIMESTAMP(3),
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "applicationId" INTEGER,
    "sourceChangeComment" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadAttribution" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "applicationId" INTEGER NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "channelId" INTEGER NOT NULL,
    "campaignId" INTEGER,
    "adSetId" INTEGER,
    "adId" INTEGER,
    "creativeId" INTEGER,
    "firstTouchSourceId" INTEGER NOT NULL,
    "lastTouchSourceId" INTEGER NOT NULL,
    "primarySourceId" INTEGER NOT NULL,
    "externalLeadId" TEXT,
    "platformConversationId" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "fbclid" TEXT,
    "gclid" TEXT,
    "ttclid" TEXT,
    "referrer" TEXT,
    "landingPage" TEXT,
    "firstContactAt" TIMESTAMP(3) NOT NULL,
    "attributedById" INTEGER NOT NULL,
    "attributionStatus" "MarketingAttributionStatus" NOT NULL DEFAULT 'AUTOMATIC',
    "verificationStatus" "MarketingVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingTouch" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "applicationId" INTEGER NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "channelId" INTEGER,
    "campaignId" INTEGER,
    "adSetId" INTEGER,
    "adId" INTEGER,
    "creativeId" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingTouch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingMetric" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "metricDate" DATE NOT NULL,
    "periodEnd" DATE,
    "platform" TEXT NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "adSetId" INTEGER,
    "adId" INTEGER,
    "reportedSpend" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "linkClicks" INTEGER NOT NULL DEFAULT 0,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "platformLeads" INTEGER NOT NULL DEFAULT 0,
    "videoViews" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "externalReport" TEXT,
    "importKey" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "inputMethod" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingSpend" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "spendDate" DATE NOT NULL,
    "platform" TEXT NOT NULL,
    "campaignId" INTEGER,
    "adSetId" INTEGER,
    "adId" INTEGER,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "MarketingSpendStatus" NOT NULL DEFAULT 'DRAFT',
    "evidenceUrl" TEXT,
    "comment" TEXT,
    "financeCategoryId" INTEGER,
    "paymentAccount" TEXT,
    "financeEntryId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewComment" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingSpend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingBudget" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "month" DATE NOT NULL,
    "sourceId" INTEGER,
    "campaignId" INTEGER,
    "planned" DECIMAL(14,2) NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAuditLog" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" INTEGER,
    "actorId" INTEGER NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "comment" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingSource_companyId_active_name_idx" ON "MarketingSource"("companyId", "active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingSource_companyId_code_key" ON "MarketingSource"("companyId", "code");

-- CreateIndex
CREATE INDEX "MarketingContactChannel_companyId_active_name_idx" ON "MarketingContactChannel"("companyId", "active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingContactChannel_companyId_code_key" ON "MarketingContactChannel"("companyId", "code");

-- CreateIndex
CREATE INDEX "MarketingCampaign_companyId_status_startsAt_idx" ON "MarketingCampaign"("companyId", "status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCampaign_companyId_platform_externalId_key" ON "MarketingCampaign"("companyId", "platform", "externalId");

-- CreateIndex
CREATE INDEX "MarketingAdSet_companyId_campaignId_status_idx" ON "MarketingAdSet"("companyId", "campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingAdSet_companyId_campaignId_externalId_key" ON "MarketingAdSet"("companyId", "campaignId", "externalId");

-- CreateIndex
CREATE INDEX "MarketingAd_companyId_campaignId_adSetId_idx" ON "MarketingAd"("companyId", "campaignId", "adSetId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingAd_companyId_campaignId_externalId_key" ON "MarketingAd"("companyId", "campaignId", "externalId");

-- CreateIndex
CREATE INDEX "MarketingCreative_companyId_campaignId_adId_idx" ON "MarketingCreative"("companyId", "campaignId", "adId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCreative_companyId_campaignId_externalId_key" ON "MarketingCreative"("companyId", "campaignId", "externalId");

-- CreateIndex
CREATE INDEX "MarketingInquiry_companyId_receivedAt_idx" ON "MarketingInquiry"("companyId", "receivedAt");

-- CreateIndex
CREATE INDEX "MarketingInquiry_companyId_normalizedPhone_receivedAt_idx" ON "MarketingInquiry"("companyId", "normalizedPhone", "receivedAt");

-- CreateIndex
CREATE INDEX "MarketingInquiry_companyId_status_assignedManagerId_idx" ON "MarketingInquiry"("companyId", "status", "assignedManagerId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingInquiry_companyId_externalLeadId_key" ON "MarketingInquiry"("companyId", "externalLeadId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadAttribution_applicationId_key" ON "LeadAttribution"("applicationId");

-- CreateIndex
CREATE INDEX "LeadAttribution_companyId_primarySourceId_createdAt_idx" ON "LeadAttribution"("companyId", "primarySourceId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadAttribution_companyId_campaignId_createdAt_idx" ON "LeadAttribution"("companyId", "campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingTouch_companyId_applicationId_occurredAt_idx" ON "MarketingTouch"("companyId", "applicationId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingMetric_dedupeKey_key" ON "MarketingMetric"("dedupeKey");

-- CreateIndex
CREATE INDEX "MarketingMetric_companyId_metricDate_campaignId_idx" ON "MarketingMetric"("companyId", "metricDate", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingMetric_companyId_campaignId_adSetId_adId_metricDat_key" ON "MarketingMetric"("companyId", "campaignId", "adSetId", "adId", "metricDate", "importKey");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingSpend_financeEntryId_key" ON "MarketingSpend"("financeEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingSpend_idempotencyKey_key" ON "MarketingSpend"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MarketingSpend_companyId_status_spendDate_idx" ON "MarketingSpend"("companyId", "status", "spendDate");

-- CreateIndex
CREATE INDEX "MarketingSpend_companyId_campaignId_spendDate_idx" ON "MarketingSpend"("companyId", "campaignId", "spendDate");

-- CreateIndex
CREATE INDEX "MarketingBudget_companyId_month_idx" ON "MarketingBudget"("companyId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingBudget_companyId_month_sourceId_campaignId_key" ON "MarketingBudget"("companyId", "month", "sourceId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingAuditLog_idempotencyKey_key" ON "MarketingAuditLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MarketingAuditLog_companyId_entityType_entityId_createdAt_idx" ON "MarketingAuditLog"("companyId", "entityType", "entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "MarketingSource" ADD CONSTRAINT "MarketingSource_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContactChannel" ADD CONSTRAINT "MarketingContactChannel_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "MarketingSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAdSet" ADD CONSTRAINT "MarketingAdSet_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAdSet" ADD CONSTRAINT "MarketingAdSet_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAd" ADD CONSTRAINT "MarketingAd_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAd" ADD CONSTRAINT "MarketingAd_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAd" ADD CONSTRAINT "MarketingAd_adSetId_fkey" FOREIGN KEY ("adSetId") REFERENCES "MarketingAdSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCreative" ADD CONSTRAINT "MarketingCreative_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCreative" ADD CONSTRAINT "MarketingCreative_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCreative" ADD CONSTRAINT "MarketingCreative_adId_fkey" FOREIGN KEY ("adId") REFERENCES "MarketingAd"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingInquiry" ADD CONSTRAINT "MarketingInquiry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingInquiry" ADD CONSTRAINT "MarketingInquiry_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "MarketingSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingInquiry" ADD CONSTRAINT "MarketingInquiry_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "MarketingContactChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingInquiry" ADD CONSTRAINT "MarketingInquiry_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingInquiry" ADD CONSTRAINT "MarketingInquiry_adSetId_fkey" FOREIGN KEY ("adSetId") REFERENCES "MarketingAdSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingInquiry" ADD CONSTRAINT "MarketingInquiry_adId_fkey" FOREIGN KEY ("adId") REFERENCES "MarketingAd"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingInquiry" ADD CONSTRAINT "MarketingInquiry_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "MarketingCreative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingInquiry" ADD CONSTRAINT "MarketingInquiry_assignedManagerId_fkey" FOREIGN KEY ("assignedManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingInquiry" ADD CONSTRAINT "MarketingInquiry_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingInquiry" ADD CONSTRAINT "MarketingInquiry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "MarketingSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "MarketingContactChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_adSetId_fkey" FOREIGN KEY ("adSetId") REFERENCES "MarketingAdSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_adId_fkey" FOREIGN KEY ("adId") REFERENCES "MarketingAd"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "MarketingCreative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_firstTouchSourceId_fkey" FOREIGN KEY ("firstTouchSourceId") REFERENCES "MarketingSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_lastTouchSourceId_fkey" FOREIGN KEY ("lastTouchSourceId") REFERENCES "MarketingSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_primarySourceId_fkey" FOREIGN KEY ("primarySourceId") REFERENCES "MarketingSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_attributedById_fkey" FOREIGN KEY ("attributedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTouch" ADD CONSTRAINT "MarketingTouch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTouch" ADD CONSTRAINT "MarketingTouch_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTouch" ADD CONSTRAINT "MarketingTouch_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "MarketingSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTouch" ADD CONSTRAINT "MarketingTouch_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "MarketingContactChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTouch" ADD CONSTRAINT "MarketingTouch_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTouch" ADD CONSTRAINT "MarketingTouch_adSetId_fkey" FOREIGN KEY ("adSetId") REFERENCES "MarketingAdSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTouch" ADD CONSTRAINT "MarketingTouch_adId_fkey" FOREIGN KEY ("adId") REFERENCES "MarketingAd"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTouch" ADD CONSTRAINT "MarketingTouch_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "MarketingCreative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTouch" ADD CONSTRAINT "MarketingTouch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingMetric" ADD CONSTRAINT "MarketingMetric_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingMetric" ADD CONSTRAINT "MarketingMetric_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingMetric" ADD CONSTRAINT "MarketingMetric_adSetId_fkey" FOREIGN KEY ("adSetId") REFERENCES "MarketingAdSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingMetric" ADD CONSTRAINT "MarketingMetric_adId_fkey" FOREIGN KEY ("adId") REFERENCES "MarketingAd"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingMetric" ADD CONSTRAINT "MarketingMetric_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingSpend" ADD CONSTRAINT "MarketingSpend_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingSpend" ADD CONSTRAINT "MarketingSpend_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingSpend" ADD CONSTRAINT "MarketingSpend_adSetId_fkey" FOREIGN KEY ("adSetId") REFERENCES "MarketingAdSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingSpend" ADD CONSTRAINT "MarketingSpend_adId_fkey" FOREIGN KEY ("adId") REFERENCES "MarketingAd"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingSpend" ADD CONSTRAINT "MarketingSpend_financeEntryId_fkey" FOREIGN KEY ("financeEntryId") REFERENCES "CompanyLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingSpend" ADD CONSTRAINT "MarketingSpend_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingSpend" ADD CONSTRAINT "MarketingSpend_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingBudget" ADD CONSTRAINT "MarketingBudget_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingBudget" ADD CONSTRAINT "MarketingBudget_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "MarketingSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingBudget" ADD CONSTRAINT "MarketingBudget_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAuditLog" ADD CONSTRAINT "MarketingAuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAuditLog" ADD CONSTRAINT "MarketingAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
