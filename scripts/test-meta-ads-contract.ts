import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseNbkRateXml } from "@/lib/integrations/nbk-rates";
import { effectiveMarketingMetrics } from "@/lib/marketing";

const sample = `<?xml version="1.0"?><rss><channel><item><title>USD</title><pubDate>02.10.2026</pubDate><description>450.79</description><quant>1</quant></item><item><title>AMD</title><description>12.21</description><quant>10</quant></item></channel></rss>`;
assert.deepEqual(parseNbkRateXml(sample, "USD"), { rate: 450.79, publishedFor: "02.10.2026" });
assert.deepEqual(parseNbkRateXml(sample, "AMD"), { rate: 1.221, publishedFor: null });
assert.equal(parseNbkRateXml(sample, "EUR"), null);
assert.deepEqual(
  effectiveMarketingMetrics([
    { channel: "Facebook manual", note: null, spend: 10 },
    { channel: "Instagram / Meta", note: "Автосинхронизация Meta · test", spend: 20 },
    { channel: "2GIS", note: null, spend: 30 },
  ]).map((metric) => metric.spend),
  [20, 30],
  "automatic Meta data must supersede old manual Meta rows without hiding other channels",
);

const integration = readFileSync("lib/integrations/meta-ads.ts", "utf8");
const route = readFileSync("app/api/marketing/route.ts", "utf8");
const daily = readFileSync("app/api/cron/daily-operations/route.ts", "utf8");
const page = readFileSync("components/marketing/MarketingManagementPage.tsx", "utf8");

assert.match(integration, /Authorization: `Bearer \$\{token\}`/);
assert.match(integration, /source: "META_ADS"/);
assert.match(integration, /companyId_metricMonth_channel/);
assert.match(integration, /officialCurrencyRateToKzt/);
assert.match(integration, /Заменено автоматической синхронизацией Meta/);
assert.match(route, /ручной ввод отключён/);
assert.match(daily, /syncMetaAdsMonth/);
assert.match(page, /Meta Ads — автоматически/);

console.log("Meta Ads automatic sync and NBK exchange-rate contracts: OK");
