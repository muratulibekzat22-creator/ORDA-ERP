import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

import { DEFAULT_WEEKLY_DAY_OFF, isWeeklyDayOff, weekdayForDateKey, weekdayLabel } from "@/lib/work-schedule";

const read = (path: string) => readFileSync(path, "utf8");

async function main() {
assert.equal(DEFAULT_WEEKLY_DAY_OFF, 1, "Monday must be the default weekly day off");
assert.equal(weekdayForDateKey("2026-10-05"), 1, "5 October 2026 must be Monday");
assert.equal(isWeeklyDayOff("2026-10-05"), true, "Monday must not require a daily report by default");
assert.equal(isWeeklyDayOff("2026-10-06"), false, "Tuesday must remain a reporting day by default");
assert.equal(isWeeklyDayOff("2026-10-09", 5), true, "changing the setting must change the day off");
assert.equal(weekdayLabel(1), "Понедельник");
assert.throws(() => weekdayForDateKey("2026-02-30"), /INVALID_DATE_KEY/);

const schema = read("prisma/schema.prisma");
const migration = read("prisma/migrations/20261006153000_weekly_day_off/migration.sql");
const dailyOperations = read("lib/services/daily-operations.service.ts");
const scheduleService = read("lib/services/work-schedule.service.ts");
const access = read("lib/work-schedule-access.ts");
const api = read("app/api/settings/work-schedule/route.ts");
const ui = read("components/settings/WorkScheduleSettings.tsx");
const dashboard = read("components/dashboard/DirectorCockpit.tsx");
const marketing = read("components/marketing/MarketingManagementPage.tsx");

assert.match(schema, /weeklyDayOff\s+Int\s+@default\(1\)/, "SystemSettings must persist Monday as the default day off");
assert.match(migration, /WEEKLY_DAY_OFF_APPLIED/, "migration must cancel already-open Monday report tasks with an audit event");
assert.match(dailyOperations, /if \(snapshot\.reportRequired\)/, "daily report creation must be conditional");
assert.match(dailyOperations, /dailyReportsCancelled/, "daily generator must cancel reports when the selected date is a day off");
assert.match(scheduleService, /CalendarTaskWorkflow\.DAILY_CRM_REPORT/, "changing the day off must reconcile open report tasks");
assert.match(access, /Role\.DIRECTOR[\s\S]*Role\.OPERATIONS_DIRECTOR/, "founder and operations director must be authorized server-side");
assert.match(api, /requireWorkScheduleLeadership/, "work schedule route must enforce leadership authorization");
assert.match(ui, /Выходной — отчёт не нужен/, "settings UI must explain the effect of the day off");
assert.match(dashboard, /reportStatus !== "DAY_OFF"/, "manager dashboard must not request a report on the day off");
assert.match(marketing, /Выходной — отчёт не нужен/, "marketing dashboard must show the day-off status");

const database = new PGlite();
await database.exec(`
  CREATE TYPE "CalendarTaskStatus" AS ENUM ('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED');
  CREATE TYPE "CalendarTaskWorkflow" AS ENUM ('PAYMENT_COLLECTION','DAILY_CRM_REPORT','ORDER_DATA_COMPLETION','PLATFORM_ORIENTATION');
  CREATE TABLE "SystemSettings" ("id" SERIAL PRIMARY KEY, "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE "CalendarTask" (
    "id" SERIAL PRIMARY KEY,
    "workflow" "CalendarTaskWorkflow",
    "status" "CalendarTaskStatus" NOT NULL DEFAULT 'PLANNED',
    "workflowKey" TEXT,
    "creatorId" INTEGER NOT NULL,
    "cancelledAt" TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE "CalendarTaskAudit" (
    "id" SERIAL PRIMARY KEY,
    "taskId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "after" JSONB,
    "actorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO "SystemSettings" DEFAULT VALUES;
  INSERT INTO "CalendarTask" ("workflow","status","workflowKey","creatorId") VALUES
    ('DAILY_CRM_REPORT','PLANNED','daily-crm:2026-10-05:11',7),
    ('DAILY_CRM_REPORT','PLANNED','daily-crm:2026-10-06:11',7),
    ('DAILY_CRM_REPORT','COMPLETED','daily-crm:2026-09-28:11',7);
`);
await database.exec(migration);
const settingsRows = await database.query<{ weeklyDayOff: number }>(`SELECT "weeklyDayOff" FROM "SystemSettings"`);
const taskRows = await database.query<{ workflowKey: string; status: string }>(`SELECT "workflowKey", "status" FROM "CalendarTask" ORDER BY "workflowKey"`);
const auditRows = await database.query<{ action: string }>(`SELECT "action" FROM "CalendarTaskAudit"`);
const taskStatuses = Object.fromEntries(taskRows.rows.map((row) => [row.workflowKey, row.status]));
assert.equal(settingsRows.rows[0]?.weeklyDayOff, 1, "migration must persist Monday as the default");
assert.equal(taskStatuses["daily-crm:2026-10-05:11"], "CANCELLED", "open Monday report must be cancelled");
assert.equal(taskStatuses["daily-crm:2026-10-06:11"], "PLANNED", "Tuesday report must remain active");
assert.equal(taskStatuses["daily-crm:2026-09-28:11"], "COMPLETED", "completed reports must remain unchanged");
assert.deepEqual(auditRows.rows.map((row) => row.action), ["WEEKLY_DAY_OFF_APPLIED"], "migration must audit the cancellation");
await database.close();

console.log("work schedule: ok");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
