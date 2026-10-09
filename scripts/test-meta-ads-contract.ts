import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { effectiveNbkRateDate, nbkRateCandidateDates, parseNbkRateXml } from "@/lib/integrations/nbk-rates";
import { campaignIdsFromEnv, metaActionCounts, onlySelectedCampaigns } from "@/lib/integrations/meta-ads-metrics";
import { effectiveMarketingMetrics, exchangeRateFromMetaMetricNote, marketingRatios, metaMetricSignals } from "@/lib/marketing";

const sample = `<?xml version="1.0"?><rss><channel><item><title>USD</title><pubDate>02.10.2026</pubDate><description>450.79</description><quant>1</quant></item><item><title>AMD</title><description>12.21</description><quant>10</quant></item></channel></rss>`;
assert.deepEqual(parseNbkRateXml(sample, "USD"), { rate: 450.79, publishedFor: "02.10.2026" });
assert.deepEqual(parseNbkRateXml(sample, "AMD"), { rate: 1.221, publishedFor: null });
assert.equal(parseNbkRateXml(sample, "EUR"), null);
const octoberNow = new Date("2026-10-09T13:00:00.000Z");
assert.equal(effectiveNbkRateDate(new Date("2026-10-31T18:59:59.999Z"), octoberNow).toISOString(), octoberNow.toISOString());
assert.equal(nbkRateCandidateDates(new Date("2026-10-31T18:59:59.999Z"), octoberNow)[0], "09.10.2026");
assert.deepEqual(campaignIdsFromEnv("123, 456,123"), ["123", "456"]);
assert.deepEqual(campaignIdsFromEnv("123,invalid"), []);
assert.deepEqual(onlySelectedCampaigns([
  { campaign_id: "123", name: "ALTYN SAPA" },
  { campaign_id: "789", name: "Personal promotion" },
], ["123"]).map((row) => row.name), ["ALTYN SAPA"]);
assert.deepEqual(metaActionCounts([
  { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "145" },
  { action_type: "onsite_conversion.messaging_first_reply", value: "140" },
  { action_type: "onsite_conversion.lead_grouped", value: "2" },
]), { conversations: 145, leadActions: 2 });
assert.deepEqual(metaActionCounts([
  { action_type: "onsite_conversion.messaging_first_reply", value: "12" },
]), { conversations: 0, leadActions: 0 });
assert.deepEqual(
  effectiveMarketingMetrics([
    { channel: "Facebook manual", note: null, spend: 10 },
    { channel: "Instagram / Meta", note: "Автосинхронизация Meta · test", spend: 20 },
    { channel: "2GIS", note: null, spend: 30 },
  ]).map((metric) => metric.spend),
  [20, 30],
  "automatic Meta data must supersede old manual Meta rows without hiding other channels",
);
assert.deepEqual(
  metaMetricSignals("Автосинхронизация Meta · 145 начатых переписок · meta:conversations=145 · meta:linkClicks=200 · meta:impressions=9000"),
  { conversations: 145, linkClicks: 200, impressions: 9000 },
);
assert.equal(exchangeRateFromMetaMetricNote("100.00 USD × 450.2500 KZT · fx:USD/KZT=450.250000", "USD"), 450.25);
assert.equal(exchangeRateFromMetaMetricNote("100.00 USD × 450,25 KZT", "USD"), 450.25);
assert.equal(exchangeRateFromMetaMetricNote("100.00 USD × 450.25 KZT", "EUR"), null);
assert.deepEqual(marketingRatios({ spend: 100_000, inquiries: 200, qualifiedLeads: 40, orders: 8, revenue: 1_000_000, linkClicks: 500 }), {
  cpl: 500,
  cac: 12_500,
  roas: 10,
  advertisingConversion: 40,
  salesConversion: 20,
});

const integration = readFileSync("lib/integrations/meta-ads.ts", "utf8");
const route = readFileSync("app/api/marketing/route.ts", "utf8");
const daily = readFileSync("app/api/cron/daily-operations/route.ts", "utf8");
const page = readFileSync("components/marketing/MarketingManagementPage.tsx", "utf8");

assert.match(integration, /Authorization: `Bearer \$\{token\}`/);
assert.match(integration, /source: "META_ADS"/);
assert.match(integration, /companyId_metricMonth_channel/);
assert.match(integration, /officialCurrencyRateToKzt/);
assert.match(integration, /Math\.min\(now\.getTime\(\), insights\.end\.getTime\(\) - 1\)/);
assert.match(integration, /source: "LAST_SUCCESSFUL"/);
assert.match(integration, /leads: insights\.conversations/);
assert.match(integration, /Заменено автоматической синхронизацией Meta/);
assert.match(route, /ручной ввод отключён/);
assert.match(daily, /syncMetaAdsMonth/);
assert.match(page, /Meta Ads — автоматически/);
assert.match(page, /Конверсия рекламы/);
assert.match(page, /Конверсия продаж/);
assert.match(page, /Цена обращения/);
assert.match(page, /Цена заказа/);
assert.match(page, /ROAS/);

console.log("Meta Ads automatic sync and NBK exchange-rate contracts: OK");
