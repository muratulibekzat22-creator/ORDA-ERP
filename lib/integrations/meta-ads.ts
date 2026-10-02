import { LeadSource, OrderLifecycle, Prisma, Role } from "@prisma/client";

import { marketingMonthRange } from "@/lib/marketing";
import { officialCurrencyRateToKzt } from "@/lib/integrations/nbk-rates";
import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";

const META_CHANNEL = "Instagram / Meta";
const DEFAULT_GRAPH_VERSION = "v26.0";
const MESSAGE_ACTION_TYPES = [
  "onsite_conversion.messaging_conversation_started_7d",
  "messaging_conversation_started_7d",
  "onsite_conversion.messaging_first_reply",
  "onsite_conversion.lead_grouped",
  "lead",
];

type MetaAction = { action_type?: string; value?: string };
type MetaInsight = {
  account_currency?: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  actions?: MetaAction[];
};
type MetaInsightsResponse = {
  data?: MetaInsight[];
  paging?: { next?: string };
  error?: { message?: string; code?: number };
};

export class MetaAdsSyncError extends Error {}

function configuration() {
  const accountId = (process.env.META_AD_ACCOUNT_ID ?? "").replace(/^act_/, "").trim();
  const accessToken = process.env.META_ACCESS_TOKEN?.trim() ?? "";
  const graphVersion = process.env.META_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_VERSION;
  const campaignFilters = (process.env.META_CAMPAIGN_NAME_FILTER ?? "")
    .split(",")
    .map((value) => value.trim().toLocaleLowerCase("ru-RU"))
    .filter(Boolean);
  return { accountId, accessToken, graphVersion, campaignFilters };
}

export function metaAdsIntegrationStatus() {
  const config = configuration();
  return {
    configured: Boolean(/^\d+$/.test(config.accountId) && config.accessToken),
    account: config.accountId ? `act_••••${config.accountId.slice(-4)}` : null,
    graphVersion: config.graphVersion,
    automatic: true,
  };
}

function monthDateRange(month: string) {
  const range = marketingMonthRange(month);
  const since = range.key + "-01";
  const until = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(range.end.getTime() - 1));
  return { ...range, since, until };
}

async function metaFetch<T>(url: URL | string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json().catch(() => null)) as (T & { error?: { message?: string; code?: number } }) | null;
  if (!response.ok || !body || body.error)
    throw new MetaAdsSyncError(`META_API_${body?.error?.code ?? response.status}`);
  return body;
}

async function loadInsights(month: string) {
  const config = configuration();
  if (!/^\d+$/.test(config.accountId) || !config.accessToken)
    throw new MetaAdsSyncError("META_NOT_CONFIGURED");
  const period = monthDateRange(month);
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/act_${config.accountId}/insights`);
  url.searchParams.set("level", "campaign");
  url.searchParams.set("fields", "campaign_id,campaign_name,account_currency,spend,actions");
  url.searchParams.set("time_range", JSON.stringify({ since: period.since, until: period.until }));
  url.searchParams.set("limit", "500");
  const rows: MetaInsight[] = [];
  let next: URL | string | undefined = url;
  for (let page = 0; next && page < 10; page++) {
    const response: MetaInsightsResponse = await metaFetch<MetaInsightsResponse>(next, config.accessToken);
    rows.push(...(response.data ?? []));
    next = response.paging?.next;
  }
  const filtered = config.campaignFilters.length
    ? rows.filter((row) => config.campaignFilters.some((filter) => (row.campaign_name ?? "").toLocaleLowerCase("ru-RU").includes(filter)))
    : rows;
  const spend = filtered.reduce((sum, row) => sum + Number(row.spend ?? 0), 0);
  const leads = filtered.reduce((sum, row) => {
    const values = new Map((row.actions ?? []).map((action) => [action.action_type ?? "", Number(action.value ?? 0)]));
    return sum + Math.max(0, ...MESSAGE_ACTION_TYPES.map((type) => values.get(type) ?? 0));
  }, 0);
  let currency = filtered.find((row) => row.account_currency)?.account_currency?.toUpperCase();
  if (!currency) {
    const accountUrl = new URL(`https://graph.facebook.com/${config.graphVersion}/act_${config.accountId}`);
    accountUrl.searchParams.set("fields", "currency");
    const account = await metaFetch<{ currency?: string }>(accountUrl, config.accessToken);
    currency = account.currency?.toUpperCase();
  }
  if (!currency) throw new MetaAdsSyncError("META_CURRENCY_MISSING");
  return { ...period, accountId: config.accountId, spend, leads: Math.round(leads), currency, campaigns: filtered.length };
}

async function currencyToKzt(currency: string, at: Date) {
  const fallback = Number(process.env.META_CURRENCY_TO_KZT_RATE ?? 0);
  try {
    return await officialCurrencyRateToKzt(currency, at, fallback);
  } catch {
    throw new MetaAdsSyncError("META_EXCHANGE_RATE_UNAVAILABLE");
  }
}

export async function syncMetaAdsMonth(input: { actorId: number; month?: string; now?: Date }) {
  const { companyId } = requireTenantIdentity();
  const now = input.now ?? new Date();
  const month = input.month ?? marketingMonthRange(now).key;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new MetaAdsSyncError("INVALID_MONTH");
  const actor = await prisma.user.findFirst({
    where: { id: input.actorId, companyId, active: true, role: { in: [Role.OPERATIONS_DIRECTOR, Role.MARKETER] } },
    select: { id: true },
  });
  if (!actor) throw new MetaAdsSyncError("META_SYNC_FORBIDDEN");
  const insights = await loadInsights(month);
  const exchange = await currencyToKzt(insights.currency, now);
  const spendKzt = Math.round(insights.spend * exchange.rate * 100) / 100;
  const sourceClients = await prisma.client.findMany({
    where: {
      companyId,
      deletedAt: null,
      OR: [
        { sourceCode: LeadSource.INSTAGRAM },
        { source: { contains: "instagram", mode: "insensitive" } },
        { source: { contains: "facebook", mode: "insensitive" } },
        { source: { contains: "meta", mode: "insensitive" } },
        { source: { contains: "таргет", mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  const crmOrders = sourceClients.length
    ? await prisma.order.findMany({
        where: {
          companyId,
          clientId: { in: sourceClients.map((client) => client.id) },
          deletedAt: null,
          lifecycle: { not: OrderLifecycle.CANCELLED },
          orderDateNeedsReview: false,
          orderReceivedAt: { gte: insights.start, lt: insights.end },
        },
        select: { amount: true },
      })
    : [];
  const revenue = crmOrders.reduce((sum, order) => sum + Number(order.amount), 0);
  const note = [
    "Автосинхронизация Meta",
    `act_${insights.accountId}`,
    `${insights.spend.toFixed(2)} ${insights.currency} × ${exchange.rate.toFixed(4)} KZT`,
    `курс: ${exchange.source}${exchange.publishedFor ? ` (${exchange.publishedFor})` : ""}`,
    `${insights.campaigns} кампаний`,
    `обновлено ${now.toISOString()}`,
  ].join(" · ");
  return prisma.$transaction(async (tx) => {
    const metric = await tx.managementMarketingMetric.upsert({
      where: { companyId_metricMonth_channel: { companyId, metricMonth: insights.start, channel: META_CHANNEL } },
      create: {
        companyId,
        metricMonth: insights.start,
        channel: META_CHANNEL,
        spend: new Prisma.Decimal(spendKzt.toFixed(2)),
        leads: insights.leads,
        orders: crmOrders.length,
        revenue: new Prisma.Decimal(revenue.toFixed(2)),
        note,
        createdById: actor.id,
      },
      update: {
        spend: new Prisma.Decimal(spendKzt.toFixed(2)),
        leads: insights.leads,
        orders: crmOrders.length,
        revenue: new Prisma.Decimal(revenue.toFixed(2)),
        note,
      },
    });
    const supersededMetrics = await tx.managementMarketingMetric.findMany({
      where: {
        companyId,
        metricMonth: insights.start,
        id: { not: metric.id },
        OR: [
          { channel: { contains: "instagram", mode: "insensitive" } },
          { channel: { contains: "facebook", mode: "insensitive" } },
          { channel: { contains: "meta", mode: "insensitive" } },
          { channel: { contains: "таргет", mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });
    if (supersededMetrics.length)
      await tx.companyLedgerEntry.updateMany({
        where: { companyId, idempotencyKey: { in: supersededMetrics.map((item) => `marketing-metric:${item.id}`) }, voidedAt: null },
        data: { voidedAt: now, voidReason: `Заменено автоматической синхронизацией Meta · показатель ${metric.id}` },
      });
    await tx.companyLedgerEntry.upsert({
      where: { idempotencyKey: `marketing-metric:${metric.id}` },
      create: {
        companyId,
        type: "MARKETING_SPEND",
        category: "ADVERTISING",
        direction: "EXPENSE",
        source: "META_ADS",
        amount: metric.spend,
        operationDate: insights.start,
        comment: `Meta Ads · автоматическая синхронизация · ${insights.currency}`,
        authorId: actor.id,
        affectsProfit: true,
        idempotencyKey: `marketing-metric:${metric.id}`,
      },
      update: {
        source: "META_ADS",
        amount: metric.spend,
        operationDate: insights.start,
        comment: `Meta Ads · автоматическая синхронизация · ${insights.currency}`,
        authorId: actor.id,
        affectsProfit: true,
        voidedAt: null,
        voidReason: null,
      },
    });
    return {
      metricId: metric.id,
      month,
      spend: spendKzt,
      sourceSpend: insights.spend,
      currency: insights.currency,
      exchangeRate: exchange.rate,
      exchangeRateSource: exchange.source,
      leads: insights.leads,
      orders: crmOrders.length,
      revenue,
      campaigns: insights.campaigns,
      supersededManualMetrics: supersededMetrics.length,
      syncedAt: now.toISOString(),
    };
  });
}
