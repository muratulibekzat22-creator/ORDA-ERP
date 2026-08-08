CREATE TABLE "PayrollAuditEvent" (
    "id" SERIAL NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" INTEGER NOT NULL,
    "periodId" INTEGER,
    "employeeId" INTEGER,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollAuditEvent_idempotencyKey_key" ON "PayrollAuditEvent"("idempotencyKey");
CREATE INDEX "PayrollAuditEvent_periodId_createdAt_idx" ON "PayrollAuditEvent"("periodId", "createdAt");
CREATE INDEX "PayrollAuditEvent_employeeId_createdAt_idx" ON "PayrollAuditEvent"("employeeId", "createdAt");
CREATE INDEX "PayrollAuditEvent_actorId_createdAt_idx" ON "PayrollAuditEvent"("actorId", "createdAt");

ALTER TABLE "PayrollAuditEvent" ADD CONSTRAINT "PayrollAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollAuditEvent" ADD CONSTRAINT "PayrollAuditEvent_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollAuditEvent" ADD CONSTRAINT "PayrollAuditEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeePayrollProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
