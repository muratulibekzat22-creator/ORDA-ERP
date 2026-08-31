import {
  DocumentType,
  LeadStage,
  MarketingAttributionStatus,
  MarketingCampaignStatus,
  MarketingInquiryStatus,
  MarketingSpendStatus,
  MarketingVerificationStatus,
  Prisma,
  Role,
} from "@prisma/client";

import { compareRequestHash, createRequestHash } from "@/lib/idempotency";
import { normalizeLeadSource, normalizePhone } from "@/lib/leads/domain";
import {
  CONTACT_CHANNEL_PRESETS,
  MARKETING_SOURCE_PRESETS,
  conversionRate,
  marketingKpis,
  marketingMetricDedupeKey,
} from "@/lib/marketing/domain";
import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";

export type MarketingActor = { userId: number; name: string; role: Role };

export class MarketingError extends Error {
  constructor(public code: "INVALID" | "NOT_FOUND" | "FORBIDDEN" | "DUPLICATE_PHONE" | "IDEMPOTENCY_CONFLICT" | "INVALID_STATE" | "CATEGORY_NOT_FOUND", public details?: unknown) {
    super(code);
  }
}

const text = (value: unknown, required = false) =>
  typeof value === "string" && (!required || value.trim()) ? value.trim() : null;
const integer = (value: unknown, fallback = 0) => {
  const result = Number(value ?? fallback);
  return Number.isInteger(result) && result >= 0 ? result : null;
};
const money = (value: unknown) => {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
};
const date = (value: unknown) => {
  const result = new Date(String(value ?? ""));
  return Number.isFinite(result.getTime()) ? result : null;
};
const optionalId = (value: unknown) => {
  if (value === undefined || value === null || value === "") return null;
  const result = Number(value);
  return Number.isInteger(result) && result > 0 ? result : NaN;
};
const asNumber = (value: Prisma.Decimal | number | string | null | undefined) => Number(value ?? 0);

function assertMarketingActor(actor: MarketingActor) {
  if (actor.role !== Role.DIRECTOR && actor.role !== Role.OPERATIONS_DIRECTOR && actor.role !== Role.MARKETER) throw new MarketingError("FORBIDDEN");
}

export async function ensureMarketingCatalogs() {
  await Promise.all([
    prisma.marketingSource.createMany({
      data: MARKETING_SOURCE_PRESETS.map(([code, name, platform, isPaid]) => ({ code, name, platform, isPaid, system: true })),
      skipDuplicates: true,
    }),
    prisma.marketingContactChannel.createMany({
      data: CONTACT_CHANNEL_PRESETS.map(([code, name]) => ({ code, name, system: true })),
      skipDuplicates: true,
    }),
  ]);
}

export async function getMarketingWorkspace(actor: MarketingActor, filters: { from: Date; to: Date; search?: string }) {
  assertMarketingActor(actor);
  await ensureMarketingCatalogs();
  const range = { gte: filters.from, lt: filters.to };
  const search = filters.search?.trim();
  const [sources, channels, campaigns, inquiries, attributions, metrics, spends, budgets, managers, marketingUsers, categories] = await Promise.all([
    prisma.marketingSource.findMany({ where: { active: true }, orderBy: [{ system: "desc" }, { name: "asc" }] }),
    prisma.marketingContactChannel.findMany({ where: { active: true }, orderBy: [{ system: "desc" }, { name: "asc" }] }),
    prisma.marketingCampaign.findMany({
      include: { source: { select: { id: true, name: true } }, responsible: { select: { id: true, name: true } }, adSets: { orderBy: { name: "asc" } }, ads: { orderBy: { name: "asc" } }, creatives: { orderBy: { name: "asc" } } },
      orderBy: { startsAt: "desc" },
    }),
    prisma.marketingInquiry.findMany({
      where: {
        receivedAt: range,
        ...(search ? { OR: [
          { name: { contains: search, mode: "insensitive" } }, { phone: { contains: search } },
          { normalizedPhone: { contains: search.replace(/\D/g, "") } }, { instagramUsername: { contains: search, mode: "insensitive" } },
          { externalLeadId: { contains: search, mode: "insensitive" } }, { city: { contains: search, mode: "insensitive" } },
          { campaign: { name: { contains: search, mode: "insensitive" } } },
        ] } : {}),
      },
      include: {
        source: { select: { id: true, name: true } }, channel: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } }, adSet: { select: { id: true, name: true } }, ad: { select: { id: true, name: true } },
        assignedManager: { select: { id: true, name: true } }, application: { select: { id: true, name: true } },
      },
      orderBy: { receivedAt: "desc" }, take: 500,
    }),
    prisma.leadAttribution.findMany({
      where: { firstContactAt: range },
      include: {
        source: { select: { id: true, name: true } }, primarySource: { select: { id: true, name: true } },
        firstTouchSource: { select: { id: true, name: true } }, lastTouchSource: { select: { id: true, name: true } },
        channel: { select: { id: true, name: true } }, campaign: { select: { id: true, name: true } },
        application: {
          select: {
            id: true, name: true, phone: true, city: true, stage: true, managerUserId: true,
            managerUser: { select: { id: true, name: true } },
            measurements: { select: { id: true, status: true } },
            commercialProposals: { select: { id: true, status: true } },
            documents: { where: { type: DocumentType.CONTRACT }, select: { id: true } },
            leadConversion: { select: { order: { select: { id: true, amount: true, companyProfit: true, lifecycle: true, payments: { select: { id: true, amount: true, reversalOfId: true } } } } } },
          },
        },
      },
      orderBy: { firstContactAt: "desc" },
    }),
    prisma.marketingMetric.findMany({ where: { metricDate: range }, orderBy: { metricDate: "desc" } }),
    prisma.marketingSpend.findMany({
      where: { spendDate: range },
      include: { campaign: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } }, reviewedBy: { select: { id: true, name: true } }, financeEntry: { select: { id: true, category: true, method: true, voidedAt: true } } },
      orderBy: { spendDate: "desc" },
    }),
    prisma.marketingBudget.findMany({ where: { month: range }, include: { source: { select: { id: true, name: true } }, campaign: { select: { id: true, name: true } } }, orderBy: { month: "desc" } }),
    prisma.user.findMany({ where: { active: true, role: { in: [Role.MANAGER, Role.DIRECTOR] } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { active: true, role: { in: [Role.MARKETER, Role.DIRECTOR] } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
    actor.role === Role.DIRECTOR ? prisma.financeCategory.findMany({ where: { active: true, direction: "EXPENSE" }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);

  const confirmedSpends = spends.filter((item) => item.status === MarketingSpendStatus.APPROVED || item.status === MarketingSpendStatus.RECONCILED);
  const confirmedSpend = confirmedSpends.reduce((sum, item) => sum + asNumber(item.amount), 0);
  const claimedSpend = spends.reduce((sum, item) => sum + asNumber(item.amount), 0);
  const rejectedSpend = spends.filter((item) => item.status === MarketingSpendStatus.REJECTED).reduce((sum, item) => sum + asNumber(item.amount), 0);
  const unreconciledSpend = spends.filter((item) => item.status === MarketingSpendStatus.APPROVED).reduce((sum, item) => sum + asNumber(item.amount), 0);
  const metricTotals = metrics.reduce((sum, item) => ({
    impressions: sum.impressions + item.impressions, clicks: sum.clicks + item.clicks,
    messages: sum.messages + item.messages, platformLeads: sum.platformLeads + item.platformLeads,
  }), { impressions: 0, clicks: 0, messages: 0, platformLeads: 0 });
  const uniquePeople = new Set(inquiries.map((item) => item.normalizedPhone)).size;
  const repeatedInquiries = Math.max(0, inquiries.length - uniquePeople);
  const completedMeasurements = attributions.reduce((sum, item) => sum + item.application.measurements.filter((measurement) => measurement.status === "COMPLETED" || measurement.status === "HANDED_TO_MANAGER").length, 0);
  const scheduledMeasurements = attributions.reduce((sum, item) => sum + item.application.measurements.filter((measurement) => measurement.status !== "CANCELLED").length, 0);
  const proposals = attributions.reduce((sum, item) => sum + item.application.commercialProposals.length, 0);
  const contracts = attributions.reduce((sum, item) => sum + item.application.documents.length, 0);
  const won = attributions.filter((item) => item.application.leadConversion?.order);
  const orders = won.length;
  const completedOrders = won.filter((item) => item.application.leadConversion?.order.lifecycle === "COMPLETED").length;
  const soldAmount = won.reduce((sum, item) => sum + asNumber(item.application.leadConversion?.order.amount), 0);
  const grossProfit = won.reduce((sum, item) => sum + asNumber(item.application.leadConversion?.order.companyProfit), 0);
  const paidAmount = won.reduce((sum, item) => sum + (item.application.leadConversion?.order.payments ?? []).filter((payment) => !payment.reversalOfId).reduce((paymentSum, payment) => paymentSum + asNumber(payment.amount), 0), 0);
  const payingClients = won.filter((item) => (item.application.leadConversion?.order.payments ?? []).some((payment) => !payment.reversalOfId && asNumber(payment.amount) > 0)).length;
  const applications = attributions.length;
  const qualified = attributions.filter((item) => item.application.stage !== LeadStage.NEW && item.application.stage !== LeadStage.LOST).length;
  const kpis = marketingKpis({ confirmedSpend, clicks: metricTotals.clicks, applications, completedMeasurements, orders, payingClients, soldAmount, grossProfit });
  const funnelValues = [
    ["Показы", metricTotals.impressions], ["Клики", metricTotals.clicks], ["Входящие сообщения", metricTotals.messages],
    ["Уникальные обращения", uniquePeople], ["Заявки", applications], ["Квалифицированные заявки", qualified],
    ["Назначенные замеры", scheduledMeasurements], ["Выполненные замеры", completedMeasurements], ["Коммерческие предложения", proposals],
    ["Договоры", contracts], ["Заказы", orders], ["Клиенты с оплатой", payingClients], ["Завершённые заказы", completedOrders],
  ] as const;
  const funnel = funnelValues.map(([label, value], index) => ({ label, value, conversion: index ? conversionRate(value, funnelValues[index - 1][1]) : 100 }));

  const performance = campaigns.map((campaign) => {
    const campaignMetrics = metrics.filter((metric) => metric.campaignId === campaign.id);
    const campaignAttributions = attributions.filter((item) => item.campaignId === campaign.id);
    const campaignSpend = confirmedSpends.filter((spend) => spend.campaignId === campaign.id).reduce((sum, spend) => sum + asNumber(spend.amount), 0);
    const campaignOrders = campaignAttributions.filter((item) => item.application.leadConversion?.order);
    const campaignSold = campaignOrders.reduce((sum, item) => sum + asNumber(item.application.leadConversion?.order.amount), 0);
    const clicks = campaignMetrics.reduce((sum, metric) => sum + metric.clicks, 0);
    const platformLeads = campaignMetrics.reduce((sum, metric) => sum + metric.platformLeads, 0);
    return { id: campaign.id, name: campaign.name, platform: campaign.platform, spend: campaignSpend, clicks, platformLeads, applications: campaignAttributions.length, orders: campaignOrders.length, cpc: campaignSpend / Math.max(clicks, 1), cpl: campaignSpend / Math.max(campaignAttributions.length, 1), roas: campaignSold / Math.max(campaignSpend, 1) };
  });

  const internalRead = actor.role === Role.DIRECTOR || actor.role === Role.OPERATIONS_DIRECTOR;
  const directorMetrics = internalRead ? { soldAmount, paidAmount, grossProfit, romi: kpis.romi, roas: kpis.roas } : null;
  const publicKpis = internalRead ? kpis : { ...kpis, romi: 0 };
  const publicAttributions = internalRead ? attributions : attributions.map((item) => ({
    ...item,
    application: {
      ...item.application,
      leadConversion: item.application.leadConversion ? {
        order: {
          id: item.application.leadConversion.order.id,
          lifecycle: item.application.leadConversion.order.lifecycle,
        },
      } : null,
    },
  }));
  return {
    role: actor.role,
    period: { from: filters.from, to: filters.to },
    overview: {
      claimedSpend, confirmedSpend, rejectedSpend, unreconciledSpend,
      inquiries: inquiries.length, uniquePeople, repeatedInquiries,
      duplicates: inquiries.filter((item) => item.isDuplicate).length,
      applications, orders, completedMeasurements, payingClients,
      platformLeads: metricTotals.platformLeads, platformLeadDifference: metricTotals.platformLeads - applications,
      clicks: metricTotals.clicks, impressions: metricTotals.impressions, ...publicKpis,
      director: directorMetrics,
    },
    funnel, performance, sources, channels, campaigns, inquiries, attributions: publicAttributions,
    metrics, spends, budgets, managers, marketingUsers, categories,
  };
}

export async function createMarketingCatalog(input: Record<string, unknown>, actor: MarketingActor) {
  assertMarketingActor(actor);
  const kind = input.kind;
  const name = text(input.name, true), code = text(input.code, true)?.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (!name || !code) throw new MarketingError("INVALID");
  if (kind === "source") return prisma.marketingSource.create({ data: { name, code, platform: text(input.platform) ?? "OTHER", isPaid: input.isPaid === true } });
  if (kind === "channel") return prisma.marketingContactChannel.create({ data: { name, code } });
  throw new MarketingError("INVALID");
}

export async function createMarketingCampaign(input: Record<string, unknown>, actor: MarketingActor) {
  assertMarketingActor(actor);
  const name = text(input.name, true), platform = text(input.platform, true), startsAt = date(input.startsAt);
  const plannedBudget = money(input.plannedBudget ?? 0), dailyBudget = money(input.dailyBudget ?? 0);
  const sourceId = optionalId(input.sourceId), responsibleId = optionalId(input.responsibleId), endsAt = input.endsAt ? date(input.endsAt) : null;
  const status = Object.values(MarketingCampaignStatus).includes(input.status as MarketingCampaignStatus) ? input.status as MarketingCampaignStatus : MarketingCampaignStatus.DRAFT;
  if (!name || !platform || !startsAt || plannedBudget === null || dailyBudget === null || Number.isNaN(sourceId) || Number.isNaN(responsibleId) || (input.endsAt && !endsAt)) throw new MarketingError("INVALID");
  const [source, responsible] = await Promise.all([
    sourceId ? prisma.marketingSource.findUnique({ where: { id: sourceId }, select: { id: true } }) : null,
    responsibleId ? prisma.user.findUnique({ where: { id: responsibleId }, select: { id: true, active: true, role: true } }) : null,
  ]);
  if ((sourceId && !source) || (responsibleId && (!responsible?.active || (responsible.role !== Role.MARKETER && responsible.role !== Role.DIRECTOR)))) throw new MarketingError("INVALID");
  return prisma.marketingCampaign.create({ data: {
    name, platform, startsAt, endsAt, plannedBudget, dailyBudget, status,
    sourceId, responsibleId, advertisingAccount: text(input.advertisingAccount), objective: text(input.objective),
    region: text(input.region), audience: text(input.audience), utmSource: text(input.utmSource), utmMedium: text(input.utmMedium),
    utmCampaign: text(input.utmCampaign), comment: text(input.comment), externalId: text(input.externalId),
  } });
}

export async function createCampaignLevel(input: Record<string, unknown>, actor: MarketingActor) {
  assertMarketingActor(actor);
  const level = text(input.level, true), name = text(input.name, true), campaignId = optionalId(input.campaignId);
  if (!level || !name || !campaignId || Number.isNaN(campaignId)) throw new MarketingError("INVALID");
  const campaign = await prisma.marketingCampaign.findUnique({ where: { id: campaignId }, select: { id: true } });
  if (!campaign) throw new MarketingError("NOT_FOUND");
  if (level === "adSet") return prisma.marketingAdSet.create({ data: { campaignId, name, externalId: text(input.externalId), audience: text(input.audience) } });
  if (level === "ad") {
    const adSetId = optionalId(input.adSetId); if (Number.isNaN(adSetId)) throw new MarketingError("INVALID");
    if (adSetId && !await prisma.marketingAdSet.findFirst({ where: { id: adSetId, campaignId }, select: { id: true } })) throw new MarketingError("INVALID");
    return prisma.marketingAd.create({ data: { campaignId, adSetId, name, externalId: text(input.externalId) } });
  }
  if (level === "creative") {
    const adId = optionalId(input.adId); if (Number.isNaN(adId)) throw new MarketingError("INVALID");
    if (adId && !await prisma.marketingAd.findFirst({ where: { id: adId, campaignId }, select: { id: true } })) throw new MarketingError("INVALID");
    return prisma.marketingCreative.create({ data: { campaignId, adId, name, format: text(input.format), assetUrl: text(input.assetUrl), externalId: text(input.externalId) } });
  }
  throw new MarketingError("INVALID");
}

export async function createMarketingInquiry(input: Record<string, unknown>, actor: MarketingActor) {
  assertMarketingActor(actor);
  const name = text(input.name, true), rawPhone = text(input.phone, true), city = text(input.city, true);
  const normalized = rawPhone ? normalizePhone(rawPhone) : "";
  const sourceId = optionalId(input.sourceId), channelId = optionalId(input.channelId), campaignId = optionalId(input.campaignId), adSetId = optionalId(input.adSetId), adId = optionalId(input.adId), creativeId = optionalId(input.creativeId), assignedManagerId = optionalId(input.assignedManagerId);
  if (!name || !normalized || !city || !sourceId || !channelId || [sourceId, channelId, campaignId, adSetId, adId, creativeId, assignedManagerId].some(Number.isNaN)) throw new MarketingError("INVALID");
  const receivedAt = input.receivedAt ? date(input.receivedAt) : new Date();
  if (!receivedAt) throw new MarketingError("INVALID");
  const [source, channel, campaign, adSet, ad, creative, manager] = await Promise.all([
    prisma.marketingSource.findUnique({ where: { id: sourceId }, select: { id: true } }),
    prisma.marketingContactChannel.findUnique({ where: { id: channelId }, select: { id: true } }),
    campaignId ? prisma.marketingCampaign.findUnique({ where: { id: campaignId }, select: { id: true } }) : null,
    adSetId ? prisma.marketingAdSet.findFirst({ where: { id: adSetId, ...(campaignId ? { campaignId } : {}) }, select: { id: true } }) : null,
    adId ? prisma.marketingAd.findFirst({ where: { id: adId, ...(campaignId ? { campaignId } : {}) }, select: { id: true } }) : null,
    creativeId ? prisma.marketingCreative.findFirst({ where: { id: creativeId, ...(campaignId ? { campaignId } : {}) }, select: { id: true } }) : null,
    assignedManagerId ? prisma.user.findFirst({ where: { id: assignedManagerId, active: true, role: { in: [Role.MANAGER, Role.DIRECTOR] } }, select: { id: true } }) : null,
  ]);
  if (!source || !channel || (campaignId && !campaign) || (adSetId && !adSet) || (adId && !ad) || (creativeId && !creative) || (assignedManagerId && !manager)) throw new MarketingError("INVALID");
  return prisma.marketingInquiry.create({ data: {
    name, phone: rawPhone!, normalizedPhone: normalized, city, sourceId, channelId, campaignId, adSetId, adId, creativeId,
    additionalPhone: text(input.additionalPhone), instagramUsername: text(input.instagramUsername), message: text(input.message),
    externalLeadId: text(input.externalLeadId), platformConversationId: text(input.platformConversationId), assignedManagerId,
    receivedAt, createdById: actor.userId,
  } });
}

async function validManager(tx: Prisma.TransactionClient, managerId: number) {
  const manager = await tx.user.findFirst({ where: { id: managerId, active: true, role: { in: [Role.MANAGER, Role.DIRECTOR] } }, select: { id: true, name: true } });
  if (!manager) throw new MarketingError("INVALID");
  return manager;
}

export async function convertInquiryToApplication(inquiryId: number, input: Record<string, unknown>, actor: MarketingActor) {
  assertMarketingActor(actor);
  return prisma.$transaction(async (tx) => {
    const inquiry = await tx.marketingInquiry.findUnique({ where: { id: inquiryId }, include: { source: true } });
    if (!inquiry) throw new MarketingError("NOT_FOUND");
    if (inquiry.applicationId) throw new MarketingError("INVALID_STATE");
    const duplicate = await tx.client.findFirst({ where: { active: true, deletedAt: null, OR: [{ phone: inquiry.normalizedPhone }, { whatsapp: inquiry.normalizedPhone }] }, select: { id: true, name: true, phone: true, stage: true } });
    if (duplicate && input.allowDuplicate !== true) throw new MarketingError("DUPLICATE_PHONE", duplicate);
    const managerId = Number(input.managerUserId ?? inquiry.assignedManagerId);
    if (!Number.isInteger(managerId) || managerId <= 0) throw new MarketingError("INVALID");
    const manager = await validManager(tx, managerId);
    const estimatedAmount = money(input.estimatedAmount ?? 0);
    if (estimatedAmount === null) throw new MarketingError("INVALID");
    const notes = [text(input.productInterest), text(input.description) ?? inquiry.message, text(input.comment)].filter(Boolean).join(" · ");
    const additional = text(input.additionalPhone) ?? inquiry.additionalPhone;
    const normalizedAdditional = additional ? normalizePhone(additional) : "";
    const application = await tx.client.create({ data: {
      name: inquiry.name, phone: inquiry.normalizedPhone, whatsapp: normalizedAdditional || inquiry.normalizedPhone, city: inquiry.city,
      address: "", iin: "", manager: manager.name, managerUserId: manager.id, amount: String(estimatedAmount), estimatedAmount,
      estimateNotes: notes, source: inquiry.source.name, sourceCode: normalizeLeadSource(inquiry.source.name), comment: notes,
      stage: LeadStage.NEW, status: LeadStage.NEW,
    } });
    await tx.leadStatusHistory.create({ data: { clientId: application.id, toStatus: LeadStage.NEW, toStage: LeadStage.NEW, authorId: actor.userId, authorName: actor.name, comment: "Заявка создана маркетологом из входящего обращения" } });
    await tx.leadAttribution.create({ data: {
      applicationId: application.id, sourceId: inquiry.sourceId, channelId: inquiry.channelId, campaignId: inquiry.campaignId,
      adSetId: inquiry.adSetId, adId: inquiry.adId, creativeId: inquiry.creativeId, firstTouchSourceId: inquiry.sourceId,
      lastTouchSourceId: inquiry.sourceId, primarySourceId: inquiry.sourceId, externalLeadId: inquiry.externalLeadId,
      platformConversationId: inquiry.platformConversationId, firstContactAt: inquiry.receivedAt, attributedById: actor.userId,
      attributionStatus: MarketingAttributionStatus.AUTOMATIC, verificationStatus: MarketingVerificationStatus.UNVERIFIED,
      utmSource: text(input.utmSource), utmMedium: text(input.utmMedium), utmCampaign: text(input.utmCampaign),
      utmContent: text(input.utmContent), utmTerm: text(input.utmTerm), fbclid: text(input.fbclid), gclid: text(input.gclid),
      ttclid: text(input.ttclid), referrer: text(input.referrer), landingPage: text(input.landingPage),
    } });
    await tx.marketingTouch.create({ data: { applicationId: application.id, sourceId: inquiry.sourceId, channelId: inquiry.channelId, campaignId: inquiry.campaignId, adSetId: inquiry.adSetId, adId: inquiry.adId, creativeId: inquiry.creativeId, occurredAt: inquiry.receivedAt, note: inquiry.message, createdById: actor.userId } });
    await tx.marketingInquiry.update({ where: { id: inquiry.id }, data: { applicationId: application.id, assignedManagerId: manager.id, status: MarketingInquiryStatus.CONVERTED } });
    await tx.marketingAuditLog.create({ data: { action: "APPLICATION_CREATED", entityType: "Client", entityId: application.id, actorId: actor.userId, after: { inquiryId: inquiry.id, sourceId: inquiry.sourceId, managerId: manager.id } } });
    return application;
  });
}

export async function updateInquiry(inquiryId: number, input: Record<string, unknown>, actor: MarketingActor) {
  assertMarketingActor(actor);
  const action = text(input.action, true);
  return prisma.$transaction(async (tx) => {
    const inquiry = await tx.marketingInquiry.findUnique({ where: { id: inquiryId } });
    if (!inquiry) throw new MarketingError("NOT_FOUND");
    if (action === "assign") {
      const managerId = Number(input.managerId); const manager = await validManager(tx, managerId);
      const updated = await tx.marketingInquiry.update({ where: { id: inquiry.id }, data: { assignedManagerId: manager.id, status: MarketingInquiryStatus.IN_PROGRESS } });
      await tx.marketingAuditLog.create({ data: { action: "INQUIRY_ASSIGNED", entityType: "MarketingInquiry", entityId: inquiry.id, actorId: actor.userId, before: { managerId: inquiry.assignedManagerId }, after: { managerId: manager.id } } });
      return updated;
    }
    if (action === "duplicate") return tx.marketingInquiry.update({ where: { id: inquiry.id }, data: { isDuplicate: true, status: MarketingInquiryStatus.DUPLICATE } });
    if (action === "responded") {
      const firstResponseAt = inquiry.firstResponseAt ?? new Date();
      const updated = await tx.marketingInquiry.update({ where: { id: inquiry.id }, data: { firstResponseAt, status: inquiry.status === MarketingInquiryStatus.NEW ? MarketingInquiryStatus.IN_PROGRESS : inquiry.status } });
      await tx.marketingAuditLog.create({ data: { action: "FIRST_RESPONSE_RECORDED", entityType: "MarketingInquiry", entityId: inquiry.id, actorId: actor.userId, after: { firstResponseAt } } });
      return updated;
    }
    if (action === "link") {
      const applicationId = Number(input.applicationId);
      const application = await tx.client.findFirst({ where: { id: applicationId, active: true, deletedAt: null }, select: { id: true } });
      if (!application) throw new MarketingError("NOT_FOUND");
      await tx.leadAttribution.upsert({ where: { applicationId }, create: {
        applicationId, sourceId: inquiry.sourceId, channelId: inquiry.channelId, campaignId: inquiry.campaignId, adSetId: inquiry.adSetId, adId: inquiry.adId, creativeId: inquiry.creativeId,
        firstTouchSourceId: inquiry.sourceId, lastTouchSourceId: inquiry.sourceId, primarySourceId: inquiry.sourceId, firstContactAt: inquiry.receivedAt, attributedById: actor.userId,
      }, update: { lastTouchSourceId: inquiry.sourceId, channelId: inquiry.channelId, campaignId: inquiry.campaignId, adSetId: inquiry.adSetId, adId: inquiry.adId, creativeId: inquiry.creativeId } });
      await tx.marketingTouch.create({ data: { applicationId, sourceId: inquiry.sourceId, channelId: inquiry.channelId, campaignId: inquiry.campaignId, adSetId: inquiry.adSetId, adId: inquiry.adId, creativeId: inquiry.creativeId, occurredAt: inquiry.receivedAt, note: inquiry.message, createdById: actor.userId } });
      return tx.marketingInquiry.update({ where: { id: inquiry.id }, data: { applicationId, status: MarketingInquiryStatus.LINKED } });
    }
    if (action === "source") {
      const sourceId = Number(input.sourceId), comment = text(input.comment, true);
      if (!Number.isInteger(sourceId) || sourceId <= 0 || !comment) throw new MarketingError("INVALID");
      const source = await tx.marketingSource.findUnique({ where: { id: sourceId }, select: { id: true } }); if (!source) throw new MarketingError("NOT_FOUND");
      const updated = await tx.marketingInquiry.update({ where: { id: inquiry.id }, data: { sourceId, sourceChangeComment: comment } });
      await tx.marketingAuditLog.create({ data: { action: "INQUIRY_SOURCE_CHANGED", entityType: "MarketingInquiry", entityId: inquiry.id, actorId: actor.userId, before: { sourceId: inquiry.sourceId }, after: { sourceId }, comment } });
      return updated;
    }
    throw new MarketingError("INVALID");
  });
}

type MetricRow = Record<string, unknown>;
function parseMetricRow(row: MetricRow, companyId: number, importKey: string, actorId: number, inputMethod: string) {
  const metricDate = date(row.metricDate ?? row.date), periodEnd = row.periodEnd ? date(row.periodEnd) : null;
  const campaignId = optionalId(row.campaignId), adSetId = optionalId(row.adSetId), adId = optionalId(row.adId);
  const numericKeys = ["reportedSpend", "impressions", "reach", "clicks", "linkClicks", "messages", "platformLeads", "videoViews", "saves", "comments"] as const;
  const values = Object.fromEntries(numericKeys.map((key) => [key, key === "reportedSpend" ? money(row[key] ?? 0) : integer(row[key] ?? 0)]));
  if (!metricDate || !campaignId || Number.isNaN(adSetId) || Number.isNaN(adId) || Object.values(values).some((value) => value === null)) throw new MarketingError("INVALID");
  return {
    metricDate, periodEnd, platform: text(row.platform, true) ?? "OTHER", campaignId, adSetId, adId,
    ...values, externalReport: text(row.externalReport), importKey,
    dedupeKey: marketingMetricDedupeKey({ companyId, campaignId, adSetId, adId, metricDate, importKey }), inputMethod, createdById: actorId,
  } as Prisma.MarketingMetricCreateManyInput;
}

export async function importMarketingMetrics(rows: MetricRow[], importKey: string, actor: MarketingActor, inputMethod = "CSV") {
  assertMarketingActor(actor);
  if (!importKey || !Array.isArray(rows) || rows.length < 1 || rows.length > 2000) throw new MarketingError("INVALID");
  const companyId = requireTenantIdentity().companyId;
  const auditKey = `metric-import:${companyId}:${importKey}`;
  const payloadHash = createRequestHash(rows);
  const replay = await prisma.marketingAuditLog.findUnique({ where: { idempotencyKey: auditKey }, select: { after: true } });
  if (replay) {
    const after = replay.after && typeof replay.after === "object" && !Array.isArray(replay.after) ? replay.after as Record<string, unknown> : {};
    if (after.requestHash !== payloadHash) throw new MarketingError("IDEMPOTENCY_CONFLICT");
    return { received: Number(after.received ?? rows.length), created: Number(after.created ?? 0), duplicates: Number(after.duplicates ?? 0), errors: Array.isArray(after.errors) ? after.errors : [], replay: true };
  }
  const valid: Prisma.MarketingMetricCreateManyInput[] = [], errors: Array<{ row: number; error: string }> = [];
  rows.forEach((row, index) => { try { valid.push(parseMetricRow(row, companyId, importKey, actor.userId, inputMethod)); } catch { errors.push({ row: index + 1, error: "Проверьте дату, кампанию и числовые показатели" }); } });
  const [campaigns, adSets, ads] = await Promise.all([
    prisma.marketingCampaign.findMany({ where: { id: { in: [...new Set(valid.map((row) => row.campaignId))] } }, select: { id: true } }),
    prisma.marketingAdSet.findMany({ where: { id: { in: [...new Set(valid.map((row) => row.adSetId).filter((id): id is number => Boolean(id)))] } }, select: { id: true, campaignId: true } }),
    prisma.marketingAd.findMany({ where: { id: { in: [...new Set(valid.map((row) => row.adId).filter((id): id is number => Boolean(id)))] } }, select: { id: true, campaignId: true } }),
  ]);
  const campaignIds = new Set(campaigns.map((item) => item.id));
  const adSetCampaign = new Map(adSets.map((item) => [item.id, item.campaignId]));
  const adCampaign = new Map(ads.map((item) => [item.id, item.campaignId]));
  const scoped = valid.filter((row, index) => {
    const validRelations = campaignIds.has(row.campaignId) && (!row.adSetId || adSetCampaign.get(row.adSetId) === row.campaignId) && (!row.adId || adCampaign.get(row.adId) === row.campaignId);
    if (!validRelations) errors.push({ row: index + 1, error: "Кампания, группа или объявление не найдены в текущей компании" });
    return validRelations;
  });
  const keys = scoped.map((row) => row.dedupeKey);
  const existing = new Set((await prisma.marketingMetric.findMany({ where: { dedupeKey: { in: keys } }, select: { dedupeKey: true } })).map((row) => row.dedupeKey));
  const fresh = scoped.filter((row) => !existing.has(row.dedupeKey));
  await prisma.$transaction(async (tx) => {
    if (fresh.length) await tx.marketingMetric.createMany({ data: fresh, skipDuplicates: true });
    await tx.marketingAuditLog.create({ data: { action: inputMethod === "CSV" ? "METRICS_CSV_IMPORTED" : "METRIC_CREATED", entityType: "MarketingMetric", actorId: actor.userId, after: { requestHash: payloadHash, received: rows.length, created: fresh.length, duplicates: scoped.length - fresh.length, errors }, idempotencyKey: auditKey } });
  });
  return { received: rows.length, created: fresh.length, duplicates: scoped.length - fresh.length, errors };
}

export async function createMarketingSpend(input: Record<string, unknown>, idempotencyKey: string, requestHash: string, actor: MarketingActor) {
  assertMarketingActor(actor);
  const replay = await prisma.marketingSpend.findUnique({ where: { idempotencyKey } });
  if (replay) { if (!compareRequestHash(replay.requestHash, requestHash)) throw new MarketingError("IDEMPOTENCY_CONFLICT"); return { spend: replay, created: false }; }
  const spendDate = date(input.spendDate), amount = money(input.amount), campaignId = optionalId(input.campaignId), adSetId = optionalId(input.adSetId), adId = optionalId(input.adId), platform = text(input.platform, true);
  if (!spendDate || amount === null || amount <= 0 || !platform || [campaignId, adSetId, adId].some(Number.isNaN)) throw new MarketingError("INVALID");
  const [campaign, adSet, ad] = await Promise.all([
    campaignId ? prisma.marketingCampaign.findUnique({ where: { id: campaignId }, select: { id: true } }) : null,
    adSetId ? prisma.marketingAdSet.findFirst({ where: { id: adSetId, ...(campaignId ? { campaignId } : {}) }, select: { id: true } }) : null,
    adId ? prisma.marketingAd.findFirst({ where: { id: adId, ...(campaignId ? { campaignId } : {}) }, select: { id: true } }) : null,
  ]);
  if ((campaignId && !campaign) || (adSetId && !adSet) || (adId && !ad)) throw new MarketingError("INVALID");
  const spend = await prisma.marketingSpend.create({ data: { spendDate, amount, platform, campaignId, adSetId, adId, evidenceUrl: text(input.evidenceUrl), comment: text(input.comment), createdById: actor.userId, idempotencyKey, requestHash } });
  return { spend, created: true };
}

export async function reviewMarketingSpend(spendId: number, input: Record<string, unknown>, idempotencyKey: string, requestHash: string, actor: MarketingActor) {
  if (actor.role !== Role.DIRECTOR && actor.role !== Role.MARKETER && actor.role !== Role.ACCOUNTANT) throw new MarketingError("FORBIDDEN");
  const action = text(input.action, true);
  return prisma.$transaction(async (tx) => {
    const spend = await tx.marketingSpend.findUnique({ where: { id: spendId } }); if (!spend) throw new MarketingError("NOT_FOUND");
    if (action === "submit") {
      if (actor.role === Role.ACCOUNTANT) throw new MarketingError("FORBIDDEN");
      if (spend.status !== MarketingSpendStatus.DRAFT && spend.status !== MarketingSpendStatus.REJECTED) throw new MarketingError("INVALID_STATE");
      return tx.marketingSpend.update({ where: { id: spend.id }, data: { status: MarketingSpendStatus.SUBMITTED, submittedAt: new Date(), reviewComment: null } });
    }
    if (actor.role !== Role.DIRECTOR && actor.role !== Role.ACCOUNTANT) throw new MarketingError("FORBIDDEN");
    if (action === "reject") {
      const comment = text(input.comment, true); if (!comment || spend.status !== MarketingSpendStatus.SUBMITTED) throw new MarketingError("INVALID_STATE");
      const updated = await tx.marketingSpend.update({ where: { id: spend.id }, data: { status: MarketingSpendStatus.REJECTED, reviewedById: actor.userId, reviewedAt: new Date(), reviewComment: comment } });
      await tx.marketingAuditLog.create({ data: { action: "SPEND_REJECTED", entityType: "MarketingSpend", entityId: spend.id, actorId: actor.userId, comment, idempotencyKey: `marketing-review:${idempotencyKey}` } });
      return updated;
    }
    if (action === "reconcile") {
      if (spend.status !== MarketingSpendStatus.APPROVED || !spend.financeEntryId) throw new MarketingError("INVALID_STATE");
      const updated = await tx.marketingSpend.update({ where: { id: spend.id }, data: { status: MarketingSpendStatus.RECONCILED, reviewedById: actor.userId, reviewedAt: new Date(), reviewComment: text(input.comment) } });
      await tx.marketingAuditLog.create({ data: { action: "SPEND_RECONCILED", entityType: "MarketingSpend", entityId: spend.id, actorId: actor.userId, comment: text(input.comment), idempotencyKey: `marketing-review:${idempotencyKey}` } });
      return updated;
    }
    if (action === "reverse") {
      const comment = text(input.comment, true);
      if (!comment || !spend.financeEntryId || (spend.status !== MarketingSpendStatus.APPROVED && spend.status !== MarketingSpendStatus.RECONCILED)) throw new MarketingError("INVALID_STATE");
      const voidedAt = new Date();
      await tx.companyLedgerEntry.update({ where: { id: spend.financeEntryId }, data: { voidedAt, voidReason: comment } });
      const updated = await tx.marketingSpend.update({ where: { id: spend.id }, data: { status: MarketingSpendStatus.REVERSED, reviewedById: actor.userId, reviewedAt: voidedAt, reviewComment: comment } });
      await tx.financeAuditEvent.create({ data: { action: "MARKETING_SPEND_REVERSED", entityType: "CompanyLedgerEntry", entityId: spend.financeEntryId, after: { marketingSpendId: spend.id, voidedAt }, reason: comment, authorId: actor.userId } });
      await tx.marketingAuditLog.create({ data: { action: "SPEND_REVERSED", entityType: "MarketingSpend", entityId: spend.id, actorId: actor.userId, comment, idempotencyKey: `marketing-review:${idempotencyKey}` } });
      return updated;
    }
    if (action !== "approve" || spend.status !== MarketingSpendStatus.SUBMITTED) throw new MarketingError("INVALID_STATE");
    const categoryId = Number(input.categoryId), paymentAccount = text(input.paymentAccount, true);
    if (!Number.isInteger(categoryId) || categoryId <= 0 || !paymentAccount) throw new MarketingError("INVALID");
    const category = await tx.financeCategory.findFirst({ where: { id: categoryId, active: true, direction: "EXPENSE" } }); if (!category) throw new MarketingError("CATEGORY_NOT_FOUND");
    const ledgerKey = `marketing-spend:${spend.id}`;
    let entry = await tx.companyLedgerEntry.findUnique({ where: { idempotencyKey: ledgerKey } });
    if (entry && !compareRequestHash(entry.requestHash, requestHash)) throw new MarketingError("IDEMPOTENCY_CONFLICT");
    if (!entry) entry = await tx.companyLedgerEntry.create({ data: {
      type: "MARKETING_EXPENSE", category: category.code, categoryId: category.id, direction: "EXPENSE", source: "MARKETING",
      amount: spend.amount, operationDate: spend.spendDate, method: paymentAccount, comment: spend.comment, authorId: actor.userId,
      idempotencyKey: ledgerKey, requestHash,
    } });
    const updated = await tx.marketingSpend.update({ where: { id: spend.id }, data: { status: MarketingSpendStatus.APPROVED, financeCategoryId: category.id, paymentAccount, financeEntryId: entry.id, reviewedById: actor.userId, reviewedAt: new Date(), reviewComment: text(input.comment) } });
    await tx.financeAuditEvent.create({ data: { action: "MARKETING_SPEND_APPROVED", entityType: "CompanyLedgerEntry", entityId: entry.id, after: { marketingSpendId: spend.id, amount: String(spend.amount), categoryId }, reason: text(input.comment) ?? "Подтверждение рекламного расхода", authorId: actor.userId } });
    await tx.marketingAuditLog.create({ data: { action: "SPEND_APPROVED", entityType: "MarketingSpend", entityId: spend.id, actorId: actor.userId, after: { financeEntryId: entry.id, categoryId, paymentAccount }, idempotencyKey: `marketing-review:${idempotencyKey}` } });
    return updated;
  });
}

export async function updatePrimaryAttribution(applicationId: number, input: Record<string, unknown>, actor: MarketingActor) {
  assertMarketingActor(actor);
  const primarySourceId = Number(input.primarySourceId), comment = text(input.comment, true);
  if (!Number.isInteger(primarySourceId) || primarySourceId <= 0 || !comment) throw new MarketingError("INVALID");
  return prisma.$transaction(async (tx) => {
    const current = await tx.leadAttribution.findUnique({ where: { applicationId } }); if (!current) throw new MarketingError("NOT_FOUND");
    const source = await tx.marketingSource.findUnique({ where: { id: primarySourceId }, select: { id: true } }); if (!source) throw new MarketingError("NOT_FOUND");
    const updated = await tx.leadAttribution.update({ where: { applicationId }, data: { primarySourceId, sourceId: primarySourceId, attributedById: actor.userId, attributionStatus: MarketingAttributionStatus.MANUAL, verificationStatus: MarketingVerificationStatus.VERIFIED } });
    await tx.marketingTouch.create({ data: { applicationId, sourceId: primarySourceId, channelId: current.channelId, occurredAt: new Date(), note: `Основной источник изменён: ${comment}`, createdById: actor.userId } });
    await tx.marketingAuditLog.create({ data: { action: "PRIMARY_ATTRIBUTION_CHANGED", entityType: "LeadAttribution", entityId: current.id, actorId: actor.userId, before: { primarySourceId: current.primarySourceId }, after: { primarySourceId }, comment } });
    return updated;
  });
}

export async function saveMarketingBudget(input: Record<string, unknown>, actor: MarketingActor) {
  assertMarketingActor(actor);
  const month = date(input.month), planned = money(input.planned), sourceId = optionalId(input.sourceId), campaignId = optionalId(input.campaignId);
  if (!month || planned === null || [sourceId, campaignId].some(Number.isNaN)) throw new MarketingError("INVALID");
  const [source, campaign] = await Promise.all([
    sourceId ? prisma.marketingSource.findUnique({ where: { id: sourceId }, select: { id: true } }) : null,
    campaignId ? prisma.marketingCampaign.findUnique({ where: { id: campaignId }, select: { id: true } }) : null,
  ]);
  if ((sourceId && !source) || (campaignId && !campaign)) throw new MarketingError("INVALID");
  month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
  const existing = await prisma.marketingBudget.findFirst({ where: { month, sourceId, campaignId } });
  return existing
    ? prisma.marketingBudget.update({ where: { id: existing.id }, data: { planned, comment: text(input.comment) } })
    : prisma.marketingBudget.create({ data: { month, planned, sourceId, campaignId, comment: text(input.comment) } });
}

export function marketingErrorResponse(error: unknown) {
  if (!(error instanceof MarketingError)) return null;
  const status = error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : ["DUPLICATE_PHONE", "IDEMPOTENCY_CONFLICT", "INVALID_STATE"].includes(error.code) ? 409 : 400;
  const messages: Record<MarketingError["code"], string> = {
    INVALID: "Проверьте заполнение полей", NOT_FOUND: "Запись не найдена", FORBIDDEN: "Недостаточно прав",
    DUPLICATE_PHONE: "Заявка с таким телефоном уже существует", IDEMPOTENCY_CONFLICT: "Ключ операции уже использован с другими данными",
    INVALID_STATE: "Операция недоступна в текущем статусе", CATEGORY_NOT_FOUND: "Категория расхода не найдена",
  };
  return { status, body: { error: messages[error.code], code: error.code, details: error.details } };
}
