import {
  AdvanceRequestStatus,
  BonusPaymentMode,
  CalendarTaskStatus,
  CalendarTaskWorkflow,
  MeasurementStatus,
  OrderLifecycle,
  PayrollConfirmationStatus,
  PayrollAccrualType,
  PayrollDirection,
  PayrollPaymentType,
  PayrollPeriodStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { compareRequestHash } from "@/lib/idempotency";
import {
  companyMonthRange,
  companyYearMonth,
  isCompanyMonthStarted,
} from "@/lib/company-calendar";
import {
  AUTOMATIC_ORDER_BONUS_REASON_PREFIX,
  auditManagerOrderBonus,
  isCompanyResponsibleOrder,
  isDateInPayrollPeriod,
  isManagerOrderBonusAutomaticPeriod,
  managerOrderBonus,
  managerOrderBonusEarnedAt,
  managerOrderBonusEarnedEvent,
  isManagerOrderBonusEligible,
  isOrderAssignedToManager,
  isSalesManagerPayrollEmployee,
  isPayrollReconciled,
  isTerminatedPayrollEmployee,
  isValidOptionalPaymentReference,
  MANAGER_ORDER_BONUS_HIGH,
  MANAGER_ORDER_BONUS_STANDARD,
  MANAGER_ORDER_BONUS_THRESHOLD,
  PAYROLL_POLICY_ADJUSTMENT_PREFIX,
  PAYROLL_SALARY_ADJUSTMENT_PREFIX,
  personalPayrollCalculation,
  payrollSalaryForPeriod,
  payrollPaymentPurpose,
  payrollPaymentReference,
} from "@/lib/payroll-policy";
import { prisma } from "@/lib/prisma";
import { orderDataGaps } from "@/lib/orders/completeness";
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
  if (actor.role !== Role.OPERATIONS_DIRECTOR && actor.role !== Role.DIRECTOR)
    throw new PayrollError("FORBIDDEN");
};
const orderBonusManager = (actor: PayrollActor) => {
  if (
    actor.role !== Role.DIRECTOR &&
    actor.role !== Role.OPERATIONS_DIRECTOR
  )
    throw new PayrollError("FORBIDDEN");
};
const salaryManager = (actor: PayrollActor) => {
  if (
    actor.role !== Role.DIRECTOR &&
    actor.role !== Role.OPERATIONS_DIRECTOR
  )
    throw new PayrollError("FORBIDDEN");
};
const payrollOperator = (actor: PayrollActor) => {
  if (
    actor.role !== Role.OPERATIONS_DIRECTOR &&
    actor.role !== Role.DIRECTOR
  )
    throw new PayrollError("FORBIDDEN");
};
const transactionOptions = { maxWait: 10_000, timeout: 30_000 } as const;

type BonusEmployment = {
  active: boolean;
  terminatedAt?: Date | null;
  user?: { active?: boolean | null } | null;
};

type BonusOrderTiming = {
  orderReceivedAt: Date;
  completedAt?: Date | null;
  lifecycle?: string | null;
};

const employmentEnded = (employee: BonusEmployment) =>
  isTerminatedPayrollEmployee({
    active: employee.active,
    terminatedAt: employee.terminatedAt,
    accountActive: employee.user?.active,
  });

const bonusEarnedAt = (
  order: BonusOrderTiming,
  employee: BonusEmployment,
) =>
  managerOrderBonusEarnedAt({
    orderReceivedAt: order.orderReceivedAt,
    completedAt: order.completedAt,
    lifecycle: order.lifecycle,
    employeeActive: employee.active,
    employeeTerminatedAt: employee.terminatedAt,
    accountActive: employee.user?.active,
  });

const bonusEarnedInRange = (
  order: BonusOrderTiming,
  employee: BonusEmployment,
  range: { start: Date; end: Date },
) => {
  const earnedAt = bonusEarnedAt(order, employee);
  return earnedAt && isDateInPayrollPeriod(earnedAt, range.start, range.end)
    ? earnedAt
    : null;
};

function payrollPolicyStateSignature(
  salaryDelta: number,
  orderDeltas: Array<{ orderId: number; delta: number }>,
) {
  const value = {
    salaryDelta: Math.round(salaryDelta * 100),
    orderDeltas: orderDeltas
      .map((row) => ({ orderId: row.orderId, delta: Math.round(row.delta * 100) }))
      .sort((a, b) => a.orderId - b.orderId),
  };
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function ensurePeriod(year: number, month: number) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  )
    throw new PayrollError("INVALID_PERIOD");
  return prisma.payrollPeriod.upsert({
    where: { companyId_year_month: { companyId: requireTenantIdentity().companyId, year, month } },
    create: { year, month },
    update: {},
  });
}

async function openPeriod(tx: Prisma.TransactionClient, periodId: number) {
  const period = await tx.payrollPeriod.findFirst({
    where: { id: periodId, companyId: requireTenantIdentity().companyId },
  });
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
  salaryManager(actor);
  const salary = nonNegativeMoney(input.baseSalary);
  const guaranteed = nonNegativeMoney(input.defaultGuaranteedBonus ?? 0);
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
        salaryPlanEnabled: Number(salary) > 0,
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
        salaryPlanEnabled: Number(salary) > 0,
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
          planEnabled: Number(salary) > 0,
          effectiveFrom: input.hiredAt,
          approvedById: actor.userId,
          comment: input.comment,
        },
      });
      await tx.employeePayrollProfile.update({
        where: { id: profile.id },
        data: { baseSalary: salary },
      });
    } else if (current.planEnabled !== (Number(salary) > 0)) {
      await tx.employeeSalaryRate.update({
        where: { id: current.id },
        data: { planEnabled: Number(salary) > 0 },
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
  salaryManager(actor);
  const salary = nonNegativeMoney(amount);
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
    if (
      current &&
      startsAt < current.effectiveFrom &&
      Number(current.amount) === Number(salary)
    ) {
      const earlierRates = await tx.employeeSalaryRate.findMany({
        where: {
          employeeId,
          id: { not: current.id },
          effectiveFrom: { lt: current.effectiveFrom },
        },
        orderBy: { effectiveFrom: "desc" },
      });
      const previousIndex = earlierRates.findIndex(
        (rate) => Number(rate.amount) !== Number(salary),
      );
      const previous = earlierRates[previousIndex];
      if (previous && startsAt <= previous.effectiveFrom) {
        const sameCalendarDay =
          startsAt.toISOString().slice(0, 10) ===
          previous.effectiveFrom.toISOString().slice(0, 10);
        if (!sameCalendarDay) throw new PayrollError("INVALID_EFFECTIVE_DATE");
        startsAt = new Date(previous.effectiveFrom.getTime() + 1);
      }
      if (!previous && startsAt < profile.hiredAt) {
        const sameCalendarDay =
          startsAt.toISOString().slice(0, 10) ===
          profile.hiredAt.toISOString().slice(0, 10);
        if (!sameCalendarDay) throw new PayrollError("INVALID_EFFECTIVE_DATE");
        startsAt = profile.hiredAt;
      }
      const redundantRates = previous
        ? earlierRates.slice(0, previousIndex)
        : earlierRates;
      if (previous) {
        await tx.employeeSalaryRate.update({
          where: { id: previous.id },
          data: { effectiveTo: startsAt },
        });
      }
      if (redundantRates.length) {
        await tx.employeeSalaryRate.updateMany({
          where: { id: { in: redundantRates.map((rate) => rate.id) } },
          data: { effectiveFrom: startsAt, effectiveTo: startsAt },
        });
        startsAt = new Date(startsAt.getTime() + 1);
      }
      const corrected = await tx.employeeSalaryRate.update({
        where: { id: current.id },
        data: {
          effectiveFrom: startsAt,
          planEnabled: Number(salary) > 0,
          approvedById: actor.userId,
          comment: reason,
        },
      });
      await audit(tx, {
        action: "SALARY_EFFECTIVE_DATE_CORRECTED",
        actor,
        employeeId,
        before: {
          amount: Number(current.amount),
          effectiveFrom: current.effectiveFrom.toISOString(),
        },
        after: {
          amount: Number(salary),
          effectiveFrom: startsAt.toISOString(),
        },
        reason,
      });
      await tx.employeePayrollProfile.update({
        where: { id: employeeId },
        data: { salaryPlanEnabled: Number(salary) > 0 },
      });
      return corrected;
    }
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
        planEnabled: Number(salary) > 0,
        effectiveFrom: startsAt,
        approvedById: actor.userId,
        comment: reason,
      },
    });
    await tx.employeePayrollProfile.update({
      where: { id: employeeId },
      data: { baseSalary: salary, salaryPlanEnabled: Number(salary) > 0 },
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
  salaryManager(actor);
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
  externalReference?: string;
  paymentMode?: BonusPaymentMode;
  manualOverride?: boolean;
  key: string;
  requestHash: string;
};

export async function createAccrual(input: AccrualInput, actor: PayrollActor) {
  if (input.type === PayrollAccrualType.BASE_SALARY) {
    if (
      actor.role !== Role.DIRECTOR &&
      actor.role !== Role.OPERATIONS_DIRECTOR
    )
      throw new PayrollError("FORBIDDEN");
  } else if (
    input.type === PayrollAccrualType.ORDER_BONUS ||
    input.type === PayrollAccrualType.GUARANTEED_ORDER_BONUS
  )
    orderBonusManager(actor);
  else salaryManager(actor);
  return createAccrualInternal(input, actor);
}

export async function createSelfAccrual(
  input: Omit<AccrualInput, "employeeId">,
  actor: PayrollActor,
) {
  if (actor.role !== Role.MANAGER) throw new PayrollError("FORBIDDEN");
  if (
    input.type !== PayrollAccrualType.ORDER_BONUS &&
    input.type !== PayrollAccrualType.DEDUCTION
  )
    throw new PayrollError("FORBIDDEN");
  const employee = await prisma.employeePayrollProfile.findUnique({
    where: { userId: actor.userId },
    select: { id: true, active: true, payrollEnabled: true },
  });
  if (!employee?.active || !employee.payrollEnabled)
    throw new PayrollError("EMPLOYEE_NOT_FOUND");
  return createAccrualInternal(
    { ...input, employeeId: employee.id },
    actor,
    { managerUserId: actor.userId, managerName: actor.name },
  );
}

async function createAccrualInternal(
  input: AccrualInput,
  actor: PayrollActor,
  orderScope?: { managerUserId: number; managerName: string },
) {
  if (input.type === PayrollAccrualType.MEASUREMENT_BONUS)
    throw new PayrollError("MEASUREMENT_BONUS_AUTOMATIC_ONLY");
  const isOrderBonus =
    input.type === PayrollAccrualType.ORDER_BONUS ||
    input.type === PayrollAccrualType.GUARANTEED_ORDER_BONUS;
  const usesAutomaticOrderBonusPolicy =
    input.type === PayrollAccrualType.ORDER_BONUS;
  const externalReference = input.externalReference?.trim() || undefined;
  if (
    input.type === PayrollAccrualType.BASE_SALARY &&
    !isValidOptionalPaymentReference(externalReference)
  )
    throw new PayrollError("KASPI_REFERENCE_REQUIRED");
  const reason = usesAutomaticOrderBonusPolicy && !input.manualOverride
    ? input.reason.trim() || "Автоматический бонус по сумме заказа"
    : requiredReason(
        input.reason,
        usesAutomaticOrderBonusPolicy
          ? "BONUS_OVERRIDE_REASON_REQUIRED"
          : "REASON_REQUIRED",
      );
  try {
    return await prisma.$transaction(
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
        const employee = await tx.employeePayrollProfile.findFirst({
          where: {
            id: input.employeeId,
            companyId: requireTenantIdentity().companyId,
          },
          include: {
            user: { select: { id: true, name: true, role: true, active: true } },
          },
        });
        const terminatedManager = Boolean(employee && employmentEnded(employee) && isSalesManagerPayrollEmployee(employee));
        if (
          !employee?.payrollEnabled ||
          (employmentEnded(employee) &&
            !(isOrderBonus && terminatedManager) &&
            input.type !== PayrollAccrualType.BASE_SALARY)
        )
          throw new PayrollError("EMPLOYEE_NOT_FOUND");
        if (input.type === PayrollAccrualType.BASE_SALARY) {
        const range = companyMonthRange(period.year, period.month);
        const salaryRates = await tx.employeeSalaryRate.findMany({
          where: { employeeId: input.employeeId },
          orderBy: { effectiveFrom: "desc" },
        });
        const periodSalary = payrollSalaryForPeriod({
          hiredAt: employee.hiredAt,
          terminatedAt: employee.terminatedAt,
          baseSalary: employee.baseSalary,
          salaryRates,
          periodStart: range.start,
          periodEnd: range.end,
        });
        if (!periodSalary.employedInPeriod)
          throw new PayrollError("EMPLOYEE_NOT_FOUND");
        const activeRate = salaryRates.find(
          (rate) =>
            rate.effectiveFrom < range.end &&
            (!rate.effectiveTo || rate.effectiveTo > range.start),
        );
        const salaryPlanEnabled =
          periodSalary.employedInPeriod &&
          (activeRate?.planEnabled ??
            (salaryRates.length === 0 && employee.salaryPlanEnabled));
        if (
          salaryPlanEnabled &&
          !money(input.amount).equals(periodSalary.amount)
        )
          throw new PayrollError("SALARY_AMOUNT_MISMATCH");
        const existingSalary = await tx.payrollAccrual.findFirst({
          where: {
            employeeId: input.employeeId,
            periodId: period.id,
            type: PayrollAccrualType.BASE_SALARY,
            direction: PayrollDirection.INCREASE,
            reversalOfId: null,
            reversedBy: { is: null },
          },
          select: { id: true },
        });
        if (existingSalary) throw new PayrollError("SALARY_ALREADY_ACCRUED");
      }
      if (
        (input.type === PayrollAccrualType.ORDER_BONUS ||
          input.type === PayrollAccrualType.GUARANTEED_ORDER_BONUS) &&
        !input.orderId
      )
        throw new PayrollError("ORDER_REQUIRED");
      let cancelledOrderWarning = false;
      let expectedOrderBonus: number | null = null;
      let resolvedAmount: Prisma.Decimal | null = null;
      if (input.orderId) {
        const monthRange = companyMonthRange(period.year, period.month);
        const order = await tx.order.findFirst({
          where: {
            id: input.orderId,
            companyId: requireTenantIdentity().companyId,
            deletedAt: null,
            orderDateNeedsReview: false,
            ...(!(isOrderBonus && terminatedManager)
              ? {
                  orderReceivedAt: {
                    gte: monthRange.start,
                    lt: monthRange.end,
                  },
                }
              : {}),
            ...(isOrderBonus
              ? {
                  OR: [
                    ...(employee.userId
                      ? [{ managerUserId: employee.userId }]
                      : []),
                    {
                      managerUserId: null,
                      manager: {
                        equals: employee.name || employee.user?.name || orderScope?.managerName || "",
                        mode: "insensitive" as const,
                      },
                    },
                    ...(employee.userId
                      ? [{ leadConversion: { managerId: employee.userId } }]
                      : []),
                  ],
                }
              : {}),
          },
          select: {
            status: true,
            lifecycle: true,
            amount: true,
            deletedAt: true,
            manager: true,
            managerUserId: true,
            orderReceivedAt: true,
            completedAt: true,
            leadConversion: { select: { managerId: true } },
          },
        });
        if (!order) throw new PayrollError("ORDER_OUTSIDE_PERIOD");
        if (
          isOrderBonus &&
          !isOrderAssignedToManager(
            {
              managerUserId: order.managerUserId,
              leadManagerId: order.leadConversion?.managerId,
              managerName: order.manager,
            },
            {
              id: employee.userId ?? -1,
              name:
                employee.user?.name ||
                employee.name ||
                orderScope?.managerName ||
                "",
            },
          )
        )
          throw new PayrollError("ORDER_OUTSIDE_PERIOD");
        if (
          isOrderBonus &&
          !bonusEarnedInRange(order, employee, monthRange)
        )
          throw new PayrollError(
            terminatedManager &&
              (order.lifecycle !== OrderLifecycle.COMPLETED || !order.completedAt)
              ? "ORDER_NOT_COMPLETED_FOR_TERMINATED_EMPLOYEE"
              : "ORDER_OUTSIDE_PERIOD",
          );
        cancelledOrderWarning = /отмен|cancel/i.test(order.status);
        if (usesAutomaticOrderBonusPolicy) {
          if (
            !isManagerOrderBonusEligible({
              ...order,
              managerName: order.manager,
            })
          )
            throw new PayrollError("ORDER_NOT_ELIGIBLE_FOR_BONUS");
          expectedOrderBonus = managerOrderBonus(Number(order.amount));
          resolvedAmount = input.manualOverride
            ? money(input.amount)
            : money(expectedOrderBonus);
        }
      }
      if (
        input.type === PayrollAccrualType.ORDER_BONUS ||
        input.type === PayrollAccrualType.GUARANTEED_ORDER_BONUS
      ) {
        const duplicate = await tx.payrollAccrual.findFirst({
          where: {
            orderId: input.orderId,
            type: {
              in: [
                PayrollAccrualType.ORDER_BONUS,
                PayrollAccrualType.GUARANTEED_ORDER_BONUS,
              ],
            },
            direction: PayrollDirection.INCREASE,
            reversalOfId: null,
            reversedBy: { is: null },
          },
          select: { id: true },
        });
        if (duplicate) throw new PayrollError("ORDER_BONUS_ALREADY_EXISTS");
      }
      const decreases: PayrollAccrualType[] = [
        PayrollAccrualType.DEDUCTION,
        PayrollAccrualType.ADJUSTMENT_DECREASE,
        PayrollAccrualType.BONUS_REVERSAL,
      ];
      resolvedAmount ??= money(input.amount);
      const accrual = await tx.payrollAccrual.create({
        data: {
          employeeId: input.employeeId,
          periodId: period.id,
          earnedPeriodId: input.earnedPeriodId,
          type: input.type,
          direction: decreases.includes(input.type)
            ? PayrollDirection.DECREASE
            : PayrollDirection.INCREASE,
          amount: resolvedAmount,
          orderId: input.orderId,
          reason,
          externalReference:
            input.type === PayrollAccrualType.BASE_SALARY
              ? externalReference
              : undefined,
          paymentMode: input.paymentMode,
          approvedById: actor.userId,
          createdById: actor.userId,
          idempotencyKey: input.key,
          orderBonusUniquenessKey:
            input.orderId &&
            (input.type === PayrollAccrualType.ORDER_BONUS ||
              input.type === PayrollAccrualType.GUARANTEED_ORDER_BONUS)
              ? `order-bonus:${input.orderId}`
              : undefined,
          requestHash: input.requestHash,
        },
      });
      await tx.companyLedgerEntry.create({
        data: {
          type: "PAYROLL_ACCRUAL",
          category: "SALARY",
          source: "OTHER_SYSTEM",
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
            amount: Number(resolvedAmount),
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
        after: {
          accrualId: accrual.id,
          type: accrual.type,
          amount: Number(accrual.amount),
          externalReference: accrual.externalReference,
          expectedOrderBonus,
          manualOverride: Boolean(input.manualOverride),
          direction: accrual.direction,
        },
        reason,
        idempotencyKey: `${input.key}:audit`,
      });
      return {
        accrual,
        payment,
        created: true,
        cancelledOrderWarning,
        expectedOrderBonus,
        automaticAmount:
          usesAutomaticOrderBonusPolicy && !input.manualOverride,
      };
      },
      { ...transactionOptions, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      (input.type === PayrollAccrualType.ORDER_BONUS ||
        input.type === PayrollAccrualType.GUARANTEED_ORDER_BONUS) &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new PayrollError("ORDER_BONUS_ALREADY_EXISTS");
    throw error;
  }
}

type PaymentInput = {
  employeeId: number;
  periodId: number;
  amount: number;
  type: PayrollPaymentType;
  paymentDate: Date;
  method?: string;
  externalReference?: string;
  comment?: string;
  relatedAccrualId?: number;
  partialSalary?: boolean;
  reversalOfId?: number;
  reversalReason?: string;
  key: string;
  requestHash: string;
};

async function managerPayrollPolicyState(
  tx: Prisma.TransactionClient,
  employeeId: number,
  period: { id: number; year: number; month: number },
) {
  const employee = await tx.employeePayrollProfile.findUnique({
    where: { id: employeeId },
    include: {
      user: { select: { role: true, name: true, active: true } },
      salaryRates: { orderBy: { effectiveFrom: "desc" } },
      accruals: {
        where: { periodId: period.id },
        include: { reversedBy: { select: { id: true } } },
      },
    },
  });
  if (!employee) throw new PayrollError("EMPLOYEE_NOT_FOUND");
  const applies = isSalesManagerPayrollEmployee(employee);
  if (!applies)
    return {
      applies: false,
      delta: 0,
      salaryDelta: 0,
      orderBonusDelta: 0,
      orderDeltas: [],
      reconciled: true,
      manualApproved: false,
      signature: "",
    };

  const range = companyMonthRange(period.year, period.month);
  const periodSalary = payrollSalaryForPeriod({
    hiredAt: employee.hiredAt,
    terminatedAt: employee.terminatedAt,
    baseSalary: employee.baseSalary,
    salaryRates: employee.salaryRates,
    periodStart: range.start,
    periodEnd: range.end,
  });
  const activeAccruals = employee.accruals.filter(
    (row) => !row.reversalOfId && !row.reversedBy,
  );
  const signed = (row: (typeof activeAccruals)[number]) =>
    Number(row.amount) *
    (row.direction === PayrollDirection.INCREASE ? 1 : -1);
  const salaryPosted = activeAccruals
    .filter(
      (row) =>
        row.type === PayrollAccrualType.BASE_SALARY ||
        row.reason.startsWith(PAYROLL_SALARY_ADJUSTMENT_PREFIX),
    )
    .reduce((sum, row) => sum + signed(row), 0);
  const activeRate = employee.salaryRates.find(
    (rate) =>
      rate.effectiveFrom < range.end &&
      (!rate.effectiveTo || rate.effectiveTo > range.start),
  );
  const salaryPlanEnabled =
    periodSalary.employedInPeriod &&
    (activeRate?.planEnabled ??
      (employee.salaryRates.length === 0 && employee.salaryPlanEnabled));
  const requiredSalary = salaryPlanEnabled
    ? periodSalary.amount
    : Math.max(salaryPosted, 0);
  const periodOrders = await tx.order.findMany({
    where: {
      companyId: requireTenantIdentity().companyId,
      orderDateNeedsReview: false,
      orderReceivedAt: { gte: range.start, lt: range.end },
      AND: [{ OR: [
        ...(employee.userId ? [{ managerUserId: employee.userId }] : []),
        {
          managerUserId: null,
          manager: { equals: employee.name, mode: "insensitive" as const },
        },
        ...(employee.userId
          ? [{ leadConversion: { managerId: employee.userId } }]
          : []),
      ] }],
    },
    select: {
      id: true,
      amount: true,
      status: true,
      lifecycle: true,
      deletedAt: true,
      manager: true,
      managerUserId: true,
      orderReceivedAt: true,
      completedAt: true,
      leadConversion: { select: { managerId: true } },
    },
  });
  const orders = periodOrders.filter(
    (order) =>
      isOrderAssignedToManager(
        {
          managerUserId: order.managerUserId,
          leadManagerId: order.leadConversion?.managerId,
          managerName: order.manager,
        },
        {
          id: employee.userId ?? -1,
          name: employee.user?.name || employee.name,
        },
      ) && Boolean(bonusEarnedInRange(order, employee, range)),
  );
  const requiredByOrder = new Map(
    orders.map((order) => [
      order.id,
      isManagerOrderBonusEligible({ ...order, managerName: order.manager })
        ? managerOrderBonus(Number(order.amount))
        : 0,
    ]),
  );
  const postedOrderRows = activeAccruals
    .filter(
      (row) =>
        Boolean(row.orderId) &&
        (row.type === PayrollAccrualType.ORDER_BONUS ||
          row.type === PayrollAccrualType.GUARANTEED_ORDER_BONUS ||
          ((row.type === PayrollAccrualType.ADJUSTMENT_INCREASE ||
            row.type === PayrollAccrualType.ADJUSTMENT_DECREASE) &&
            row.reason.startsWith(PAYROLL_POLICY_ADJUSTMENT_PREFIX))),
    );
  const orderIds = new Set([
    ...requiredByOrder.keys(),
    ...postedOrderRows
      .map((row) => row.orderId)
      .filter((value): value is number => Boolean(value)),
  ]);
  const orderDeltas = [...orderIds].map((orderId) => {
    const required = requiredByOrder.get(orderId) ?? 0;
    const posted = postedOrderRows
      .filter((row) => row.orderId === orderId)
      .reduce((sum, row) => sum + signed(row), 0);
    return { orderId, required, posted, delta: required - posted };
  });
  const salaryDelta = requiredSalary - salaryPosted;
  const orderBonusDelta = orderDeltas.reduce(
    (sum, row) => sum + row.delta,
    0,
  );
  const signature = payrollPolicyStateSignature(salaryDelta, orderDeltas);
  const approval = await tx.payrollAuditEvent.findFirst({
    where: {
      periodId: period.id,
      employeeId,
      action: "MANAGER_PAYROLL_MANUAL_APPROVED",
    },
    orderBy: { createdAt: "desc" },
    select: { after: true },
  });
  const approvalAfter = approval?.after as { signature?: string } | null;
  const manualApproved = approvalAfter?.signature === signature;
  return {
    applies: true,
    delta: salaryDelta + orderBonusDelta,
    salaryDelta,
    orderBonusDelta,
    orderDeltas,
    reconciled: isPayrollReconciled(salaryDelta) || manualApproved,
    manualApproved,
    signature,
  };
}

async function createPaymentTx(
  tx: Prisma.TransactionClient,
  input: PaymentInput,
  actor: PayrollActor,
) {
  if (Number.isNaN(input.paymentDate.getTime())) throw new PayrollError("INVALID_DATE");
  const finalSalaryPayment =
    input.type === PayrollPaymentType.SALARY_PAYMENT ||
    input.type === PayrollPaymentType.FINAL_SETTLEMENT;
  if (finalSalaryPayment && actor.role !== Role.OPERATIONS_DIRECTOR && actor.role !== Role.DIRECTOR)
    throw new PayrollError("DIRECTOR_CONFIRMATION_REQUIRED");
  if (finalSalaryPayment && input.method !== "kaspi")
    throw new PayrollError("KASPI_METHOD_REQUIRED");
  if (
    finalSalaryPayment &&
    !isValidOptionalPaymentReference(input.externalReference)
  )
    throw new PayrollError("KASPI_REFERENCE_REQUIRED");
  const existing = await tx.payrollPayment.findUnique({
    where: { idempotencyKey: input.key },
  });
  if (existing) {
    if (!compareRequestHash(existing.requestHash, input.requestHash))
      throw new PayrollError("IDEMPOTENCY_CONFLICT");
    return existing;
  }
  const period = await openPeriod(tx, input.periodId);
  const employee = await tx.employeePayrollProfile.findUnique({
    where: { id: input.employeeId },
    include: { user: { select: { role: true, active: true } } },
  });
  // Historical obligations remain payable after employment ends. Access to
  // the account is disabled, but the immutable payroll profile stays valid.
  if (!employee?.payrollEnabled)
    throw new PayrollError("EMPLOYEE_NOT_FOUND");
  if (finalSalaryPayment) {
    const reconciliation = await managerPayrollPolicyState(
      tx,
      input.employeeId,
      period,
    );
    if (reconciliation.applies && !reconciliation.reconciled)
      throw new PayrollError("PAYROLL_RECONCILIATION_REQUIRED");
  }
  if (
    input.type === PayrollPaymentType.SALARY_PAYMENT ||
    input.type === PayrollPaymentType.FINAL_SETTLEMENT
  ) {
    const [accruals, previousPayments] = await Promise.all([
      tx.payrollAccrual.findMany({
        where: {
          employeeId: input.employeeId,
          periodId: input.periodId,
          reversalOfId: null,
          reversedBy: { is: null },
        },
        select: {
          amount: true,
          direction: true,
          type: true,
          reason: true,
          order: { select: { manager: true, managerUserId: true } },
        },
      }),
      tx.payrollPayment.findMany({
        where: { employeeId: input.employeeId, periodId: input.periodId },
        select: { amount: true, type: true },
      }),
    ]);
    const accrued = accruals.filter((row) => {
      const automaticProposal =
        row.type === PayrollAccrualType.ORDER_BONUS &&
        row.reason.startsWith(AUTOMATIC_ORDER_BONUS_REASON_PREFIX);
      const orderBonusEntry =
        row.type === PayrollAccrualType.ORDER_BONUS ||
        row.type === PayrollAccrualType.GUARANTEED_ORDER_BONUS ||
        ((row.type === PayrollAccrualType.ADJUSTMENT_INCREASE ||
          row.type === PayrollAccrualType.ADJUSTMENT_DECREASE) &&
          row.reason.startsWith(PAYROLL_POLICY_ADJUSTMENT_PREFIX));
      const companyOrder =
        row.order &&
        isCompanyResponsibleOrder({
          managerName: row.order.manager,
          managerUserId: row.order.managerUserId,
        });
      return !automaticProposal && !(companyOrder && orderBonusEntry);
    }).reduce(
      (sum, row) =>
        sum +
        Number(row.amount) *
          (row.direction === PayrollDirection.INCREASE ? 1 : -1),
      0,
    );
    const paid = previousPayments.reduce(
      (sum, row) =>
        sum +
        Number(row.amount) *
          (row.type === PayrollPaymentType.EMPLOYEE_REFUND ? -1 : 1),
      0,
    );
    if (Number(input.amount) > accrued - paid + 0.01)
      throw new PayrollError("PAYMENT_EXCEEDS_PAYABLE");
  }
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
      externalReference: input.externalReference,
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

const salaryPaymentTypes = [
  PayrollPaymentType.ADVANCE,
  PayrollPaymentType.SALARY_PAYMENT,
  PayrollPaymentType.FINAL_SETTLEMENT,
] as const;

async function assertPartialSalaryPaymentAvailable(
  tx: Prisma.TransactionClient,
  input: PaymentInput,
) {
  money(input.amount);
  const [period, employee, paymentsTowardSalary] = await Promise.all([
    tx.payrollPeriod.findUniqueOrThrow({ where: { id: input.periodId } }),
    tx.employeePayrollProfile.findUnique({
      where: { id: input.employeeId },
      include: { salaryRates: { orderBy: { effectiveFrom: "desc" } } },
    }),
    tx.payrollPayment.findMany({
      where: {
        employeeId: input.employeeId,
        periodId: input.periodId,
        reversalOfId: null,
        reversedAt: null,
        type: { in: [...salaryPaymentTypes] },
      },
      select: { amount: true },
    }),
  ]);
  if (!employee?.payrollEnabled)
    throw new PayrollError("PARTIAL_SALARY_ACCRUAL_REQUIRED");
  const range = companyMonthRange(period.year, period.month);
  const periodSalary = payrollSalaryForPeriod({
    hiredAt: employee.hiredAt,
    terminatedAt: employee.terminatedAt,
    baseSalary: employee.baseSalary,
    salaryRates: employee.salaryRates,
    periodStart: range.start,
    periodEnd: range.end,
  });
  const rate = employee.salaryRates.find((item) =>
    item.effectiveFrom < range.end &&
    (!item.effectiveTo || item.effectiveTo > range.start),
  );
  const salaryPlanEnabled =
    periodSalary.employedInPeriod &&
    (rate?.planEnabled ??
      (employee.salaryRates.length === 0 && employee.salaryPlanEnabled));
  if (!salaryPlanEnabled || periodSalary.amount <= 0)
    throw new PayrollError("PARTIAL_SALARY_ACCRUAL_REQUIRED");
  const salary = periodSalary.amount;
  const paid = paymentsTowardSalary.reduce((sum, item) => sum + Number(item.amount), 0);
  if (Number(input.amount) > salary - paid + 0.01)
    throw new PayrollError("PAYMENT_EXCEEDS_PAYABLE");
}

export async function createPayment(input: PaymentInput, actor: PayrollActor) {
  const founderPartialSalaryPayment =
    (actor.role === Role.DIRECTOR || actor.role === Role.OPERATIONS_DIRECTOR) &&
    input.type === PayrollPaymentType.ADVANCE &&
    (input.partialSalary === true || input.relatedAccrualId != null);
  if (!founderPartialSalaryPayment) payrollOperator(actor);
  if (input.type === PayrollPaymentType.EMPLOYEE_REFUND)
    throw new PayrollError("FORBIDDEN");
  if (
    (input.type === PayrollPaymentType.SALARY_PAYMENT ||
      input.type === PayrollPaymentType.FINAL_SETTLEMENT) &&
    actor.role !== Role.OPERATIONS_DIRECTOR &&
    actor.role !== Role.DIRECTOR
  )
    throw new PayrollError("DIRECTOR_CONFIRMATION_REQUIRED");
  const finalSalaryPayment =
    input.type === PayrollPaymentType.SALARY_PAYMENT ||
    input.type === PayrollPaymentType.FINAL_SETTLEMENT;
  const externalReference = input.externalReference?.trim() || undefined;
  if (finalSalaryPayment && input.method !== "kaspi")
    throw new PayrollError("KASPI_METHOD_REQUIRED");
  if (
    finalSalaryPayment &&
    !isValidOptionalPaymentReference(externalReference)
  )
    throw new PayrollError("KASPI_REFERENCE_REQUIRED");
  try {
    return await prisma.$transaction(async (tx) => {
      const replay = await tx.payrollPayment.findUnique({
        where: { idempotencyKey: input.key },
        select: { id: true },
      });
      if (founderPartialSalaryPayment && !replay)
        await assertPartialSalaryPaymentAvailable(tx, input);
      input.externalReference = externalReference;
      const payment = await createPaymentTx(tx, input, actor);
      await tx.payrollAuditEvent.upsert({
        where: { idempotencyKey: `${input.key}:audit` },
        update: {},
        create: {
          action: founderPartialSalaryPayment
            ? "PARTIAL_SALARY_PAYMENT_CREATED"
            : "PAYROLL_PAYMENT_CREATED",
          actorId: actor.userId,
          periodId: input.periodId,
          employeeId: input.employeeId,
          after: { paymentId: payment.id, amount: Number(payment.amount), type: payment.type },
          reason: input.comment?.trim() || "Фактическая выплата сотруднику",
          idempotencyKey: `${input.key}:audit`,
        },
      });
      const [period, employee] = await Promise.all([
        tx.payrollPeriod.findUniqueOrThrow({
          where: { id: input.periodId },
          select: { year: true, month: true },
        }),
        tx.employeePayrollProfile.findUniqueOrThrow({
          where: { id: input.employeeId },
          select: { name: true },
        }),
      ]);
      return {
        ...payment,
        confirmationNumber: payrollPaymentReference(
          period.year,
          period.month,
          payment.id,
        ),
        paymentPurpose: payrollPaymentPurpose(
          employee.name,
          period.year,
          period.month,
          payment.id,
        ) + (payment.externalReference ? ` · Kaspi ${payment.externalReference}` : ""),
      };
    }, { ...transactionOptions, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new PayrollError("KASPI_REFERENCE_ALREADY_USED");
    throw error;
  }
}


export async function approveManagerPayrollManual(
  input: { employeeId: number; periodId: number; reason: string; key: string },
  actor: PayrollActor,
) {
  director(actor);
  const reason = requiredReason(input.reason);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.payrollAuditEvent.findUnique({ where: { idempotencyKey: input.key } });
    if (existing) return { approved: true, replay: true };
    const period = await openPeriod(tx, input.periodId);
    const state = await managerPayrollPolicyState(tx, input.employeeId, period);
    if (!state.applies) throw new PayrollError("PAYROLL_POLICY_NOT_APPLICABLE");
    await tx.payrollAuditEvent.create({
      data: {
        action: "MANAGER_PAYROLL_MANUAL_APPROVED",
        actorId: actor.userId,
        periodId: period.id,
        employeeId: input.employeeId,
        before: {
          salaryDelta: state.salaryDelta,
          orderBonusDelta: state.orderBonusDelta,
        },
        after: {
          signature: state.signature,
          mode: "MANUAL",
        },
        reason,
        idempotencyKey: input.key,
      },
    });
    return { approved: true, replay: false };
  }, transactionOptions);
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
  if (actor.role === Role.PARTNER || input.type === PayrollPaymentType.EMPLOYEE_REFUND)
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
    amount?: number;
    paymentDate?: Date;
    method?: string;
    comment?: string;
    key: string;
    requestHash: string;
  },
  actor: PayrollActor,
) {
  salaryManager(actor);
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
    const paymentDate = input.paymentDate ?? confirmation.claimedPaymentDate;
    if (Number.isNaN(paymentDate.getTime())) throw new PayrollError("INVALID_DATE");
    const amount = input.amount ?? Number(confirmation.amount);
    const payment = await createPaymentTx(tx, {
      employeeId: confirmation.employeeId,
      periodId: confirmation.periodId,
      amount,
      type: confirmation.type,
      paymentDate,
      method: input.method ?? confirmation.method ?? undefined,
      comment: input.comment?.trim() || confirmation.comment || undefined,
      key: `payroll-confirmation:${confirmation.id}`,
      requestHash: input.requestHash,
    }, actor);
    const updated = await tx.payrollPaymentConfirmation.update({
      where: { id },
      data: {
        amount: payment.amount,
        claimedPaymentDate: payment.paymentDate,
        method: payment.method,
        comment: payment.comment,
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
    paymentDate?: Date;
  },
  actor: PayrollActor,
) {
  director(actor);
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
          paymentDate: input.paymentDate ?? new Date(),
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
  salaryManager(actor);
  if (target === PayrollPeriodStatus.CLOSED) {
    const statement = await payrollSummary(periodId, actor);
    if (statement.rows.some((row) =>
      row.calculation.amountToPay > 0.01 || row.totals.pending > 0.01,
    )) throw new PayrollError("PAYROLL_NOT_FULLY_PAID");
  }
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
  forceSelf = false,
) {
  const selfOnly = forceSelf || !(
    actor.role === Role.DIRECTOR ||
    actor.role === Role.OPERATIONS_DIRECTOR ||
    actor.role === Role.ACCOUNTANT
  );
  if (actor.role === Role.PARTNER) throw new PayrollError("FORBIDDEN");
  const self = selfOnly
    ? await prisma.employeePayrollProfile.findUnique({
        where: { userId: actor.userId },
      })
    : null;
  if (selfOnly && !self) throw new PayrollError("EMPLOYEE_NOT_FOUND");
  const employeeId = selfOnly ? self!.id : requestedEmployeeId;
  const period = await prisma.payrollPeriod.findUniqueOrThrow({
    where: { id: periodId },
    select: { year: true, month: true },
  });
  const periodRange = companyMonthRange(period.year, period.month);
  const [employees, settings, periodOrders, readinessOrders, readinessMeasurements, readinessTasks, manualApprovals] = await Promise.all([prisma.employeePayrollProfile.findMany({
    where: {
      ...(employeeId ? { id: employeeId } : {}),
      payrollEnabled: true,
    },
    include: {
      user: { select: { id: true, name: true, role: true, active: true } },
      salaryRates: { include: { approvedBy: { select: { id: true, name: true } } }, orderBy: { effectiveFrom: "desc" } },
      accruals: {
        where: { periodId },
        include: {
          payments: true,
          reversedBy: { select: { id: true } },
          order: {
            select: {
              id: true,
              number: true,
              amount: true,
              status: true,
              lifecycle: true,
              deletedAt: true,
              orderReceivedAt: true,
              completedAt: true,
              manager: true,
              managerUserId: true,
              client: { select: { name: true, phone: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      payments: {
        where: { periodId },
        include: {
          paidBy: { select: { id: true, name: true } },
          reversal: { select: { id: true } },
        },
        orderBy: { paymentDate: "desc" },
      },
      paymentConfirmations: { where: { periodId }, orderBy: { createdAt: "desc" } },
      advanceRequests: { where: { periodId }, orderBy: { createdAt: "desc" } },
    },
    orderBy: { name: "asc" },
  }), prisma.systemSettings.findUnique({ where: { companyId: requireTenantIdentity().companyId }, select: { paydayDayOfMonth: true } }), prisma.order.findMany({
    where: {
      companyId: requireTenantIdentity().companyId,
      orderDateNeedsReview: false,
      orderReceivedAt: {
        gte: periodRange.start,
        lt: periodRange.end,
      },
    },
    select: {
      id: true,
      number: true,
      amount: true,
      status: true,
      lifecycle: true,
      deletedAt: true,
      orderReceivedAt: true,
      completedAt: true,
      manager: true,
      managerUserId: true,
      leadConversion: { select: { managerId: true } },
      client: { select: { name: true, phone: true } },
    },
    orderBy: [{ orderReceivedAt: "asc" }, { id: "asc" }],
  }), prisma.order.findMany({
    where: {
      companyId: requireTenantIdentity().companyId,
      deletedAt: null,
      managerUserId: { not: null },
      OR: [
        { lifecycle: { notIn: [OrderLifecycle.COMPLETED, OrderLifecycle.CANCELLED] } },
        { orderDateNeedsReview: true, lifecycle: { not: OrderLifecycle.CANCELLED } },
      ],
    },
    select: {
      orderDateNeedsReview: true,
      manager: true,
      managerUserId: true,
      partnerId: true,
      partnerPrice: true,
      partnerAgreedAt: true,
      promisedAt: true,
      productionDeadline: true,
      client: { select: { phone: true, city: true } },
      installation: { select: { scheduledAt: true } },
    },
  }), prisma.measurement.findMany({
    where: {
      companyId: requireTenantIdentity().companyId,
      visitDate: { lt: new Date() },
      status: { in: [MeasurementStatus.ASSIGNED, MeasurementStatus.IN_PROGRESS] },
      client: { managerUserId: { not: null } },
    },
    select: { client: { select: { managerUserId: true } } },
  }), prisma.calendarTask.findMany({
    where: {
      companyId: requireTenantIdentity().companyId,
      workflow: CalendarTaskWorkflow.ORDER_DATA_COMPLETION,
      status: { in: [CalendarTaskStatus.PLANNED, CalendarTaskStatus.IN_PROGRESS] },
    },
    select: { assigneeId: true },
  }), prisma.payrollAuditEvent.findMany({
    where: { periodId, action: "MANAGER_PAYROLL_MANUAL_APPROVED", employeeId: { not: null } },
    select: { employeeId: true, after: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  })]);
  const visibleEmployees = employees.filter((employee) => {
    if (!employmentEnded(employee)) return employee.active;
    if (
      employee.accruals.length > 0 ||
      employee.payments.length > 0 ||
      employee.paymentConfirmations.length > 0 ||
      employee.advanceRequests.length > 0
    )
      return true;
    const manager = isSalesManagerPayrollEmployee(employee);
    if (!manager) return false;
    return periodOrders.some(
      (order) =>
        isOrderAssignedToManager(
          {
            managerUserId: order.managerUserId,
            leadManagerId: order.leadConversion?.managerId,
            managerName: order.manager,
          },
          {
            id: employee.userId ?? -1,
            name: employee.user?.name || employee.name,
          },
        ) && Boolean(bonusEarnedInRange(order, employee, periodRange)),
    );
  });
  const rows = visibleEmployees.map((employee) => {
    const activeAccruals = employee.accruals.filter(
      (row) => !row.reversalOfId && !row.reversedBy,
    );
    const statementAccruals = activeAccruals.filter((row) => {
      const companyOrder = row.order
        ? isCompanyResponsibleOrder({
            managerName: row.order.manager,
            managerUserId: row.order.managerUserId,
          })
        : false;
      const orderBonusEntry =
        row.type === PayrollAccrualType.ORDER_BONUS ||
        row.type === PayrollAccrualType.GUARANTEED_ORDER_BONUS ||
        ((row.type === PayrollAccrualType.ADJUSTMENT_INCREASE ||
          row.type === PayrollAccrualType.ADJUSTMENT_DECREASE) &&
          row.reason.startsWith(PAYROLL_POLICY_ADJUSTMENT_PREFIX));
      return !(companyOrder && orderBonusEntry);
    });
    const accrued = employee.accruals.reduce(
      (sum, row) => sum + signedAccrual(row),
      0,
    );
    const statementPosted = statementAccruals.reduce(
      (sum, row) => sum + signedAccrual(row),
      0,
    );
    const paid = employee.payments.reduce(
      (sum, row) => sum + signedPayment(row),
      0,
    );
    const pending = employee.paymentConfirmations
      .filter((row) => row.status === PayrollConfirmationStatus.PENDING)
      .reduce((sum, row) => sum + Number(row.amount), 0);
    const pendingAdvances = employee.paymentConfirmations
      .filter(
        (row) =>
          row.status === PayrollConfirmationStatus.PENDING &&
          row.type === PayrollPaymentType.ADVANCE,
      )
      .reduce((sum, row) => sum + Number(row.amount), 0);
    const increase = (types: PayrollAccrualType[]) => statementAccruals
      .filter((row) => row.direction === PayrollDirection.INCREASE && types.includes(row.type))
      .reduce((sum, row) => sum + Number(row.amount), 0);
    const advancesPaid = employee.payments
      .filter((row) => row.type === PayrollPaymentType.ADVANCE)
      .reduce((sum, row) => sum + signedPayment(row), 0);
    const periodSalary = payrollSalaryForPeriod({
      hiredAt: employee.hiredAt,
      terminatedAt: employee.terminatedAt,
      baseSalary: employee.baseSalary,
      salaryRates: employee.salaryRates,
      periodStart: periodRange.start,
      periodEnd: periodRange.end,
    });
    const bonusTypes = new Set<PayrollAccrualType>([
      PayrollAccrualType.GUARANTEED_ORDER_BONUS,
      PayrollAccrualType.ORDER_BONUS,
      PayrollAccrualType.MEASUREMENT_BONUS,
      PayrollAccrualType.EXTRA_BONUS,
    ]);
    const bonusAccruals = statementAccruals
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
          order: row.order,
          measurementId: row.measurementId,
          type: row.type,
          amount: Number(row.amount),
          accruedAt: row.createdAt,
          paid: bonusPaid,
          payable,
          status: payable <= 0 ? "PAID" : bonusPaid > 0 ? "PARTIALLY_PAID" : "ACCRUED",
        };
      });
    const identity = employee.user
      ? employee.user
      : { id: 0, name: employee.name || "Сотрудник", role: employee.position || "EMPLOYEE", active: false };
    const employeeEmploymentEnded = employmentEnded(employee);
    const policySigned = (row: (typeof activeAccruals)[number]) =>
      Number(row.amount) *
      (row.direction === PayrollDirection.INCREASE ? 1 : -1);
    const salaryPosted = activeAccruals
      .filter(
        (row) =>
          row.type === PayrollAccrualType.BASE_SALARY ||
          row.reason.startsWith(PAYROLL_SALARY_ADJUSTMENT_PREFIX),
      )
      .reduce((sum, row) => sum + policySigned(row), 0);
    const baseSalaryPosted = activeAccruals
      .filter((row) => row.type === PayrollAccrualType.BASE_SALARY)
      .reduce((sum, row) => sum + policySigned(row), 0);
    const activeRate = employee.salaryRates.find(
      (rate) =>
        rate.effectiveFrom < periodRange.end &&
        (!rate.effectiveTo || rate.effectiveTo > periodRange.start),
    );
    const configuredSalary = periodSalary.amount;
    const salaryPlanEnabled =
      periodSalary.employedInPeriod &&
      (activeRate?.planEnabled ??
        (employee.salaryRates.length === 0 && employee.salaryPlanEnabled));
    const statementSalary = salaryPlanEnabled
      ? Math.max(configuredSalary, baseSalaryPosted, 0)
      : Math.max(baseSalaryPosted, 0);
    const currentSalary = salaryPlanEnabled ? configuredSalary : 0;
    const confirmedOtherAccruals = statementAccruals
      .filter((row) =>
        row.type !== PayrollAccrualType.BASE_SALARY &&
        !row.reason.startsWith(PAYROLL_SALARY_ADJUSTMENT_PREFIX) &&
        !(row.type === PayrollAccrualType.ORDER_BONUS &&
          row.reason.startsWith(AUTOMATIC_ORDER_BONUS_REASON_PREFIX)),
      )
      .reduce((sum, row) => sum + policySigned(row), 0);
    const salaryPaid = employee.payments
      .filter((payment) => salaryPaymentTypes.includes(payment.type as (typeof salaryPaymentTypes)[number]))
      .reduce((sum, payment) => sum + signedPayment(payment), 0);
    const confirmedAccrued = Math.max(
      paid,
      Math.max(salaryPosted, salaryPaid) + confirmedOtherAccruals,
      0,
    );
    const managerPolicyApplies = isSalesManagerPayrollEmployee(employee);
    const assignedOrders = managerPolicyApplies
      ? periodOrders.filter(
          (order) =>
            isOrderAssignedToManager(
              {
                managerUserId: order.managerUserId,
                leadManagerId: order.leadConversion?.managerId,
                managerName: order.manager,
              },
              identity,
            ) &&
            Boolean(bonusEarnedInRange(order, employee, periodRange)),
        )
      : [];
    const orderBonusAudit = managerPolicyApplies
      ? assignedOrders.map((order) => {
            const primaryBonuses = statementAccruals.filter(
              (row) =>
                row.orderId === order.id &&
                row.direction === PayrollDirection.INCREASE &&
                (row.type === PayrollAccrualType.ORDER_BONUS ||
                  row.type === PayrollAccrualType.GUARANTEED_ORDER_BONUS),
            );
            const manualBonus = primaryBonuses.find(
              (row) => row.type === PayrollAccrualType.ORDER_BONUS,
            );
            const policyAdjustments = statementAccruals.filter(
              (row) =>
                row.orderId === order.id &&
                (row.type === PayrollAccrualType.ADJUSTMENT_INCREASE ||
                  row.type === PayrollAccrualType.ADJUSTMENT_DECREASE) &&
                row.reason.startsWith(PAYROLL_POLICY_ADJUSTMENT_PREFIX),
            );
            const appliedAdjustment = policyAdjustments.reduce(
              (sum, row) => sum + policySigned(row),
              0,
            );
            const submitted = Number(manualBonus?.amount ?? 0);
            const recorded =
              primaryBonuses.reduce(
                (sum, row) => sum + policySigned(row),
                0,
              ) + appliedAdjustment;
            const policyAudit = auditManagerOrderBonus({
              orderAmount: Number(order.amount),
              status: order.status,
              deletedAt: order.deletedAt,
              managerName: order.manager,
              managerUserId: order.managerUserId,
              submitted,
              recorded,
            });
            const earnedAt = bonusEarnedAt(order, employee)!;
            return {
              accrualId: manualBonus?.id ?? primaryBonuses[0]?.id ?? -order.id,
              orderId: order.id,
              orderNumber: order.number,
              clientName: order.client.name,
              orderAmount: Number(order.amount),
              orderStatus: order.status,
              earnedAt,
              earnedEvent: managerOrderBonusEarnedEvent({
                active: employee.active,
                terminatedAt: employee.terminatedAt,
                accountActive: employee.user?.active,
              }),
              eligible: policyAudit.eligible,
              submitted,
              expected: policyAudit.expected,
              appliedAdjustment,
              recorded,
              managerDifference: policyAudit.managerDifference,
              ledgerDifference: policyAudit.ledgerDifference,
              status: policyAudit.status,
              reconciled: policyAudit.reconciled,
            };
          })
      : [];
    const assignedOrderIds = new Set(assignedOrders.map((order) => order.id));
    const orphanOrderIds = managerPolicyApplies
      ? [
          ...new Set(
            statementAccruals
              .filter(
                (row) =>
                  row.orderId &&
                  !(row.order && isCompanyResponsibleOrder({ managerName: row.order.manager })) &&
                  !assignedOrderIds.has(row.orderId) &&
                  (row.type === PayrollAccrualType.ORDER_BONUS ||
                    row.type === PayrollAccrualType.GUARANTEED_ORDER_BONUS ||
                    ((row.type === PayrollAccrualType.ADJUSTMENT_INCREASE ||
                      row.type === PayrollAccrualType.ADJUSTMENT_DECREASE) &&
                      row.reason.startsWith(PAYROLL_POLICY_ADJUSTMENT_PREFIX))),
              )
              .map((row) => row.orderId!),
          ),
        ]
      : [];
    const orphanOrderAudit = orphanOrderIds.map((orderId) => {
      const rows = statementAccruals.filter((row) => row.orderId === orderId);
      const primaryBonuses = rows.filter(
        (row) =>
          row.direction === PayrollDirection.INCREASE &&
          (row.type === PayrollAccrualType.ORDER_BONUS ||
            row.type === PayrollAccrualType.GUARANTEED_ORDER_BONUS),
      );
      const manualBonus = primaryBonuses.find(
        (row) => row.type === PayrollAccrualType.ORDER_BONUS,
      );
      const policyAdjustments = rows.filter(
        (row) =>
          (row.type === PayrollAccrualType.ADJUSTMENT_INCREASE ||
            row.type === PayrollAccrualType.ADJUSTMENT_DECREASE) &&
          row.reason.startsWith(PAYROLL_POLICY_ADJUSTMENT_PREFIX),
      );
      const recorded = [...primaryBonuses, ...policyAdjustments].reduce(
        (sum, row) => sum + policySigned(row),
        0,
      );
      const order = primaryBonuses[0]?.order ?? policyAdjustments[0]?.order;
      return {
        accrualId: manualBonus?.id ?? primaryBonuses[0]?.id ?? -orderId,
        orderId,
        orderNumber: order?.number ?? `Заказ ${orderId}`,
        clientName: order?.client.name ?? "Не закреплён за менеджером",
        orderAmount: Number(order?.amount ?? 0),
        orderStatus: order?.status ?? "Вне расчётного периода",
        earnedAt:
          (order ? bonusEarnedAt(order, employee) : null) ??
          order?.orderReceivedAt ??
          new Date(0),
        earnedEvent: managerOrderBonusEarnedEvent({
          active: employee.active,
          terminatedAt: employee.terminatedAt,
          accountActive: employee.user?.active,
        }),
        eligible: false,
        submitted: Number(manualBonus?.amount ?? 0),
        expected: 0,
        appliedAdjustment: policyAdjustments.reduce(
          (sum, row) => sum + policySigned(row),
          0,
        ),
        recorded,
        managerDifference: Number(manualBonus?.amount ?? 0),
        ledgerDifference: -recorded,
        status: "NOT_ELIGIBLE" as const,
        reconciled: isPayrollReconciled(-recorded),
      };
    });
    const allOrderBonusAudit = [...orderBonusAudit, ...orphanOrderAudit];
    const suggestedOrderBonuses = orderBonusAudit
      .filter((item) => item.eligible && item.recorded < 0.01)
      .reduce((sum, item) => sum + item.expected, 0);
    const policySalaryRequired = salaryPlanEnabled
      ? configuredSalary
      : Math.max(salaryPosted, 0);
    const salaryDifference = managerPolicyApplies
      ? policySalaryRequired - salaryPosted
      : 0;
    const bonusLedgerDifference = allOrderBonusAudit.reduce(
      (sum, row) => sum + row.ledgerDifference,
      0,
    );
    const policyReady = isPayrollReconciled(salaryDifference);
    const policySignature = payrollPolicyStateSignature(
      salaryDifference,
      allOrderBonusAudit.map((row) => ({ orderId: row.orderId, delta: row.ledgerDifference })),
    );
    const latestApproval = manualApprovals.find((row) => row.employeeId === employee.id);
    const approvalAfter = latestApproval?.after as { signature?: string } | null;
    const manualApproved = !policyReady && approvalAfter?.signature === policySignature;
    const workReadiness =
      managerPolicyApplies && identity.id && !employeeEmploymentEnded
      ? {
          orderIssues: readinessOrders.filter(
            (order) =>
              order.managerUserId === identity.id &&
              !isCompanyResponsibleOrder({ managerName: order.manager }) &&
              orderDataGaps(order).length > 0,
          ).length,
          measurementsToClose: readinessMeasurements.filter(
            (measurement) => measurement.client.managerUserId === identity.id,
          ).length,
          openTasks: readinessTasks.filter((task) => task.assigneeId === identity.id).length,
          ready: false,
        }
      : { orderIssues: 0, measurementsToClose: 0, openTasks: 0, ready: true };
    workReadiness.ready = workReadiness.orderIssues === 0 && workReadiness.measurementsToClose === 0 && workReadiness.openTasks === 0;
    const auditedAccrued =
      statementPosted + salaryDifference + bonusLedgerDifference;
    // The audit is a preview only. Amounts become payable only after people
    // create the actual accruals: salary by the director and order bonuses by
    // the manager.
    const approvedAccrued = confirmedAccrued;
    const approvedPayable = approvedAccrued - paid;
    const personalCalculation = personalPayrollCalculation({
      salary: statementSalary,
      bonuses: increase([
        PayrollAccrualType.GUARANTEED_ORDER_BONUS,
        PayrollAccrualType.ORDER_BONUS,
        PayrollAccrualType.MEASUREMENT_BONUS,
        PayrollAccrualType.EXTRA_BONUS,
        PayrollAccrualType.ADJUSTMENT_INCREASE,
      ]) + suggestedOrderBonuses,
      premiums: increase([PayrollAccrualType.PREMIUM]),
      deductions: statementAccruals
        .filter((row) => row.direction === PayrollDirection.DECREASE)
        .reduce((sum, row) => sum + Number(row.amount), 0),
      advances: advancesPaid,
      otherPayments: paid - advancesPaid,
      pendingAdvances,
      accrued: confirmedAccrued,
    });
    const payments = employee.payments.map((payment) => ({
      ...payment,
      confirmationNumber: payrollPaymentReference(
        period.year,
        period.month,
        payment.id,
      ),
      paymentPurpose: payrollPaymentPurpose(
        identity.name,
        period.year,
        period.month,
        payment.id,
      ) + (payment.externalReference ? ` · Kaspi ${payment.externalReference}` : ""),
    }));
    return {
      ...employee,
      salaryPlanEnabled,
      user: identity,
      payments,
      hasOrdaAccess: Boolean(employee.userId),
      employmentEnded: employeeEmploymentEnded,
      currentSalary,
      salaryEffectiveFrom:
        periodSalary.effectiveFrom ?? employee.hiredAt,
      breakdown: {
        salaryAccrued: increase([PayrollAccrualType.BASE_SALARY]),
        bonusesAccrued: increase([
          PayrollAccrualType.GUARANTEED_ORDER_BONUS,
          PayrollAccrualType.ORDER_BONUS,
          PayrollAccrualType.MEASUREMENT_BONUS,
          PayrollAccrualType.EXTRA_BONUS,
        ]),
        premiumsAccrued: increase([PayrollAccrualType.PREMIUM]),
        advancesPaid,
        totalAccrued: accrued,
        totalPaid: paid,
        payable: accrued - paid,
      },
      bonusAccruals,
      calculation: personalCalculation,
      payrollAudit: managerPolicyApplies
        ? {
            policy: {
              threshold: MANAGER_ORDER_BONUS_THRESHOLD,
              belowOrEqual: MANAGER_ORDER_BONUS_STANDARD,
              above: MANAGER_ORDER_BONUS_HIGH,
              earnedEvent: managerOrderBonusEarnedEvent({
                active: employee.active,
                terminatedAt: employee.terminatedAt,
                accountActive: employee.user?.active,
              }),
            },
            linkedOrders: allOrderBonusAudit.filter((row) => row.eligible).length,
            submittedOrderBonus: allOrderBonusAudit.reduce(
              (sum, row) => sum + row.submitted,
              0,
            ),
            requiredOrderBonus: allOrderBonusAudit.reduce(
              (sum, row) => sum + row.expected,
              0,
            ),
            managerDifference: allOrderBonusAudit.reduce(
              (sum, row) => sum + row.managerDifference,
              0,
            ),
            salaryRequired: policySalaryRequired,
            salaryPosted,
            salaryDifference,
            premiums: increase([
              PayrollAccrualType.PREMIUM,
              PayrollAccrualType.EXTRA_BONUS,
            ]),
            deductions: activeAccruals
              .filter((row) => row.type === PayrollAccrualType.DEDUCTION)
              .reduce((sum, row) => sum + Number(row.amount), 0),
            advances: advancesPaid,
            alreadyPaid: paid,
            ledgerDifference: salaryDifference + bonusLedgerDifference,
            auditedAccrued,
            auditedPayable: auditedAccrued - paid,
            approvedAccrued,
            approvedPayable,
            unreconciledOrders: allOrderBonusAudit.filter(
              (row) => !row.reconciled,
            ).length,
            calculationReady: policyReady || manualApproved,
            manualApproved,
            workReadiness,
            readyToPay: policyReady || manualApproved,
            mismatches: allOrderBonusAudit,
          }
        : null,
      totals: { accrued, paid, pending, payable: accrued - paid },
    };
  });
  const breakdown = rows.reduce((sum, row) => ({
    salaryAccrued: sum.salaryAccrued + row.breakdown.salaryAccrued,
    bonusesAccrued: sum.bonusesAccrued + row.breakdown.bonusesAccrued,
    premiumsAccrued: sum.premiumsAccrued + row.breakdown.premiumsAccrued,
    advancesPaid: sum.advancesPaid + row.breakdown.advancesPaid,
    totalAccrued: sum.totalAccrued + row.breakdown.totalAccrued,
    totalPaid: sum.totalPaid + row.breakdown.totalPaid,
    payable: sum.payable + row.breakdown.payable,
  }), { salaryAccrued: 0, bonusesAccrued: 0, premiumsAccrued: 0, advancesPaid: 0, totalAccrued: 0, totalPaid: 0, payable: 0 });
  return {
    rows,
    settings: settings ?? { paydayDayOfMonth: 1 },
    breakdown,
    totals: rows.reduce(
      (sum, row) => ({
        accrued: sum.accrued + row.totals.accrued,
        paid: sum.paid + row.totals.paid,
        pending: sum.pending + row.totals.pending,
        payable: sum.payable + row.totals.payable,
      }),
      { accrued: 0, paid: 0, pending: 0, payable: 0 },
    ),
  };
}

const orderBonusTypes = [
  PayrollAccrualType.ORDER_BONUS,
  PayrollAccrualType.GUARANTEED_ORDER_BONUS,
] as const;

function orderBonusCorrectionActor(actor: PayrollActor) {
  if (
    actor.role !== Role.MANAGER &&
    actor.role !== Role.DIRECTOR &&
    actor.role !== Role.OPERATIONS_DIRECTOR
  )
    throw new PayrollError("FORBIDDEN");
}

export async function listOrderBonusesForCorrection(
  year: number,
  month: number,
  actor: PayrollActor,
) {
  orderBonusCorrectionActor(actor);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  )
    throw new PayrollError("INVALID_PERIOD");
  const companyId = requireTenantIdentity().companyId;
  const period = await prisma.payrollPeriod.findUnique({
    where: { companyId_year_month: { companyId, year, month } },
    select: { id: true, year: true, month: true, status: true },
  });
  if (!period) return { period: null, items: [] };
  const managerOwnOnly = actor.role === Role.MANAGER;
  const rows = await prisma.payrollAccrual.findMany({
    where: {
      periodId: period.id,
      type: { in: [...orderBonusTypes] },
      direction: PayrollDirection.INCREASE,
      reversalOfId: null,
      reversedBy: { is: null },
      employee: {
        companyId,
        ...(managerOwnOnly ? { userId: actor.userId } : {}),
      },
    },
    include: {
      employee: {
        select: {
          id: true,
          name: true,
          user: { select: { id: true, name: true } },
        },
      },
      order: {
        select: {
          id: true,
          number: true,
          amount: true,
          manager: true,
          managerUserId: true,
          orderReceivedAt: true,
          client: { select: { name: true, phone: true } },
        },
      },
      payments: {
        where: { reversalOfId: null, reversedAt: null },
        select: { amount: true },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const visibleRows = rows.filter(
    (row) =>
      !row.order ||
      !isCompanyResponsibleOrder({
        managerName: row.order.manager,
        managerUserId: row.order.managerUserId,
      }),
  );
  const orderIds = [
    ...new Set(
      visibleRows
        .map((row) => row.orderId)
        .filter((orderId): orderId is number => Boolean(orderId)),
    ),
  ];
  const employeeIds = [
    ...new Set(visibleRows.map((row) => row.employeeId)),
  ];
  const policyAdjustments =
    orderIds.length > 0 && employeeIds.length > 0
      ? await prisma.payrollAccrual.findMany({
          where: {
            periodId: period.id,
            employeeId: { in: employeeIds },
            orderId: { in: orderIds },
            type: {
              in: [
                PayrollAccrualType.ADJUSTMENT_INCREASE,
                PayrollAccrualType.ADJUSTMENT_DECREASE,
              ],
            },
            reversalOfId: null,
            reversedBy: { is: null },
            reason: { startsWith: PAYROLL_POLICY_ADJUSTMENT_PREFIX },
            employee: {
              companyId,
              ...(managerOwnOnly ? { userId: actor.userId } : {}),
            },
          },
          select: {
            employeeId: true,
            orderId: true,
            amount: true,
            direction: true,
          },
        })
      : [];
  const adjustmentByEmployeeAndOrder = new Map<string, number>();
  for (const adjustment of policyAdjustments) {
    if (!adjustment.orderId) continue;
    const key = `${adjustment.employeeId}:${adjustment.orderId}`;
    const signedAmount =
      Number(adjustment.amount) *
      (adjustment.direction === PayrollDirection.INCREASE ? 1 : -1);
    adjustmentByEmployeeAndOrder.set(
      key,
      (adjustmentByEmployeeAndOrder.get(key) ?? 0) + signedAmount,
    );
  }
  return {
    period,
    items: visibleRows.map((row) => {
      const paid = row.payments.reduce(
        (sum, payment) => sum + Number(payment.amount),
        0,
      );
      const policyAdjustment = row.orderId
        ? (adjustmentByEmployeeAndOrder.get(
            `${row.employeeId}:${row.orderId}`,
          ) ?? 0)
        : 0;
      const policyAdjusted = Math.abs(policyAdjustment) >= 0.01;
      const effectiveAmount = Number(row.amount) + policyAdjustment;
      const editable =
        period.status === PayrollPeriodStatus.OPEN &&
        paid < 0.01 &&
        !policyAdjusted;
      return {
        id: row.id,
        employeeId: row.employeeId,
        employeeName:
          row.employee.user?.name || row.employee.name || "Сотрудник",
        orderId: row.orderId,
        order: row.order,
        type: row.type,
        amount: Number(row.amount),
        policyAdjustment,
        effectiveAmount,
        paid,
        createdAt: row.createdAt,
        editable,
        blockedReason:
          period.status !== PayrollPeriodStatus.OPEN
            ? "PERIOD_NOT_OPEN"
            : paid >= 0.01
              ? "BONUS_PAYMENT_EXISTS"
              : policyAdjusted
                ? "BONUS_POLICY_ADJUSTED"
                : null,
      };
    }),
  };
}

export async function syncAutomaticOrderBonuses(
  year: number,
  month: number,
  actor: PayrollActor,
) {
  orderBonusCorrectionActor(actor);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  )
    throw new PayrollError("INVALID_PERIOD");
  const companyId = requireTenantIdentity().companyId;
  if (!isCompanyMonthStarted(year, month))
    return { created: 0, removed: 0, skipped: true };
  const automaticPeriod = isManagerOrderBonusAutomaticPeriod(year, month);
  const existingPeriod = await prisma.payrollPeriod.findUnique({
    where: { companyId_year_month: { companyId, year, month } },
  });
  if (!existingPeriod && !automaticPeriod && actor.role === Role.MANAGER)
    return { created: 0, removed: 0, skipped: true };
  const period = existingPeriod ?? await ensurePeriod(year, month);
  if (period.status !== PayrollPeriodStatus.OPEN)
    return {
      created: 0,
      removed: 0,
      skipped: true,
      periodStatus: period.status,
    };
  const managerOwnOnly = actor.role === Role.MANAGER;
  const bonusesNeedingPolicyCheck = await prisma.payrollAccrual.findMany({
    where: {
      periodId: period.id,
      type: { in: [...orderBonusTypes] },
      direction: PayrollDirection.INCREASE,
      reversalOfId: null,
      reversedBy: { is: null },
      employee: {
        companyId,
        ...(managerOwnOnly ? { userId: actor.userId } : {}),
      },
      order: { isNot: null },
    },
    select: {
      id: true,
      employee: {
        select: {
          active: true,
          terminatedAt: true,
          user: { select: { active: true, role: true } },
        },
      },
      order: {
        select: {
          manager: true,
          managerUserId: true,
          orderReceivedAt: true,
          completedAt: true,
          lifecycle: true,
        },
      },
      payments: {
        where: { reversalOfId: null, reversedAt: null },
        select: { amount: true },
      },
    },
  });
  let removed = 0;
  let deferredRemoved = 0;
  const range = companyMonthRange(year, month);
  for (const bonus of bonusesNeedingPolicyCheck) {
    if (!bonus.order || bonus.payments.some((payment) => Number(payment.amount) > 0))
      continue;
    const companyResponsible = isCompanyResponsibleOrder({
      managerName: bonus.order.manager,
      managerUserId: bonus.order.managerUserId,
    });
    const outsideFactualOrderMonth =
      !companyResponsible &&
      !bonusEarnedInRange(bonus.order, bonus.employee, range);
    if (!companyResponsible && !outsideFactualOrderMonth) continue;
    const reason = companyResponsible
      ? "Заказ оформлен с ответственным «Компания»: менеджерский бонус не начисляется"
      : employmentEnded(bonus.employee) && bonus.order.lifecycle !== OrderLifecycle.COMPLETED
        ? "Начисление уволенного сотрудника отложено до завершения заказа"
        : "Бонус относится к месяцу фактической даты заказа";
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ accrualId: bonus.id, action: "cancel", reason }))
      .digest("hex");
    const result = await correctOrderBonus(
      {
        accrualId: bonus.id,
        cancel: true,
        reason,
        key: companyResponsible
          ? `company-responsible-order-bonus:${bonus.id}`
          : `factual-order-month-bonus:${bonus.id}`,
        requestHash,
      },
      actor,
    );
    if (result.created) {
      if (companyResponsible) removed += 1;
      else deferredRemoved += 1;
    }
  }
  const [profiles, orders] = await Promise.all([
    prisma.employeePayrollProfile.findMany({
      where: {
        companyId,
        payrollEnabled: true,
        ...(managerOwnOnly ? { userId: actor.userId } : {}),
        OR: [
          { position: Role.MANAGER },
          { user: { role: Role.MANAGER } },
        ],
      },
      include: {
        user: { select: { id: true, name: true, role: true, active: true } },
      },
    }),
    prisma.order.findMany({
      where: {
        companyId,
        deletedAt: null,
        orderDateNeedsReview: false,
        orderReceivedAt: { gte: range.start, lt: range.end },
        ...(managerOwnOnly
          ? {
              AND: [
                {
                  OR: [
                    { managerUserId: actor.userId },
                    {
                      managerUserId: null,
                      manager: { equals: actor.name, mode: "insensitive" },
                    },
                    { leadConversion: { managerId: actor.userId } },
                  ],
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        number: true,
        amount: true,
        status: true,
        lifecycle: true,
        deletedAt: true,
        managerUserId: true,
        manager: true,
        orderReceivedAt: true,
        completedAt: true,
        leadConversion: { select: { managerId: true } },
      },
      orderBy: [{ orderReceivedAt: "asc" }, { id: "asc" }],
    }),
  ]);
  const skippedOrders: number[] = [];
  const bonusCandidates = orders.flatMap((order) => {
    if (!isManagerOrderBonusEligible({ ...order, managerName: order.manager }))
      return [];
    const profile = profiles.find((candidate) =>
      isOrderAssignedToManager(
        {
          managerUserId: order.managerUserId,
          leadManagerId: order.leadConversion?.managerId,
          managerName: order.manager,
        },
        {
          id: candidate.userId ?? -1,
          name: candidate.user?.name || candidate.name,
        },
      ),
    );
    if (!profile) {
      skippedOrders.push(order.id);
      return [];
    }
    const deferred = employmentEnded(profile);
    if (!deferred) return [];
    const earnedAt = bonusEarnedInRange(order, profile, range);
    return earnedAt ? [{ order, profile, earnedAt, deferred }] : [];
  });
  const priorBonuses = bonusCandidates.length
    ? await prisma.payrollAccrual.findMany({
        where: {
          orderId: { in: bonusCandidates.map(({ order }) => order.id) },
          type: { in: [...orderBonusTypes] },
          direction: PayrollDirection.INCREASE,
          reversalOfId: null,
          reversedBy: { is: null },
        },
        select: { orderId: true },
      })
    : [];
  const handledOrderIds = new Set(
    priorBonuses
      .map((row) => row.orderId)
      .filter((orderId): orderId is number => Boolean(orderId)),
  );
  let created = 0;
  let deferredCreated = 0;
  for (const { order, profile, earnedAt, deferred } of bonusCandidates) {
    if (handledOrderIds.has(order.id)) continue;
    const amount = managerOrderBonus(Number(order.amount));
    const payload = {
      periodId: period.id,
      type: PayrollAccrualType.ORDER_BONUS,
      amount,
      orderId: order.id,
      reason: deferred
        ? `${AUTOMATIC_ORDER_BONUS_REASON_PREFIX} после завершения заказа уволенного сотрудника: ${order.number}`
        : `${AUTOMATIC_ORDER_BONUS_REASON_PREFIX}: ${order.number}`,
      key: deferred
        ? `automatic-order-bonus-completed:${order.id}:${period.id}`
        : `automatic-order-bonus:${order.id}`,
      requestHash: createHash("sha256")
        .update(
          JSON.stringify({
            orderId: order.id,
            periodId: period.id,
            amount,
            earnedAt: earnedAt.toISOString(),
          }),
        )
        .digest("hex"),
    };
    try {
      const result = managerOwnOnly
        ? await createSelfAccrual(payload, actor)
        : await createAccrual({ ...payload, employeeId: profile.id }, actor);
      if (result.created) {
        created += 1;
        if (deferred) deferredCreated += 1;
      }
      handledOrderIds.add(order.id);
    } catch (error) {
      if (
        error instanceof PayrollError &&
        error.message === "ORDER_BONUS_ALREADY_EXISTS"
      ) {
        handledOrderIds.add(order.id);
        continue;
      }
      throw error;
    }
  }
  return {
    created,
    deferredCreated,
    deferredRemoved,
    removed,
    skipped: false,
    automaticPeriod,
    skippedOrders,
  };
}

export async function accrueCompletedTerminatedManagerOrderBonus(
  orderId: number,
  actor: PayrollActor,
) {
  const companyId = requireTenantIdentity().companyId;
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      companyId,
      deletedAt: null,
      orderDateNeedsReview: false,
      lifecycle: OrderLifecycle.COMPLETED,
      completedAt: { not: null },
    },
    select: {
      id: true,
      number: true,
      amount: true,
      status: true,
      lifecycle: true,
      deletedAt: true,
      manager: true,
      managerUserId: true,
      orderReceivedAt: true,
      completedAt: true,
      leadConversion: { select: { managerId: true } },
    },
  });
  if (
    !order?.completedAt ||
    !isManagerOrderBonusEligible({ ...order, managerName: order.manager })
  )
    return { created: false, skipped: true, reason: "ORDER_NOT_ELIGIBLE" };

  const profiles = await prisma.employeePayrollProfile.findMany({
    where: {
      companyId,
      payrollEnabled: true,
      OR: [
        { position: Role.MANAGER },
        { user: { role: Role.MANAGER } },
      ],
    },
    include: {
      user: { select: { id: true, name: true, role: true, active: true } },
    },
  });
  const profile = profiles.find(
    (candidate) =>
      employmentEnded(candidate) &&
      isOrderAssignedToManager(
        {
          managerUserId: order.managerUserId,
          leadManagerId: order.leadConversion?.managerId,
          managerName: order.manager,
        },
        {
          id: candidate.userId ?? -1,
          name: candidate.user?.name || candidate.name,
        },
      ),
  );
  if (!profile)
    return { created: false, skipped: true, reason: "EMPLOYEE_NOT_TERMINATED" };

  const earnedPeriod = companyYearMonth(order.orderReceivedAt);
  const period = await ensurePeriod(earnedPeriod.year, earnedPeriod.month);
  if (period.status !== PayrollPeriodStatus.OPEN)
    return { created: false, skipped: true, reason: "PERIOD_NOT_OPEN" };
  const priorBonus = await prisma.payrollAccrual.findFirst({
    where: {
      orderId: order.id,
      type: { in: [...orderBonusTypes] },
      direction: PayrollDirection.INCREASE,
      reversalOfId: null,
      reversedBy: { is: null },
      employeeId: profile.id,
    },
    include: {
      period: { select: { id: true, status: true } },
      payments: {
        where: { reversalOfId: null, reversedAt: null },
        select: { id: true },
      },
    },
  });
  if (priorBonus?.periodId === period.id)
    return { created: false, skipped: true, reason: "ALREADY_ACCRUED" };
  if (priorBonus) {
    if (
      priorBonus.period.status !== PayrollPeriodStatus.OPEN ||
      priorBonus.payments.length > 0
    )
      return {
        created: false,
        skipped: true,
        reason:
          priorBonus.payments.length > 0
            ? "BONUS_PAYMENT_EXISTS"
            : "SOURCE_PERIOD_NOT_OPEN",
      };
    const reason =
      "Начисление уволенного сотрудника перенесено в месяц фактической даты заказа";
    const cancellationHash = createHash("sha256")
      .update(
        JSON.stringify({
          accrualId: priorBonus.id,
          action: "cancel",
          reason,
        }),
      )
      .digest("hex");
    await correctOrderBonus(
      {
        accrualId: priorBonus.id,
        cancel: true,
        reason,
        key: `terminated-manager-order-bonus-completed:${priorBonus.id}`,
        requestHash: cancellationHash,
      },
      { ...actor, role: Role.DIRECTOR },
    );
  }
  const amount = managerOrderBonus(Number(order.amount));
  const key = `automatic-order-bonus-completed:${order.id}:${period.id}`;
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        orderId: order.id,
        periodId: period.id,
        amount,
        earnedAt: order.orderReceivedAt.toISOString(),
        unlockedAt: order.completedAt.toISOString(),
      }),
    )
    .digest("hex");
  try {
    return await createAccrualInternal(
      {
        employeeId: profile.id,
        periodId: period.id,
        type: PayrollAccrualType.ORDER_BONUS,
        amount,
        orderId: order.id,
        reason: `${AUTOMATIC_ORDER_BONUS_REASON_PREFIX} после завершения заказа уволенного сотрудника: ${order.number}`,
        key,
        requestHash,
      },
      actor,
    );
  } catch (error) {
    if (
      error instanceof PayrollError &&
      error.message === "ORDER_BONUS_ALREADY_EXISTS"
    )
      return { created: false, skipped: true, reason: error.message };
    throw error;
  }
}

type OrderBonusCorrectionInput = {
  accrualId: number;
  cancel: boolean;
  targetYear?: number;
  targetMonth?: number;
  targetOrderId?: number;
  amount?: number;
  manualOverride?: boolean;
  reason: string;
  key: string;
  requestHash: string;
};

export async function correctOrderBonus(
  input: OrderBonusCorrectionInput,
  actor: PayrollActor,
) {
  orderBonusCorrectionActor(actor);
  const reason = requiredReason(input.reason);
  const companyId = requireTenantIdentity().companyId;
  try {
    return await prisma.$transaction(async (tx) => {
      const replay = await tx.payrollAccrual.findUnique({
        where: { idempotencyKey: `${input.key}:reversal` },
      });
      if (replay) {
        if (!compareRequestHash(replay.requestHash, input.requestHash))
          throw new PayrollError("IDEMPOTENCY_CONFLICT");
        const replacement = await tx.payrollAccrual.findUnique({
          where: { idempotencyKey: `${input.key}:replacement` },
        });
        return {
          created: false,
          cancelled: !replacement,
          reversal: replay,
          replacement,
        };
      }

      const original = await tx.payrollAccrual.findFirst({
        where: { id: input.accrualId, employee: { companyId } },
        include: {
          employee: {
            include: {
              user: { select: { id: true, name: true, active: true } },
            },
          },
          period: true,
          reversedBy: { select: { id: true } },
          payments: {
            where: { reversalOfId: null, reversedAt: null },
            select: { id: true, amount: true },
          },
        },
      });
      if (
        !original ||
        original.reversalOfId ||
        !orderBonusTypes.includes(
          original.type as (typeof orderBonusTypes)[number],
        )
      )
        throw new PayrollError("BONUS_NOT_FOUND");
      if (original.reversedBy)
        throw new PayrollError("ACCRUAL_ALREADY_REVERSED");
      if (original.period.status !== PayrollPeriodStatus.OPEN)
        throw new PayrollError(
          original.period.status === PayrollPeriodStatus.CLOSED
            ? "PERIOD_CLOSED"
            : "PERIOD_NOT_OPEN",
        );
      if (original.payments.length > 0)
        throw new PayrollError("BONUS_PAYMENT_EXISTS");
      if (
        actor.role === Role.MANAGER &&
        original.employee.userId !== actor.userId
      )
        throw new PayrollError("FORBIDDEN");
      if (original.orderId) {
        const policyAdjustment = await tx.payrollAccrual.findFirst({
          where: {
            employeeId: original.employeeId,
            periodId: original.periodId,
            orderId: original.orderId,
            type: {
              in: [
                PayrollAccrualType.ADJUSTMENT_INCREASE,
                PayrollAccrualType.ADJUSTMENT_DECREASE,
              ],
            },
            reversalOfId: null,
            reversedBy: { is: null },
            reason: { startsWith: PAYROLL_POLICY_ADJUSTMENT_PREFIX },
          },
          select: { id: true },
        });
        if (policyAdjustment)
          throw new PayrollError("BONUS_POLICY_ADJUSTED");
      }

      let targetPeriod: typeof original.period | null = null;
      let targetOrder: {
        id: number;
        amount: Prisma.Decimal;
        status: string;
        lifecycle: OrderLifecycle;
        deletedAt: Date | null;
        manager: string;
        managerUserId: number | null;
        orderReceivedAt: Date;
        completedAt: Date | null;
        leadConversion: { managerId: number | null } | null;
      } | null = null;
      let replacementAmount: Prisma.Decimal | null = null;
      let expectedOrderBonus: number | null = null;

      if (!input.cancel) {
        const targetYear = Number(input.targetYear);
        const targetMonth = Number(input.targetMonth);
        const targetOrderId = Number(input.targetOrderId);
        if (
          !Number.isInteger(targetYear) ||
          !Number.isInteger(targetMonth) ||
          targetMonth < 1 ||
          targetMonth > 12 ||
          !isCompanyMonthStarted(targetYear, targetMonth)
        )
          throw new PayrollError("INVALID_PERIOD");
        if (!Number.isInteger(targetOrderId) || targetOrderId <= 0)
          throw new PayrollError("ORDER_REQUIRED");
        targetPeriod = await tx.payrollPeriod.upsert({
          where: {
            companyId_year_month: {
              companyId,
              year: targetYear,
              month: targetMonth,
            },
          },
          create: { companyId, year: targetYear, month: targetMonth },
          update: {},
        });
        if (targetPeriod.status !== PayrollPeriodStatus.OPEN)
          throw new PayrollError(
            targetPeriod.status === PayrollPeriodStatus.CLOSED
              ? "PERIOD_CLOSED"
              : "PERIOD_NOT_OPEN",
          );
        const range = companyMonthRange(targetYear, targetMonth);
        const originalEmploymentEnded = employmentEnded(original.employee);
        targetOrder = await tx.order.findFirst({
          where: {
            id: targetOrderId,
            companyId,
            deletedAt: null,
            orderDateNeedsReview: false,
            ...(!originalEmploymentEnded
              ? {
                  orderReceivedAt: { gte: range.start, lt: range.end },
                }
              : {}),
            OR: [
              ...(original.employee.userId
                ? [{ managerUserId: original.employee.userId }]
                : []),
              {
                managerUserId: null,
                manager: {
                  equals:
                    original.employee.name || original.employee.user?.name || "",
                  mode: "insensitive" as const,
                },
              },
              ...(original.employee.userId
                ? [{ leadConversion: { managerId: original.employee.userId } }]
                : []),
            ],
          },
          select: {
            id: true,
            amount: true,
            status: true,
            lifecycle: true,
            deletedAt: true,
            manager: true,
            managerUserId: true,
            orderReceivedAt: true,
            completedAt: true,
            leadConversion: { select: { managerId: true } },
          },
        });
        if (!targetOrder) throw new PayrollError("ORDER_OUTSIDE_PERIOD");
        if (
          !isOrderAssignedToManager(
            {
              managerUserId: targetOrder.managerUserId,
              leadManagerId: targetOrder.leadConversion?.managerId,
              managerName: targetOrder.manager,
            },
            {
              id: original.employee.userId ?? -1,
              name: original.employee.user?.name || original.employee.name,
            },
          )
        )
          throw new PayrollError("ORDER_OUTSIDE_PERIOD");
        if (!bonusEarnedInRange(targetOrder, original.employee, range))
          throw new PayrollError(
            originalEmploymentEnded &&
              (targetOrder.lifecycle !== OrderLifecycle.COMPLETED ||
                !targetOrder.completedAt)
              ? "ORDER_NOT_COMPLETED_FOR_TERMINATED_EMPLOYEE"
              : "ORDER_OUTSIDE_PERIOD",
          );
        if (
          !isManagerOrderBonusEligible({
            ...targetOrder,
            managerName: targetOrder.manager,
          })
        )
          throw new PayrollError("ORDER_NOT_ELIGIBLE_FOR_BONUS");
        const duplicate = await tx.payrollAccrual.findFirst({
          where: {
            id: { not: original.id },
            orderId: targetOrder.id,
            type: { in: [...orderBonusTypes] },
            direction: PayrollDirection.INCREASE,
            reversalOfId: null,
            reversedBy: { is: null },
          },
          select: { id: true },
        });
        if (duplicate) throw new PayrollError("ORDER_BONUS_ALREADY_EXISTS");
        expectedOrderBonus = managerOrderBonus(Number(targetOrder.amount));
        replacementAmount = input.manualOverride
          ? money(input.amount)
          : money(expectedOrderBonus);
      }

      await tx.payrollAccrual.update({
        where: { id: original.id },
        data: { orderBonusUniquenessKey: null },
      });
      const reversal = await tx.payrollAccrual.create({
        data: {
          employeeId: original.employeeId,
          periodId: original.periodId,
          earnedPeriodId: original.periodId,
          type: PayrollAccrualType.BONUS_REVERSAL,
          direction: PayrollDirection.DECREASE,
          amount: original.amount,
          orderId: original.orderId,
          reason,
          approvedById: actor.userId,
          createdById: actor.userId,
          reversalOfId: original.id,
          idempotencyKey: `${input.key}:reversal`,
          requestHash: input.requestHash,
        },
      });
      await tx.companyLedgerEntry.create({
        data: {
          companyId,
          type: "PAYROLL_ACCRUAL",
          category: "SALARY",
          source: "OTHER_SYSTEM",
          direction: "INCOME",
          amount: reversal.amount,
          operationDate: reversal.createdAt,
          comment: reason,
          orderId: original.orderId,
          employeeId: original.employeeId,
          authorId: actor.userId,
          idempotencyKey: `payroll-accrual:${reversal.id}`,
          requestHash: input.requestHash,
          affectsProfit: true,
          payrollAccrualId: reversal.id,
        },
      });

      const replacement =
        targetPeriod && targetOrder && replacementAmount
          ? await tx.payrollAccrual.create({
              data: {
                employeeId: original.employeeId,
                periodId: targetPeriod.id,
                type: PayrollAccrualType.ORDER_BONUS,
                direction: PayrollDirection.INCREASE,
                amount: replacementAmount,
                orderId: targetOrder.id,
                reason: input.manualOverride
                  ? `Ручная корректировка бонуса: ${reason}`
                  : `Исправление бонуса, сумма рассчитана автоматически: ${reason}`,
                paymentMode: original.paymentMode,
                approvedById: actor.userId,
                createdById: actor.userId,
                idempotencyKey: `${input.key}:replacement`,
                orderBonusUniquenessKey: `order-bonus:${targetOrder.id}`,
                requestHash: input.requestHash,
              },
            })
          : null;
      if (replacement) {
        await tx.companyLedgerEntry.create({
          data: {
            companyId,
            type: "PAYROLL_ACCRUAL",
            category: "SALARY",
            source: "OTHER_SYSTEM",
            direction: "EXPENSE",
            amount: replacement.amount,
            operationDate: replacement.createdAt,
            comment: replacement.reason,
            orderId: replacement.orderId,
            employeeId: original.employeeId,
            authorId: actor.userId,
            idempotencyKey: `payroll-accrual:${replacement.id}`,
            requestHash: input.requestHash,
            affectsProfit: true,
            payrollAccrualId: replacement.id,
          },
        });
      }
      await audit(tx, {
        action: replacement ? "ORDER_BONUS_CORRECTED" : "ORDER_BONUS_CANCELLED",
        actor,
        periodId: replacement?.periodId ?? original.periodId,
        employeeId: original.employeeId,
        before: {
          accrualId: original.id,
          periodId: original.periodId,
          orderId: original.orderId,
          amount: Number(original.amount),
        },
        after: replacement
          ? {
              reversalId: reversal.id,
              accrualId: replacement.id,
              periodId: replacement.periodId,
              orderId: replacement.orderId,
              amount: Number(replacement.amount),
              expectedOrderBonus,
              manualOverride: Boolean(input.manualOverride),
            }
          : { reversalId: reversal.id },
        reason,
        idempotencyKey: `${input.key}:audit`,
      });
      return {
        created: true,
        cancelled: !replacement,
        reversal,
        replacement,
        expectedOrderBonus,
        automaticAmount: Boolean(replacement && !input.manualOverride),
      };
    }, {
      ...transactionOptions,
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new PayrollError("ORDER_BONUS_ALREADY_EXISTS");
    throw error;
  }
}

type PayrollAccrualCorrectionInput = {
  accrualId: number;
  amount: number;
  reason: string;
  key: string;
  requestHash: string;
};

const genericAccrualCorrectionTypes = new Set<PayrollAccrualType>([
  PayrollAccrualType.BASE_SALARY,
  PayrollAccrualType.MEASUREMENT_BONUS,
  PayrollAccrualType.EXTRA_BONUS,
  PayrollAccrualType.PREMIUM,
  PayrollAccrualType.DEDUCTION,
  PayrollAccrualType.ADJUSTMENT_INCREASE,
  PayrollAccrualType.ADJUSTMENT_DECREASE,
]);

export async function correctPayrollAccrual(
  input: PayrollAccrualCorrectionInput,
  actor: PayrollActor,
) {
  salaryManager(actor);
  const reason = requiredReason(input.reason);
  const amount = money(input.amount);
  const companyId = requireTenantIdentity().companyId;
  return prisma.$transaction(
    async (tx) => {
      const replay = await tx.payrollAccrual.findUnique({
        where: { idempotencyKey: `${input.key}:reversal` },
      });
      if (replay) {
        if (!compareRequestHash(replay.requestHash, input.requestHash))
          throw new PayrollError("IDEMPOTENCY_CONFLICT");
        return {
          created: false,
          reversal: replay,
          replacement: await tx.payrollAccrual.findUnique({
            where: { idempotencyKey: `${input.key}:replacement` },
          }),
        };
      }

      const original = await tx.payrollAccrual.findFirst({
        where: { id: input.accrualId, employee: { companyId } },
        include: {
          period: true,
          reversedBy: { select: { id: true } },
          payments: {
            where: { reversalOfId: null, reversedAt: null },
            select: { id: true },
          },
        },
      });
      if (!original || original.reversalOfId)
        throw new PayrollError("ACCRUAL_NOT_FOUND");
      if (original.reversedBy)
        throw new PayrollError("ACCRUAL_ALREADY_REVERSED");
      if (!genericAccrualCorrectionTypes.has(original.type))
        throw new PayrollError("ACCRUAL_NOT_EDITABLE");
      if (original.payments.length > 0)
        throw new PayrollError("ACCRUAL_PAYMENT_EXISTS");
      if (original.period.status !== PayrollPeriodStatus.OPEN)
        throw new PayrollError(
          original.period.status === PayrollPeriodStatus.CLOSED
            ? "PERIOD_CLOSED"
            : "PERIOD_NOT_OPEN",
        );

      if (original.measurementId)
        await tx.payrollAccrual.update({
          where: { id: original.id },
          data: { measurementId: null },
        });

      const reversalDirection =
        original.direction === PayrollDirection.INCREASE
          ? PayrollDirection.DECREASE
          : PayrollDirection.INCREASE;
      const reversal = await tx.payrollAccrual.create({
        data: {
          employeeId: original.employeeId,
          periodId: original.periodId,
          earnedPeriodId: original.earnedPeriodId ?? original.periodId,
          type: PayrollAccrualType.BONUS_REVERSAL,
          direction: reversalDirection,
          amount: original.amount,
          orderId: original.orderId,
          reason: `Отмена перед исправлением: ${reason}`,
          approvedById: actor.userId,
          createdById: actor.userId,
          reversalOfId: original.id,
          idempotencyKey: `${input.key}:reversal`,
          requestHash: input.requestHash,
        },
      });
      await tx.companyLedgerEntry.create({
        data: {
          companyId,
          type: "PAYROLL_ACCRUAL",
          category: "SALARY",
          source: "OTHER_SYSTEM",
          direction:
            reversal.direction === PayrollDirection.INCREASE
              ? "EXPENSE"
              : "INCOME",
          amount: reversal.amount,
          operationDate: reversal.createdAt,
          comment: reversal.reason,
          orderId: reversal.orderId,
          employeeId: original.employeeId,
          authorId: actor.userId,
          idempotencyKey: `payroll-accrual:${reversal.id}`,
          requestHash: input.requestHash,
          affectsProfit: true,
          payrollAccrualId: reversal.id,
        },
      });

      const replacement = await tx.payrollAccrual.create({
        data: {
          employeeId: original.employeeId,
          periodId: original.periodId,
          earnedPeriodId: original.earnedPeriodId,
          type: original.type,
          direction: original.direction,
          amount,
          orderId: original.orderId,
          measurementId: original.measurementId,
          reason: `Исправление начисления: ${reason}`,
          externalReference: original.externalReference,
          paymentMode: original.paymentMode,
          approvedById: actor.userId,
          createdById: actor.userId,
          idempotencyKey: `${input.key}:replacement`,
          requestHash: input.requestHash,
        },
      });
      await tx.companyLedgerEntry.create({
        data: {
          companyId,
          type: "PAYROLL_ACCRUAL",
          category: "SALARY",
          source: "OTHER_SYSTEM",
          direction:
            replacement.direction === PayrollDirection.INCREASE
              ? "EXPENSE"
              : "INCOME",
          amount: replacement.amount,
          operationDate: replacement.createdAt,
          comment: replacement.reason,
          orderId: replacement.orderId,
          employeeId: original.employeeId,
          authorId: actor.userId,
          idempotencyKey: `payroll-accrual:${replacement.id}`,
          requestHash: input.requestHash,
          affectsProfit: true,
          payrollAccrualId: replacement.id,
        },
      });
      await audit(tx, {
        action: "PAYROLL_ACCRUAL_CORRECTED",
        actor,
        periodId: original.periodId,
        employeeId: original.employeeId,
        before: {
          accrualId: original.id,
          type: original.type,
          amount: Number(original.amount),
          direction: original.direction,
        },
        after: {
          reversalId: reversal.id,
          accrualId: replacement.id,
          amount: Number(replacement.amount),
          direction: replacement.direction,
        },
        reason,
        idempotencyKey: `${input.key}:audit`,
      });
      return { created: true, reversal, replacement };
    },
    {
      ...transactionOptions,
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

export async function reverseAccrual(
  id: number,
  periodId: number,
  reason: string,
  key: string,
  requestHash: string,
  actor: PayrollActor,
) {
  salaryManager(actor);
  const reversalReason = requiredReason(reason);
  const companyId = requireTenantIdentity().companyId;
  return prisma.$transaction(
    async (tx) => {
      const replay = await tx.payrollAccrual.findUnique({
        where: { idempotencyKey: key },
      });
      if (replay) {
        if (!compareRequestHash(replay.requestHash, requestHash))
          throw new PayrollError("IDEMPOTENCY_CONFLICT");
        return { accrual: replay, created: false };
      }
      const original = await tx.payrollAccrual.findFirst({
        where: { id, employee: { companyId } },
        include: {
          reversedBy: { select: { id: true } },
          payments: {
            where: { reversalOfId: null, reversedAt: null },
            select: { id: true },
          },
        },
      });
      if (!original || original.reversalOfId)
        throw new PayrollError("ACCRUAL_NOT_FOUND");
      if (original.reversedBy)
        throw new PayrollError("ACCRUAL_ALREADY_REVERSED");
      if (original.payments.length > 0)
        throw new PayrollError("ACCRUAL_PAYMENT_EXISTS");
      await openPeriod(tx, periodId);

      const direction =
        original.direction === PayrollDirection.INCREASE
          ? PayrollDirection.DECREASE
          : PayrollDirection.INCREASE;
      const reversal = await tx.payrollAccrual.create({
        data: {
          employeeId: original.employeeId,
          periodId,
          earnedPeriodId: original.periodId,
          type: PayrollAccrualType.BONUS_REVERSAL,
          direction,
          amount: original.amount,
          orderId: original.orderId,
          reason: reversalReason,
          approvedById: actor.userId,
          createdById: actor.userId,
          reversalOfId: original.id,
          idempotencyKey: key,
          requestHash,
        },
      });
      await tx.payrollAccrual.update({
        where: { id: original.id },
        data: { orderBonusUniquenessKey: null },
      });
      await tx.companyLedgerEntry.create({
        data: {
          companyId,
          type: "PAYROLL_ACCRUAL",
          category: "SALARY",
          source: "OTHER_SYSTEM",
          direction:
            direction === PayrollDirection.INCREASE ? "EXPENSE" : "INCOME",
          amount: reversal.amount,
          operationDate: reversal.createdAt,
          comment: reversalReason,
          orderId: reversal.orderId,
          employeeId: original.employeeId,
          authorId: actor.userId,
          idempotencyKey: `payroll-accrual:${reversal.id}`,
          requestHash,
          affectsProfit: true,
          payrollAccrualId: reversal.id,
        },
      });
      await audit(tx, {
        action: "PAYROLL_ACCRUAL_REVERSED",
        actor,
        periodId,
        employeeId: original.employeeId,
        before: {
          accrualId: original.id,
          type: original.type,
          amount: Number(original.amount),
          direction: original.direction,
        },
        after: { reversalId: reversal.id, direction },
        reason: reversalReason,
        idempotencyKey: `${key}:audit`,
      });
      return { accrual: reversal, created: true };
    },
    {
      ...transactionOptions,
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}
