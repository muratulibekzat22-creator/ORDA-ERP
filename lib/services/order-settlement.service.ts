import { hasProductionPrice } from "@/lib/orders/production-price";
import { calculateProfitFirstAllocation } from "@/lib/partners/profit-first";

export type SettlementStatus = "NOT_ASSIGNED" | "UNPAID" | "PARTIAL" | "PAID" | "OVERPAID";
type Money = number | string | { toString(): string };
type Payment = { id: number; amount: Money; type: string; partnerId?: number | null; method?: string | null; partnerPayoutPurpose?: string | null; comment?: string | null; author?: string | null; operationDate?: Date | string; partner?: { name: string } | null };
type Assignment = { id: number; previousPartnerId?: number | null; newPartnerId: number; previousPayable: Money; newPayable: Money; paidAtChange: Money; remainingAtChange: Money; reason: string; createdAt: Date | string; author?: { name: string } | null };
type PayrollAccrual = {
  id: number; periodId: number; type: string; amount: Money; direction: string; measurementId?: number | null;
  createdAt: Date | string; reversedBy?: { id: number } | null;
  employee: { id: number; userId: number | null; name: string; user: { name: string } | null };
  payments?: Array<{ id: number; amount: Money; paymentDate: Date | string; reversalOfId?: number | null; reversedAt?: Date | string | null }>;
};
type Worker = { id: number; name: string; payrollProfile?: { id: number } | null };
export type SettlementSource = {
  amount: Money; partnerId?: number | null; partnerPrice: Money; partnerAgreedAt?: Date | string | null;
  partner?: { id: number; name: string } | null; payments?: Payment[]; partnerAssignmentHistory?: Assignment[]; status?: string;
  managerUser?: Worker | null;
  measurements?: Array<{ measurerUser?: Worker | null }>;
  payrollAccruals?: PayrollAccrual[];
  partnerRelation?: {
    operations?: Array<{ type: string; status: string; amount: Money; adjustmentEffect?: Money }>;
  } | null;
};

const clientTypes = new Set(["CLIENT_PAYMENT", "payment", "PREPAYMENT", "ADDITIONAL_PAYMENT"]);
const cancelled = new Set(["CANCELLED", "LOST", "Отменён", "Отменен", "Потерян"]);

export function buildOrderSettlement(order: SettlementSource) {
  const payments = order.payments ?? [];
  const received = payments.reduce((sum, item) => clientTypes.has(item.type) ? sum + Number(item.amount) : item.type === "REFUND" ? sum - Number(item.amount) : sum, 0);
  const paid = payments.reduce((sum, item) => item.partnerId !== order.partnerId ? sum : item.type === "PARTNER_PAYOUT" ? sum + Number(item.amount) : item.type === "PARTNER_PAYOUT_REVERSAL" ? sum - Number(item.amount) : sum, 0);
  const activeOperations = (order.partnerRelation?.operations ?? []).filter(
    (operation) => operation.status === "POSTED" && operation.type !== "REVERSAL",
  );
  const operationTotal = (type: string) => activeOperations
    .filter((operation) => operation.type === type)
    .reduce((sum, operation) => sum + Number(operation.amount), 0);
  const clientPaidToWorkshop = operationTotal("CLIENT_TO_PARTNER");
  const workshopReturnedToClient = operationTotal("PARTNER_REFUND");
  const workshopTransferredToCompany = operationTotal("PARTNER_TO_COMPANY");
  const total = Number(order.amount), priceSet = hasProductionPrice(order.partnerPrice, order.partnerAgreedAt), agreed = priceSet ? Number(order.partnerPrice) : null;
  const allocationValue = calculateProfitFirstAllocation({
    totalSale: total,
    productionCost: agreed ?? 0,
    companyClientReceived: received,
    clientPaidToWorkshop,
    workshopReturnedToClient,
    workshopTransferredToCompany,
    companyPaidWorkshop: paid,
    dataComplete: priceSet,
  });
  const numeric = (value: { toNumber(): number } | null) => value === null ? null : value.toNumber();
  const allocation = {
    dataComplete: allocationValue.dataComplete,
    totalSale: numeric(allocationValue.totalSale)!,
    productionCost: numeric(allocationValue.productionCost)!,
    plannedCompanyIncome: numeric(allocationValue.plannedCompanyIncome),
    plannedLoss: numeric(allocationValue.plannedLoss),
    clientReceived: numeric(allocationValue.clientReceived)!,
    clientRemaining: numeric(allocationValue.clientRemaining)!,
    companyIncomeRetained: numeric(allocationValue.companyIncomeRetained),
    companyIncomeRemaining: numeric(allocationValue.companyIncomeRemaining),
    productionFunded: numeric(allocationValue.productionFunded),
    workshopReceived: numeric(allocationValue.workshopReceived)!,
    readyToPayWorkshop: numeric(allocationValue.readyToPayWorkshop),
    workshopRemaining: numeric(allocationValue.workshopRemaining),
    awaitingClientForWorkshop: numeric(allocationValue.awaitingClientForWorkshop),
    workshopAdvance: numeric(allocationValue.workshopAdvance),
    companyCashHeld: numeric(allocationValue.companyCashHeld)!,
    directWorkshopHeld: numeric(allocationValue.directWorkshopHeld)!,
  };
  const clientReceivedTotal = allocation.clientReceived;
  const paidToWorkshop = allocation.workshopReceived;
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
  return {
    cancelled: cancelled.has(order.status ?? ""),
    client: { total, received: clientReceivedTotal, remaining: Math.max(total - clientReceivedTotal, 0), overpayment: Math.max(clientReceivedTotal - total, 0), status: status(clientReceivedTotal, total) },
    partner: {
      partnerId: order.partnerId ?? null, partnerName: order.partner?.name ?? null, priceSet, agreed, paid: priceSet ? paidToWorkshop : 0,
      remaining: agreed === null ? 0 : Math.max(agreed - paidToWorkshop, 0), overpayment: agreed === null ? 0 : Math.max(paidToWorkshop - agreed, 0), status: status(paidToWorkshop, agreed ?? 0, Boolean(order.partnerId)),
      allocation,
      payouts: payments.filter((item) => item.type === "PARTNER_PAYOUT" || item.type === "PARTNER_PAYOUT_REVERSAL").map((item) => ({ id: item.id, amount: Number(item.amount), type: item.type, purpose: item.partnerPayoutPurpose ?? "OTHER", partnerId: item.partnerId ?? null, partnerName: item.partner?.name ?? null, method: item.method ?? "", comment: item.comment ?? null, author: item.author ?? null, operationDate: item.operationDate ?? null })),
      assignments: (order.partnerAssignmentHistory ?? []).map((item) => ({ id: item.id, previousPartnerId: item.previousPartnerId ?? null, newPartnerId: item.newPartnerId, previousPayable: Number(item.previousPayable), newPayable: Number(item.newPayable), paidAtChange: Number(item.paidAtChange), remainingAtChange: Number(item.remainingAtChange), reason: item.reason, createdAt: item.createdAt, authorName: item.author?.name ?? null })),
    },
    manager: worker(order.managerUser, new Set(["GUARANTEED_ORDER_BONUS", "ORDER_BONUS", "EXTRA_BONUS"])),
    measurer: worker(measurer, new Set(["MEASUREMENT_BONUS"])),
  };
}
