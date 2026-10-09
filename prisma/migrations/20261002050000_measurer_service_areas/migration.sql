ALTER TABLE "EmployeePayrollProfile"
  ADD COLUMN "homeCity" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "maxTravelMinutes" INTEGER NOT NULL DEFAULT 240,
  ADD COLUMN "measurerServiceArea" JSONB;
