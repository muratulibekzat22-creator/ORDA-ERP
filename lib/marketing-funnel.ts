export type StoredMarketingMetric = {
  channel: string;
  note?: string | null;
  spend: { toString(): string } | number | string;
  leads: number;
};

export const isAutomaticMetaMetric = (metric: StoredMarketingMetric) =>
  metric.channel === "Instagram / Meta" &&
  metric.note?.startsWith("Автосинхронизация Meta");

export const metaConversationCount = (metric: StoredMarketingMetric) => {
  const match = metric.note?.match(/(\d+)\s+начатых переписок/iu);
  const value = Number(match?.[1] ?? 0);
  return Number.isFinite(value) ? value : 0;
};

export const salesConversionPercent = (orders: number, leads: number) =>
  leads > 0 ? (orders / leads) * 100 : null;

export function metaFunnelKpis(input: {
  spend: number;
  conversations: number;
  crmLeads: number;
  orders: number;
  revenue: number;
}) {
  return {
    costPerConversation:
      input.spend > 0 && input.conversations > 0
        ? input.spend / input.conversations
        : null,
    cpl:
      input.spend > 0 && input.crmLeads > 0
        ? input.spend / input.crmLeads
        : null,
    cac:
      input.spend > 0 && input.orders > 0
        ? input.spend / input.orders
        : null,
    roas: input.spend > 0 ? input.revenue / input.spend : null,
    conversion: salesConversionPercent(input.orders, input.crmLeads),
  };
}
