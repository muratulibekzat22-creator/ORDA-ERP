ALTER TYPE "LeadLostReason" ADD VALUE IF NOT EXISTS 'PRICE_TOO_HIGH';
ALTER TYPE "LeadLostReason" ADD VALUE IF NOT EXISTS 'CHANGED_MIND';
ALTER TYPE "LeadLostReason" ADD VALUE IF NOT EXISTS 'COMPARING';
ALTER TYPE "LeadLostReason" ADD VALUE IF NOT EXISTS 'NOT_READY';
ALTER TYPE "LeadLostReason" ADD VALUE IF NOT EXISTS 'UNSUITABLE_SOLUTION';

CREATE TYPE "MeasurementClientOutcome" AS ENUM (
  'READY_TO_CONTINUE',
  'RETURN_TO_MANAGER',
  'REFUSED'
);

ALTER TABLE "Client"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" INTEGER;

ALTER TABLE "Measurement"
  ADD COLUMN "clientOutcome" "MeasurementClientOutcome",
  ADD COLUMN "outcomeComment" TEXT,
  ADD COLUMN "refusalReason" "LeadLostReason",
  ADD COLUMN "outcomeAt" TIMESTAMP(3);

CREATE INDEX "Client_deletedAt_managerUserId_idx"
  ON "Client"("deletedAt", "managerUserId");

CREATE INDEX "Measurement_clientOutcome_outcomeAt_idx"
  ON "Measurement"("clientOutcome", "outcomeAt");

ALTER TABLE "Client"
  ADD CONSTRAINT "Client_deletedById_fkey"
  FOREIGN KEY ("deletedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
