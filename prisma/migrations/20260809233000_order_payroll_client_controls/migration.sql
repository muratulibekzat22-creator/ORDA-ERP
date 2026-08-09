ALTER TABLE "SystemSettings"
ADD COLUMN "paydayDayOfMonth" INTEGER NOT NULL DEFAULT 1;

UPDATE "Material"
SET "warrantyMonths" = CASE
  WHEN lower("name") = lower('Сосна') THEN 6
  WHEN lower("name") = lower('Карагач') THEN 12
  WHEN lower("name") = lower('Дуб ламель') THEN 60
  ELSE "warrantyMonths"
END
WHERE "warrantyMonths" IS NULL
  AND lower("name") IN (lower('Сосна'), lower('Карагач'), lower('Дуб ламель'));

CREATE TABLE "ClientDeletionAudit" (
  "id" SERIAL NOT NULL,
  "deletedClientId" INTEGER NOT NULL,
  "clientSnapshot" JSONB NOT NULL,
  "impact" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "actorId" INTEGER NOT NULL,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ClientDeletionAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientDeletionAudit_deletedClientId_deletedAt_idx"
ON "ClientDeletionAudit"("deletedClientId", "deletedAt");

CREATE INDEX "ClientDeletionAudit_actorId_deletedAt_idx"
ON "ClientDeletionAudit"("actorId", "deletedAt");

ALTER TABLE "ClientDeletionAudit"
ADD CONSTRAINT "ClientDeletionAudit_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
