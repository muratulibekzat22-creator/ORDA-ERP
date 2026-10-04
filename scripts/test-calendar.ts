import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addBusinessDays,
  addBusinessMonths,
  businessDateFromKey,
  businessDateKey,
  calendarMonthGrid,
  calendarViewRange,
  formatBusinessInput,
  parseBusinessDateTime,
  splitCalendarRange,
  startOfBusinessWeek,
} from "@/lib/calendar-time";

const root = process.cwd(), read = (path: string) => readFileSync(join(root, path), "utf8");
const parsed = parseBusinessDateTime("2026-08-08T14:00");
assert.equal(parsed?.toISOString(), "2026-08-08T09:00:00.000Z", "Kazakhstan local time must serialize with +05:00 offset");
assert.equal(formatBusinessInput(parsed!), "2026-08-08T14:00", "business time must round-trip without UTC shift");
assert.equal(parseBusinessDateTime("2026-08-08"), null, "time is required");

const sunday = businessDateFromKey("2026-10-04");
assert.equal(businessDateKey(startOfBusinessWeek(sunday)), "2026-09-28", "week must start on Monday");
assert.equal(businessDateKey(addBusinessDays(sunday, 1)), "2026-10-05", "day navigation must use calendar days");
assert.equal(businessDateKey(addBusinessMonths(businessDateFromKey("2027-01-31"), 1)), "2027-02-28", "month navigation must clamp to the last real day");

const weekRange = calendarViewRange(sunday, "week");
assert.equal(businessDateKey(weekRange.from), "2026-09-28", "week range must include Monday");
assert.equal(businessDateKey(weekRange.to), "2026-10-05", "week range end must be exclusive");
const monthRange = calendarViewRange(sunday, "month");
assert.equal(businessDateKey(monthRange.from), "2026-10-01", "month range must start on day one");
assert.equal(businessDateKey(monthRange.to), "2026-11-01", "month range end must be exclusive");
const periodRange = calendarViewRange(sunday, "period", { start: "2026-10-05", end: "2026-10-18" });
assert.equal(businessDateKey(periodRange.from), "2026-10-05", "period must start at the selected first date");
assert.equal(businessDateKey(periodRange.to), "2026-10-19", "period must include the selected final date");

const monthGrid = calendarMonthGrid(sunday);
assert.equal(monthGrid.length, 42, "month grid must always contain six full weeks");
assert.equal(businessDateKey(monthGrid[0]), "2026-09-28", "October 2026 grid must start on Monday");
assert.equal(businessDateKey(monthGrid[41]), "2026-11-08", "October 2026 grid must end on Sunday");

const chunks = splitCalendarRange({
  from: businessDateFromKey("2026-01-01"),
  to: businessDateFromKey("2026-05-01"),
});
assert.ok(chunks.length > 1, "long periods must be split for the existing API limit");
assert.ok(chunks.every((chunk) => chunk.from < chunk.to), "every API chunk must have a positive range");
for (let index = 1; index < chunks.length; index += 1) {
  assert.equal(chunks[index - 1].to.getTime(), chunks[index].from.getTime(), "API chunks must be contiguous");
}

const service = read("lib/services/calendar.service.ts"), api = read("app/api/calendar/route.ts"), schema = read("prisma/schema.prisma"), sidebar = read("components/layout/RouteShell.tsx"), page = read("components/pages/CalendarPage.tsx");
for (const marker of ["taskScope(actor)", "INVALID_ASSIGNEE", "FORBIDDEN_RELATION", "RELATION_MISMATCH", "completedAt", "CANCELLED", "calendarTaskAudit.create", "conflict"]) assert.ok(service.includes(marker), `missing calendar guard: ${marker}`);
for (const marker of ["requirePermission(\"calendar\")", 'searchParams.get("start")', 'searchParams.get("end")', "62 * 86400000", 'searchParams.get("cursor")']) assert.ok(api.includes(marker), `missing range/auth guard: ${marker}`);
for (const marker of ["@@index([assigneeId, dueAt])", "completedById", "cancelledAt"]) assert.ok(schema.includes(marker), `missing schema contract: ${marker}`);
assert.ok(!api.includes("export async function DELETE"), "calendar tasks must not be hard-deleted");
for (const marker of ["MiniCalendar", "WeekView", "MonthView", '["period", "Период"]', "loadIndicators", "quickCreate(date", "await refresh()"])
  assert.ok(page.includes(marker), `missing calendar UI contract: ${marker}`);
const dashboardIndex = sidebar.indexOf('["/",'), calendarIndex = sidebar.indexOf('["/calendar",');
assert.ok(dashboardIndex >= 0 && calendarIndex > dashboardIndex, "sidebar order must stay deterministic with Home first");
console.log("calendar timezone, views, navigation, API range, security, audit and sidebar regression checks passed");
