DO $$ BEGIN
  CREATE TYPE "ManagementMarketingTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'REVIEW', 'DONE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RecruitmentVacancyStatus" AS ENUM ('OPEN', 'INTERVIEW', 'OFFER', 'HIRED', 'PAUSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ManagementMarketingTask" (
  "id" SERIAL PRIMARY KEY,
  "companyId" INTEGER NOT NULL DEFAULT current_setting('app.current_company_id', true)::integer,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "ManagementMarketingTaskStatus" NOT NULL DEFAULT 'TODO',
  "priority" INTEGER NOT NULL DEFAULT 2,
  "dueAt" TIMESTAMP(3),
  "assigneeId" INTEGER,
  "createdById" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagementMarketingTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT,
  CONSTRAINT "ManagementMarketingTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL,
  CONSTRAINT "ManagementMarketingTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "ManagementMarketingMetric" (
  "id" SERIAL PRIMARY KEY,
  "companyId" INTEGER NOT NULL DEFAULT current_setting('app.current_company_id', true)::integer,
  "metricMonth" TIMESTAMP(3) NOT NULL,
  "channel" TEXT NOT NULL,
  "spend" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "leads" INTEGER NOT NULL DEFAULT 0,
  "orders" INTEGER NOT NULL DEFAULT 0,
  "revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "note" TEXT,
  "createdById" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagementMarketingMetric_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT,
  CONSTRAINT "ManagementMarketingMetric_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "RecruitmentVacancy" (
  "id" SERIAL PRIMARY KEY,
  "companyId" INTEGER NOT NULL DEFAULT current_setting('app.current_company_id', true)::integer,
  "title" TEXT NOT NULL,
  "status" "RecruitmentVacancyStatus" NOT NULL DEFAULT 'OPEN',
  "candidates" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "createdById" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecruitmentVacancy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT,
  CONSTRAINT "RecruitmentVacancy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS "ManagementMarketingTask_companyId_status_dueAt_idx" ON "ManagementMarketingTask"("companyId", "status", "dueAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ManagementMarketingMetric_companyId_metricMonth_channel_key" ON "ManagementMarketingMetric"("companyId", "metricMonth", "channel");
CREATE INDEX IF NOT EXISTS "ManagementMarketingMetric_companyId_metricMonth_idx" ON "ManagementMarketingMetric"("companyId", "metricMonth");
CREATE INDEX IF NOT EXISTS "RecruitmentVacancy_companyId_status_updatedAt_idx" ON "RecruitmentVacancy"("companyId", "status", "updatedAt");
