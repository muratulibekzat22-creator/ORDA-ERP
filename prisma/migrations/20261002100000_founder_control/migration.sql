ALTER TABLE "CalendarTask" ADD COLUMN "controlKey" TEXT,
  ADD COLUMN "controlRemindedAt" TIMESTAMP(3),
  ADD COLUMN "controlVerifiedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "CalendarTask_companyId_controlKey_key" ON "CalendarTask"("companyId", "controlKey");
