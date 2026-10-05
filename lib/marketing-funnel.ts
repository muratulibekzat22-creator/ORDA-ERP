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
    conversion:
      input.crmLeads > 0 ? (input.orders / input.crmLeads) * 100 : null,
  };
}
