ALTER TABLE "CalendarTask"
  ADD COLUMN IF NOT EXISTS "acknowledgementRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "acknowledgedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "acknowledgementComment" TEXT,
  ADD COLUMN IF NOT EXISTS "plannedCompletionAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resultText" TEXT,
  ADD COLUMN IF NOT EXISTS "resultSubmittedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "CalendarTaskResultAttachment" (
  "id" SERIAL PRIMARY KEY,
  "companyId" INTEGER NOT NULL DEFAULT current_setting('app.current_company_id', true)::integer,
  "taskId" INTEGER NOT NULL,
  "uploadedById" INTEGER NOT NULL,
  "fileName" TEXT NOT NULL,
  "pathname" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CalendarTaskResultAttachment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CalendarTaskResultAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CalendarTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CalendarTaskResultAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CalendarTaskResultAttachment_pathname_key" ON "CalendarTaskResultAttachment"("pathname");
CREATE INDEX IF NOT EXISTS "CalendarTaskResultAttachment_companyId_taskId_createdAt_idx" ON "CalendarTaskResultAttachment"("companyId", "taskId", "createdAt");
CREATE INDEX IF NOT EXISTS "CalendarTaskResultAttachment_uploadedById_createdAt_idx" ON "CalendarTaskResultAttachment"("uploadedById", "createdAt");
CREATE INDEX IF NOT EXISTS "CalendarTask_assigneeId_acknowledgementRequired_acknowledgedAt_idx" ON "CalendarTask"("assigneeId", "acknowledgementRequired", "acknowledgedAt");
CREATE INDEX IF NOT EXISTS "CalendarTask_assigneeId_plannedCompletionAt_resultSubmittedAt_idx" ON "CalendarTask"("assigneeId", "plannedCompletionAt", "resultSubmittedAt");

DELETE FROM "RolePermission"
WHERE "role" = 'OPERATIONS_DIRECTOR'::"Role"
  AND "permission" IN ('partners', 'payroll', 'settings', 'design', 'installation');
