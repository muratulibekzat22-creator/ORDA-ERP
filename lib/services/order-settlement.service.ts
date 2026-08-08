export type SettlementStatus = "NOT_ASSIGNED" | "UNPAID" | "PARTIAL" | "PAID" | "OVERPAID";
type Money = number | string | { toString(): string };
type Payment = { id: number; amount: Money; type: string; partnerId?: number | null; method?: string | null; comment?: string | null; author?: string | null; operationDate?: Date | string; partner?: { name: string } | null };
type Assignment = { id: number; previousPartnerId?: number | null; newPartnerId: number; previousPayable: Money; newPayable: Money; paidAtChange: Money; remainingAtChange: Money; reason: string; createdAt: Date | string; author?: { name: string } | null };
export type SettlementSource = { amount: Money; partnerId?: number | null; partnerPrice: Money; partner?: { id: number; name: string } | null; payments?: Payment[]; partnerAssignmentHistory?: Assignment[]; status?: string };

const clientTypes = new Set(["CLIENT_PAYMENT", "payment", "PREPAYMENT", "ADDITIONAL_PAYMENT"]);
const cancelled = new Set(["CANCELLED", "LOST", "Отменён", "Отменен", "Потерян"]);

export function buildOrderSettlement(order: SettlementSource) {
  const payments = order.payments ?? [];
  const received = payments.reduce((sum, item) => clientTypes.has(item.type) ? sum + Number(item.amount) : item.type === "REFUND" ? sum - Number(item.amount) : sum, 0);
  const paid = payments.reduce((sum, item) => item.partnerId !== order.partnerId ? sum : item.type === "PARTNER_PAYOUT" ? sum + Number(item.amount) : item.type === "PARTNER_PAYOUT_REVERSAL" ? sum - Number(item.amount) : sum, 0);
  const total = Number(order.amount), agreed = Number(order.partnerPrice);
  const status = (value: number, target: number, assigned = true): SettlementStatus => !assigned ? "NOT_ASSIGNED" : value > target ? "OVERPAID" : target > 0 && value >= target ? "PAID" : value > 0 ? "PARTIAL" : "UNPAID";
  return {
    cancelled: cancelled.has(order.status ?? ""),
    client: { total, received, remaining: Math.max(total - received, 0), overpayment: Math.max(received - total, 0), status: status(received, total) },
    partner: {
      partnerId: order.partnerId ?? null, partnerName: order.partner?.name ?? null, agreed, paid,
      remaining: Math.max(agreed - paid, 0), overpayment: Math.max(paid - agreed, 0), status: status(paid, agreed, Boolean(order.partnerId)),
      payouts: payments.filter((item) => item.type === "PARTNER_PAYOUT" || item.type === "PARTNER_PAYOUT_REVERSAL").map((item) => ({ id: item.id, amount: Number(item.amount), type: item.type, partnerId: item.partnerId ?? null, partnerName: item.partner?.name ?? null, method: item.method ?? "", comment: item.comment ?? null, author: item.author ?? null, operationDate: item.operationDate ?? null })),
      assignments: (order.partnerAssignmentHistory ?? []).map((item) => ({ id: item.id, previousPartnerId: item.previousPartnerId ?? null, newPartnerId: item.newPartnerId, previousPayable: Number(item.previousPayable), newPayable: Number(item.newPayable), paidAtChange: Number(item.paidAtChange), remainingAtChange: Number(item.remainingAtChange), reason: item.reason, createdAt: item.createdAt, authorName: item.author?.name ?? null })),
    },
  };
}
