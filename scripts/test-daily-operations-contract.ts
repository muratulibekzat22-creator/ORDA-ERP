import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const schema = read("prisma/schema.prisma");
const service = read("lib/services/daily-operations.service.ts");
const mandatory = read("lib/services/mandatory-task.service.ts");
const cron = read("app/api/cron/daily-operations/route.ts");
const buildScript = read("scripts/vercel-build.mjs");
const vercel = JSON.parse(read("vercel.json")) as { crons?: Array<{ path: string; schedule: string }> };
const dashboard = read("components/dashboard/DirectorCockpit.tsx");
const founderControl = read("components/dashboard/FounderControlPanel.tsx");
const marketing = read("components/marketing/MarketingManagementPage.tsx");
const legacyCrm = read("app/crm/page.tsx");

for (const workflow of ["DAILY_CRM_REPORT", "ORDER_DATA_COMPLETION", "PLATFORM_ORIENTATION"])
  assert.match(schema, new RegExp(`\\b${workflow}\\b`), `${workflow} is missing from Prisma enum`);

assert.match(service, /new Date\(`\$\{key\}T00:00:00\+05:00`\)/, "Almaty day boundary must use +05:00");
assert.match(service, /createdAt: \{ gte: start, lt: end \}/, "lead and event metrics must use half-open day ranges");
assert.match(service, /toStage: \{ notIn: \["NEW", "LOST"\] \}/, "interested leads must be derived from canonical stage events");
assert.match(service, /completedAt: \{ gte: start, lt: end \}/, "completed measurements must be event-based");
assert.match(service, /orderReceivedAt: \{ gte: start, lt: end \}/, "orders must be attributed by received date");
assert.match(
  service,
  /responsibleType: OrderResponsibleType\.EMPLOYEE,[\s\S]*managerUserId: \{ in: ids \}/,
  "company-owned orders must not count in an employee's daily CRM results",
);
assert.match(service, /companyId_workflowKey/, "task generation must be idempotent per tenant and workflow key");
assert.match(service, /pg_advisory_xact_lock/, "concurrent generators must be serialized");
assert.match(service, /activeOlderTask/, "order-readiness tasks must not stack while an older task is active");
assert.match(service, /Просрочен срок/, "order-readiness tasks must include overdue deadlines");
assert.match(service, /ORDER_READINESS_REFRESHED/, "existing readiness tasks must refresh without duplication");
assert.match(service, /status: \{ in: \["ASSIGNED", "IN_PROGRESS"\] \}/, "overdue active measurements must be included in manager readiness");
assert.match(service, /Замерщик не выбран/, "unassigned measurers must be explicit in the task");
assert.match(service, /role: Role\.MANAGER/, "daily rows must be limited to active managers");
assert.match(service, /role: Role\.OPERATIONS_DIRECTOR/, "daily tasks must be owned by the operations director, not the founder");
assert.match(service, /readinessDueAt/, "readiness tasks must receive a clear next-day deadline");
assert.match(service, /dueAtForBusinessDate\(todayKey, 18\)/, "daily CRM reports must stay actionable until 18:00 Almaty");
assert.doesNotMatch(cron, /role: "DIRECTOR"/, "daily operations cron must not depend on the founder");
assert.match(mandatory.replace(/\s+/g, " "), /\{ workflow: null \}, \{ dueAt: \{ lte: now \} \}/, "scheduled workflow tasks must not block before their due time");
assert.match(cron, /timingSafeEqual/, "cron must use constant-time secret comparison");
assert.match(cron, /company\.isDemo/, "cron must reject demo tenants");
assert(vercel.crons?.some((item) => item.path === "/api/cron/daily-operations" && item.schedule === "0 5 * * *"), "10:00 Almaty daily cron is missing");
assert.match(buildScript, /RUN_RELEASE_PREPARATION === "true"/, "ordinary deployments must not mutate staff tasks or payroll");
assert.doesNotMatch(buildScript, /prisma:migrate:deploy/, "Vercel builds must not run concurrent database migrations");
assert.match(dashboard, /Ежедневный CRM-контроль/, "manager/director CRM summary is missing");
assert.match(founderControl, /data\.issues\.map\(\(group\)/, "founder control must show consolidated groups");
assert.doesNotMatch(founderControl, /Отклонений:.*summary\.total/, "founder control must not lead with hundreds of raw exceptions");
assert.match(marketing, /Работа менеджеров продаж за вчера/, "marketing CRM summary is missing");
assert.match(marketing, /Замерщики здесь не оцениваются/, "marketing CRM summary must explain that measurers are outside this block");
assert.match(legacyCrm, /redirect\("\/clients"\)/, "legacy demo CRM route must redirect to the live clients workspace");
assert.doesNotMatch(legacyCrm, /\+7 777 123 45 67/, "legacy demo client data must not remain reachable");

console.log("daily operations contract: ok");
