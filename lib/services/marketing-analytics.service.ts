import { OrderLifecycle } from "@prisma/client";

import { effectiveMarketingMetrics } from "@/lib/marketing";
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
  orders: number;
  revenue: number;
  cpl: number | null;
  cac: number | null;
  roas: number | null;
  conversion: number | null;
  spendTracked: boolean;
  crmTracked: boolean;
  metaAttributionMissing: boolean;
};

/**
 * Marketing spend is taken from recorded channel metrics. Inquiries, orders and
 * revenue are taken from the full CRM acquisition cohort so those totals keep
 * working even when the Meta service token is unavailable. The CRM cohort is
 * not attributed to ad campaigns, so ad efficiency ratios stay empty whenever
 * these totals are mixed with automatic Meta spend.
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
  const crmOrders = crmClients.length
    ? await prisma.order.findMany({
        where: {
          companyId: input.companyId,
          clientId: { in: crmClients.map((client) => client.id) },
          deletedAt: null,
          lifecycle: { not: OrderLifecycle.CANCELLED },
        },
        select: { amount: true },
      })
    : [];

  const crmTracked = crmClients.length > 0;
  const spendTracked = effectiveMetrics.length > 0;
  const automaticMetaTracked = effectiveMetrics.some(
    (metric) => metric.channel === "Instagram / Meta" && metric.note?.startsWith("Автосинхронизация Meta"),
  );
  const comparableChannelResults = !automaticMetaTracked;
  const spend = recorded.spend;
  const leads = crmTracked ? crmClients.length : recorded.leads;
  const orders = crmTracked ? crmOrders.length : recorded.orders;
  const revenue = crmTracked
    ? crmOrders.reduce((sum, order) => sum + Number(order.amount), 0)
    : recorded.revenue;

  return {
    spend,
    leads,
    orders,
    revenue,
    cpl: comparableChannelResults && spendTracked && leads > 0 ? spend / leads : null,
    cac: comparableChannelResults && spendTracked && orders > 0 ? spend / orders : null,
    roas: comparableChannelResults && spendTracked && spend > 0 ? revenue / spend : null,
    conversion: leads > 0 ? (orders / leads) * 100 : null,
    spendTracked,
    crmTracked,
    metaAttributionMissing: automaticMetaTracked,
  };
}
