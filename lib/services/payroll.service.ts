import {
  AdvanceRequestStatus,
  BonusPaymentMode,
  PayrollAccrualType,
  PayrollDirection,
  PayrollPaymentType,
  PayrollPeriodStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { compareRequestHash } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";

export type PayrollActor = { userId: number; role: Role; name: string };
export class PayrollError extends Error {}
const money = (value: unknown) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0)
    throw new PayrollError("INVALID_AMOUNT");
  return new Prisma.Decimal(amount.toFixed(2));
};
const nonNegativeMoney = (value: unknown) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0)
    throw new PayrollError("INVALID_AMOUNT");
  return new Prisma.Decimal(amount.toFixed(2));
};
const requiredReason = (value: string | undefined, code = "REASON_REQUIRED") => {
  const reason = value?.trim();
  if (!reason) throw new PayrollError(code);
  return reason;
};
const director = (actor: PayrollActor) => {
  if (actor.role !== Role.DIRECTOR) throw new PayrollError("FORBIDDEN");
};
const finance = (actor: PayrollActor) => {
  if (!(actor.role === Role.DIRECTOR || actor.role === Role.ACCOUNTANT))
    throw new PayrollError("FORBIDDEN");
};
const transactionOptions = { maxWait: 10_000, timeout: 30_000 } as const;

export async function ensurePeriod(year: number, month: number) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  )
    throw new PayrollError("INVALID_PERIOD");
  return prisma.payrollPeriod.upsert({
    where: { year_month: { year, month } },
    create: { year, month },
    update: {},
  });
}

async function openPeriod(tx: Prisma.TransactionClient, periodId: number) {
  const period = await tx.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new PayrollError("PERIOD_NOT_FOUND");
  if (period.status !== PayrollPeriodStatus.OPEN)
    throw new PayrollError(period.status === PayrollPeriodStatus.CLOSED ? "PERIOD_CLOSED" : "PERIOD_NOT_OPEN");
  return period;
}

async function audit(
  tx: Prisma.TransactionClient,
  input: {
    action: string;
    actor: PayrollActor;
    periodId?: number;
    employeeId?: number;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
    reason: string;
    idempotencyKey?: string;
  },
) {
  return tx.payrollAuditEvent.create({
    data: {
      action: input.action,
      actorId: input.actor.userId,
      periodId: input.periodId,
      employeeId: input.employeeId,
      before: input.before,
      after: input.after,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    },
  });
}

export async function upsertPayrollProfile(
  input: {
    userId: number;
    hiredAt: Date;
    baseSalary: number;
    defaultGuaranteedBonus?: number;
    comment?: string;
  },
  actor: PayrollActor,
) {
  director(actor);
  const salary = nonNegativeMoney(input.baseSalary);
  const guaranteed = nonNegativeMoney(input.defaultGuaranteedBonus ?? 20000);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user || user.role === Role.PARTNER)
      throw new PayrollError("EMPLOYEE_NOT_FOUND");
    const previousProfile = await tx.employeePayrollProfile.findUnique({ where: { userId: input.userId } });
    const profile = await tx.employeePayrollProfile.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        hiredAt: input.hiredAt,
        baseSalary: salary,
        defaultGuaranteedBonus: guaranteed,
        comment: input.comment,
      },
      update: {
        payrollEnabled: true,
        active: true,
        defaultGuaranteedBonus: guaranteed,
        comment: input.comment,
      },
    });
    const current = await tx.employeeSalaryRate.findFirst({
      where: { employeeId: profile.id, effectiveTo: null },
      orderBy: { effectiveFrom: "desc" },
    });
    if (!current || !current.amount.equals(salary)) {
      if (current)
        await tx.employeeSalaryRate.update({
          where: { id: current.id },
          data: { effectiveTo: input.hiredAt },
        });
      await tx.employeeSalaryRate.create({
        data: {
          employeeId: profile.id,
          amount: salary,
          effectiveFrom: input.hiredAt,
          approvedById: actor.userId,
          comment: input.comment,
        },
      });
      await tx.employeePayrollProfile.update({
        where: { id: profile.id },
        data: { baseSalary: salary },
      });
    }
    await audit(tx, {
      action: "PAYROLL_PROFILE_CONFIGURED",
      actor,
      employeeId: profile.id,
      before: previousProfile ? { baseSalary: Number(previousProfile.baseSalary), guaranteedBonus: Number(previousProfile.defaultGuaranteedBonus) } : undefined,
      after: { baseSalary: Number(salary), guaranteedBonus: Number(guaranteed) },
      reason: input.comment?.trim() || "Настройка зарплатного профиля",
    });
    return tx.employeePayrollProfile.findUniqueOrThrow({
      where: { id: profile.id },
      include: {
        salaryRates: { orderBy: { effectiveFrom: "desc" } },
        user: { select: { id: true, name: true, role: true, active: true } },
      },
    });
  }, transactionOptions);
}

export async function changeSalary(
  employeeId: number,
  amount: number,
  effectiveFrom: Date,
  comment: string | undefined,
  actor: PayrollActor,
) {
  director(actor);
  const salary = money(amount);
  return prisma.$transaction(async (tx) => {
    const profile = await tx.employeePayrollProfile.findUnique({
      where: { id: employeeId },
    });
    if (!profile) throw new PayrollError("EMPLOYEE_NOT_FOUND");
    const current = await tx.employeeSalaryRate.findFirst({
      where: { employeeId, effectiveTo: null },
      orderBy: { effectiveFrom: "desc" },
    });
    if (current)
      await tx.employeeSalaryRate.update({
        where: { id: current.id },
        data: { effectiveTo: effectiveFrom },
      });
    const rate = await tx.employeeSalaryRate.create({
      data: {
        employeeId,
        amount: salary,
        effectiveFrom,
        approvedById: actor.userId,
        comment,
      },
    });
    await tx.employeePayrollProfile.update({
      where: { id: employeeId },
      data: { baseSalary: salary },
    });
    await audit(tx, {
      action: "SALARY_CHANGED",
      actor,
      employeeId,
      before: current ? { amount: Number(current.amount), effectiveFrom: current.effectiveFrom.toISOString() } : undefined,
      after: { amount: Number(salary), effectiveFrom: effectiveFrom.toISOString() },
      reason: comment?.trim() || "Изменение оклада",
    });
    return rate;
  }, transactionOptions);
}

export async function changeAllowance(
  employeeId: number,
  amount: number,
  comment: string | undefined,
  actor: PayrollActor,
) {
  director(actor);
  const allowance = nonNegativeMoney(amount);
  return prisma.$transaction(async (tx) => {
    const profile = await tx.employeePayrollProfile.findUnique({ where: { id: employeeId } });
    if (!profile) throw new PayrollError("EMPLOYEE_NOT_FOUND");
    const updated = await tx.employeePayrollProfile.update({
      where: { id: employeeId },
      data: { defaultGuaranteedBonus: allowance },
    });
    await audit(tx, {
      action: "ALLOWANCE_CHANGED",
      actor,
      employeeId,
      before: { amount: Number(profile.defaultGuaranteedBonus) },
      after: { amount: Number(allowance) },
      reason: comment?.trim() || "Изменение гарантированного бонуса",
    });
    return updated;
  }, transactionOptions);
}

type AccrualInput = {
  employeeId: number;
  periodId: number;
  earnedPeriodId?: number;
  type: PayrollAccrualType;
  amount: number;
  orderId?: number;
  reason: string;
  paymentMode?: BonusPaymentMode;
  key: string;
  requestHash: string;
};

export async function createAccrual(input: AccrualInput, actor: PayrollActor) {
  director(actor);
  const reason = requiredReason(input.reason);
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.payrollAccrual.findUnique({
        where: { idempotencyKey: input.key },
      });
      if (existing) {
        if (!compareRequestHash(existing.requestHash, input.requestHash))
          throw new PayrollError("IDEMPOTENCY_CONFLICT");
        return { accrual: existing, created: false };
      }
      const period = await openPeriod(tx, input.periodId);
      const employee = await tx.employeePayrollProfile.findUnique({
        where: { id: input.employeeId },
      });
      if (!employee?.payrollEnabled || !employee.active)
        throw new PayrollError("EMPLOYEE_NOT_FOUND");
      if (
        (input.type === PayrollAccrualType.ORDER_BONUS ||
          input.type === PayrollAccrualType.GUARANTEED_ORDER_BONUS) &&
        !input.orderId
      )
        throw new PayrollError("ORDER_REQUIRED");
      let cancelledOrderWarning = false;
      if (input.orderId) {
        const order = await tx.order.findUnique({
          where: { id: input.orderId },
          select: { status: true },
        });
        if (!order) throw new PayrollError("ORDER_NOT_FOUND");
        cancelledOrderWarning = /отмен|cancel/i.test(order.status);
      }
      const decreases: PayrollAccrualType[] = [
        PayrollAccrualType.DEDUCTION,
        PayrollAccrualType.ADJUSTMENT_DECREASE,
        PayrollAccrualType.BONUS_REVERSAL,
      ];
      const accrual = await tx.payrollAccrual.create({
        data: {
          employeeId: input.employeeId,
          periodId: period.id,
          earnedPeriodId: input.earnedPeriodId,
          type: input.type,
          direction: decreases.includes(input.type)
            ? PayrollDirection.DECREASE
            : PayrollDirection.INCREASE,
          amount: money(input.amount),
          orderId: input.orderId,
          reason,
          paymentMode: input.paymentMode,
          approvedById: actor.userId,
          createdById: actor.userId,
          idempotencyKey: input.key,
          requestHash: input.requestHash,
        },
      });
      await tx.companyLedgerEntry.create({
        data: {
          type: "PAYROLL_ACCRUAL",
          category: "SALARY",
          direction:
            accrual.direction === PayrollDirection.INCREASE
              ? "EXPENSE"
              : "INCOME",
          amount: accrual.amount,
          operationDate: accrual.createdAt,
          comment: reason,
          orderId: input.orderId,
          authorId: actor.userId,
          idempotencyKey: `payroll-accrual:${accrual.id}`,
          requestHash: input.requestHash,
          affectsProfit: true,
          payrollAccrualId: accrual.id,
        },
      });
      let payment = null;
      if (input.paymentMode === BonusPaymentMode.IMMEDIATE) {
        payment = await createPaymentTx(
          tx,
          {
            employeeId: input.employeeId,
            periodId: period.id,
            amount: input.amount,
            type: PayrollPaymentType.IMMEDIATE_BONUS,
            paymentDate: new Date(),
            relatedAccrualId: accrual.id,
            comment: reason,
            key: `${input.key}:payment`,
            requestHash: input.requestHash,
          },
          actor,
        );
      }
      await audit(tx, {
        action: input.type === PayrollAccrualType.PREMIUM ? "PREMIUM_ACCRUED" : "PAYROLL_ACCRUAL_CREATED",
        actor,
        periodId: period.id,
        employeeId: input.employeeId,
        after: { accrualId: accrual.id, type: accrual.type, amount: Number(accrual.amount), direction: accrual.direction },
        reason,
        idempotencyKey: `${input.key}:audit`,
      });
      return { accrual, payment, created: true, cancelledOrderWarning };
    },
    { ...transactionOptions, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

type PaymentInput = {
  employeeId: number;
  periodId: number;
  amount: number;
  type: PayrollPaymentType;
  paymentDate: Date;
  method?: string;
  comment?: string;
  relatedAccrualId?: number;
  key: string;
  requestHash: string;
};
async function createPaymentTx(
  tx: Prisma.TransactionClient,
  input: PaymentInput,
  actor: PayrollActor,
) {
  const existing = await tx.payrollPayment.findUnique({
    where: { idempotencyKey: input.key },
  });
  if (existing) {
    if (!compareRequestHash(existing.requestHash, input.requestHash))
      throw new PayrollError("IDEMPOTENCY_CONFLICT");
    return existing;
  }
  await openPeriod(tx, input.periodId);
  const payment = await tx.payrollPayment.create({
    data: {
      employeeId: input.employeeId,
      periodId: input.periodId,
      amount: money(input.amount),
      paymentDate: input.paymentDate,
      type: input.type,
      method: input.method,
      comment: input.comment,
      relatedAccrualId: input.relatedAccrualId,
      paidById: actor.userId,
      idempotencyKey: input.key,
      requestHash: input.requestHash,
    },
  });
  await tx.companyLedgerEntry.create({
    data: {
      type: "PAYROLL_PAYMENT",
      category: "SALARY",
      direction:
        input.type === PayrollPaymentType.EMPLOYEE_REFUND
          ? "INCOME"
          : "EXPENSE",
      amount: payment.amount,
      operationDate: input.paymentDate,
      comment: input.comment,
      authorId: actor.userId,
      idempotencyKey: `payroll-payment:${payment.id}`,
      requestHash: input.requestHash,
      affectsProfit: false,
      payrollPaymentId: payment.id,
    },
  });
  return payment;
}
export async function createPayment(input: PaymentInput, actor: PayrollActor) {
  finance(actor);
  return prisma.$transaction((tx) => createPaymentTx(tx, input, actor), {
    ...transactionOptions,
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

export async function requestAdvance(
  input: {
    periodId: number;
    amount: number;
    comment?: string;
    key: string;
    requestHash: string;
  },
  actor: PayrollActor,
) {
  if (actor.role === Role.PARTNER) throw new PayrollError("FORBIDDEN");
  const employee = await prisma.employeePayrollProfile.findUnique({
    where: { userId: actor.userId },
  });
  if (!employee?.active || !employee.payrollEnabled)
    throw new PayrollError("EMPLOYEE_NOT_FOUND");
  const period = await prisma.payrollPeriod.findUnique({
    where: { id: input.periodId },
  });
  if (!period) throw new PayrollError("PERIOD_NOT_FOUND");
  if (period.status !== PayrollPeriodStatus.OPEN)
    throw new PayrollError(period.status === PayrollPeriodStatus.CLOSED ? "PERIOD_CLOSED" : "PERIOD_NOT_OPEN");
  const existing = await prisma.payrollAdvanceRequest.findUnique({
    where: { idempotencyKey: input.key },
  });
  if (existing) {
    if (!compareRequestHash(existing.requestHash, input.requestHash))
      throw new PayrollError("IDEMPOTENCY_CONFLICT");
    return existing;
  }
  return prisma.payrollAdvanceRequest.create({
    data: {
      employeeId: employee.id,
      periodId: input.periodId,
      requestedAmount: money(input.amount),
      comment: input.comment,
      idempotencyKey: input.key,
      requestHash: input.requestHash,
    },
  });
}

export async function reviewAdvance(
  id: number,
  input: {
    status: AdvanceRequestStatus;
    approvedAmount?: number;
    comment?: string;
  },
  actor: PayrollActor,
) {
  director(actor);
  if (!(
    input.status === AdvanceRequestStatus.APPROVED ||
    input.status === AdvanceRequestStatus.REJECTED
  ))
    throw new PayrollError("INVALID_STATUS");
  return prisma.$transaction(async (tx) => {
    const request = await tx.payrollAdvanceRequest.findUnique({
      where: { id },
    });
    if (!request || request.status !== AdvanceRequestStatus.REQUESTED)
      throw new PayrollError("CONFLICT");
    await openPeriod(tx, request.periodId);
    const updated = await tx.payrollAdvanceRequest.update({
      where: { id },
      data: {
        status: input.status,
        approvedAmount:
          input.status === AdvanceRequestStatus.APPROVED
            ? money(input.approvedAmount ?? Number(request.requestedAmount))
            : null,
        reviewComment: input.comment,
        reviewedById: actor.userId,
        reviewedAt: new Date(),
      },
    });
    await audit(tx, {
      action: input.status === AdvanceRequestStatus.APPROVED ? "ADVANCE_APPROVED" : "ADVANCE_REJECTED",
      actor,
      periodId: request.periodId,
      employeeId: request.employeeId,
      before: { status: request.status, requestedAmount: Number(request.requestedAmount) },
      after: { status: updated.status, approvedAmount: updated.approvedAmount ? Number(updated.approvedAmount) : null },
      reason: input.comment?.trim() || (input.status === AdvanceRequestStatus.APPROVED ? "Аванс одобрен" : "Аванс отклонён"),
    });
    return updated;
  }, transactionOptions);
}

export async function payAdvance(
  id: number,
  input: {
    key: string;
    requestHash: string;
    method?: string;
    comment?: string;
  },
  actor: PayrollActor,
) {
  finance(actor);
  return prisma.$transaction(
    async (tx) => {
      const request = await tx.payrollAdvanceRequest.findUnique({
        where: { id },
      });
      if (request?.status === AdvanceRequestStatus.PAID && request.paymentId) {
        const existing = await tx.payrollPayment.findUniqueOrThrow({
          where: { id: request.paymentId },
        });
        if (
          existing.idempotencyKey !== input.key ||
          !compareRequestHash(existing.requestHash, input.requestHash)
        )
          throw new PayrollError("IDEMPOTENCY_CONFLICT");
        return existing;
      }
      if (
        !request ||
        request.status !== AdvanceRequestStatus.APPROVED ||
        !request.approvedAmount
      )
        throw new PayrollError("CONFLICT");
      const payment = await createPaymentTx(
        tx,
        {
          employeeId: request.employeeId,
          periodId: request.periodId,
          amount: Number(request.approvedAmount),
          type: PayrollPaymentType.ADVANCE,
          paymentDate: new Date(),
          method: input.method,
          comment: input.comment,
          key: input.key,
          requestHash: input.requestHash,
        },
        actor,
      );
      await tx.payrollAdvanceRequest.update({
        where: { id },
        data: { status: AdvanceRequestStatus.PAID, paymentId: payment.id },
      });
      return payment;
    },
    { ...transactionOptions, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function closePeriod(
  periodId: number,
  key: string,
  actor: PayrollActor,
) {
  return transitionPeriod(periodId, PayrollPeriodStatus.CLOSED, "Закрытие расчётного месяца", key, actor);
}

export async function transitionPeriod(
  periodId: number,
  target: PayrollPeriodStatus,
  reasonValue: string | undefined,
  key: string,
  actor: PayrollActor,
) {
  director(actor);
  return prisma.$transaction(async (tx) => {
    const replay = await tx.payrollAuditEvent.findUnique({ where: { idempotencyKey: key } });
    if (replay?.periodId === periodId)
      return tx.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
    const period = await tx.payrollPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new PayrollError("PERIOD_NOT_FOUND");
    const reason = period.status === PayrollPeriodStatus.CLOSED && target === PayrollPeriodStatus.OPEN
      ? requiredReason(reasonValue)
      : reasonValue?.trim() || "Изменение статуса расчётного периода";
    const allowed =
      (period.status === PayrollPeriodStatus.OPEN && target === PayrollPeriodStatus.REVIEW) ||
      (period.status === PayrollPeriodStatus.REVIEW && (target === PayrollPeriodStatus.OPEN || target === PayrollPeriodStatus.CLOSED)) ||
      (period.status === PayrollPeriodStatus.CLOSED && target === PayrollPeriodStatus.OPEN);
    if (!allowed) throw new PayrollError("INVALID_PERIOD_TRANSITION");
    const updated = await tx.payrollPeriod.update({
      where: { id: periodId },
      data: target === PayrollPeriodStatus.CLOSED
        ? { status: target, closedAt: new Date(), closedById: actor.userId, closeKey: key }
        : { status: target, closedAt: null, closedById: null, closeKey: null },
    });
    await audit(tx, {
      action: target === PayrollPeriodStatus.CLOSED ? "PERIOD_CLOSED" : period.status === PayrollPeriodStatus.CLOSED ? "PERIOD_REOPENED" : "PERIOD_STATUS_CHANGED",
      actor,
      periodId,
      before: { status: period.status },
      after: { status: target },
      reason,
      idempotencyKey: key,
    });
    return updated;
  }, transactionOptions);
}

const signedAccrual = (row: {
  amount: Prisma.Decimal;
  direction: PayrollDirection;
}) =>
  Number(row.amount) * (row.direction === PayrollDirection.INCREASE ? 1 : -1);
const signedPayment = (row: {
  amount: Prisma.Decimal;
  type: PayrollPaymentType;
}) =>
  Number(row.amount) *
  (row.type === PayrollPaymentType.EMPLOYEE_REFUND ? -1 : 1);
export async function payrollSummary(
  periodId: number,
  actor: PayrollActor,
  requestedEmployeeId?: number,
) {
  const selfOnly = !(
    actor.role === Role.DIRECTOR || actor.role === Role.ACCOUNTANT
  );
  if (actor.role === Role.PARTNER) throw new PayrollError("FORBIDDEN");
  const self = selfOnly
    ? await prisma.employeePayrollProfile.findUnique({
        where: { userId: actor.userId },
      })
    : null;
  if (selfOnly && !self) throw new PayrollError("EMPLOYEE_NOT_FOUND");
  const employeeId = selfOnly ? self!.id : requestedEmployeeId;
  const employees = await prisma.employeePayrollProfile.findMany({
    where: { ...(employeeId ? { id: employeeId } : {}), payrollEnabled: true },
    include: {
      user: { select: { id: true, name: true, role: true, active: true } },
      salaryRates: { orderBy: { effectiveFrom: "desc" } },
      accruals: { where: { periodId }, orderBy: { createdAt: "desc" } },
      payments: { where: { periodId }, orderBy: { paymentDate: "desc" } },
      advanceRequests: { where: { periodId }, orderBy: { createdAt: "desc" } },
    },
    orderBy: { user: { name: "asc" } },
  });
  const rows = employees.map((employee) => {
    const accrued = employee.accruals.reduce(
      (sum, row) => sum + signedAccrual(row),
      0,
    );
    const paid = employee.payments.reduce(
      (sum, row) => sum + signedPayment(row),
      0,
    );
    return { ...employee, totals: { accrued, paid, payable: accrued - paid } };
  });
  return {
    rows,
    totals: rows.reduce(
      (sum, row) => ({
        accrued: sum.accrued + row.totals.accrued,
        paid: sum.paid + row.totals.paid,
        payable: sum.payable + row.totals.payable,
      }),
      { accrued: 0, paid: 0, payable: 0 },
    ),
  };
}

export async function reverseAccrual(
  id: number,
  periodId: number,
  reason: string,
  key: string,
  requestHash: string,
  actor: PayrollActor,
) {
  director(actor);
  const reversalReason = requiredReason(reason);
  const original = await prisma.payrollAccrual.findUnique({ where: { id } });
  if (!original || original.reversalOfId) throw new PayrollError("NOT_FOUND");
  const result = await createAccrual(
    {
      employeeId: original.employeeId,
      periodId,
      earnedPeriodId: original.periodId,
      type: PayrollAccrualType.BONUS_REVERSAL,
      amount: Number(original.amount),
      orderId: original.orderId ?? undefined,
      reason: reversalReason,
      key,
      requestHash,
    },
    actor,
  );
  await prisma.$transaction(async (tx) => {
    await tx.payrollAccrual.update({
      where: { id: result.accrual.id },
      data: { reversalOfId: original.id },
    });
    await audit(tx, {
      action: "PAYROLL_ACCRUAL_REVERSED",
      actor,
      periodId,
      employeeId: original.employeeId,
      before: { accrualId: original.id, type: original.type, amount: Number(original.amount) },
      after: { reversalId: result.accrual.id },
      reason: reversalReason,
    });
  }, transactionOptions);
  return result;
}
