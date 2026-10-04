import { PayrollPaymentType, type Prisma } from "@prisma/client";

type ApprovedPayrollSnapshot = {
  id: number;
  employeeId: number;
  periodId: number;
  revision: number;
  preparedAmount: Prisma.Decimal | number;
};

type ConfirmedPayrollPayment = {
  employeeId: number;
  periodId: number;
  amount: Prisma.Decimal | number;
  type: PayrollPaymentType;
};

const accountingKey = (row: { employeeId: number; periodId: number }) =>
  `${row.employeeId}:${row.periodId}`;

export function latestApprovedPayrollSnapshots<T extends ApprovedPayrollSnapshot>(
  snapshots: readonly T[],
) {
  const latest = new Map<string, T>();
  for (const snapshot of snapshots) {
    const key = accountingKey(snapshot);
    const current = latest.get(key);
    if (
      !current ||
      snapshot.revision > current.revision ||
      (snapshot.revision === current.revision && snapshot.id > current.id)
    ) latest.set(key, snapshot);
  }
  return [...latest.values()];
}

export function signedConfirmedPayrollPayment(payment: ConfirmedPayrollPayment) {
  const amount = Number(payment.amount);
  return payment.type === PayrollPaymentType.EMPLOYEE_REFUND ? -amount : amount;
}

export function approvedPayrollAccountingTotals(
  snapshots: readonly ApprovedPayrollSnapshot[],
  payments: readonly ConfirmedPayrollPayment[],
) {
  const latest = latestApprovedPayrollSnapshots(snapshots);
  const paymentsByEmployeePeriod = new Map<string, number>();
  for (const payment of payments) {
    const key = accountingKey(payment);
    paymentsByEmployeePeriod.set(
      key,
      (paymentsByEmployeePeriod.get(key) ?? 0) +
        signedConfirmedPayrollPayment(payment),
    );
  }

  let accrued = 0;
  let payable = 0;
  for (const snapshot of latest) {
    const amount = Number(snapshot.preparedAmount);
    accrued += amount;
    payable += Math.max(amount - (paymentsByEmployeePeriod.get(accountingKey(snapshot)) ?? 0), 0);
  }

  return {
    accrued,
    paid: payments.reduce(
      (sum, payment) => sum + signedConfirmedPayrollPayment(payment),
      0,
    ),
    payable,
  };
}
