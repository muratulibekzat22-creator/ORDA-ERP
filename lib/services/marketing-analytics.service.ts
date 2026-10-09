import { OrderLifecycle } from "@prisma/client";

import { effectiveMarketingMetrics, marketingRatios, metaMetricSignals } from "@/lib/marketing";
import { prisma } from "@/lib/prisma";

type MarketingMetric = {
  channel: string;
  note?: string | null;
  spend: { toString(): string } | number | string;
  leads: number;
  orders: number;
  revenue: { toString(): string } | number | string;
};

export type MarketingAnalytics = {
  spend: number;
  leads: number;
  qualifiedLeads: number;
  orders: number;
  revenue: number;
  cpl: number | null;
  cac: number | null;
  roas: number | null;
  advertisingConversion: number | null;
  salesConversion: number | null;
  conversion: number | null;
  metaLinkClicks: number;
  spendTracked: boolean;
  crmTracked: boolean;
  metaAttributionMissing: boolean;
};

/**
 * Marketing spend is taken from recorded channel metrics. Inquiries, orders and
 * revenue are taken from CRM by their own event dates in the selected month,
 * matching the business dashboard. Automatic Meta metrics provide the top of
 * the funnel (WhatsApp conversations and link clicks); CRM provides qualified
 * applications, orders and revenue. The resulting period ratios are management
 * metrics, not per-campaign attribution.
 */
export async function getMarketingAnalytics(input: {
  companyId: number;
  start: Date;
  end: Date;
  metrics?: MarketingMetric[];
}): Promise<MarketingAnalytics> {
  const metrics = input.metrics ?? await prisma.managementMarketingMetric.findMany({
    where: {
      companyId: input.companyId,
      metricMonth: { gte: input.start, lt: input.end },
    },
    select: {
      channel: true,
      note: true,
      spend: true,
      leads: true,
      orders: true,
      revenue: true,
    },
  });
  const effectiveMetrics = effectiveMarketingMetrics(metrics);
  const recorded = effectiveMetrics.reduce(
    (summary, item) => ({
      spend: summary.spend + Number(item.spend),
      leads: summary.leads + item.leads,
      orders: summary.orders + item.orders,
      revenue: summary.revenue + Number(item.revenue),
    }),
    { spend: 0, leads: 0, orders: 0, revenue: 0 },
  );

  const crmClients = await prisma.client.findMany({
    where: {
      companyId: input.companyId,
      active: true,
      deletedAt: null,
      createdAt: { gte: input.start, lt: input.end },
    },
    select: { id: true },
  });
  const crmOrders = await prisma.order.findMany({
    where: {
      companyId: input.companyId,
      orderReceivedAt: { gte: input.start, lt: input.end },
      orderDateNeedsReview: false,
      deletedAt: null,
      lifecycle: { not: OrderLifecycle.CANCELLED },
    },
    select: { amount: true },
  });

  const crmTracked = crmClients.length > 0 || crmOrders.length > 0;
  const spendTracked = effectiveMetrics.length > 0;
  const automaticMetaTracked = effectiveMetrics.some(
    (metric) => metric.channel === "Instagram / Meta" && metric.note?.startsWith("Автосинхронизация Meta"),
  );
  const metaSignals = effectiveMetrics
    .filter((metric) => metric.channel === "Instagram / Meta" && metric.note?.startsWith("Автосинхронизация Meta"))
    .reduce((summary, metric) => {
      const signals = metaMetricSignals(metric.note);
      return {
        conversations: summary.conversations + (signals.conversations ?? metric.leads),
        linkClicks: summary.linkClicks + (signals.linkClicks ?? 0),
      };
    }, { conversations: 0, linkClicks: 0 });
  const spend = recorded.spend;
  const qualifiedLeads = crmClients.length;
  const leads = automaticMetaTracked && metaSignals.conversations > 0
    ? metaSignals.conversations
    : crmTracked
      ? qualifiedLeads
      : recorded.leads;
  const orders = crmTracked ? crmOrders.length : recorded.orders;
  const revenue = crmTracked
    ? crmOrders.reduce((sum, order) => sum + Number(order.amount), 0)
    : recorded.revenue;
  const ratios = marketingRatios({
    spend,
    inquiries: leads,
    qualifiedLeads,
    orders,
    revenue,
    linkClicks: automaticMetaTracked ? metaSignals.linkClicks : 0,
  });

  return {
    spend,
    leads,
    qualifiedLeads,
    orders,
    revenue,
    cpl: spendTracked ? ratios.cpl : null,
    cac: spendTracked ? ratios.cac : null,
    roas: spendTracked ? ratios.roas : null,
    advertisingConversion: ratios.advertisingConversion,
    salesConversion: ratios.salesConversion,
    conversion: ratios.salesConversion,
    metaLinkClicks: metaSignals.linkClicks,
    spendTracked,
    crmTracked,
    metaAttributionMissing: automaticMetaTracked,
  };
}
