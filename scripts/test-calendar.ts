import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatBusinessInput, parseBusinessDateTime } from "@/lib/calendar-time";

const root = process.cwd(), read = (path: string) => readFileSync(join(root, path), "utf8");
const parsed = parseBusinessDateTime("2026-08-08T14:00");
assert.equal(parsed?.toISOString(), "2026-08-08T09:00:00.000Z", "Kazakhstan local time must serialize with +05:00 offset");
assert.equal(formatBusinessInput(parsed!), "2026-08-08T14:00", "business time must round-trip without UTC shift");
assert.equal(parseBusinessDateTime("2026-08-08"), null, "time is required");

const service = read("lib/services/calendar.service.ts"), api = read("app/api/calendar/route.ts"), schema = read("prisma/schema.prisma"), sidebar = read("components/layout/RouteShell.tsx");
for (const marker of ["taskScope(actor)", "INVALID_ASSIGNEE", "FORBIDDEN_RELATION", "RELATION_MISMATCH", "completedAt", "CANCELLED", "calendarTaskAudit.create", "conflict"]) assert.ok(service.includes(marker), `missing calendar guard: ${marker}`);
for (const marker of ["requirePermission(\"calendar\")", "from", "to", "370 * 86400000"]) assert.ok(api.includes(marker), `missing range/auth guard: ${marker}`);
for (const marker of ["@@index([assigneeId, dueAt])", "completedById", "cancelledAt"]) assert.ok(schema.includes(marker), `missing schema contract: ${marker}`);
assert.ok(!api.includes("export async function DELETE"), "calendar tasks must not be hard-deleted");
const dashboardIndex = sidebar.indexOf('["/",'), calendarIndex = sidebar.indexOf('["/calendar",');
assert.ok(dashboardIndex >= 0 && calendarIndex > dashboardIndex, "sidebar order must stay deterministic with Home first");
console.log("calendar timezone, range, security, audit and sidebar regression checks passed");
