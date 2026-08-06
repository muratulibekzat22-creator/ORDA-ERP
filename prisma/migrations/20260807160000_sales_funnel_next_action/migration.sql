CREATE TYPE "LeadStage" AS ENUM ('NEW', 'QUALIFIED', 'CALCULATION_READY', 'PROPOSAL_SENT', 'FOLLOW_UP', 'MEASUREMENT_SCHEDULED', 'MEASUREMENT_COMPLETED', 'NEGOTIATION', 'WON', 'LOST');
CREATE TYPE "LeadNextActionType" AS ENUM ('CALL', 'WHATSAPP', 'FOLLOW_UP', 'MEASUREMENT', 'MEETING', 'CALCULATION', 'PROPOSAL', 'OTHER');
CREATE TYPE "LeadSource" AS ENUM ('WHATSAPP', 'INSTAGRAM', 'CALL', 'WEBSITE', 'REFERRAL', 'OFFICE', 'REPEAT', 'OTHER');
CREATE TYPE "LeadLostReason" AS ENUM ('EXPENSIVE', 'NO_RESPONSE', 'COMPETITOR', 'POSTPONED', 'NO_BUDGET', 'NOT_RELEVANT', 'LOCATION', 'TIMING', 'OTHER');

ALTER TABLE "Client"
  ADD COLUMN "stage" "LeadStage" NOT NULL DEFAULT 'NEW',
  ADD COLUMN "sourceCode" "LeadSource",
  ADD COLUMN "managerUserId" INTEGER,
  ADD COLUMN "lostReason" "LeadLostReason",
  ADD COLUMN "lostComment" TEXT,
  ADD COLUMN "lostAt" TIMESTAMP(3),
  ADD COLUMN "lostByUserId" INTEGER;

ALTER TABLE "LeadStatusHistory"
  ADD COLUMN "fromStage" "LeadStage",
  ADD COLUMN "toStage" "LeadStage";

CREATE TABLE "LeadNextAction" (
  "id" SERIAL NOT NULL,
  "clientId" INTEGER NOT NULL,
  "nextActionType" "LeadNextActionType" NOT NULL,
  "nextActionAt" TIMESTAMP(3) NOT NULL,
  "nextActionComment" TEXT,
  "createdByUserId" INTEGER NOT NULL,
  "completedAt" TIMESTAMP(3),
  "completedByUserId" INTEGER,
  "resultComment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadNextAction_pkey" PRIMARY KEY ("id")
);

-- Conservative backfill: preserve legacy text and only map values with an unambiguous meaning.
UPDATE "Client" SET "stage" = CASE
  WHEN upper("status") IN ('WON', 'ВЫИГРАНО', 'СДЕЛКА') THEN 'WON'::"LeadStage"
  WHEN upper("status") IN ('LOST', 'ПРОИГРАНО') THEN 'LOST'::"LeadStage"
  WHEN lower("status") LIKE '%замер%назнач%' THEN 'MEASUREMENT_SCHEDULED'::"LeadStage"
  WHEN lower("status") LIKE '%кп%' THEN 'PROPOSAL_SENT'::"LeadStage"
  WHEN lower("status") LIKE '%повтор%' OR lower("status") LIKE '%follow%' THEN 'FOLLOW_UP'::"LeadStage"
  WHEN lower("status") LIKE '%работ%' OR lower("status") LIKE '%квалиф%' THEN 'QUALIFIED'::"LeadStage"
  ELSE 'NEW'::"LeadStage" END;

UPDATE "Client" SET "sourceCode" = CASE
  WHEN lower("source") LIKE '%whatsapp%' OR lower("source") LIKE '%ватсап%' THEN 'WHATSAPP'::"LeadSource"
  WHEN lower("source") LIKE '%instagram%' THEN 'INSTAGRAM'::"LeadSource"
  WHEN lower("source") LIKE '%звон%' OR lower("source") = 'call' THEN 'CALL'::"LeadSource"
  WHEN lower("source") LIKE '%сайт%' OR lower("source") = 'website' THEN 'WEBSITE'::"LeadSource"
  WHEN lower("source") LIKE '%рекомен%' OR lower("source") = 'referral' THEN 'REFERRAL'::"LeadSource"
  WHEN lower("source") LIKE '%офис%' OR lower("source") = 'office' THEN 'OFFICE'::"LeadSource"
  WHEN lower("source") LIKE '%повтор%' OR lower("source") = 'repeat' THEN 'REPEAT'::"LeadSource"
  WHEN trim("source") <> '' THEN 'OTHER'::"LeadSource"
  ELSE NULL END;

UPDATE "Client" c SET "managerUserId" = u."id"
FROM "User" u
WHERE u."role" = 'MANAGER' AND u."name" = c."manager"
  AND (SELECT count(*) FROM "User" u2 WHERE u2."role" = 'MANAGER' AND u2."name" = c."manager") = 1;

CREATE INDEX "Client_stage_createdAt_idx" ON "Client"("stage", "createdAt");
CREATE INDEX "Client_managerUserId_stage_idx" ON "Client"("managerUserId", "stage");
CREATE INDEX "Client_sourceCode_createdAt_idx" ON "Client"("sourceCode", "createdAt");
CREATE INDEX "LeadNextAction_clientId_completedAt_nextActionAt_idx" ON "LeadNextAction"("clientId", "completedAt", "nextActionAt");
CREATE INDEX "LeadNextAction_createdByUserId_completedAt_nextActionAt_idx" ON "LeadNextAction"("createdByUserId", "completedAt", "nextActionAt");

ALTER TABLE "Client" ADD CONSTRAINT "Client_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadStatusHistory" ADD CONSTRAINT "LeadStatusHistory_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadNextAction" ADD CONSTRAINT "LeadNextAction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadNextAction" ADD CONSTRAINT "LeadNextAction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadNextAction" ADD CONSTRAINT "LeadNextAction_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
