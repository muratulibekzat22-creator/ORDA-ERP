ALTER TABLE "SystemSettings"
ADD COLUMN "weeklyDayOff" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "SystemSettings"
ADD CONSTRAINT "SystemSettings_weeklyDayOff_check"
CHECK ("weeklyDayOff" BETWEEN 0 AND 6);

WITH cancelled AS (
  UPDATE "CalendarTask"
  SET
    "status" = 'CANCELLED',
    "cancelledAt" = CURRENT_TIMESTAMP,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE "workflow" = 'DAILY_CRM_REPORT'
    AND "status" IN ('PLANNED', 'IN_PROGRESS')
    AND "workflowKey" ~ '^daily-crm:[0-9]{4}-[0-9]{2}-[0-9]{2}:[0-9]+$'
    AND EXTRACT(ISODOW FROM SUBSTRING("workflowKey" FROM 11 FOR 10)::date) = 1
  RETURNING "id", "creatorId"
)
INSERT INTO "CalendarTaskAudit" ("taskId", "action", "after", "actorId", "createdAt")
SELECT
  "id",
  'WEEKLY_DAY_OFF_APPLIED',
  jsonb_build_object('weeklyDayOff', 1, 'reportRequired', false),
  "creatorId",
  CURRENT_TIMESTAMP
FROM cancelled;
