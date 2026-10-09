type CustomerPayment = {
  orderId: number | null;
  type: string;
  amount: number | string | { toString(): string };
};

export function splitDashboardReceipts<T extends CustomerPayment>(payments: readonly T[], periodOrderIds: ReadonlySet<number>) {
  const classified = payments.map((payment) => ({
    payment,
    amount: (payment.type === "REFUND" ? -1 : 1) * Number(payment.amount),
    fromPeriodOrder: payment.orderId !== null && periodOrderIds.has(payment.orderId),
  }));
  const received = classified.reduce((sum, row) => sum + row.amount, 0);
  const receivedForPeriodOrders = classified.reduce((sum, row) => sum + (row.fromPeriodOrder ? row.amount : 0), 0);
  return {
    classified,
    received,
    receivedForPeriodOrders,
    receivedFromOtherOrders: received - receivedForPeriodOrders,
  };
}
