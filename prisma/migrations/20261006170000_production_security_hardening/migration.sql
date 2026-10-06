-- Additive production hardening. This migration never deletes or rewrites business rows.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "mfaSecretEncrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "mfaRecoveryHashes" JSONB,
  ADD COLUMN IF NOT EXISTS "mfaSetupCompletedAt" TIMESTAMP(3);

ALTER TABLE "Client"
  ADD COLUMN IF NOT EXISTS "deleteReason" TEXT,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "deleteReason" TEXT;

ALTER TABLE "CalendarTask"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedById" INTEGER,
  ADD COLUMN IF NOT EXISTS "deleteReason" TEXT,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Document"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedById" INTEGER,
  ADD COLUMN IF NOT EXISTS "deleteReason" TEXT,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Measurement"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedById" INTEGER,
  ADD COLUMN IF NOT EXISTS "deleteReason" TEXT,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedById" INTEGER,
  ADD COLUMN IF NOT EXISTS "deleteReason" TEXT,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "PayrollAccrual"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedById" INTEGER,
  ADD COLUMN IF NOT EXISTS "deleteReason" TEXT,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "PayrollPayment"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedById" INTEGER,
  ADD COLUMN IF NOT EXISTS "deleteReason" TEXT,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Production"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedById" INTEGER,
  ADD COLUMN IF NOT EXISTS "deleteReason" TEXT,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "PriceApprovalRequest" ADD COLUMN IF NOT EXISTS "companyId" INTEGER;
UPDATE "PriceApprovalRequest" approval
SET "companyId" = client."companyId"
FROM "Client" client
WHERE client.id = approval."clientId";
ALTER TABLE "PriceApprovalRequest" ALTER COLUMN "companyId" SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PriceApprovalRequest_companyId_fkey') THEN
    ALTER TABLE "PriceApprovalRequest" ADD CONSTRAINT "PriceApprovalRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "AuditLog"
  ADD COLUMN IF NOT EXISTS "actorUserId" INTEGER,
  ADD COLUMN IF NOT EXISTS "actorRole" TEXT,
  ADD COLUMN IF NOT EXISTS "requestId" TEXT,
  ADD COLUMN IF NOT EXISTS "ipHash" TEXT,
  ADD COLUMN IF NOT EXISTS "userAgent" TEXT;
ALTER TABLE "AuditLog" ALTER COLUMN reason SET DEFAULT '';
UPDATE "AuditLog" SET "actorUserId" = "actorId" WHERE "actorUserId" IS NULL AND "actorId" IS NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_actorUserId_fkey') THEN
    ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "DeletionLog" (
  id BIGSERIAL PRIMARY KEY,
  "companyId" INTEGER NOT NULL,
  "actorUserId" INTEGER NOT NULL,
  "actorRole" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  reason TEXT NOT NULL,
  "restoredAt" TIMESTAMP(3),
  "restoredById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeletionLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "IdempotencyRecord" (
  id BIGSERIAL PRIMARY KEY,
  "companyId" INTEGER NOT NULL,
  "actorUserId" INTEGER NOT NULL,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "responseBody" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdempotencyRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PriceApprovalRequest_companyId_status_createdAt_idx" ON "PriceApprovalRequest"("companyId", status, "createdAt");
CREATE INDEX IF NOT EXISTS "CalendarTask_companyId_deletedAt_dueAt_idx" ON "CalendarTask"("companyId", "deletedAt", "dueAt");
CREATE INDEX IF NOT EXISTS "Document_companyId_deletedAt_documentDate_idx" ON "Document"("companyId", "deletedAt", "documentDate");
CREATE INDEX IF NOT EXISTS "Measurement_companyId_deletedAt_visitDate_idx" ON "Measurement"("companyId", "deletedAt", "visitDate");
CREATE INDEX IF NOT EXISTS "Payment_companyId_deletedAt_operationDate_idx" ON "Payment"("companyId", "deletedAt", "operationDate");
CREATE INDEX IF NOT EXISTS "Production_companyId_deletedAt_stage_idx" ON "Production"("companyId", "deletedAt", stage);
CREATE INDEX IF NOT EXISTS "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_companyId_entityType_entityId_createdAt_idx" ON "AuditLog"("companyId", "entityType", "entityId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_requestId_idx" ON "AuditLog"("requestId");
CREATE INDEX IF NOT EXISTS "DeletionLog_companyId_entityType_entityId_createdAt_idx" ON "DeletionLog"("companyId", "entityType", "entityId", "createdAt");
CREATE INDEX IF NOT EXISTS "DeletionLog_actorUserId_createdAt_idx" ON "DeletionLog"("actorUserId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyRecord_companyId_actorUserId_scope_key_key" ON "IdempotencyRecord"("companyId", "actorUserId", scope, key);
CREATE INDEX IF NOT EXISTS "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

CREATE OR REPLACE FUNCTION forbid_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF pg_has_role(current_user, 'neondb_owner', 'MEMBER') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AuditLog is append-only' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER "AuditLog_append_only"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "AuditLog"
FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_log_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM PUBLIC;
