export type SettlementStatus = "NOT_ASSIGNED" | "UNPAID" | "PARTIAL" | "PAID" | "OVERPAID";
type Money = number | string | { toString(): string };
type Payment = { id: number; amount: Money; type: string; partnerId?: number | null; method?: string | null; comment?: string | null; author?: string | null; operationDate?: Date | string; partner?: { name: string } | null };
type Assignment = { id: number; previousPartnerId?: number | null; newPartnerId: number; previousPayable: Money; newPayable: Money; paidAtChange: Money; remainingAtChange: Money; reason: string; createdAt: Date | string; author?: { name: string } | null };
type PayrollAccrual = {
  id: number; periodId: number; type: string; amount: Money; direction: string; measurementId?: number | null;
  createdAt: Date | string; reversedBy?: { id: number } | null;
  employee: { id: number; userId: number | null; name: string; user: { name: string } | null };
  payments?: Array<{ id: number; amount: Money; paymentDate: Date | string; reversalOfId?: number | null; reversedAt?: Date | string | null }>;
};
type Worker = { id: number; name: string; payrollProfile?: { id: number } | null };
type PartnerRelation = {
  id: number;
  startsAt: Date | string;
  workDueAt?: Date | string | null;
  paymentDueAt?: Date | string | null;
  comment?: string | null;
  createdAt: Date | string;
  createdBy?: { name: string } | null;
  operations?: Array<{
    id: number; type: string; status: string; amount: Money; adjustmentEffect: Money;
    operationDate: Date | string; method?: string | null; account?: string | null;
    comment?: string | null; paymentId?: number | null; reversalOfId?: number | null;
    reversalOf?: { id: number } | null; reversal?: { id: number } | null; createdBy?: { name: string } | null;
  }>;
  auditEvents?: Array<{
    id: number; action: string; comment?: string | null; createdAt: Date | string;
    actor?: { name: string } | null;
  }>;
};
export type SettlementSource = {
  amount: Money; partnerId?: number | null; partnerPrice: Money; partnerAgreedAt?: Date | string | null;
  partner?: { id: number; name: string } | null; payments?: Payment[]; partnerAssignmentHistory?: Assignment[]; status?: string;
  managerUser?: Worker | null;
  measurements?: Array<{ measurerUser?: Worker | null }>;
  payrollAccruals?: PayrollAccrual[];
  partnerRelation?: PartnerRelation | null;
};

const clientTypes = new Set(["CLIENT_PAYMENT", "payment", "PREPAYMENT", "ADDITIONAL_PAYMENT"]);
const cancelled = new Set(["CANCELLED", "LOST", "Отменён", "Отменен", "Потерян"]);

export function buildOrderSettlement(order: SettlementSource) {
  const payments = order.payments ?? [];
  const receivedGross = payments.reduce((sum, item) => clientTypes.has(item.type) ? sum + Number(item.amount) : sum, 0);
  const refunds = payments.reduce((sum, item) => item.type === "REFUND" ? sum + Number(item.amount) : sum, 0);
  const received = receivedGross - refunds;
  const paid = payments.reduce((sum, item) => item.partnerId !== order.partnerId ? sum : item.type === "PARTNER_PAYOUT" ? sum + Number(item.amount) : item.type === "PARTNER_PAYOUT_REVERSAL" ? sum - Number(item.amount) : sum, 0);
  const total = Number(order.amount), priceSet = Boolean(order.partnerAgreedAt), agreed = priceSet ? Number(order.partnerPrice) : null;
  const status = (value: number, target: number, assigned = true): SettlementStatus => !assigned ? "NOT_ASSIGNED" : value > target ? "OVERPAID" : target > 0 && value >= target ? "PAID" : value > 0 ? "PARTIAL" : "UNPAID";
  const payroll = order.payrollAccruals ?? [];
  const worker = (assigned: Worker | null | undefined, types: Set<string>) => {
    const accruals = payroll.filter((row) => types.has(row.type) && row.direction === "INCREASE" && !row.reversedBy);
    const rows = accruals.map((row) => {
      const paid = (row.payments ?? []).filter((payment) => !payment.reversalOfId && !payment.reversedAt).reduce((sum, payment) => sum + Number(payment.amount), 0);
      const amount = Number(row.amount), remaining = Math.max(amount - paid, 0);
      return { id: row.id, periodId: row.periodId, employeeId: row.employee.id, userId: row.employee.userId, employeeName: row.employee.user?.name ?? row.employee.name, type: row.type, amount, paid, remaining, status: status(paid, amount), measurementId: row.measurementId ?? null, createdAt: row.createdAt };
    });
    const accrued = rows.reduce((sum, row) => sum + row.amount, 0), paid = rows.reduce((sum, row) => sum + row.paid, 0);
    return {
      userId: assigned?.id ?? rows[0]?.userId ?? null,
      employeeId: assigned?.payrollProfile?.id ?? rows[0]?.employeeId ?? null,
      name: assigned?.name ?? rows[0]?.employeeName ?? null,
      accrued, paid, remaining: Math.max(accrued - paid, 0), status: status(paid, accrued, Boolean(assigned || rows.length)), accruals: rows,
    };
  };
  const measurer = order.measurements?.find((item) => item.measurerUser)?.measurerUser ?? null;
  const clientRemaining = Math.max(total - received, 0);
  const clientOverpayment = Math.max(received - total, 0);
  // The order production deadline is not the same thing as a client payment
  // deadline. Until a canonical payment schedule exists, do not show a false date.
  const clientDueAt = null;
  const clientStatus = clientOverpayment > 0
    ? "OVERPAID"
    : clientRemaining <= 0
      ? "PAID"
      : received > 0
        ? "PARTIAL"
        : "UNPAID";
  const pendingPartner = (order.partnerRelation?.operations ?? []).reduce((sum, item) =>
    item.type === "COMPANY_TO_PARTNER" && item.status === "PENDING" ? sum + Number(item.amount) : sum, 0);
  return {
    cancelled: cancelled.has(order.status ?? ""),
    client: { total, receivedGross, refunds, received, remaining: clientRemaining, overpayment: clientOverpayment, dueAt: clientDueAt, status: clientStatus },
    partner: {
      partnerId: order.partnerId ?? null, partnerName: order.partner?.name ?? null, priceSet, agreed, paid: priceSet ? paid : 0,
      pending: pendingPartner,
      remaining: agreed === null ? 0 : Math.max(agreed - paid, 0), overpayment: agreed === null ? 0 : Math.max(paid - agreed, 0), status: pendingPartner > 0 ? "PENDING_CONFIRMATION" : status(paid, agreed ?? 0, Boolean(order.partnerId)),
      payouts: payments.filter((item) => item.type === "PARTNER_PAYOUT" || item.type === "PARTNER_PAYOUT_REVERSAL").map((item) => ({ id: item.id, amount: Number(item.amount), type: item.type, partnerId: item.partnerId ?? null, partnerName: item.partner?.name ?? null, method: item.method ?? "", comment: item.comment ?? null, author: item.author ?? null, operationDate: item.operationDate ?? null })),
      assignments: (order.partnerAssignmentHistory ?? []).map((item) => ({ id: item.id, previousPartnerId: item.previousPartnerId ?? null, newPartnerId: item.newPartnerId, previousPayable: Number(item.previousPayable), newPayable: Number(item.newPayable), paidAtChange: Number(item.paidAtChange), remainingAtChange: Number(item.remainingAtChange), reason: item.reason, createdAt: item.createdAt, authorName: item.author?.name ?? null })),
      history: order.partnerRelation ? {
        relationId: order.partnerRelation.id,
        startsAt: order.partnerRelation.startsAt,
        workDueAt: order.partnerRelation.workDueAt ?? null,
        paymentDueAt: order.partnerRelation.paymentDueAt ?? null,
        comment: order.partnerRelation.comment ?? null,
        createdAt: order.partnerRelation.createdAt,
        createdBy: order.partnerRelation.createdBy?.name ?? null,
        operations: (order.partnerRelation.operations ?? []).map((item) => ({
          id: item.id,
          type: item.type,
          status: item.status,
          amount: Number(item.amount),
          adjustmentEffect: Number(item.adjustmentEffect),
          operationDate: item.operationDate,
          method: item.method ?? null,
          account: item.account ?? null,
          comment: item.comment ?? null,
          paymentId: item.paymentId ?? null,
          reversalOfId: item.reversalOfId ?? item.reversalOf?.id ?? null,
          reversalId: item.reversal?.id ?? null,
          author: item.createdBy?.name ?? null,
        })),
        audit: (order.partnerRelation.auditEvents ?? []).map((item) => ({
          id: item.id,
          action: item.action,
          comment: item.comment ?? null,
          createdAt: item.createdAt,
          actor: item.actor?.name ?? null,
        })),
      } : null,
    },
    manager: worker(order.managerUser, new Set(["GUARANTEED_ORDER_BONUS", "ORDER_BONUS", "EXTRA_BONUS"])),
    measurer: worker(measurer, new Set(["MEASUREMENT_BONUS"])),
  };
}
