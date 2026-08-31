ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OPERATIONS_DIRECTOR';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'operations';

CREATE TYPE "OperationalScope" AS ENUM ('ORDA_PROJECT', 'ALTYN_SAPA');
CREATE TYPE "OperationalWorkItemStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "OperationalWorkItemPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');
CREATE TYPE "OperationalAccessAuditAction" AS ENUM (
  'OPERATIONAL_ACCESS_GRANTED',
  'OPERATIONAL_ACCESS_EXTENDED',
  'OPERATIONAL_SCOPE_CHANGED',
  'OPERATIONAL_ACCESS_REVOKED',
  'OPERATIONAL_TASK_CREATED',
  'OPERATIONAL_TASK_ASSIGNED',
  'OPERATIONAL_TASK_UPDATED',
  'OPERATIONAL_RELEASE_APPROVED'
);

CREATE SEQUENCE IF NOT EXISTS employee_code_ops_seq START 1;

ALTER TABLE "User"
  ADD COLUMN "temporaryAccess" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "accessExpiresAt" TIMESTAMP(3),
  ADD COLUMN "accessRevokedAt" TIMESTAMP(3),
  ADD COLUMN "revokedById" INTEGER,
  ADD COLUMN "revokeReason" TEXT,
  ADD COLUMN "ordaProjectOperationsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "companyOperationsEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "OperationalWorkItem" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "scope" "OperationalScope" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "source" TEXT NOT NULL,
  "status" "OperationalWorkItemStatus" NOT NULL DEFAULT 'OPEN',
  "priority" "OperationalWorkItemPriority" NOT NULL DEFAULT 'NORMAL',
  "dueAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "assigneeId" INTEGER NOT NULL,
  "createdById" INTEGER NOT NULL,
  "previewUrl" TEXT,
  "productionUrl" TEXT,
  "commitSha" TEXT,
  "pullRequestUrl" TEXT,
  "verificationResult" TEXT,
  "releaseStatus" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationalWorkItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationalAccessAuditEvent" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "targetUserId" INTEGER NOT NULL,
  "actorId" INTEGER NOT NULL,
  "action" "OperationalAccessAuditAction" NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationalAccessAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "User_companyId_role_temporaryAccess_accessExpiresAt_idx"
  ON "User"("companyId", "role", "temporaryAccess", "accessExpiresAt");
CREATE INDEX "OperationalWorkItem_companyId_scope_status_priority_idx"
  ON "OperationalWorkItem"("companyId", "scope", "status", "priority");
CREATE INDEX "OperationalWorkItem_companyId_assigneeId_status_dueAt_idx"
  ON "OperationalWorkItem"("companyId", "assigneeId", "status", "dueAt");
CREATE INDEX "OperationalAccessAuditEvent_companyId_targetUserId_createdAt_idx"
  ON "OperationalAccessAuditEvent"("companyId", "targetUserId", "createdAt");
CREATE INDEX "OperationalAccessAuditEvent_companyId_actorId_createdAt_idx"
  ON "OperationalAccessAuditEvent"("companyId", "actorId", "createdAt");
CREATE INDEX "OperationalAccessAuditEvent_companyId_action_createdAt_idx"
  ON "OperationalAccessAuditEvent"("companyId", "action", "createdAt");

ALTER TABLE "User"
  ADD CONSTRAINT "User_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OperationalWorkItem"
  ADD CONSTRAINT "OperationalWorkItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OperationalWorkItem_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OperationalWorkItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperationalAccessAuditEvent"
  ADD CONSTRAINT "OperationalAccessAuditEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OperationalAccessAuditEvent_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OperationalAccessAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
