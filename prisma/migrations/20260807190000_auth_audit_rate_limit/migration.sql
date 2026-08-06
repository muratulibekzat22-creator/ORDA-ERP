ALTER TABLE "AuthAuditEvent"
  ALTER COLUMN "email" DROP NOT NULL,
  ADD COLUMN "accountIdentifierHash" TEXT,
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "userAgentClass" TEXT;

CREATE INDEX "AuthAuditEvent_accountIdentifierHash_ipHash_createdAt_idx"
  ON "AuthAuditEvent"("accountIdentifierHash", "ipHash", "createdAt");

-- Existing raw identifiers are legacy audit data. New login events never populate this column.
COMMENT ON COLUMN "AuthAuditEvent"."email" IS 'Legacy only; new events use accountIdentifierHash';
