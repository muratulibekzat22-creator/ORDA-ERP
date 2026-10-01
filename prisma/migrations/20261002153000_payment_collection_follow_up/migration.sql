CREATE TYPE "CalendarTaskWorkflow" AS ENUM ('PAYMENT_COLLECTION');

ALTER TABLE "CalendarTask"
  ADD COLUMN "workflow" "CalendarTaskWorkflow",
  ADD COLUMN "workflowKey" TEXT,
  ADD COLUMN "expectedAmount" DECIMAL(14,2);

CREATE UNIQUE INDEX "CalendarTask_companyId_workflowKey_key"
  ON "CalendarTask"("companyId", "workflowKey");

CREATE INDEX "CalendarTask_assigneeId_workflow_dueAt_status_idx"
  ON "CalendarTask"("assigneeId", "workflow", "dueAt", "status");
