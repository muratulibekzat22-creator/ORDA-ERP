DO $$ BEGIN
  CREATE TYPE "ManagementMarketingReportPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ManagementMarketingReportStatus" AS ENUM ('SUBMITTED', 'NEEDS_REVISION', 'APPROVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ManagementMarketingReport" (
  "id" SERIAL PRIMARY KEY,
  "companyId" INTEGER NOT NULL DEFAULT current_setting('app.current_company_id', true)::integer,
  "periodType" "ManagementMarketingReportPeriod" NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "workCompleted" TEXT NOT NULL,
  "resultSummary" TEXT NOT NULL,
  "bestResult" TEXT NOT NULL,
  "problems" TEXT NOT NULL,
  "nextActions" TEXT NOT NULL,
  "creativesPublished" INTEGER NOT NULL DEFAULT 0,
  "qualifiedLeads" INTEGER NOT NULL DEFAULT 0,
  "unqualifiedLeads" INTEGER NOT NULL DEFAULT 0,
  "status" "ManagementMarketingReportStatus" NOT NULL DEFAULT 'SUBMITTED',
  "directorComment" TEXT,
  "authorId" INTEGER NOT NULL,
  "reviewedById" INTEGER,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagementMarketingReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ManagementMarketingReport_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ManagementMarketingReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ManagementMarketingReport_period_check" CHECK ("periodEnd" >= "periodStart"),
  CONSTRAINT "ManagementMarketingReport_counts_check" CHECK ("creativesPublished" >= 0 AND "qualifiedLeads" >= 0 AND "unqualifiedLeads" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ManagementMarketingReport_companyId_authorId_periodType_periodStart_periodEnd_key"
  ON "ManagementMarketingReport"("companyId", "authorId", "periodType", "periodStart", "periodEnd");
CREATE INDEX IF NOT EXISTS "ManagementMarketingReport_companyId_periodStart_periodEnd_idx"
  ON "ManagementMarketingReport"("companyId", "periodStart", "periodEnd");
CREATE INDEX IF NOT EXISTS "ManagementMarketingReport_companyId_status_submittedAt_idx"
  ON "ManagementMarketingReport"("companyId", "status", "submittedAt");
