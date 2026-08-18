import {
  AdvanceRequestStatus,
  BonusPaymentMode,
  PayrollConfirmationStatus,
  PayrollAccrualType,
  PayrollBonusRule,
  PayrollDirection,
  PayrollPaymentType,
  PayrollPeriodStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { compareRequestHash } from "@/lib/idempotency";
import {
  calculateOrderBonus,
  calculatePayrollBreakdown,
} from "@/lib/payroll-calculation";
import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";

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
const payrollOperator = (actor: PayrollActor) => {
  if (actor.role !== Role.DIRECTOR && actor.role !== Role.ACCOUNTANT)
    throw new PayrollError("FORBIDDEN");
};
const transactionOptions = { maxWait: 10_000, timeout: 30_000 } as const;

export async function ensurePeriod(
  year: number,
  month: number,
  actor?: PayrollActor,
) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  )
    throw new PayrollError("INVALID_PERIOD");
  if (actor) director(actor);
  const period = await prisma.payrollPeriod.upsert({
    where: { companyId_year_month: { companyId: requireTenantIdentity().companyId, year, month } },
    create: { year, month },
    update: {},
  });
  if (!actor || period.status !== PayrollPeriodStatus.OPEN) return period;
  const effectiveAt = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  const employees = await prisma.employeePayrollProfile.findMany({
    where: { active: true, payrollEnabled: true },
    include: {
      salaryRates: {
        where: {
          effectiveFrom: { lte: effectiveAt },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveAt } }],
        },
        orderBy: { effectiveFrom: "desc" },
        take: 1,
      },
    },
  });
  for (const employee of employees) {
    const amount = Number(employee.salaryRates[0]?.amount ?? employee.baseSalary);
    if (amount <= 0) continue;
    const key = `salary-period:${requireTenantIdentity().companyId}:${period.id}:${employee.id}`;
    await createAccrual(
      {
        employeeId: employee.id,
        periodId: period.id,
        type: PayrollAccrualType.BASE_SALARY,
        amount,
        reason: `Оклад за ${String(month).padStart(2, "0")}.${year}`,
        key,
        requestHash: key,
      },
      actor,
    );
  }
  return period;
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
        name: user.name,
        position: user.role,
        phone: user.phone,
        email: user.email,
        hiredAt: input.hiredAt,
        baseSalary: salary,
        defaultGuaranteedBonus: guaranteed,
        comment: input.comment,
      },
      update: {
        name: user.name,
        position: user.role,
        phone: user.phone,
        email: user.email,
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
  const reason = requiredReason(comment);
  if (Number.isNaN(effectiveFrom.getTime())) throw new PayrollError("INVALID_DATE");
  return prisma.$transaction(async (tx) => {
    const profile = await tx.employeePayrollProfile.findUnique({
      where: { id: employeeId },
    });
    if (!profile) throw new PayrollError("EMPLOYEE_NOT_FOUND");
    const current = await tx.employeeSalaryRate.findFirst({
      where: { employeeId, effectiveTo: null },
      orderBy: { effectiveFrom: "desc" },
    });
    let startsAt = effectiveFrom;
    if (current && startsAt <= current.effectiveFrom) {
      const sameCalendarDay =
        startsAt.toISOString().slice(0, 10) ===
        current.effectiveFrom.toISOString().slice(0, 10);
      if (!sameCalendarDay) throw new PayrollError("INVALID_EFFECTIVE_DATE");
      startsAt = new Date(current.effectiveFrom.getTime() + 1);
    }
    if (current)
      await tx.employeeSalaryRate.update({
        where: { id: current.id },
        data: { effectiveTo: startsAt },
      });
    const rate = await tx.employeeSalaryRate.create({
      data: {
        employeeId,
        amount: salary,
        effectiveFrom: startsAt,
        approvedById: actor.userId,
        comment: reason,
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
      after: { amount: Number(salary), effectiveFrom: startsAt.toISOString() },
      reason,
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
  bonusRule?: PayrollBonusRule;
  bonusValue?: number;
  key: string;
  requestHash: string;
};

type OrderBonusSource = {
  id: number;
  number: string;
  amount: Prisma.Decimal;
  prepayment: Prisma.Decimal;
  companyProfit: Prisma.Decimal;
  managerUserId: number | null;
  status: string;
  client: { id: number; name: string };
  documents: Array<{ id: number; number: string }>;
};

const orderBonusSelect = {
  id: true,
  number: true,
  amount: true,
  prepayment: true,
  companyProfit: true,
  managerUserId: true,
  status: true,
  client: { select: { id: true, name: true } },
  documents: {
    where: { type: "CONTRACT", archivedAt: null },
    select: { id: true, number: true },
    orderBy: { documentDate: "desc" },
    take: 1,
  },
} satisfies Prisma.OrderSelect;

function orderBonusCalculation(
  order: OrderBonusSource,
  rule: PayrollBonusRule,
  value: number,
) {
  const calculation = calculateOrderBonus(rule, value, {
    paidAmount: Number(order.prepayment),
    orderAmount: Number(order.amount),
    profitAmount: Number(order.companyProfit),
  });
  return {
    ...calculation,
    snapshot: {
      orderId: order.id,
      orderNumber: order.number,
      orderAmount: Number(order.amount),
      paidAmount: Number(order.prepayment),
      profitAmount: Number(order.companyProfit),
      clientId: order.client.id,
      clientName: order.client.name,
      contractDocumentId: order.documents[0]?.id ?? null,
      contractNumber: order.documents[0]?.number ?? null,
      rule,
      value,
      calculatedAt: new Date().toISOString(),
    } satisfies Prisma.InputJsonObject,
  };
}

export async function createAccrual(input: AccrualInput, actor: PayrollActor) {
  director(actor);
  if (input.type === PayrollAccrualType.MEASUREMENT_BONUS)
    throw new PayrollError("MEASUREMENT_BONUS_AUTOMATIC_ONLY");
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
      let order: OrderBonusSource | null = null;
      if (input.orderId) {
        order = await tx.order.findFirst({
          where: { id: input.orderId, deletedAt: null },
          select: orderBonusSelect,
        });
        if (!order) throw new PayrollError("ORDER_NOT_FOUND");
        if (
          employee.userId &&
          order.managerUserId &&
          employee.userId !== order.managerUserId
        )
          throw new PayrollError("ORDER_MANAGER_MISMATCH");
        cancelledOrderWarning = /отмен|cancel/i.test(order.status);
      }
      const decreases: PayrollAccrualType[] = [
        PayrollAccrualType.DEDUCTION,
        PayrollAccrualType.ADJUSTMENT_DECREASE,
        PayrollAccrualType.BONUS_REVERSAL,
      ];
      const orderBonus = Boolean(
        order &&
        (input.type === PayrollAccrualType.ORDER_BONUS ||
          input.type === PayrollAccrualType.GUARANTEED_ORDER_BONUS),
      );
      const bonusRule = orderBonus
        ? input.bonusRule ?? PayrollBonusRule.FIXED
        : undefined;
      const bonusValue = orderBonus
        ? Number(input.bonusValue ?? input.amount)
        : undefined;
      if (orderBonus && (!Number.isFinite(bonusValue) || bonusValue! <= 0))
        throw new PayrollError("INVALID_BONUS_VALUE");
      if (
        orderBonus &&
        bonusRule !== PayrollBonusRule.FIXED &&
        bonusValue! > 100
      )
        throw new PayrollError("INVALID_BONUS_PERCENT");
      const calculation = orderBonus
        ? orderBonusCalculation(order!, bonusRule!, bonusValue!)
        : null;
      const accrualAmount = calculation?.calculatedAmount ?? input.amount;
      const accrual = await tx.payrollAccrual.create({
        data: {
          employeeId: input.employeeId,
          periodId: period.id,
          earnedPeriodId: input.earnedPeriodId,
          type: input.type,
          direction: decreases.includes(input.type)
            ? PayrollDirection.DECREASE
            : PayrollDirection.INCREASE,
          amount: orderBonus
            ? nonNegativeMoney(accrualAmount)
            : money(accrualAmount),
          orderId: input.orderId,
          reason,
          paymentMode: input.paymentMode,
          bonusRule,
          bonusValue:
            bonusValue == null ? undefined : new Prisma.Decimal(bonusValue),
          bonusBasisAmount:
            calculation == null
              ? undefined
              : new Prisma.Decimal(calculation.basisAmount),
          bonusSnapshot: calculation?.snapshot,
          approvedById: actor.userId,
          createdById: actor.userId,
          idempotencyKey: input.key,
          requestHash: input.requestHash,
        },
      });
      let payment = null;
      if (input.paymentMode === BonusPaymentMode.IMMEDIATE) {
        if (Number(accrual.amount) <= 0)
          throw new PayrollError("BONUS_NOT_PAYABLE");
        payment = await createPaymentTx(
          tx,
          {
            employeeId: input.employeeId,
            periodId: period.id,
            amount: Number(accrual.amount),
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
  reversalOfId?: number;
  reversalReason?: string;
  key: string;
  requestHash: string;
};
async function createPaymentTx(
  tx: Prisma.TransactionClient,
  input: PaymentInput,
  actor: PayrollActor,
) {
  if (Number.isNaN(input.paymentDate.getTime())) throw new PayrollError("INVALID_DATE");
  const existing = await tx.payrollPayment.findUnique({
    where: { idempotencyKey: input.key },
  });
  if (existing) {
    if (!compareRequestHash(existing.requestHash, input.requestHash))
      throw new PayrollError("IDEMPOTENCY_CONFLICT");
    return existing;
  }
  await openPeriod(tx, input.periodId);
  const employee = await tx.employeePayrollProfile.findUnique({ where: { id: input.employeeId } });
  if (!employee?.payrollEnabled || !employee.active)
    throw new PayrollError("EMPLOYEE_NOT_FOUND");
  if (input.relatedAccrualId) {
    const accrual = await tx.payrollAccrual.findFirst({
      where: {
        id: input.relatedAccrualId,
        employeeId: input.employeeId,
        periodId: input.periodId,
        direction: PayrollDirection.INCREASE,
        reversedBy: null,
      },
      include: { payments: true },
    });
    if (!accrual) throw new PayrollError("ACCRUAL_NOT_FOUND");
    const paid = accrual.payments
      .filter((payment) => !payment.reversalOfId && !payment.reversedAt)
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
    if (Number(input.amount) > Number(accrual.amount) - paid)
      throw new PayrollError("PAYMENT_EXCEEDS_ACCRUAL");
  }
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
      reversalOfId: input.reversalOfId,
      reversalReason: input.reversalReason,
      paidById: actor.userId,
      idempotencyKey: input.key,
      requestHash: input.requestHash,
    },
  });
  await tx.companyLedgerEntry.create({
    data: {
      type: "PAYROLL_PAYMENT",
      category: "SALARY",
      source: "PAYROLL_PAYMENT",
      direction:
        input.type === PayrollPaymentType.EMPLOYEE_REFUND
          ? "INCOME"
          : "EXPENSE",
      amount: payment.amount,
      operationDate: input.paymentDate,
      method: input.method,
      employeeId: input.employeeId,
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
  payrollOperator(actor);
  if (input.type === PayrollPaymentType.EMPLOYEE_REFUND)
    throw new PayrollError("FORBIDDEN");
  return prisma.$transaction(async (tx) => {
    const payment = await createPaymentTx(tx, input, actor);
    await tx.payrollAuditEvent.upsert({
      where: { idempotencyKey: `${input.key}:audit` },
      update: {},
      create: {
        action: "PAYROLL_PAYMENT_CREATED",
        actorId: actor.userId,
        periodId: input.periodId,
        employeeId: input.employeeId,
        after: { paymentId: payment.id, amount: Number(payment.amount), type: payment.type },
        reason: input.comment?.trim() || "Фактическая выплата сотруднику",
        idempotencyKey: `${input.key}:audit`,
      },
    });
    return payment;
  }, { ...transactionOptions, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function requestPaymentConfirmation(
  input: {
    periodId: number;
    amount: number;
    type: PayrollPaymentType;
    claimedPaymentDate: Date;
    method?: string;
    comment?: string;
    key: string;
    requestHash: string;
  },
  actor: PayrollActor,
) {
  if (
    actor.role === Role.PARTNER ||
    (input.type !== PayrollPaymentType.ADVANCE &&
      input.type !== PayrollPaymentType.SALARY_PAYMENT)
  )
    throw new PayrollError("FORBIDDEN");
  if (Number.isNaN(input.claimedPaymentDate.getTime()))
    throw new PayrollError("INVALID_DATE");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.payrollPaymentConfirmation.findUnique({ where: { idempotencyKey: input.key } });
    if (existing) {
      if (!compareRequestHash(existing.requestHash, input.requestHash))
        throw new PayrollError("IDEMPOTENCY_CONFLICT");
      return existing;
    }
    await openPeriod(tx, input.periodId);
    const employee = await tx.employeePayrollProfile.findUnique({ where: { userId: actor.userId } });
    if (!employee?.active || !employee.payrollEnabled)
      throw new PayrollError("EMPLOYEE_NOT_FOUND");
    const confirmation = await tx.payrollPaymentConfirmation.create({
      data: {
        employeeId: employee.id,
        periodId: input.periodId,
        amount: money(input.amount),
        type: input.type,
        claimedPaymentDate: input.claimedPaymentDate,
        method: input.method,
        comment: input.comment,
        createdById: actor.userId,
        idempotencyKey: input.key,
        requestHash: input.requestHash,
      },
    });
    await audit(tx, {
      action: "PAYMENT_CONFIRMATION_REQUESTED",
      actor,
      periodId: input.periodId,
      employeeId: employee.id,
      after: { confirmationId: confirmation.id, amount: Number(confirmation.amount), status: confirmation.status },
      reason: input.comment?.trim() || "Сотрудник сообщил о получении денег",
      idempotencyKey: `${input.key}:audit`,
    });
    return confirmation;
  }, { ...transactionOptions, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function reviewPaymentConfirmation(
  id: number,
  input: {
    decision: "CONFIRM" | "REJECT";
    comment?: string;
    key: string;
    requestHash: string;
  },
  actor: PayrollActor,
) {
  payrollOperator(actor);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${20_000_000 + id})`;
    const confirmation = await tx.payrollPaymentConfirmation.findUnique({ where: { id } });
    if (!confirmation) throw new PayrollError("CONFIRMATION_NOT_FOUND");
    if (confirmation.status === PayrollConfirmationStatus.CONFIRMED && confirmation.confirmedPaymentId)
      return { confirmation, payment: await tx.payrollPayment.findUniqueOrThrow({ where: { id: confirmation.confirmedPaymentId } }) };
    if (confirmation.status !== PayrollConfirmationStatus.PENDING)
      throw new PayrollError("CONFIRMATION_ALREADY_REVIEWED");
    if (input.decision === "REJECT") {
      const updated = await tx.payrollPaymentConfirmation.update({
        where: { id },
        data: { status: PayrollConfirmationStatus.REJECTED, reviewedById: actor.userId, reviewedAt: new Date(), reviewComment: input.comment?.trim() || null },
      });
      await audit(tx, {
        action: "PAYMENT_CONFIRMATION_REJECTED",
        actor,
        periodId: confirmation.periodId,
        employeeId: confirmation.employeeId,
        before: { status: confirmation.status },
        after: { status: updated.status },
        reason: input.comment?.trim() || "Сообщение о получении отклонено директором",
        idempotencyKey: `${input.key}:audit`,
      });
      return { confirmation: updated, payment: null };
    }
    const payment = await createPaymentTx(tx, {
      employeeId: confirmation.employeeId,
      periodId: confirmation.periodId,
      amount: Number(confirmation.amount),
      type: confirmation.type,
      paymentDate: confirmation.claimedPaymentDate,
      method: confirmation.method ?? undefined,
      comment: confirmation.comment || undefined,
      key: `payroll-confirmation:${confirmation.id}`,
      requestHash: confirmation.requestHash,
    }, actor);
    const updated = await tx.payrollPaymentConfirmation.update({
      where: { id },
      data: {
        status: PayrollConfirmationStatus.CONFIRMED,
        reviewedById: actor.userId,
        reviewedAt: new Date(),
        reviewComment: input.comment?.trim() || null,
        confirmedPaymentId: payment.id,
      },
    });
    await audit(tx, {
      action: "PAYMENT_CONFIRMATION_CONFIRMED",
      actor,
      periodId: confirmation.periodId,
      employeeId: confirmation.employeeId,
      before: { status: confirmation.status, requestedAmount: Number(confirmation.amount) },
      after: { status: updated.status, paymentId: payment.id, confirmedAmount: Number(payment.amount) },
      reason: input.comment?.trim() || "Выплата подтверждена директором",
      idempotencyKey: `${input.key}:audit`,
    });
    return { confirmation: updated, payment };
  }, { ...transactionOptions, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function reversePayment(
  id: number,
  input: { reason: string; key: string; requestHash: string },
  actor: PayrollActor,
) {
  director(actor);
  const reason = requiredReason(input.reason);
  return prisma.$transaction(async (tx) => {
    const replay = await tx.payrollPayment.findUnique({ where: { idempotencyKey: input.key } });
    if (replay) {
      if (!compareRequestHash(replay.requestHash, input.requestHash)) throw new PayrollError("IDEMPOTENCY_CONFLICT");
      return replay;
    }
    await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${30_000_000 + id})`;
    const original = await tx.payrollPayment.findUnique({ where: { id }, include: { reversal: true } });
    if (!original || original.reversalOfId) throw new PayrollError("PAYMENT_NOT_FOUND");
    if (original.reversal || original.reversedAt) throw new PayrollError("PAYMENT_ALREADY_REVERSED");
    const reversal = await createPaymentTx(tx, {
      employeeId: original.employeeId,
      periodId: original.periodId,
      amount: Number(original.amount),
      type: PayrollPaymentType.EMPLOYEE_REFUND,
      paymentDate: new Date(),
      method: original.method ?? undefined,
      comment: `Сторно: ${reason}`,
      reversalOfId: original.id,
      reversalReason: reason,
      key: input.key,
      requestHash: input.requestHash,
    }, actor);
    await tx.payrollPayment.update({ where: { id: original.id }, data: { reversedAt: reversal.paymentDate } });
    await audit(tx, {
      action: "PAYROLL_PAYMENT_REVERSED",
      actor,
      periodId: original.periodId,
      employeeId: original.employeeId,
      before: { paymentId: original.id, amount: Number(original.amount), type: original.type },
      after: { reversalId: reversal.id, amount: Number(reversal.amount) },
      reason,
      idempotencyKey: `${input.key}:audit`,
    });
    return reversal;
  }, { ...transactionOptions, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function requestAdvance(
  input: {
    periodId: number;
    amount: number;
    method?: string;
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
      method: input.method,
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
    method?: string;
    comment?: string;
    key: string;
    requestHash: string;
  },
  actor: PayrollActor,
) {
  payrollOperator(actor);
  if (!(
    input.status === AdvanceRequestStatus.APPROVED ||
    input.status === AdvanceRequestStatus.REJECTED
  ))
    throw new PayrollError("INVALID_STATUS");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${25_000_000 + id})`;
    const request = await tx.payrollAdvanceRequest.findUnique({
      where: { id },
      include: { payment: true },
    });
    if (!request) throw new PayrollError("CONFLICT");
    if (
      input.status === AdvanceRequestStatus.APPROVED &&
      request.status === AdvanceRequestStatus.PAID &&
      request.payment
    )
      return { request, payment: request.payment };
    if (
      input.status === AdvanceRequestStatus.REJECTED &&
      request.status === AdvanceRequestStatus.REJECTED
    )
      return { request, payment: null };
    if (request.status !== AdvanceRequestStatus.REQUESTED)
      throw new PayrollError("CONFLICT");
    await openPeriod(tx, request.periodId);
    const payment = input.status === AdvanceRequestStatus.APPROVED
      ? await createPaymentTx(
          tx,
          {
            employeeId: request.employeeId,
            periodId: request.periodId,
            amount: Number(request.requestedAmount),
            type: PayrollPaymentType.ADVANCE,
            paymentDate: new Date(),
            method: request.method ?? input.method ?? "bank_transfer",
            comment: request.comment ?? input.comment,
            key: `payroll-advance:${request.id}`,
            requestHash: request.requestHash,
          },
          actor,
        )
      : null;
    const updated = await tx.payrollAdvanceRequest.update({
      where: { id },
      data: {
        status: payment
          ? AdvanceRequestStatus.PAID
          : AdvanceRequestStatus.REJECTED,
        approvedAmount: payment ? request.requestedAmount : null,
        paymentId: payment?.id,
        reviewComment: input.comment,
        reviewedById: actor.userId,
        reviewedAt: new Date(),
      },
      include: { payment: true },
    });
    await audit(tx, {
      action: payment ? "ADVANCE_CONFIRMED_AND_PAID" : "ADVANCE_REJECTED",
      actor,
      periodId: request.periodId,
      employeeId: request.employeeId,
      before: { status: request.status, requestedAmount: Number(request.requestedAmount) },
      after: {
        status: updated.status,
        approvedAmount: updated.approvedAmount
          ? Number(updated.approvedAmount)
          : null,
        paymentId: payment?.id ?? null,
      },
      reason:
        input.comment?.trim() ||
        (payment ? "Аванс подтверждён и выплачен" : "Аванс отклонён"),
      idempotencyKey: `${input.key}:audit`,
    });
    return { request: updated, payment };
  }, { ...transactionOptions, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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
  payrollOperator(actor);
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

async function refreshDynamicOrderBonuses(
  periodId: number,
  employeeId?: number,
) {
  const period = await prisma.payrollPeriod.findUnique({
    where: { id: periodId },
    select: { status: true },
  });
  if (period?.status !== PayrollPeriodStatus.OPEN) return;
  const accruals = await prisma.payrollAccrual.findMany({
    where: {
      periodId,
      ...(employeeId ? { employeeId } : {}),
      reversedBy: null,
      bonusRule: {
        in: [PayrollBonusRule.PAID_PERCENT, PayrollBonusRule.PROFIT_PERCENT],
      },
      orderId: { not: null },
    },
    include: { order: { select: orderBonusSelect } },
  });
  const updates = accruals.flatMap((accrual) => {
    if (!accrual.order || !accrual.bonusRule || accrual.bonusValue == null)
      return [];
    const calculation = orderBonusCalculation(
      accrual.order,
      accrual.bonusRule,
      Number(accrual.bonusValue),
    );
    if (
      Number(accrual.amount) === calculation.calculatedAmount &&
      Number(accrual.bonusBasisAmount ?? 0) === calculation.basisAmount
    )
      return [];
    return [
      prisma.payrollAccrual.update({
        where: { id: accrual.id },
        data: {
          amount: calculation.calculatedAmount,
          bonusBasisAmount: calculation.basisAmount,
          bonusSnapshot: calculation.snapshot,
        },
      }),
    ];
  });
  if (updates.length) await prisma.$transaction(updates);
}

function plannedWorkDays(year: number, month: number) {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let result = 0;
  for (let day = 1; day <= days; day += 1) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) result += 1;
  }
  return result;
}

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
  const period = await prisma.payrollPeriod.findUnique({
    where: { id: periodId },
    select: { year: true, month: true },
  });
  if (!period) throw new PayrollError("PERIOD_NOT_FOUND");
  const plannedDays = plannedWorkDays(period.year, period.month);
  await refreshDynamicOrderBonuses(periodId, employeeId);
  const [employees, settings] = await Promise.all([prisma.employeePayrollProfile.findMany({
    where: {
      ...(employeeId ? { id: employeeId } : {}),
      payrollEnabled: true,
      active: true,
    },
    include: {
      user: { select: { id: true, name: true, role: true, active: true } },
      salaryRates: { include: { approvedBy: { select: { id: true, name: true } } }, orderBy: { effectiveFrom: "desc" } },
      accruals: {
        where: { periodId },
        include: {
          payments: true,
          reversedBy: { select: { id: true } },
          approvedBy: { select: { id: true, name: true } },
          order: {
            select: {
              id: true,
              number: true,
              amount: true,
              prepayment: true,
              companyProfit: true,
              client: { select: { id: true, name: true } },
              documents: {
                where: { type: "CONTRACT", archivedAt: null },
                select: { id: true, number: true },
                orderBy: { documentDate: "desc" },
                take: 1,
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      payments: {
        where: { periodId },
        include: {
          paidBy: { select: { id: true, name: true } },
          reversalOf: { select: { id: true, type: true } },
        },
        orderBy: { paymentDate: "desc" },
      },
      paymentConfirmations: {
        where: { periodId },
        include: {
          createdBy: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      advanceRequests: {
        where: { periodId },
        include: {
          reviewedBy: { select: { id: true, name: true } },
          payment: { select: { id: true, method: true, paymentDate: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { name: "asc" },
  }), prisma.systemSettings.upsert({ where: { companyId: requireTenantIdentity().companyId }, create: {}, update: {}, select: { paydayDayOfMonth: true } })]);
  const rows = employees.map((employee) => {
    const calculated = calculatePayrollBreakdown(
      employee.accruals,
      employee.payments,
    );
    const pending = employee.paymentConfirmations
      .filter((row) => row.status === PayrollConfirmationStatus.PENDING)
      .reduce((sum, row) => sum + Number(row.amount), 0);
    const activeRate = employee.salaryRates.find((rate) =>
      rate.effectiveFrom <= new Date() && (!rate.effectiveTo || rate.effectiveTo > new Date()),
    ) ?? employee.salaryRates[0];
    const bonusTypes = new Set<PayrollAccrualType>([
      PayrollAccrualType.GUARANTEED_ORDER_BONUS,
      PayrollAccrualType.ORDER_BONUS,
      PayrollAccrualType.MEASUREMENT_BONUS,
      PayrollAccrualType.EXTRA_BONUS,
    ]);
    const bonusAccruals = employee.accruals
      .filter(
        (row) =>
          row.direction === PayrollDirection.INCREASE && bonusTypes.has(row.type),
      )
      .map((row) => {
        const bonusPaid = row.payments
          .filter((payment) => !payment.reversalOfId && !payment.reversedAt)
          .reduce((sum, payment) => sum + Number(payment.amount), 0);
        const payable = Math.max(Number(row.amount) - bonusPaid, 0);
        return {
          id: row.id,
          orderId: row.orderId,
          measurementId: row.measurementId,
          type: row.type,
          amount: Number(row.amount),
          rule: row.bonusRule ?? PayrollBonusRule.FIXED,
          ruleValue: Number(row.bonusValue ?? row.amount),
          basisAmount: Number(row.bonusBasisAmount ?? 0),
          order: row.order
            ? {
                id: row.order.id,
                number: row.order.number,
                amount: Number(row.order.amount),
                paid: Number(row.order.prepayment),
                profit: Number(row.order.companyProfit),
                client: row.order.client,
                contract: row.order.documents[0] ?? null,
              }
            : null,
          approvedBy: row.approvedBy,
          accruedAt: row.createdAt,
          paid: bonusPaid,
          payable,
          status: payable <= 0 ? "PAID" : bonusPaid > 0 ? "PARTIALLY_PAID" : "ACCRUED",
        };
      });
    const identity = employee.user
      ? employee.user
      : { id: 0, name: employee.name || "Сотрудник", role: employee.position || "EMPLOYEE", active: false };
    return {
      ...employee,
      user: identity,
      hasOrdaAccess: Boolean(employee.userId),
      currentSalary: Number(activeRate?.amount ?? employee.baseSalary),
      salaryEffectiveFrom: activeRate?.effectiveFrom ?? employee.hiredAt,
      plannedDays,
      workedDays: plannedDays,
      calculatedSalary: calculated.salaryAccrued,
      breakdown: {
        ...calculated,
      },
      bonusAccruals,
      totals: {
        accrued: calculated.totalAccrued,
        paid: calculated.totalPaid,
        received: calculated.totalPaid,
        deductions: calculated.deductions,
        pending,
        payable: calculated.payable,
      },
    };
  });
  const breakdown = rows.reduce((sum, row) => ({
    salaryAccrued: sum.salaryAccrued + row.breakdown.salaryAccrued,
    bonusesAccrued: sum.bonusesAccrued + row.breakdown.bonusesAccrued,
    premiumsAccrued: sum.premiumsAccrued + row.breakdown.premiumsAccrued,
    otherAccruals: sum.otherAccruals + row.breakdown.otherAccruals,
    advancesPaid: sum.advancesPaid + row.breakdown.advancesPaid,
    partialPayments: sum.partialPayments + row.breakdown.partialPayments,
    finalPayments: sum.finalPayments + row.breakdown.finalPayments,
    salaryPayments: sum.salaryPayments + row.breakdown.salaryPayments,
    deductions: sum.deductions + row.breakdown.deductions,
    totalAccrued: sum.totalAccrued + row.breakdown.totalAccrued,
    totalPaid: sum.totalPaid + row.breakdown.totalPaid,
    payable: sum.payable + row.breakdown.payable,
  }), {
    salaryAccrued: 0,
    bonusesAccrued: 0,
    premiumsAccrued: 0,
    otherAccruals: 0,
    advancesPaid: 0,
    partialPayments: 0,
    finalPayments: 0,
    salaryPayments: 0,
    deductions: 0,
    totalAccrued: 0,
    totalPaid: 0,
    payable: 0,
  });
  return {
    rows,
    settings,
    breakdown,
    totals: rows.reduce(
      (sum, row) => ({
        accrued: sum.accrued + row.totals.accrued,
        paid: sum.paid + row.totals.paid,
        received: sum.received + row.totals.received,
        deductions: sum.deductions + row.totals.deductions,
        pending: sum.pending + row.totals.pending,
        payable: sum.payable + row.totals.payable,
      }),
      { accrued: 0, paid: 0, received: 0, deductions: 0, pending: 0, payable: 0 },
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
