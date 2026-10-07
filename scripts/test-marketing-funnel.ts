import assert from "node:assert/strict";

import {
  isAutomaticMetaMetric,
  metaConversationCount,
  metaFunnelKpis,
  salesConversionPercent,
} from "../lib/marketing-funnel";
import { effectiveMarketingMetrics } from "../lib/marketing";

const metric = {
  channel: "Instagram / Meta",
  note: "Автосинхронизация Meta · 29 начатых переписок · 7 событий lead в Meta",
  spend: 145_000,
  leads: 7,
};

assert.equal(isAutomaticMetaMetric(metric), true);
assert.equal(metaConversationCount(metric), 29);
assert.equal(salesConversionPercent(2, 34)?.toFixed(1), "5.9");
assert.equal(salesConversionPercent(0, 4), 0);
assert.equal(salesConversionPercent(0, 0), null);
assert.deepEqual(
  metaFunnelKpis({
    spend: 145_000,
    conversations: 29,
    crmLeads: 20,
    orders: 4,
    revenue: 1_450_000,
  }),
  {
    costPerConversation: 5_000,
    cpl: 7_250,
    cac: 36_250,
    roas: 10,
    conversion: 20,
  },
);

assert.deepEqual(
  metaFunnelKpis({
    spend: 145_000,
    conversations: 0,
    crmLeads: 0,
    orders: 0,
    revenue: 0,
  }),
  {
    costPerConversation: null,
    cpl: null,
    cac: null,
    roas: 0,
    conversion: null,
  },
);

const multipleMonths = effectiveMarketingMetrics([
  { channel: "Instagram / Meta", note: "Автосинхронизация Meta · сентябрь", spend: 100, leads: 1 },
  { channel: "Instagram / Meta", note: "Автосинхронизация Meta · октябрь", spend: 200, leads: 2 },
  { channel: "Meta ручной ввод", note: "legacy", spend: 999, leads: 99 },
  { channel: "Рекомендации", note: null, spend: 0, leads: 3 },
]);
assert.equal(multipleMonths.length, 3, "all automatic monthly Meta rows and non-Meta channels must remain");
assert.equal(multipleMonths.reduce((sum, row) => sum + row.spend, 0), 300);
assert.equal(multipleMonths.some((row) => row.channel === "Meta ручной ввод"), false);

console.log("Meta conversations, CRM leads, order cost, ROAS and conversion passed");
