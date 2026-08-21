import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CONTACT_CHANNEL_PRESETS, MARKETING_SOURCE_PRESETS, marketingKpis, marketingMetricDedupeKey } from "../lib/marketing/domain";
import { defaultPermissions } from "../lib/permissions";
import { Role } from "../lib/roles";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

assert.equal(MARKETING_SOURCE_PRESETS.length, 17);
assert.equal(CONTACT_CHANNEL_PRESETS.length, 12);
assert.notEqual(MARKETING_SOURCE_PRESETS.find(([code]) => code === "INSTAGRAM_ORGANIC")?.[0], MARKETING_SOURCE_PRESETS.find(([code]) => code === "META_INSTAGRAM_ADS")?.[0]);
assert.notEqual(MARKETING_SOURCE_PRESETS.find(([code]) => code === "WHATSAPP_ORGANIC")?.[0], MARKETING_SOURCE_PRESETS.find(([code]) => code === "META_CLICK_WHATSAPP")?.[0]);
assert.ok(MARKETING_SOURCE_PRESETS.some(([code]) => code === "GOOGLE_ADS"));

const kpis = marketingKpis({ confirmedSpend: 120_000, clicks: 600, applications: 60, completedMeasurements: 30, orders: 12, payingClients: 10, soldAmount: 1_200_000, grossProfit: 360_000 });
assert.equal(kpis.cpc, 200);
assert.equal(kpis.cpl, 2_000);
assert.equal(kpis.measurementCost, 4_000);
assert.equal(kpis.cpa, 10_000);
assert.equal(kpis.cac, 12_000);
assert.equal(kpis.roas, 10);
assert.equal(kpis.romi, 2);
assert.deepEqual(marketingKpis({ confirmedSpend: 0, clicks: 0, applications: 0, completedMeasurements: 0, orders: 0, payingClients: 0, soldAmount: 0, grossProfit: 0 }), { cpc: 0, cpl: 0, measurementCost: 0, cpa: 0, cac: 0, roas: 0, romi: 0 });

const keyInput = { companyId: 2, campaignId: 9, adSetId: null, adId: null, metricDate: new Date("2026-08-20T00:00:00Z"), importKey: "csv-1" };
assert.equal(marketingMetricDedupeKey(keyInput), marketingMetricDedupeKey(keyInput));
assert.notEqual(marketingMetricDedupeKey(keyInput), marketingMetricDedupeKey({ ...keyInput, importKey: "csv-2" }));

assert.deepEqual(defaultPermissions[Role.MARKETER].sort(), ["calendar", "marketing"]);
assert.ok(defaultPermissions[Role.DIRECTOR].includes("marketing"));
assert.ok(defaultPermissions[Role.ACCOUNTANT].includes("marketing"));

const scope = read("lib/tenant-scope.ts");
for (const model of ["MarketingSource", "MarketingContactChannel", "MarketingCampaign", "MarketingAdSet", "MarketingAd", "MarketingCreative", "MarketingInquiry", "LeadAttribution", "MarketingTouch", "MarketingMetric", "MarketingSpend", "MarketingBudget", "MarketingAuditLog"]) assert.match(scope, new RegExp(`"${model}"`));

const service = read("lib/services/marketing.service.ts");
assert.doesNotMatch(service, /input\.companyId|body\.companyId|first-company|company\.findFirst/);
assert.match(service, /requireTenantIdentity\(\)\.companyId/);
assert.match(service, /marketing-spend:\$\{spend\.id\}/);
assert.match(service, /status: MarketingSpendStatus\.APPROVED/);
assert.match(service, /companyLedgerEntry\.create/);
assert.match(service, /leadAttribution\.create/);
assert.match(service, /tx\.client\.create/);

const route = read("app/api/marketing/route.ts");
assert.match(route, /role !== Role\.DIRECTOR && role !== Role\.MARKETER/);
assert.match(route, /requirePermission\("marketing"\)/);

const workspace = read("components/marketing/MarketingWorkspace.tsx");
for (const tab of ["Обзор", "Входящие", "Заявки", "Кампании", "Каналы", "Расходы и показатели", "Воронка", "Атрибуция", "Бюджет", "Отчёты"]) assert.match(workspace, new RegExp(tab));
assert.match(workspace, /Preview/);
assert.match(workspace, /importMetrics/);

const migration = read("prisma/migrations/20260820143000_marketing_workspace/migration.sql");
assert.doesNotMatch(migration, /\b(DROP TABLE|TRUNCATE|DELETE FROM|DROP COLUMN|migrate reset)\b/i);
assert.match(migration, /ALTER TYPE "Role" ADD VALUE 'MARKETER'/);
assert.match(migration, /CREATE TABLE "LeadAttribution"/);
assert.match(migration, /CREATE TABLE "MarketingSpend"/);

console.log("Marketing workspace checks passed");
