const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

export function marketingMonthRange(value?: string | Date) {
  const now = typeof value === "string" && /^\d{4}-\d{2}$/.test(value)
    ? new Date(`${value}-01T00:00:00+05:00`)
    : value instanceof Date
      ? value
      : new Date();
  const local = new Date(now.getTime() + ALMATY_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  return {
    key: `${year}-${String(month + 1).padStart(2, "0")}`,
    start: new Date(Date.UTC(year, month, 1) - ALMATY_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 1, 1) - ALMATY_OFFSET_MS),
  };
}

export function effectiveMarketingMetrics<T extends { channel: string; note?: string | null }>(metrics: T[]) {
  const automatic = metrics.find(
    (metric) =>
      metric.channel === "Instagram / Meta" &&
      metric.note?.startsWith("Автосинхронизация Meta"),
  );
  if (!automatic) return metrics;
  return metrics.filter(
    (metric) =>
      metric === automatic ||
      !/instagram|facebook|meta|таргет/iu.test(metric.channel),
  );
}

function positiveInteger(value: string | undefined) {
  const parsed = Number(value ?? "");
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function metaMetricSignals(note?: string | null) {
  const value = note ?? "";
  const conversations = positiveInteger(
    value.match(/meta:conversations=(\d+)/i)?.[1] ??
    value.match(/(\d+)\s+начат(?:ых|ые)\s+перепис(?:ок|ки)/iu)?.[1],
  );
  const linkClicks = positiveInteger(value.match(/meta:linkClicks=(\d+)/i)?.[1]);
  const impressions = positiveInteger(value.match(/meta:impressions=(\d+)/i)?.[1]);
  return { conversations, linkClicks, impressions };
}

export function exchangeRateFromMetaMetricNote(note: string | null | undefined, currency: string) {
  const value = note ?? "";
  const machine = value.match(/fx:([A-Z]{3})\/KZT=([0-9]+(?:\.[0-9]+)?)/i);
  if (machine?.[1]?.toUpperCase() === currency.toUpperCase()) {
    const parsed = Number(machine[2]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const legacy = value.match(/(?:^|·)\s*[0-9]+(?:[.,][0-9]+)?\s+([A-Z]{3})\s+×\s+([0-9]+(?:[.,][0-9]+)?)\s+KZT/i);
  if (legacy?.[1]?.toUpperCase() !== currency.toUpperCase()) return null;
  const parsed = Number(legacy[2].replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function marketingRatios(input: {
  spend: number;
  inquiries: number;
  qualifiedLeads: number;
  orders: number;
  revenue: number;
  linkClicks: number;
}) {
  const salesBase = input.qualifiedLeads > 0 ? input.qualifiedLeads : input.inquiries;
  return {
    cpl: input.spend > 0 && input.inquiries > 0 ? input.spend / input.inquiries : null,
    cac: input.spend > 0 && input.orders > 0 ? input.spend / input.orders : null,
    roas: input.spend > 0 ? input.revenue / input.spend : null,
    advertisingConversion: input.linkClicks > 0 ? (input.inquiries / input.linkClicks) * 100 : null,
    salesConversion: salesBase > 0 ? (input.orders / salesBase) * 100 : null,
  };
}
