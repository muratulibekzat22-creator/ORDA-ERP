import { OrderLifecycle } from "@prisma/client";

import { effectiveMarketingMetrics } from "@/lib/marketing";
import {
  isAutomaticMetaMetric,
  metaConversationCount,
  metaFunnelKpis,
} from "@/lib/marketing-funnel";
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
  metaSpend: number;
  metaConversations: number;
  metaLeadActions: number;
  metaCrmLeads: number;
  metaProposals: number;
  metaMeasurements: number;
  metaOrders: number;
  metaRevenue: number;
  costPerConversation: number | null;
  cpl: number | null;
  cac: number | null;
  roas: number | null;
  conversion: number | null;
  metaConversion: number | null;
  spendTracked: boolean;
  metaSpendTracked: boolean;
  crmTracked: boolean;
  metaAttributionMissing: boolean;
};

/**
 * Marketing spend is taken from recorded channel metrics. The all-channel CRM
 * totals stay separate from the Meta funnel. Meta conversations come from the
 * automatic sync note, while Meta leads and orders use the CRM source field.
 * This keeps the cost and ROAS denominators explicit on the owner dashboard.
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

  const [crmClients, metaSourceClients, crmOrders, proposalRows, measurementRows] = await Promise.all([
    prisma.client.findMany({
      where: {
        companyId: input.companyId,
        active: true,
        deletedAt: null,
        createdAt: { gte: input.start, lt: input.end },
      },
      select: { id: true },
    }),
    prisma.client.findMany({
      where: {
        companyId: input.companyId,
        active: true,
        deletedAt: null,
        OR: [
          { sourceCode: "INSTAGRAM" },
          { source: { contains: "instagram", mode: "insensitive" } },
          { source: { contains: "facebook", mode: "insensitive" } },
          { source: { contains: "meta", mode: "insensitive" } },
          { source: { contains: "таргет", mode: "insensitive" } },
        ],
      },
      select: { id: true, createdAt: true },
    }),
    prisma.order.findMany({
      where: {
        companyId: input.companyId,
        orderReceivedAt: { gte: input.start, lt: input.end },
        orderDateNeedsReview: false,
        deletedAt: null,
        lifecycle: { not: OrderLifecycle.CANCELLED },
      },
      select: { amount: true, clientId: true },
    }),
    prisma.commercialProposal.findMany({
      where: {
        companyId: input.companyId,
        createdAt: { gte: input.start, lt: input.end },
      },
      select: { clientId: true },
    }),
    prisma.measurement.findMany({
      where: {
        companyId: input.companyId,
        deletedAt: null,
        visitDate: { gte: input.start, lt: input.end },
        client: { active: true, deletedAt: null },
      },
      select: { clientId: true },
    }),
  ]);

  const crmTracked = crmClients.length > 0 || crmOrders.length > 0;
  const spendTracked = effectiveMetrics.length > 0;
  const automaticMetaMetrics = effectiveMetrics.filter(isAutomaticMetaMetric);
  const automaticMetaTracked = automaticMetaMetrics.length > 0;
  const comparableChannelResults = !automaticMetaTracked;
  const spend = recorded.spend;
  const leads = crmTracked ? crmClients.length : recorded.leads;
  const orders = crmTracked ? crmOrders.length : recorded.orders;
  const revenue = crmTracked
    ? crmOrders.reduce((sum, order) => sum + Number(order.amount), 0)
    : recorded.revenue;
  const metaClientIds = new Set(metaSourceClients.map((client) => client.id));
  const metaCrmLeads = metaSourceClients.filter(
    (client) => client.createdAt >= input.start && client.createdAt < input.end,
  ).length;
  const metaProposals = new Set(
    proposalRows
      .filter((proposal) => metaClientIds.has(proposal.clientId))
      .map((proposal) => proposal.clientId),
  ).size;
  const metaMeasurements = new Set(
    measurementRows
      .filter((measurement) => metaClientIds.has(measurement.clientId))
      .map((measurement) => measurement.clientId),
  ).size;
  const metaOrders = crmOrders.filter((order) => metaClientIds.has(order.clientId));
  const metaRevenue = metaOrders.reduce(
    (sum, order) => sum + Number(order.amount),
    0,
  );
  const metaSpend = automaticMetaMetrics.reduce(
    (sum, metric) => sum + Number(metric.spend),
    0,
  );
  const metaConversations = automaticMetaMetrics.reduce(
    (sum, metric) => sum + metaConversationCount(metric),
    0,
  );
  const metaLeadActions = automaticMetaMetrics.reduce(
    (sum, metric) => sum + metric.leads,
    0,
  );
  const ratioSpend = automaticMetaTracked ? metaSpend : spend;
  const ratioLeads = automaticMetaTracked ? metaCrmLeads : leads;
  const ratioOrders = automaticMetaTracked ? metaOrders.length : orders;
  const ratioRevenue = automaticMetaTracked ? metaRevenue : revenue;
  const metaKpis = metaFunnelKpis({
    spend: metaSpend,
    conversations: metaConversations,
    crmLeads: metaCrmLeads,
    orders: metaOrders.length,
    revenue: metaRevenue,
  });

  return {
    spend,
    leads,
    orders,
    revenue,
    metaSpend,
    metaConversations,
    metaLeadActions,
    metaCrmLeads,
    metaProposals,
    metaMeasurements,
    metaOrders: metaOrders.length,
    metaRevenue,
    costPerConversation:
      automaticMetaTracked ? metaKpis.costPerConversation : null,
    cpl:
      automaticMetaTracked
        ? metaKpis.cpl
        : comparableChannelResults && ratioSpend > 0 && ratioLeads > 0
          ? ratioSpend / ratioLeads
          : null,
    cac:
      automaticMetaTracked
        ? metaKpis.cac
        : comparableChannelResults && ratioSpend > 0 && ratioOrders > 0
          ? ratioSpend / ratioOrders
          : null,
    roas:
      automaticMetaTracked
        ? metaKpis.roas
        : comparableChannelResults && ratioSpend > 0
          ? ratioRevenue / ratioSpend
          : null,
    conversion: leads > 0 ? (orders / leads) * 100 : null,
    metaConversion: automaticMetaTracked ? metaKpis.conversion : null,
    spendTracked,
    metaSpendTracked: automaticMetaTracked,
    crmTracked,
    metaAttributionMissing:
      automaticMetaTracked && metaConversations > 0 && metaCrmLeads === 0,
  };
}
