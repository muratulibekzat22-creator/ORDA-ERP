import { LeadSource, OrderLifecycle, Prisma, Role } from "@prisma/client";

import { marketingMonthRange } from "@/lib/marketing";
import { campaignIdsFromEnv, metaActionCounts, onlySelectedCampaigns, type MetaAction } from "@/lib/integrations/meta-ads-metrics";
import { officialCurrencyRateToKzt } from "@/lib/integrations/nbk-rates";
import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";

const META_CHANNEL = "Instagram / Meta";
const DEFAULT_GRAPH_VERSION = "v26.0";
type MetaInsight = {
  account_currency?: string;
  campaign_id?: string;
  campaign_name?: string;
  ad_id?: string;
  ad_name?: string;
  date_start?: string;
  date_stop?: string;
  spend?: string;
  reach?: string;
  impressions?: string;
  inline_link_clicks?: string;
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
  const campaignIds = campaignIdsFromEnv(process.env.META_CAMPAIGN_IDS ?? "");
  const booksToLedger = process.env.META_POST_TO_LEDGER === "true";
  return { accountId, accessToken, graphVersion, campaignIds, booksToLedger };
}

export function metaAdsIntegrationStatus() {
  const config = configuration();
  return {
    configured: Boolean(/^\d+$/.test(config.accountId) && config.accessToken && config.campaignIds.length),
    account: config.accountId ? `act_••••${config.accountId.slice(-4)}` : null,
    graphVersion: config.graphVersion,
    campaignCount: config.campaignIds.length,
    booksToLedger: config.booksToLedger,
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

function nonNegativeNumber(value: string | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function insightMetrics(row: MetaInsight) {
  return {
    spend: Math.round(nonNegativeNumber(row.spend) * 100) / 100,
    reach: Math.round(nonNegativeNumber(row.reach)),
    impressions: Math.round(nonNegativeNumber(row.impressions)),
    linkClicks: Math.round(nonNegativeNumber(row.inline_link_clicks)),
    ...metaActionCounts(row.actions),
  };
}

function addMetrics<T extends ReturnType<typeof insightMetrics>>(left: T, right: ReturnType<typeof insightMetrics>) {
  return {
    ...left,
    spend: Math.round((left.spend + right.spend) * 100) / 100,
    reach: left.reach + right.reach,
    impressions: left.impressions + right.impressions,
    linkClicks: left.linkClicks + right.linkClicks,
    conversations: left.conversations + right.conversations,
    leadActions: left.leadActions + right.leadActions,
  };
}

async function loadInsightPages(url: URL, token: string) {
  const rows: MetaInsight[] = [];
  let next: URL | string | undefined = url;
  for (let page = 0; next && page < 10; page++) {
    const response: MetaInsightsResponse = await metaFetch<MetaInsightsResponse>(next, token);
    rows.push(...(response.data ?? []));
    next = response.paging?.next;
  }
  if (next) throw new MetaAdsSyncError("META_PAGINATION_LIMIT");
  return rows;
}

export async function loadMetaAdsCampaignReport(month: string) {
  const config = configuration();
  if (!/^\d+$/.test(config.accountId) || !config.accessToken || !config.campaignIds.length)
    throw new MetaAdsSyncError("META_NOT_CONFIGURED");
  const period = monthDateRange(month);
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/act_${config.accountId}/insights`);
  url.searchParams.set("level", "campaign");
  url.searchParams.set("fields", "campaign_id,campaign_name,account_currency,spend,reach,impressions,inline_link_clicks,actions");
  url.searchParams.set("time_range", JSON.stringify({ since: period.since, until: period.until }));
  url.searchParams.set("limit", "500");
  const dailyUrl = new URL(url);
  dailyUrl.searchParams.set("time_increment", "1");
  dailyUrl.searchParams.set("fields", "campaign_id,campaign_name,date_start,date_stop,account_currency,spend,reach,impressions,inline_link_clicks,actions");
  const adsUrl = new URL(url);
  adsUrl.searchParams.set("level", "ad");
  adsUrl.searchParams.set("fields", "campaign_id,campaign_name,ad_id,ad_name,account_currency,spend,reach,impressions,inline_link_clicks,actions");
  const adDailyUrl = new URL(adsUrl);
  adDailyUrl.searchParams.set("time_increment", "1");
  adDailyUrl.searchParams.set("fields", "campaign_id,campaign_name,ad_id,ad_name,date_start,date_stop,account_currency,spend,reach,impressions,inline_link_clicks,actions");
  const [rows, dailyRows, adRows, adDailyRows] = await Promise.all([
    loadInsightPages(url, config.accessToken),
    loadInsightPages(dailyUrl, config.accessToken),
    loadInsightPages(adsUrl, config.accessToken),
    loadInsightPages(adDailyUrl, config.accessToken),
  ]);
  const selectedDailyRows = onlySelectedCampaigns(dailyRows, config.campaignIds);
  const selectedAdRows = onlySelectedCampaigns(adRows, config.campaignIds);
  const selectedAdDailyRows = onlySelectedCampaigns(adDailyRows, config.campaignIds);
  const adsByCampaign = new Map<string, Map<string, { id: string; name: string; daily: Array<{ date: string } & ReturnType<typeof insightMetrics>> } & ReturnType<typeof insightMetrics>>>();
  for (const row of selectedAdRows) {
    if (!row.campaign_id || !row.ad_id) continue;
    const campaignAds = adsByCampaign.get(row.campaign_id) ?? new Map();
    const metrics = insightMetrics(row);
    campaignAds.set(row.ad_id, {
      id: row.ad_id,
      name: row.ad_name ?? row.ad_id,
      ...metrics,
      daily: selectedAdDailyRows
        .filter((daily) => daily.ad_id === row.ad_id && daily.date_start)
        .map((daily) => ({ date: daily.date_start!, ...insightMetrics(daily) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    });
    adsByCampaign.set(row.campaign_id, campaignAds);
  }
  const campaigns = onlySelectedCampaigns(rows, config.campaignIds).map((row) => ({
    id: row.campaign_id!,
    name: row.campaign_name ?? row.campaign_id!,
    ...insightMetrics(row),
    daily: selectedDailyRows
      .filter((daily) => daily.campaign_id === row.campaign_id && daily.date_start)
      .map((daily) => ({ date: daily.date_start!, ...insightMetrics(daily) }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    ads: [...(adsByCampaign.get(row.campaign_id!)?.values() ?? [])]
      .sort((a, b) => b.spend - a.spend),
  })).sort((a, b) => b.spend - a.spend);
  const dailyByDate = new Map<string, ReturnType<typeof insightMetrics>>();
  for (const row of selectedDailyRows) {
    if (!row.date_start) continue;
    const metrics = insightMetrics(row);
    dailyByDate.set(row.date_start, dailyByDate.has(row.date_start) ? addMetrics(dailyByDate.get(row.date_start)!, metrics) : metrics);
  }
  const accountUrl = new URL(`https://graph.facebook.com/${config.graphVersion}/act_${config.accountId}`);
  accountUrl.searchParams.set("fields", "currency,timezone_name");
  const account = await metaFetch<{ currency?: string; timezone_name?: string }>(accountUrl, config.accessToken);
  const currency = account.currency?.toUpperCase();
  if (!currency) throw new MetaAdsSyncError("META_CURRENCY_MISSING");
  return {
    ...period,
    accountId: config.accountId,
    accountTimezone: account.timezone_name ?? null,
    currency,
    selectedCampaignCount: config.campaignIds.length,
    loadedAt: new Date().toISOString(),
    campaigns,
    daily: [...dailyByDate.entries()].map(([date, metrics]) => ({ date, ...metrics })).sort((a, b) => a.date.localeCompare(b.date)),
    spend: Math.round(campaigns.reduce((sum, row) => sum + row.spend, 0) * 100) / 100,
    conversations: campaigns.reduce((sum, row) => sum + row.conversations, 0),
    leadActions: campaigns.reduce((sum, row) => sum + row.leadActions, 0),
    linkClicks: campaigns.reduce((sum, row) => sum + row.linkClicks, 0),
    impressions: campaigns.reduce((sum, row) => sum + row.impressions, 0),
  };
}

async function storedCurrencyRate(currency: string) {
  const { companyId } = requireTenantIdentity();
  const metric = await prisma.managementMarketingMetric.findFirst({
    where: { companyId, channel: META_CHANNEL, note: { contains: `${currency.toUpperCase()} ×` } },
    select: { note: true },
    orderBy: { updatedAt: "desc" },
  });
  const match = metric?.note?.match(new RegExp(`${currency.toUpperCase()} × ([0-9]+(?:\\.[0-9]+)?) KZT`, "i"));
  const rate = Number(match?.[1] ?? 0);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

export async function currencyToKzt(currency: string, at: Date) {
  const configuredFallback = Number(process.env.META_CURRENCY_TO_KZT_RATE ?? 0);
  const savedFallback = await storedCurrencyRate(currency);
  const fallback = Number.isFinite(configuredFallback) && configuredFallback > 0 ? configuredFallback : savedFallback;
  try {
    const exchange = await officialCurrencyRateToKzt(currency, at, fallback);
    return {
      ...exchange,
      fallbackKind: exchange.source === "CONFIGURED_FALLBACK"
        ? configuredFallback > 0 ? "CONFIGURED" : "LAST_SUCCESSFUL_SYNC"
        : null,
    };
  } catch {
    throw new MetaAdsSyncError("META_EXCHANGE_RATE_UNAVAILABLE");
  }
}

export async function syncMetaAdsMonth(input: { actorId: number; month?: string; now?: Date }) {
  const { companyId } = requireTenantIdentity();
  const config = configuration();
  const now = input.now ?? new Date();
  const month = input.month ?? marketingMonthRange(now).key;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new MetaAdsSyncError("INVALID_MONTH");
  const actor = await prisma.user.findFirst({
    where: { id: input.actorId, companyId, active: true, role: { in: [Role.DIRECTOR, Role.OPERATIONS_DIRECTOR, Role.MARKETER] } },
    select: { id: true },
  });
  if (!actor) throw new MetaAdsSyncError("META_SYNC_FORBIDDEN");
  const insights = await loadMetaAdsCampaignReport(month);
  const exchange = await currencyToKzt(insights.currency, new Date(Math.min(insights.end.getTime() - 1, now.getTime())));
  const spendKzt = Math.round(insights.spend * exchange.rate * 100) / 100;
  const sourceClients = await prisma.client.findMany({
    where: {
      companyId,
      deletedAt: null,
      OR: [
        { sourceCode: LeadSource.WHATSAPP },
        { sourceCode: LeadSource.INSTAGRAM },
        { source: { contains: "whatsapp", mode: "insensitive" } },
        { source: { contains: "ватсап", mode: "insensitive" } },
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
    `${insights.campaigns.length} кампаний`,
    `${insights.conversations} начатых переписок`,
    `${insights.leadActions} событий lead в Meta`,
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
        leads: insights.leadActions,
        orders: crmOrders.length,
        revenue: new Prisma.Decimal(revenue.toFixed(2)),
        note,
        createdById: actor.id,
      },
      update: {
        spend: new Prisma.Decimal(spendKzt.toFixed(2)),
        leads: insights.leadActions,
        orders: crmOrders.length,
        revenue: new Prisma.Decimal(revenue.toFixed(2)),
        note,
      },
    });
    const supersededMetrics = config.booksToLedger ? await tx.managementMarketingMetric.findMany({
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
    }) : [];
    if (config.booksToLedger && supersededMetrics.length)
      await tx.companyLedgerEntry.updateMany({
        where: { companyId, idempotencyKey: { in: supersededMetrics.map((item) => `marketing-metric:${item.id}`) }, voidedAt: null },
        data: { voidedAt: now, voidReason: `Заменено автоматической синхронизацией Meta · показатель ${metric.id}` },
      });
    if (config.booksToLedger) await tx.companyLedgerEntry.upsert({
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
      leadActions: insights.leadActions,
      conversations: insights.conversations,
      orders: crmOrders.length,
      revenue,
      campaigns: insights.campaigns.length,
      supersededManualMetrics: supersededMetrics.length,
      syncedAt: now.toISOString(),
    };
  });
}
