import { createHash } from "node:crypto";

export const MARKETING_SOURCE_PRESETS = [
  ["META_INSTAGRAM_ADS", "Meta — Instagram Ads", "META", true],
  ["META_FACEBOOK_ADS", "Meta — Facebook Ads", "META", true],
  ["META_CLICK_WHATSAPP", "Meta — Click to WhatsApp", "META", true],
  ["INSTAGRAM_ORGANIC", "Instagram Organic", "INSTAGRAM", false],
  ["FACEBOOK_ORGANIC", "Facebook Organic", "FACEBOOK", false],
  ["WHATSAPP_ORGANIC", "WhatsApp Organic", "WHATSAPP", false],
  ["TIKTOK_ADS", "TikTok Ads", "TIKTOK", true],
  ["TIKTOK_ORGANIC", "TikTok Organic", "TIKTOK", false],
  ["GOOGLE_ADS", "Google Ads", "GOOGLE", true],
  ["GOOGLE_ORGANIC", "Google Organic", "GOOGLE", false],
  ["WEBSITE", "Website", "WEB", false],
  ["TWO_GIS", "2GIS", "2GIS", false],
  ["REFERRAL", "Referral / Сарафан", "REFERRAL", false],
  ["SHOWROOM", "Showroom", "OFFLINE", false],
  ["OUTDOOR", "Outdoor", "OFFLINE", true],
  ["PARTNER", "Partner", "PARTNER", false],
  ["OTHER", "Other", "OTHER", false],
] as const;

export const CONTACT_CHANNEL_PRESETS = [
  ["INSTAGRAM_DIRECT", "Instagram Direct"],
  ["FACEBOOK_MESSENGER", "Facebook Messenger"],
  ["WHATSAPP", "WhatsApp"],
  ["WEBSITE_FORM", "форма сайта"],
  ["PHONE", "телефонный звонок"],
  ["TELEGRAM", "Telegram"],
  ["TIKTOK", "TikTok"],
  ["GOOGLE_FORM", "Google form"],
  ["TWO_GIS", "2GIS"],
  ["SHOWROOM_VISIT", "посещение шоурума"],
  ["RECOMMENDATION", "рекомендация"],
  ["OTHER", "другой"],
] as const;

export function safeDivide(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

export function marketingKpis(input: {
  confirmedSpend: number;
  clicks: number;
  applications: number;
  completedMeasurements: number;
  orders: number;
  payingClients: number;
  soldAmount: number;
  grossProfit: number;
}) {
  const spend = input.confirmedSpend;
  return {
    cpc: safeDivide(spend, input.clicks),
    cpl: safeDivide(spend, input.applications),
    measurementCost: safeDivide(spend, input.completedMeasurements),
    cpa: safeDivide(spend, input.orders),
    cac: safeDivide(spend, input.payingClients),
    roas: safeDivide(input.soldAmount, spend),
    romi: safeDivide(input.grossProfit - spend, spend),
  };
}

export function conversionRate(next: number, previous: number) {
  return safeDivide(next * 100, previous);
}

export function marketingMetricDedupeKey(input: {
  companyId: number;
  campaignId: number;
  adSetId?: number | null;
  adId?: number | null;
  metricDate: Date;
  importKey: string;
}) {
  return createHash("sha256").update([
    input.companyId,
    input.campaignId,
    input.adSetId ?? 0,
    input.adId ?? 0,
    input.metricDate.toISOString().slice(0, 10),
    input.importKey,
  ].join(":"), "utf8").digest("hex");
}

export const CAMPAIGN_STATUS_LABELS = {
  DRAFT: "Черновик",
  SCHEDULED: "Запланирована",
  ACTIVE: "Активна",
  PAUSED: "Приостановлена",
  COMPLETED: "Завершена",
  ARCHIVED: "Архивная",
} as const;

export const SPEND_STATUS_LABELS = {
  DRAFT: "Черновик",
  SUBMITTED: "Отправлен на подтверждение",
  APPROVED: "Подтверждён",
  REJECTED: "Отклонён",
  RECONCILED: "Сверен",
  REVERSED: "Сторнирован",
} as const;
