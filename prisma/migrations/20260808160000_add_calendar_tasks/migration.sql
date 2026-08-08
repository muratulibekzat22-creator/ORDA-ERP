CREATE TYPE "CalendarTaskType" AS ENUM ('CALL', 'MEETING', 'MEASUREMENT', 'INSTALLATION', 'DELIVERY', 'TASK', 'REMINDER', 'OTHER');
CREATE TYPE "CalendarTaskStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "CalendarTaskPriority" AS ENUM ('NORMAL', 'IMPORTANT', 'URGENT');

CREATE TABLE "CalendarTask" (
  "id" SERIAL NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "type" "CalendarTaskType" NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "status" "CalendarTaskStatus" NOT NULL DEFAULT 'PLANNED',
  "priority" "CalendarTaskPriority" NOT NULL DEFAULT 'NORMAL',
  "assigneeId" INTEGER NOT NULL,
  "creatorId" INTEGER NOT NULL,
  "clientId" INTEGER,
  "orderId" INTEGER,
  "completedAt" TIMESTAMP(3),
  "completedById" INTEGER,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CalendarTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CalendarTaskAudit" (
  "id" SERIAL NOT NULL,
  "taskId" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "actorId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CalendarTaskAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CalendarTask_assigneeId_dueAt_idx" ON "CalendarTask"("assigneeId", "dueAt");
CREATE INDEX "CalendarTask_status_dueAt_idx" ON "CalendarTask"("status", "dueAt");
CREATE INDEX "CalendarTask_clientId_dueAt_idx" ON "CalendarTask"("clientId", "dueAt");
CREATE INDEX "CalendarTask_orderId_dueAt_idx" ON "CalendarTask"("orderId", "dueAt");
CREATE INDEX "CalendarTaskAudit_taskId_createdAt_idx" ON "CalendarTaskAudit"("taskId", "createdAt");
CREATE INDEX "CalendarTaskAudit_actorId_createdAt_idx" ON "CalendarTaskAudit"("actorId", "createdAt");
ALTER TABLE "CalendarTask" ADD CONSTRAINT "CalendarTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarTask" ADD CONSTRAINT "CalendarTask_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarTask" ADD CONSTRAINT "CalendarTask_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarTask" ADD CONSTRAINT "CalendarTask_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarTask" ADD CONSTRAINT "CalendarTask_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CalendarTaskAudit" ADD CONSTRAINT "CalendarTaskAudit_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CalendarTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarTaskAudit" ADD CONSTRAINT "CalendarTaskAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
