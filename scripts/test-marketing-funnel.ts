import assert from "node:assert/strict";

import {
  isAutomaticMetaMetric,
  metaConversationCount,
  metaFunnelKpis,
  salesConversionPercent,
} from "../lib/marketing-funnel";

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

console.log("Meta conversations, CRM leads, order cost, ROAS and conversion passed");
