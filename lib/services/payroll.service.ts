import {
  AdvanceRequestStatus,
  BonusPaymentMode,
  CalendarTaskStatus,
  CalendarTaskWorkflow,
  MeasurementStatus,
  OrderLifecycle,
  OrderResponsibleType,
  PayrollConfirmationStatus,
  PayrollAccrualType,
  PayrollDirection,
  PayrollPaymentType,
  PayrollPeriodStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { compareRequestHash, isPrismaUniqueConflict } from "@/lib/idempotency";
import {
  companyMonthRange,
  companyYearMonth,
  isCompanyMonthStarted,
} from "@/lib/company-calendar";
import {
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

const orderBonusEmployeeRoles = new Set<Role>([
  Role.MANAGER,
  Role.OPERATIONS_DIRECTOR,
  Role.DIRECTOR,
]);

const employeeCanReceiveOrderBonus = (employee: {
  position: string;
  user?: { role?: Role | null } | null;
}) =>
  Boolean(
    (employee.user?.role && orderBonusEmployeeRoles.has(employee.user.role)) ||
      orderBonusEmployeeRoles.has(employee.position as Role),
  );

const effectiveOrderBonusAmount = (
  _orderAmount: number,
  manualAmount: Prisma.Decimal | number | null | undefined,
) => manualAmount == null ? 0 : Number(manualAmount);

const optionalBonusAmount = (value: unknown) => {
  if (value == null) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0)
    throw new PayrollError("INVALID_AMOUNT");
  return new Prisma.Decimal(amount.toFixed(2));
};

type PayrollCalculationState = {
  salary: number;
  orderBonuses: number;
  otherBonuses: number;
  premiums: number;
  deductions: number;
  prepared: number;
  source: Prisma.InputJsonValue;
};

const payrollCalculationHash = (state: PayrollCalculationState) =>
  createHash("sha256").update(JSON.stringify(state)).digest("hex");

type PayrollCalculationSnapshotState = {
  salaryAmount: Prisma.Decimal;
  orderBonusAmount: Prisma.Decimal;
  otherBonusAmount: Prisma.Decimal;
  premiumAmount: Prisma.Decimal;
  deductionAmount: Prisma.Decimal;
  preparedAmount: Prisma.Decimal;
  calculationHash: string;
  source: Prisma.JsonValue;
};

const samePayrollAmount = (left: number, right: number) =>
  Math.abs(left - right) < 0.005;

/**
 * The first snapshot migration preserves previously confirmed salary rows.
 * Those rows predate the runtime SHA-256 format, so compare their immutable
 * components and sorted source ids instead of treating every migrated row as
 * an immediate correction. New snapshots always use the canonical hash.
 */
function payrollSnapshotMatchesCalculation(
  snapshot: PayrollCalculationSnapshotState,
  state: PayrollCalculationState,
  calculationHash = payrollCalculationHash(state),
) {
  if (snapshot.calculationHash === calculationHash) return true;
  const source =
    snapshot.source &&
    typeof snapshot.source === "object" &&
    !Array.isArray(snapshot.source)
      ? (snapshot.source as Record<string, Prisma.JsonValue>)
      : null;
  if (source?.migrated !== true) return false;
  if (
    !samePayrollAmount(Number(snapshot.salaryAmount), state.salary) ||
    !samePayrollAmount(Number(snapshot.orderBonusAmount), state.orderBonuses) ||
    !samePayrollAmount(Number(snapshot.otherBonusAmount), state.otherBonuses) ||
    !samePayrollAmount(Number(snapshot.premiumAmount), state.premiums) ||
    !samePayrollAmount(Number(snapshot.deductionAmount), state.deductions) ||
    !samePayrollAmount(Number(snapshot.preparedAmount), state.prepared)
  )
    return false;
  const currentSource = state.source as Record<string, unknown>;
  const migratedAccrualIds = Array.isArray(source.calculationAccruals)
    ? source.calculationAccruals
        .flatMap((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return [];
          const id = Number((item as Record<string, unknown>).id);
          return Number.isInteger(id) ? [id] : [];
        })
        .sort((a, b) => a - b)
    : [];
  const currentAccrualIds = Array.isArray(currentSource.calculationAccruals)
    ? currentSource.calculationAccruals
        .flatMap((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return [];
          const id = Number((item as Record<string, unknown>).id);
          return Number.isInteger(id) ? [id] : [];
        })
        .sort((a, b) => a - b)
    : [];
  const currentOrderSources = Array.isArray(currentSource.orderBonuses)
    ? currentSource.orderBonuses
    : [];
  const migratedOrderSources = Array.isArray(source.orderBonuses)
    ? source.orderBonuses
    : [];
  const canonicalOrderSources = (rows: Prisma.JsonValue[]) =>
    rows
      .flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const row = item as Record<string, Prisma.JsonValue>;
        const orderId = Number(row.orderId);
        const decisionId = row.decisionId == null ? null : Number(row.decisionId);
        const manualAmount = row.manualAmount == null ? null : Number(row.manualAmount);
        const earnedAt = typeof row.earnedAt === "string" ? row.earnedAt : "";
        if (!Number.isInteger(orderId)) return [];
        return [{ orderId, decisionId, earnedAt, manualAmount }];
      })
      .sort((left, right) => left.orderId - right.orderId);
  return (
    JSON.stringify(canonicalOrderSources(migratedOrderSources)) ===
      JSON.stringify(canonicalOrderSources(currentOrderSources)) &&
    migratedAccrualIds.length === currentAccrualIds.length &&
    migratedAccrualIds.every((id, index) => id === currentAccrualIds[index])
  );
}

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
  const companyId = requireTenantIdentity().companyId;
  // Every payroll writer takes a key-share lock before checking OPEN. Closing
  // takes the conflicting update lock, so its final summary and status write
  // cannot race an accrual, bonus decision, confirmation or payment commit.
  await tx.$queryRaw`
    SELECT id
    FROM "PayrollPeriod"
    WHERE id = ${periodId} AND "companyId" = ${companyId}
    FOR KEY SHARE
  `;
  const period = await tx.payrollPeriod.findFirst({
    where: { id: periodId, companyId },
  });
  if (!period) throw new PayrollError("PERIOD_NOT_FOUND");
  if (period.status !== PayrollPeriodStatus.OPEN)
    throw new PayrollError(period.status === PayrollPeriodStatus.CLOSED ? "PERIOD_CLOSED" : "PERIOD_NOT_OPEN");
  return period;
}

async function assertPayrollEmployeeTenant(
  tx: Prisma.TransactionClient,
  employeeId: number,
  errorCode: string,
) {
  const employee = await tx.employeePayrollProfile.findFirst({
    where: {
      id: employeeId,
      companyId: requireTenantIdentity().companyId,
    },
    select: { id: true },
  });
  if (!employee) throw new PayrollError(errorCode);
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
  idempotency?: { key: string; requestHash: string },
) {
  salaryManager(actor);
  const companyId = requireTenantIdentity().companyId;
  const salary = nonNegativeMoney(input.baseSalary);
  const guaranteed = nonNegativeMoney(input.defaultGuaranteedBonus ?? 0);
  if (!Number.isInteger(input.userId) || input.userId <= 0)
    throw new PayrollError("EMPLOYEE_NOT_FOUND");
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${31_000_000 + input.userId})`;
      if (idempotency) {
        const replay = await tx.payrollAuditEvent.findUnique({
          where: { idempotencyKey: idempotency.key },
        });
        if (replay) {
          const after =
            replay.after &&
            typeof replay.after === "object" &&
            !Array.isArray(replay.after)
              ? (replay.after as Record<string, unknown>)
              : null;
          const profileId = Number(after?.profileId);
          const replaySalary = Number(after?.baseSalary);
          const replayGuaranteed = Number(after?.guaranteedBonus);
          if (
            replay.action !== "PAYROLL_PROFILE_CONFIGURED" ||
            replay.employeeId !== profileId ||
            after?.userId !== input.userId ||
            typeof after.requestHash !== "string" ||
            !compareRequestHash(after.requestHash, idempotency.requestHash) ||
            !Number.isInteger(profileId) ||
            profileId <= 0 ||
            !Number.isFinite(replaySalary) ||
            replaySalary < 0 ||
            !Number.isFinite(replayGuaranteed) ||
            replayGuaranteed < 0
          )
            throw new PayrollError("IDEMPOTENCY_CONFLICT");
          const replayProfile = await tx.employeePayrollProfile.findFirst({
            where: { id: profileId, companyId, userId: input.userId },
            include: {
              salaryRates: { orderBy: { effectiveFrom: "desc" } },
              user: {
                select: { id: true, name: true, role: true, active: true },
              },
            },
          });
          if (!replayProfile)
            throw new PayrollError("IDEMPOTENCY_CONFLICT");
          return {
            ...replayProfile,
            baseSalary: new Prisma.Decimal(replaySalary.toFixed(2)),
            defaultGuaranteedBonus: new Prisma.Decimal(
              replayGuaranteed.toFixed(2),
            ),
          };
        }
      }
      const user = await tx.user.findFirst({
        where: { id: input.userId, companyId },
      });
      if (!user || user.role === Role.PARTNER)
        throw new PayrollError("EMPLOYEE_NOT_FOUND");
      const previousProfile = await tx.employeePayrollProfile.findFirst({
        where: { userId: input.userId, companyId },
      });
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
        before: previousProfile
          ? {
              baseSalary: Number(previousProfile.baseSalary),
              guaranteedBonus: Number(
                previousProfile.defaultGuaranteedBonus,
              ),
            }
          : undefined,
        after: {
          profileId: profile.id,
          userId: input.userId,
          baseSalary: Number(salary),
          guaranteedBonus: Number(guaranteed),
          ...(idempotency ? { requestHash: idempotency.requestHash } : {}),
        },
        reason: input.comment?.trim() || "Настройка зарплатного профиля",
        idempotencyKey: idempotency?.key,
      });
      return tx.employeePayrollProfile.findFirstOrThrow({
        where: { id: profile.id, companyId },
        include: {
          salaryRates: { orderBy: { effectiveFrom: "desc" } },
          user: { select: { id: true, name: true, role: true, active: true } },
        },
      });
    }, transactionOptions);
  } catch (error) {
    if (idempotency && isPrismaUniqueConflict(error))
      throw new PayrollError("IDEMPOTENCY_CONFLICT");
    throw error;
  }
}

export async function changeSalary(
  employeeId: number,
  amount: number,
  effectiveFrom: Date,
  comment: string | undefined,
  actor: PayrollActor,
  idempotency?: { key: string; requestHash: string },
) {
  salaryManager(actor);
  const salary = nonNegativeMoney(amount);
  const reason = requiredReason(comment);
  const companyId = requireTenantIdentity().companyId;
  if (Number.isNaN(effectiveFrom.getTime())) throw new PayrollError("INVALID_DATE");
  return prisma.$transaction(async (tx) => {
    const profile = await tx.employeePayrollProfile.findFirst({
      where: { id: employeeId, companyId },
    });
    if (!profile) throw new PayrollError("EMPLOYEE_NOT_FOUND");
    await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${30_000_000 + employeeId})`;
    if (idempotency) {
      const replay = await tx.payrollAuditEvent.findUnique({
        where: { idempotencyKey: idempotency.key },
      });
      if (replay) {
        const after = replay.after as Record<string, unknown> | null;
        const rateId = Number(after?.salaryRateId);
        if (
          replay.employeeId !== employeeId ||
          after?.requestHash !== idempotency.requestHash ||
          !Number.isInteger(rateId)
        )
          throw new PayrollError("IDEMPOTENCY_CONFLICT");
        const rate = await tx.employeeSalaryRate.findFirst({
          where: { id: rateId, employeeId },
        });
        if (!rate) throw new PayrollError("IDEMPOTENCY_CONFLICT");
        return rate;
      }
    }
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
          salaryRateId: corrected.id,
          ...(idempotency ? { requestHash: idempotency.requestHash } : {}),
        },
        reason,
        idempotencyKey: idempotency?.key,
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
      await tx.employeeSalaryRate.updateMany({
        where: { employeeId, effectiveTo: null },
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
      after: {
        amount: Number(salary),
        effectiveFrom: startsAt.toISOString(),
        salaryRateId: rate.id,
        ...(idempotency ? { requestHash: idempotency.requestHash } : {}),
      },
      reason,
      idempotencyKey: idempotency?.key,
    });
    return rate;
  }, transactionOptions);
}

export async function changeAllowance(
  employeeId: number,
  amount: number,
  comment: string | undefined,
  actor: PayrollActor,
  idempotency?: { key: string; requestHash: string },
) {
  salaryManager(actor);
  const allowance = nonNegativeMoney(amount);
  const companyId = requireTenantIdentity().companyId;
  if (!Number.isInteger(employeeId) || employeeId <= 0)
    throw new PayrollError("EMPLOYEE_NOT_FOUND");
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${32_000_000 + employeeId})`;
      const profile = await tx.employeePayrollProfile.findFirst({
        where: { id: employeeId, companyId },
      });
      if (!profile) throw new PayrollError("EMPLOYEE_NOT_FOUND");
      if (idempotency) {
        const replay = await tx.payrollAuditEvent.findUnique({
          where: { idempotencyKey: idempotency.key },
        });
        if (replay) {
          const after =
            replay.after &&
            typeof replay.after === "object" &&
            !Array.isArray(replay.after)
              ? (replay.after as Record<string, unknown>)
              : null;
          const replayAmount = Number(after?.amount);
          if (
            replay.action !== "ALLOWANCE_CHANGED" ||
            replay.employeeId !== employeeId ||
            after?.profileId !== employeeId ||
            typeof after.requestHash !== "string" ||
            !compareRequestHash(after.requestHash, idempotency.requestHash) ||
            !Number.isFinite(replayAmount) ||
            replayAmount < 0
          )
            throw new PayrollError("IDEMPOTENCY_CONFLICT");
          return {
            ...profile,
            defaultGuaranteedBonus: new Prisma.Decimal(
              replayAmount.toFixed(2),
            ),
          };
        }
      }
      const updated = await tx.employeePayrollProfile.update({
        where: { id: employeeId },
        data: { defaultGuaranteedBonus: allowance },
      });
      await audit(tx, {
        action: "ALLOWANCE_CHANGED",
        actor,
        employeeId,
        before: { amount: Number(profile.defaultGuaranteedBonus) },
        after: {
          profileId: employeeId,
          amount: Number(allowance),
          ...(idempotency ? { requestHash: idempotency.requestHash } : {}),
        },
        reason: comment?.trim() || "Изменение гарантированного бонуса",
        idempotencyKey: idempotency?.key,
      });
      return updated;
    }, transactionOptions);
  } catch (error) {
    if (idempotency && isPrismaUniqueConflict(error))
      throw new PayrollError("IDEMPOTENCY_CONFLICT");
    throw error;
  }
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

const isOrderBonusAccrualType = (type: PayrollAccrualType): boolean =>
  type === PayrollAccrualType.ORDER_BONUS ||
  type === PayrollAccrualType.GUARANTEED_ORDER_BONUS;

export async function createAccrual(input: AccrualInput, actor: PayrollActor) {
  if (isOrderBonusAccrualType(input.type))
    throw new PayrollError("ORDER_BONUS_DECISION_REQUIRED");
  if (input.type === PayrollAccrualType.BASE_SALARY)
    throw new PayrollError("USE_CONFIRM_CALCULATION");
  salaryManager(actor);
  return createAccrualInternal(input, actor);
}

export async function createSelfAccrual(
  input: Omit<AccrualInput, "employeeId">,
  actor: PayrollActor,
) {
  void input;
  void actor;
  // Managers use PayrollOrderBonusDecision for their own order bonuses and
  // PaymentConfirmation for advance reports. Payroll components (including
  // deductions) are leadership-only and must never be created through a
  // self-service endpoint.
  throw new PayrollError("FORBIDDEN");
}

async function createAccrualInternal(
  input: AccrualInput,
  actor: PayrollActor,
) {
  if (isOrderBonusAccrualType(input.type))
    throw new PayrollError("ORDER_BONUS_DECISION_REQUIRED");
  if (input.type === PayrollAccrualType.MEASUREMENT_BONUS)
    throw new PayrollError("MEASUREMENT_BONUS_AUTOMATIC_ONLY");
  const isOrderBonus = isOrderBonusAccrualType(input.type);
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
          await assertPayrollEmployeeTenant(
            tx,
            existing.employeeId,
            "IDEMPOTENCY_CONFLICT",
          );
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
                  responsibleType: OrderResponsibleType.EMPLOYEE,
                  managerUserId: employee.userId ?? -1,
                }
              : {}),
          },
          select: {
            status: true,
            lifecycle: true,
            amount: true,
            deletedAt: true,
            responsibleType: true,
            manager: true,
            managerUserId: true,
            orderReceivedAt: true,
            completedAt: true,
          },
        });
        if (!order) throw new PayrollError("ORDER_OUTSIDE_PERIOD");
        if (
          isOrderBonus &&
          !isOrderAssignedToManager(
            {
              responsibleType: order.responsibleType,
              managerUserId: order.managerUserId,
              managerName: order.manager,
            },
            {
              id: employee.userId ?? -1,
              name:
                employee.user?.name ||
                employee.name ||
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
          // Components remain a prepared calculation until a director/founder
          // confirms the complete payroll snapshot.
          affectsProfit: false,
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
      isOrderBonusAccrualType(input.type) &&
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
  const employee = await tx.employeePayrollProfile.findFirst({
    where: {
      id: employeeId,
      companyId: requireTenantIdentity().companyId,
    },
    include: {
      user: { select: { role: true, name: true, active: true } },
      salaryRates: { orderBy: { effectiveFrom: "desc" } },
      accruals: {
        where: { periodId: period.id },
        include: { reversedBy: { select: { id: true } } },
        orderBy: { id: "asc" },
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
      responsibleType: OrderResponsibleType.EMPLOYEE,
      managerUserId: employee.userId ?? -1,
    },
    select: {
      id: true,
      amount: true,
      status: true,
      lifecycle: true,
      deletedAt: true,
      responsibleType: true,
      manager: true,
      managerUserId: true,
      orderReceivedAt: true,
      completedAt: true,
    },
  });
  const orders = periodOrders.filter(
    (order) =>
      isOrderAssignedToManager(
        {
          responsibleType: order.responsibleType,
          managerUserId: order.managerUserId,
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

async function payrollEntitlementTx(
  tx: Prisma.TransactionClient,
  employeeId: number,
  period: { id: number; year: number; month: number },
) {
  const companyId = requireTenantIdentity().companyId;
  const employee = await tx.employeePayrollProfile.findFirst({
    where: { id: employeeId, companyId, payrollEnabled: true },
    include: {
      user: { select: { id: true, name: true, role: true, active: true } },
      salaryRates: { orderBy: { effectiveFrom: "desc" } },
      accruals: {
        where: { periodId: period.id },
        include: {
          reversedBy: { select: { id: true } },
          order: { select: { responsibleType: true } },
          ledgerEntry: {
            select: {
              amount: true,
              direction: true,
              affectsProfit: true,
              voidedAt: true,
            },
          },
        },
      },
      payments: { where: { periodId: period.id } },
      calculationSnapshots: {
        where: { periodId: period.id },
        orderBy: { revision: "desc" },
        take: 1,
      },
    },
  });
  if (!employee) throw new PayrollError("EMPLOYEE_NOT_FOUND");
  const range = companyMonthRange(period.year, period.month);
  const periodSalary = payrollSalaryForPeriod({
    hiredAt: employee.hiredAt,
    terminatedAt: employee.terminatedAt,
    baseSalary: employee.baseSalary,
    salaryRates: employee.salaryRates,
    periodStart: range.start,
    periodEnd: range.end,
  });
  const activeRate = employee.salaryRates.find(
    (rate) =>
      rate.effectiveFrom < range.end &&
      (!rate.effectiveTo || rate.effectiveTo > range.start),
  );
  const salaryPlanEnabled =
    periodSalary.employedInPeriod &&
    (activeRate?.planEnabled ??
      (employee.salaryRates.length === 0 && employee.salaryPlanEnabled));
  const activeAccruals = employee.accruals.filter(
    (row) => !row.reversalOfId && !row.reversedBy,
  );
  const salary = salaryPlanEnabled ? Math.max(periodSalary.amount, 0) : 0;
  const calculationAccruals = activeAccruals.filter(
    (row) =>
      row.type !== PayrollAccrualType.BASE_SALARY &&
      row.type !== PayrollAccrualType.ORDER_BONUS &&
      row.type !== PayrollAccrualType.GUARANTEED_ORDER_BONUS &&
      (row.type !== PayrollAccrualType.MEASUREMENT_BONUS ||
        row.order?.responsibleType === OrderResponsibleType.EMPLOYEE) &&
      !row.reason.startsWith(PAYROLL_POLICY_ADJUSTMENT_PREFIX),
  );
  const increases = (types: PayrollAccrualType[]) => calculationAccruals
    .filter(
      (row) =>
        row.direction === PayrollDirection.INCREASE && types.includes(row.type),
    )
    .reduce((sum, row) => sum + Number(row.amount), 0);
  const otherBonuses = increases([
    PayrollAccrualType.MEASUREMENT_BONUS,
    PayrollAccrualType.EXTRA_BONUS,
    PayrollAccrualType.ADJUSTMENT_INCREASE,
  ]);
  const premiums = increases([PayrollAccrualType.PREMIUM]);
  const deductions = calculationAccruals
    .filter((row) => row.direction === PayrollDirection.DECREASE)
    .reduce((sum, row) => sum + Number(row.amount), 0);
  const calculationAccrualIds = new Set(
    calculationAccruals.map((row) => row.id),
  );
  // Before snapshots existed, a standalone component could already have a
  // profit-affecting ledger row. Preserve that historical recognition and
  // only post the unrecognised balance on the first snapshot.
  const previouslyRecognizedProfit = activeAccruals
    .filter(
      (row) =>
        row.type === PayrollAccrualType.BASE_SALARY ||
        calculationAccrualIds.has(row.id),
    )
    .reduce((sum, row) => {
      const ledger = row.ledgerEntry;
      if (!ledger?.affectsProfit || ledger.voidedAt) return sum;
      return sum +
        (ledger.direction === "EXPENSE"
          ? Number(ledger.amount)
          : -Number(ledger.amount));
    }, 0);
  let orderBonuses = 0;
  let missingBonusCount = 0;
  const orderBonusSources: Array<{
    orderId: number;
    decisionId: number | null;
    earnedAt: string;
    manualAmount: number | null;
  }> = [];
  if (employee.userId && employeeCanReceiveOrderBonus(employee)) {
    const orders = await tx.order.findMany({
      where: {
        companyId,
        deletedAt: null,
        orderDateNeedsReview: false,
        responsibleType: OrderResponsibleType.EMPLOYEE,
        managerUserId: employee.userId,
        lifecycle: { not: OrderLifecycle.CANCELLED },
        OR: [
          {
            payrollBonusDecisions: {
              some: { employeeId: employee.id, periodId: period.id },
            },
          },
          {
            payrollBonusDecisions: { none: { employeeId: employee.id } },
            orderReceivedAt: { gte: range.start, lt: range.end },
          },
        ],
      },
      select: {
        id: true,
        amount: true,
        status: true,
        lifecycle: true,
        deletedAt: true,
        responsibleType: true,
        manager: true,
        managerUserId: true,
        orderReceivedAt: true,
        completedAt: true,
        payrollBonusDecisions: {
          where: { employeeId: employee.id },
          select: {
            id: true,
            periodId: true,
            earnedAt: true,
            manualAmount: true,
          },
        },
      },
      orderBy: { id: "asc" },
    });
    for (const order of orders) {
      if (!isManagerOrderBonusEligible(order)) continue;
      const decision = order.payrollBonusDecisions[0];
      const earnedAt = decision?.periodId === period.id
        ? decision.earnedAt
        : decision
          ? null
          : bonusEarnedInRange(order, employee, range);
      if (!earnedAt) continue;
      const manualAmount = decision?.manualAmount == null
        ? null
        : Number(decision.manualAmount);
      if (manualAmount == null) missingBonusCount += 1;
      else orderBonuses += manualAmount;
      orderBonusSources.push({
        orderId: order.id,
        decisionId: decision?.id ?? null,
        earnedAt: earnedAt.toISOString(),
        manualAmount,
      });
    }
  }
  const paid = employee.payments.reduce(
    (sum, payment) => sum + signedPayment(payment),
    0,
  );
  const total = salary + orderBonuses + otherBonuses + premiums - deductions;
  const latestApproval = employee.calculationSnapshots[0] ?? null;
  const approvedAmount = latestApproval
    ? Number(latestApproval.preparedAmount)
    : null;
  return {
    salary,
    orderBonuses,
    otherBonuses,
    premiums,
    deductions,
    paid,
    total,
    payable: (approvedAmount ?? total) - paid,
    incomplete: missingBonusCount > 0,
    missingBonusCount,
    previouslyRecognizedProfit,
    orderBonusSources,
    source: {
      salaryRateId: activeRate?.id ?? null,
      salaryEffectiveFrom: periodSalary.effectiveFrom?.toISOString() ?? null,
      calculationAccruals: calculationAccruals
        .map((row) => ({
          id: row.id,
          type: row.type,
          direction: row.direction,
          amount: Number(row.amount),
        }))
        .sort((a, b) => a.id - b.id),
      orderBonuses: orderBonusSources
        .slice()
        .sort((a, b) => a.orderId - b.orderId),
    },
    latestApproval,
    approvedAmount,
  };
}

export async function confirmPayrollCalculation(
  input: {
    employeeId: number;
    periodId: number;
    reason: string;
    key: string;
    requestHash: string;
    expectedCalculationHash: string;
  },
  actor: PayrollActor,
) {
  salaryManager(actor);
  const reason = requiredReason(input.reason);
  const companyId = requireTenantIdentity().companyId;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id
      FROM "PayrollPeriod"
      WHERE id = ${input.periodId} AND "companyId" = ${companyId}
      FOR KEY SHARE
    `;
    const period = await tx.payrollPeriod.findFirst({
      where: { id: input.periodId, companyId },
      select: { id: true, year: true, month: true, status: true },
    });
    if (!period) throw new PayrollError("PERIOD_NOT_FOUND");
    if (!isCompanyMonthStarted(period.year, period.month))
      throw new PayrollError("PAYROLL_PERIOD_NOT_STARTED");
    await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${period.id}, ${input.employeeId})`;
    const replay = await tx.payrollCalculationSnapshot.findUnique({
      where: { idempotencyKey: input.key },
      include: { approvedBy: { select: { id: true, name: true } } },
    });
    if (replay) {
      if (
        replay.companyId !== companyId ||
        replay.employeeId !== input.employeeId ||
        replay.periodId !== period.id
      )
        throw new PayrollError("IDEMPOTENCY_CONFLICT");
      if (!compareRequestHash(replay.requestHash, input.requestHash))
        throw new PayrollError("IDEMPOTENCY_CONFLICT");
      return { snapshot: replay, created: false, replay: true };
    }
    const replayAudit = await tx.payrollAuditEvent.findUnique({
      where: { idempotencyKey: `${input.key}:audit` },
      include: { period: { select: { companyId: true } } },
    });
    if (replayAudit) {
      const after =
        replayAudit.after &&
        typeof replayAudit.after === "object" &&
        !Array.isArray(replayAudit.after)
          ? (replayAudit.after as Record<string, unknown>)
          : null;
      if (
        replayAudit.period?.companyId !== companyId ||
        replayAudit.periodId !== period.id ||
        replayAudit.employeeId !== input.employeeId ||
        after?.requestHash !== input.requestHash
      )
        throw new PayrollError("IDEMPOTENCY_CONFLICT");
      const snapshotId = Number(after.snapshotId);
      if (!Number.isInteger(snapshotId) || snapshotId <= 0)
        throw new PayrollError("IDEMPOTENCY_CONFLICT");
      const snapshot = await tx.payrollCalculationSnapshot.findFirst({
        where: {
          id: snapshotId,
          companyId,
          employeeId: input.employeeId,
          periodId: period.id,
        },
        include: { approvedBy: { select: { id: true, name: true } } },
      });
      if (!snapshot) throw new PayrollError("IDEMPOTENCY_CONFLICT");
      return { snapshot, created: false, replay: true };
    }
    const calculation = await payrollEntitlementTx(
      tx,
      input.employeeId,
      period,
    );
    if (calculation.incomplete)
      throw new PayrollError("CALCULATION_INCOMPLETE");
    const prepared = {
      salary: calculation.salary,
      orderBonuses: calculation.orderBonuses,
      otherBonuses: calculation.otherBonuses,
      premiums: calculation.premiums,
      deductions: calculation.deductions,
      prepared: calculation.total,
      source: calculation.source,
    };
    const calculationHash = payrollCalculationHash(prepared);
    if (
      !input.expectedCalculationHash ||
      input.expectedCalculationHash !== calculationHash
    )
      throw new PayrollError("PAYROLL_CALCULATION_STALE");
    const latest = await tx.payrollCalculationSnapshot.findFirst({
      where: {
        companyId,
        employeeId: input.employeeId,
        periodId: period.id,
      },
      include: { approvedBy: { select: { id: true, name: true } } },
      orderBy: [{ revision: "desc" }, { id: "desc" }],
    });
    if (
      latest &&
      payrollSnapshotMatchesCalculation(latest, prepared, calculationHash)
    ) {
      // A no-op still consumes its idempotency key. Otherwise a delayed replay
      // could approve a different calculation after components have changed.
      await audit(tx, {
        action: "PAYROLL_CALCULATION_CONFIRMATION_NOOP",
        actor,
        periodId: period.id,
        employeeId: input.employeeId,
        before: {
          snapshotId: latest.id,
          revision: latest.revision,
          calculationHash: latest.calculationHash,
        },
        after: {
          snapshotId: latest.id,
          revision: latest.revision,
          calculationHash,
          requestHash: input.requestHash,
        },
        reason,
        idempotencyKey: `${input.key}:audit`,
      });
      return { snapshot: latest, created: false, replay: false };
    }
    const snapshot = await tx.payrollCalculationSnapshot.create({
      data: {
        companyId,
        employeeId: input.employeeId,
        periodId: period.id,
        revision: (latest?.revision ?? 0) + 1,
        salaryAmount: new Prisma.Decimal(calculation.salary.toFixed(2)),
        orderBonusAmount: new Prisma.Decimal(calculation.orderBonuses.toFixed(2)),
        otherBonusAmount: new Prisma.Decimal(calculation.otherBonuses.toFixed(2)),
        premiumAmount: new Prisma.Decimal(calculation.premiums.toFixed(2)),
        deductionAmount: new Prisma.Decimal(calculation.deductions.toFixed(2)),
        preparedAmount: new Prisma.Decimal(calculation.total.toFixed(2)),
        calculationHash,
        source: calculation.source,
        reason,
        approvedById: actor.userId,
        previousSnapshotId: latest?.id,
        idempotencyKey: input.key,
        requestHash: input.requestHash,
      },
      include: { approvedBy: { select: { id: true, name: true } } },
    });
    const recognitionDelta = calculation.total -
      (latest
        ? Number(latest.preparedAmount)
        : calculation.previouslyRecognizedProfit);
    const accountingDate = new Date(
      companyMonthRange(period.year, period.month).end.getTime() - 1,
    );
    const ledgerEntry = Math.abs(recognitionDelta) >= 0.005
      ? await tx.companyLedgerEntry.create({
          data: {
            type: "PAYROLL_ACCRUAL",
            category: "SALARY",
            source: "PAYROLL_CALCULATION",
            direction: recognitionDelta > 0 ? "EXPENSE" : "INCOME",
            amount: new Prisma.Decimal(Math.abs(recognitionDelta).toFixed(2)),
            // Keep a late correction in the payroll month it belongs to;
            // approvedAt remains the real audit timestamp.
            operationDate: accountingDate,
            employeeId: input.employeeId,
            comment: latest
              ? `Корректировка начисления зарплаты, версия ${snapshot.revision}: ${reason}`
              : `Подтверждение начисления зарплаты: ${reason}`,
            authorId: actor.userId,
            idempotencyKey: `payroll-calculation-snapshot:${snapshot.id}`,
            requestHash: input.requestHash,
            affectsProfit: true,
            payrollCalculationSnapshotId: snapshot.id,
          },
        })
      : null;
    await audit(tx, {
      action: latest
        ? "PAYROLL_CALCULATION_CORRECTED"
        : "PAYROLL_CALCULATION_CONFIRMED",
      actor,
      periodId: period.id,
      employeeId: input.employeeId,
      before: latest
        ? {
            snapshotId: latest.id,
            revision: latest.revision,
            preparedAmount: Number(latest.preparedAmount),
            calculationHash: latest.calculationHash,
          }
        : undefined,
      after: {
        snapshotId: snapshot.id,
        revision: snapshot.revision,
        preparedAmount: Number(snapshot.preparedAmount),
        calculationHash: snapshot.calculationHash,
        recognitionDelta,
        ledgerEntryId: ledgerEntry?.id ?? null,
        source: calculation.source,
        requestHash: input.requestHash,
      },
      reason,
      idempotencyKey: `${input.key}:audit`,
    });
    return { snapshot, ledgerEntry, created: true, replay: false };
  }, {
    ...transactionOptions,
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
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
    await assertPayrollEmployeeTenant(
      tx,
      existing.employeeId,
      "IDEMPOTENCY_CONFLICT",
    );
    if (!compareRequestHash(existing.requestHash, input.requestHash))
      throw new PayrollError("IDEMPOTENCY_CONFLICT");
    return existing;
  }
  const period = await openPeriod(tx, input.periodId);
  const employee = await tx.employeePayrollProfile.findFirst({
    where: {
      id: input.employeeId,
      companyId: requireTenantIdentity().companyId,
    },
    include: { user: { select: { role: true, active: true } } },
  });
  // Historical obligations remain payable after employment ends. Access to
  // the account is disabled, but the immutable payroll profile stays valid.
  if (!employee?.payrollEnabled)
    throw new PayrollError("EMPLOYEE_NOT_FOUND");
  if (finalSalaryPayment) {
    const entitlement = await payrollEntitlementTx(
      tx,
      input.employeeId,
      period,
    );
    if (entitlement.incomplete)
      throw new PayrollError("CALCULATION_INCOMPLETE");
    if (!entitlement.latestApproval)
      throw new PayrollError("PAYROLL_CALCULATION_NOT_CONFIRMED");
    const currentState: PayrollCalculationState = {
      salary: entitlement.salary,
      orderBonuses: entitlement.orderBonuses,
      otherBonuses: entitlement.otherBonuses,
      premiums: entitlement.premiums,
      deductions: entitlement.deductions,
      prepared: entitlement.total,
      source: entitlement.source,
    };
    if (
      !payrollSnapshotMatchesCalculation(
        entitlement.latestApproval,
        currentState,
      )
    )
      throw new PayrollError("PAYROLL_CALCULATION_NEEDS_CORRECTION");
    if (Number(input.amount) > entitlement.payable + 0.01)
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

async function assertPartialSalaryPaymentAvailable(
  tx: Prisma.TransactionClient,
  input: PaymentInput,
) {
  money(input.amount);
  const period = await tx.payrollPeriod.findFirst({
    where: {
      id: input.periodId,
      companyId: requireTenantIdentity().companyId,
    },
    select: { id: true, year: true, month: true },
  });
  if (!period) throw new PayrollError("PERIOD_NOT_FOUND");
  const entitlement = await payrollEntitlementTx(tx, input.employeeId, period);
  if (Number(input.amount) > entitlement.payable + 0.01)
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
        select: { id: true, employeeId: true },
      });
      if (replay)
        await assertPayrollEmployeeTenant(
          tx,
          replay.employeeId,
          "IDEMPOTENCY_CONFLICT",
        );
      const auditReplay = await tx.payrollAuditEvent.findUnique({
        where: { idempotencyKey: `${input.key}:audit` },
      });
      if (auditReplay) {
        if (
          auditReplay.periodId !== input.periodId ||
          auditReplay.employeeId !== input.employeeId
        )
          throw new PayrollError("IDEMPOTENCY_CONFLICT");
        await assertPayrollEmployeeTenant(
          tx,
          input.employeeId,
          "IDEMPOTENCY_CONFLICT",
        );
        if (!replay) throw new PayrollError("IDEMPOTENCY_CONFLICT");
      }
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
        tx.payrollPeriod.findFirstOrThrow({
          where: {
            id: input.periodId,
            companyId: requireTenantIdentity().companyId,
          },
          select: { year: true, month: true },
        }),
        tx.employeePayrollProfile.findFirstOrThrow({
          where: {
            id: input.employeeId,
            companyId: requireTenantIdentity().companyId,
          },
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
    const period = await openPeriod(tx, input.periodId);
    const existing = await tx.payrollAuditEvent.findUnique({ where: { idempotencyKey: input.key } });
    if (existing) {
      if (
        existing.periodId !== period.id ||
        existing.employeeId !== input.employeeId
      )
        throw new PayrollError("IDEMPOTENCY_CONFLICT");
      await assertPayrollEmployeeTenant(
        tx,
        input.employeeId,
        "IDEMPOTENCY_CONFLICT",
      );
      return { approved: true, replay: true };
    }
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
  if (
    actor.role !== Role.MANAGER ||
    input.type === PayrollPaymentType.EMPLOYEE_REFUND
  )
    throw new PayrollError("FORBIDDEN");
  if (Number.isNaN(input.claimedPaymentDate.getTime()))
    throw new PayrollError("INVALID_DATE");
  const companyId = requireTenantIdentity().companyId;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.payrollPaymentConfirmation.findUnique({
      where: { idempotencyKey: input.key },
    });
    if (existing) {
      if (existing.periodId !== input.periodId)
        throw new PayrollError("IDEMPOTENCY_CONFLICT");
      const existingEmployee = await tx.employeePayrollProfile.findFirst({
        where: { id: existing.employeeId, companyId },
        select: { id: true },
      });
      if (!existingEmployee)
        throw new PayrollError("IDEMPOTENCY_CONFLICT");
      if (!compareRequestHash(existing.requestHash, input.requestHash))
        throw new PayrollError("IDEMPOTENCY_CONFLICT");
      return existing;
    }
    await openPeriod(tx, input.periodId);
    const employee = await tx.employeePayrollProfile.findFirst({
      where: { userId: actor.userId, companyId },
    });
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
      reason: input.comment?.trim() || "Заявка сотрудника на аванс",
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
  if (input.decision !== "CONFIRM" && input.decision !== "REJECT")
    throw new PayrollError("INVALID_DECISION");
  const companyId = requireTenantIdentity().companyId;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${20_000_000 + id})`;
    // PayrollPaymentConfirmation has no denormalised companyId. Scope through
    // its employee before inspecting the status or performing either review
    // branch, so an id from another tenant is indistinguishable from missing.
    const confirmation = await tx.payrollPaymentConfirmation.findFirst({
      where: { id, employee: { companyId } },
    });
    if (!confirmation) throw new PayrollError("CONFIRMATION_NOT_FOUND");
    if (
      confirmation.status === PayrollConfirmationStatus.CONFIRMED &&
      confirmation.confirmedPaymentId
    ) {
      const [payment, reviewAudit] = await Promise.all([
        tx.payrollPayment.findFirst({
          where: {
            id: confirmation.confirmedPaymentId,
            employee: { companyId },
          },
        }),
        tx.payrollAuditEvent.findUnique({
          where: { idempotencyKey: `${input.key}:audit` },
        }),
      ]);
      if (!payment) throw new PayrollError("CONFIRMATION_NOT_FOUND");
      const reviewAfter =
        reviewAudit?.after &&
        typeof reviewAudit.after === "object" &&
        !Array.isArray(reviewAudit.after)
          ? (reviewAudit.after as Record<string, unknown>)
          : null;
      const replayAmount = input.amount ?? Number(confirmation.amount);
      if (
        input.decision !== "CONFIRM" ||
        !reviewAudit ||
        reviewAudit.action !== "PAYMENT_CONFIRMATION_CONFIRMED" ||
        reviewAudit.periodId !== confirmation.periodId ||
        reviewAudit.employeeId !== confirmation.employeeId ||
        Number(reviewAfter?.paymentId) !== payment.id ||
        !compareRequestHash(payment.requestHash, input.requestHash) ||
        !Number.isFinite(replayAmount) ||
        replayAmount <= 0 ||
        !payment.amount.equals(new Prisma.Decimal(replayAmount.toFixed(2)))
      )
        throw new PayrollError("IDEMPOTENCY_CONFLICT");
      return { confirmation, payment };
    }
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
        reason: input.comment?.trim() || "Заявка на аванс отклонена директором",
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
      after: {
        status: updated.status,
        paymentId: payment.id,
        confirmedAmount: Number(payment.amount),
        decision: input.decision,
        requestHash: input.requestHash,
      },
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
  const companyId = requireTenantIdentity().companyId;
  return prisma.$transaction(async (tx) => {
    const replay = await tx.payrollPayment.findUnique({ where: { idempotencyKey: input.key } });
    if (replay) {
      await assertPayrollEmployeeTenant(
        tx,
        replay.employeeId,
        "IDEMPOTENCY_CONFLICT",
      );
      if (!compareRequestHash(replay.requestHash, input.requestHash)) throw new PayrollError("IDEMPOTENCY_CONFLICT");
      return replay;
    }
    await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${30_000_000 + id})`;
    const original = await tx.payrollPayment.findFirst({
      where: { id, employee: { companyId } },
      include: { reversal: true },
    });
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
  if (actor.role !== Role.MANAGER) throw new PayrollError("FORBIDDEN");
  const companyId = requireTenantIdentity().companyId;
  return prisma.$transaction(async (tx) => {
    const employee = await tx.employeePayrollProfile.findFirst({
      where: { userId: actor.userId, companyId },
    });
    if (!employee?.active || !employee.payrollEnabled)
      throw new PayrollError("EMPLOYEE_NOT_FOUND");
    const period = await openPeriod(tx, input.periodId);
    const existing = await tx.payrollAdvanceRequest.findUnique({
      where: { idempotencyKey: input.key },
    });
    if (existing) {
      if (
        existing.employeeId !== employee.id ||
        existing.periodId !== period.id
      )
        throw new PayrollError("IDEMPOTENCY_CONFLICT");
      if (!compareRequestHash(existing.requestHash, input.requestHash))
        throw new PayrollError("IDEMPOTENCY_CONFLICT");
      return existing;
    }
    return tx.payrollAdvanceRequest.create({
      data: {
        employeeId: employee.id,
        periodId: input.periodId,
        requestedAmount: money(input.amount),
        comment: input.comment,
        idempotencyKey: input.key,
        requestHash: input.requestHash,
      },
    });
  }, { ...transactionOptions, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function reviewAdvance(
  id: number,
  input: {
    status: AdvanceRequestStatus;
    approvedAmount?: number;
    comment?: string;
    key: string;
    requestHash: string;
  },
  actor: PayrollActor,
) {
  director(actor);
  if (!(
    input.status === AdvanceRequestStatus.APPROVED ||
    input.status === AdvanceRequestStatus.REJECTED
  ))
    throw new PayrollError("INVALID_STATUS");
  const companyId = requireTenantIdentity().companyId;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT advance.id
      FROM "PayrollAdvanceRequest" advance
      JOIN "EmployeePayrollProfile" employee
        ON employee.id = advance."employeeId"
      WHERE advance.id = ${id} AND employee."companyId" = ${companyId}
      FOR UPDATE OF advance
    `;
    const request = await tx.payrollAdvanceRequest.findFirst({
      where: { id, employee: { companyId } },
    });
    if (!request) throw new PayrollError("CONFLICT");
    const replay = await tx.payrollAuditEvent.findFirst({
      where: {
        idempotencyKey: `${input.key}:audit`,
        period: { companyId },
      },
      select: { periodId: true, employeeId: true, after: true },
    });
    if (replay) {
      const after =
        replay.after &&
        typeof replay.after === "object" &&
        !Array.isArray(replay.after)
          ? (replay.after as Record<string, unknown>)
          : null;
      if (
        replay.periodId !== request.periodId ||
        replay.employeeId !== request.employeeId ||
        Number(after?.advanceRequestId) !== request.id ||
        after?.requestHash !== input.requestHash
      )
        throw new PayrollError("IDEMPOTENCY_CONFLICT");
      return request;
    }
    if (request.status !== AdvanceRequestStatus.REQUESTED)
      throw new PayrollError("CONFLICT");
    await openPeriod(tx, request.periodId);
    const approvedAmount =
      input.status === AdvanceRequestStatus.APPROVED
        ? money(input.approvedAmount ?? Number(request.requestedAmount))
        : null;
    const result = await tx.payrollAdvanceRequest.updateMany({
      where: { id, status: AdvanceRequestStatus.REQUESTED },
      data: {
        status: input.status,
        approvedAmount,
        reviewComment: input.comment,
        reviewedById: actor.userId,
        reviewedAt: new Date(),
      },
    });
    if (result.count !== 1) throw new PayrollError("CONFLICT");
    const updated = await tx.payrollAdvanceRequest.findFirstOrThrow({
      where: { id, employee: { companyId } },
    });
    await audit(tx, {
      action: input.status === AdvanceRequestStatus.APPROVED ? "ADVANCE_APPROVED" : "ADVANCE_REJECTED",
      actor,
      periodId: request.periodId,
      employeeId: request.employeeId,
      before: { status: request.status, requestedAmount: Number(request.requestedAmount) },
      after: {
        advanceRequestId: request.id,
        status: updated.status,
        approvedAmount: updated.approvedAmount
          ? Number(updated.approvedAmount)
          : null,
        requestHash: input.requestHash,
      },
      reason: input.comment?.trim() || (input.status === AdvanceRequestStatus.APPROVED ? "Аванс одобрен" : "Аванс отклонён"),
      idempotencyKey: `${input.key}:audit`,
    });
    return updated;
  }, {
    ...transactionOptions,
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
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
  const companyId = requireTenantIdentity().companyId;
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT advance.id
        FROM "PayrollAdvanceRequest" advance
        JOIN "EmployeePayrollProfile" employee
          ON employee.id = advance."employeeId"
        WHERE advance.id = ${id} AND employee."companyId" = ${companyId}
        FOR UPDATE OF advance
      `;
      const request = await tx.payrollAdvanceRequest.findFirst({
        where: { id, employee: { companyId } },
      });
      if (request?.status === AdvanceRequestStatus.PAID && request.paymentId) {
        const existing = await tx.payrollPayment.findUniqueOrThrow({
          where: { id: request.paymentId },
        });
        await assertPayrollEmployeeTenant(
          tx,
          existing.employeeId,
          "IDEMPOTENCY_CONFLICT",
        );
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
      const result = await tx.payrollAdvanceRequest.updateMany({
        where: {
          id,
          status: AdvanceRequestStatus.APPROVED,
          paymentId: null,
        },
        data: { status: AdvanceRequestStatus.PAID, paymentId: payment.id },
      });
      if (result.count !== 1) throw new PayrollError("CONFLICT");
      return payment;
    },
    { ...transactionOptions, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function closePeriod(
  periodId: number,
  key: string,
  requestHash: string,
  actor: PayrollActor,
) {
  return transitionPeriod(
    periodId,
    PayrollPeriodStatus.CLOSED,
    "Закрытие расчётного месяца",
    key,
    requestHash,
    actor,
  );
}

export async function transitionPeriod(
  periodId: number,
  target: PayrollPeriodStatus,
  reasonValue: string | undefined,
  key: string,
  requestHash: string,
  actor: PayrollActor,
) {
  salaryManager(actor);
  const companyId = requireTenantIdentity().companyId;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id
      FROM "PayrollPeriod"
      WHERE id = ${periodId} AND "companyId" = ${companyId}
      FOR UPDATE
    `;
    const period = await tx.payrollPeriod.findFirst({
      where: { id: periodId, companyId },
    });
    if (!period) throw new PayrollError("PERIOD_NOT_FOUND");
    const replay = await tx.payrollAuditEvent.findUnique({ where: { idempotencyKey: key } });
    if (replay) {
      const replayAfter =
        replay.after &&
        typeof replay.after === "object" &&
        !Array.isArray(replay.after)
          ? (replay.after as Record<string, unknown>)
          : null;
      const replayReason =
        reasonValue?.trim() || "Изменение статуса расчётного периода";
      if (
        replay.periodId !== period.id ||
        replayAfter?.status !== target ||
        replay.reason !== replayReason ||
        replayAfter?.requestHash !== requestHash
      )
        throw new PayrollError("IDEMPOTENCY_CONFLICT");
      return period;
    }
    if (target === PayrollPeriodStatus.CLOSED) {
      const statement = await payrollSummary(
        periodId,
        actor,
        undefined,
        false,
        { includeDetails: false, db: tx },
      );
      const rowsWithActivity = statement.rows.filter(
        (row) => row.calculation.hasActivity,
      );
      if (rowsWithActivity.some((row) => row.calculation.incomplete))
        throw new PayrollError("CALCULATION_INCOMPLETE");
      if (
        rowsWithActivity.some(
          (row) => row.calculation.approvalStatus !== "CONFIRMED",
        )
      )
        throw new PayrollError("PAYROLL_CALCULATION_NOT_CONFIRMED");
      if (
        rowsWithActivity.some(
          (row) =>
            row.calculation.remaining > 0.01 || row.totals.pending > 0.01,
        )
      )
        throw new PayrollError("PAYROLL_NOT_FULLY_PAID");
    }
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
      after: { status: target, requestHash },
      reason,
      idempotencyKey: key,
    });
    return updated;
  }, transactionOptions);
}

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
  options: { includeDetails?: boolean; db?: Prisma.TransactionClient } = {},
) {
  const includeDetails = options.includeDetails !== false;
  const db = (options.db ?? prisma) as Prisma.TransactionClient;
  const companyId = requireTenantIdentity().companyId;
  const selfOnly = forceSelf || !(
    actor.role === Role.DIRECTOR ||
    actor.role === Role.OPERATIONS_DIRECTOR ||
    actor.role === Role.ACCOUNTANT
  );
  if (actor.role === Role.PARTNER) throw new PayrollError("FORBIDDEN");
  const self = selfOnly
    ? await db.employeePayrollProfile.findFirst({
        where: { userId: actor.userId, companyId },
      })
    : null;
  if (selfOnly && !self) throw new PayrollError("EMPLOYEE_NOT_FOUND");
  const employeeId = selfOnly ? self!.id : requestedEmployeeId;
  const period = await db.payrollPeriod.findFirstOrThrow({
    where: { id: periodId, companyId },
    select: { id: true, year: true, month: true, status: true },
  });
  const periodRange = companyMonthRange(period.year, period.month);
  const [employees, settings, periodOrders, readinessOrders, readinessMeasurements, readinessTasks, bonusDecisionEvents] = await Promise.all([db.employeePayrollProfile.findMany({
    where: {
      ...(employeeId ? { id: employeeId } : {}),
      companyId,
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
              responsibleType: true,
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
      calculationSnapshots: {
        where: { periodId },
        include: { approvedBy: { select: { id: true, name: true } } },
        orderBy: [{ revision: "desc" }, { id: "desc" }],
        ...(includeDetails ? {} : { take: 1 }),
      },
    },
    orderBy: { name: "asc" },
  }), db.systemSettings.findUnique({ where: { companyId }, select: { paydayDayOfMonth: true } }), db.order.findMany({
    where: {
      companyId,
      deletedAt: null,
      orderDateNeedsReview: false,
      responsibleType: OrderResponsibleType.EMPLOYEE,
      managerUserId: { not: null },
      OR: [
        {
          orderReceivedAt: {
            gte: periodRange.start,
            lt: periodRange.end,
          },
        },
        { payrollBonusDecisions: { some: { periodId } } },
      ],
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
      responsibleType: true,
      manager: true,
      managerUserId: true,
      payrollBonusDecisions: {
        select: {
          id: true,
          employeeId: true,
          periodId: true,
          earnedAt: true,
          manualAmount: true,
          updatedAt: true,
          updatedBy: { select: { id: true, name: true } },
        },
      },
      client: { select: { name: true, phone: true } },
    },
    orderBy: [{ orderReceivedAt: "asc" }, { id: "asc" }],
  }), includeDetails ? db.order.findMany({
    where: {
      companyId,
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
  }) : Promise.resolve([]), includeDetails ? db.measurement.findMany({
    where: {
      companyId,
      visitDate: { lt: new Date() },
      status: { in: [MeasurementStatus.ASSIGNED, MeasurementStatus.IN_PROGRESS] },
      client: { managerUserId: { not: null } },
    },
    select: { client: { select: { managerUserId: true } } },
  }) : Promise.resolve([]), includeDetails ? db.calendarTask.findMany({
    where: {
      companyId,
      workflow: CalendarTaskWorkflow.ORDER_DATA_COMPLETION,
      status: { in: [CalendarTaskStatus.PLANNED, CalendarTaskStatus.IN_PROGRESS] },
    },
    select: { assigneeId: true },
  }) : Promise.resolve([]), includeDetails ? db.payrollAuditEvent.findMany({
    where: {
      periodId,
      action: {
        in: [
          "ORDER_BONUS_DECISION_CHANGED",
          "ORDER_BONUS_DECISION_MIGRATED",
          "ORDER_BONUS_DECISION_INVALIDATED",
        ],
      },
      employee: { companyId },
    },
    select: {
      id: true,
      employeeId: true,
      before: true,
      after: true,
      reason: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  }) : Promise.resolve([])]);
  const persistedPriorPeriods = await db.payrollPeriod.findMany({
    where: {
      companyId,
      OR: [
        { year: { lt: period.year } },
        { year: period.year, month: { lt: period.month } },
      ],
    },
    select: { id: true, year: true, month: true },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });
  const priorPeriodIds = persistedPriorPeriods.map((item) => item.id);
  const [priorSnapshots, priorPayments, priorAccruals, priorOrders] =
    priorPeriodIds.length
      ? await Promise.all([
          db.payrollCalculationSnapshot.findMany({
            where: { companyId, periodId: { in: priorPeriodIds } },
            select: {
              id: true,
              employeeId: true,
              periodId: true,
              revision: true,
              salaryAmount: true,
              orderBonusAmount: true,
              otherBonusAmount: true,
              premiumAmount: true,
              deductionAmount: true,
              preparedAmount: true,
              calculationHash: true,
              source: true,
              approvedAt: true,
            },
            orderBy: [{ revision: "desc" }, { id: "desc" }],
          }),
          db.payrollPayment.findMany({
            where: {
              periodId: { in: priorPeriodIds },
              employee: { companyId },
            },
            select: {
              employeeId: true,
              periodId: true,
              amount: true,
              type: true,
            },
          }),
          db.payrollAccrual.findMany({
            where: {
              periodId: { in: priorPeriodIds },
              employee: { companyId },
            },
            select: {
              id: true,
              employeeId: true,
              periodId: true,
              type: true,
              direction: true,
              amount: true,
              reason: true,
              reversalOfId: true,
              reversedBy: { select: { id: true } },
              order: { select: { responsibleType: true } },
            },
            orderBy: { id: "asc" },
          }),
          db.order.findMany({
            where: {
              companyId,
              deletedAt: null,
              orderDateNeedsReview: false,
              responsibleType: OrderResponsibleType.EMPLOYEE,
              managerUserId: { not: null },
              lifecycle: { not: OrderLifecycle.CANCELLED },
              OR: [
                { orderReceivedAt: { lt: periodRange.start } },
                {
                  payrollBonusDecisions: {
                    some: { periodId: { in: priorPeriodIds } },
                  },
                },
              ],
            },
            select: {
              id: true,
              amount: true,
              status: true,
              lifecycle: true,
              deletedAt: true,
              responsibleType: true,
              manager: true,
              managerUserId: true,
              orderReceivedAt: true,
              completedAt: true,
              payrollBonusDecisions: {
                select: {
                  id: true,
                  employeeId: true,
                  periodId: true,
                  earnedAt: true,
                  manualAmount: true,
                },
              },
            },
            orderBy: { id: "asc" },
          }),
        ])
      : [[], [], [], []] as const;
  type PriorPeriodDescriptor = {
    id: number | null;
    year: number;
    month: number;
  };
  const priorPeriodByMonth = new Map(
    persistedPriorPeriods.map((item) => [
      `${item.year}-${item.month}`,
      item as PriorPeriodDescriptor,
    ]),
  );
  const priorPeriodById = new Map(
    persistedPriorPeriods.map((item) => [item.id, item]),
  );
  const priorPeriods: PriorPeriodDescriptor[] = [];
  const currentMonthIndex = period.year * 12 + period.month - 1;
  const persistedStartIndex = persistedPriorPeriods[0]
    ? persistedPriorPeriods[0].year * 12 + persistedPriorPeriods[0].month - 1
    : currentMonthIndex;
  const relevantStartIndexes = employees.flatMap((employee) => {
    const starts = [employee.hiredAt, ...employee.salaryRates.map((rate) => rate.effectiveFrom)];
    return starts.map((date) => {
      const month = companyYearMonth(date);
      return month.year * 12 + month.month - 1;
    });
  });
  // Missing PayrollPeriod rows must not erase an otherwise applicable salary
  // condition. Generate read-only descriptors from the earliest hire/rate,
  // capped at ten years for profiles with bad legacy dates; factual persisted
  // periods are never dropped by that cap.
  const earliestRelevantIndex = relevantStartIndexes.length
    ? Math.min(...relevantStartIndexes)
    : currentMonthIndex;
  const boundedRelevantIndex = Math.max(
    earliestRelevantIndex,
    currentMonthIndex - 120,
  );
  const priorStartIndex = Math.min(persistedStartIndex, boundedRelevantIndex);
  if (priorStartIndex < currentMonthIndex) {
    let year = Math.floor(priorStartIndex / 12);
    let month = (priorStartIndex % 12) + 1;
    while (year < period.year || (year === period.year && month < period.month)) {
      priorPeriods.push(
        priorPeriodByMonth.get(`${year}-${month}`) ?? { id: null, year, month },
      );
      month += 1;
      if (month > 12) {
        year += 1;
        month = 1;
      }
    }
  }
  const priorPeriodMonthKeys = new Set(
    priorPeriods.map((item) => `${item.year}-${item.month}`),
  );
  const latestPriorSnapshotByEmployeePeriod = new Map<
    string,
    (typeof priorSnapshots)[number]
  >();
  for (const snapshot of priorSnapshots) {
    const key = `${snapshot.employeeId}:${snapshot.periodId}`;
    if (!latestPriorSnapshotByEmployeePeriod.has(key))
      latestPriorSnapshotByEmployeePeriod.set(key, snapshot);
  }
  const periodOrdersByManagerUserId = new Map<
    number,
    Array<(typeof periodOrders)[number]>
  >();
  for (const order of periodOrders) {
    if (order.managerUserId == null) continue;
    const rows = periodOrdersByManagerUserId.get(order.managerUserId) ?? [];
    rows.push(order);
    periodOrdersByManagerUserId.set(order.managerUserId, rows);
  }
  const priorOrdersByManagerUserId = new Map<
    number,
    Array<(typeof priorOrders)[number]>
  >();
  for (const order of priorOrders) {
    if (order.managerUserId == null) continue;
    const rows = priorOrdersByManagerUserId.get(order.managerUserId) ?? [];
    rows.push(order);
    priorOrdersByManagerUserId.set(order.managerUserId, rows);
  }
  const priorAccrualsByEmployeePeriod = new Map<
    string,
    Array<(typeof priorAccruals)[number]>
  >();
  for (const accrual of priorAccruals) {
    const key = `${accrual.employeeId}:${accrual.periodId}`;
    const rows = priorAccrualsByEmployeePeriod.get(key) ?? [];
    rows.push(accrual);
    priorAccrualsByEmployeePeriod.set(key, rows);
  }
  const priorPaymentsByEmployeePeriod = new Map<
    string,
    Array<(typeof priorPayments)[number]>
  >();
  for (const payment of priorPayments) {
    const key = `${payment.employeeId}:${payment.periodId}`;
    const rows = priorPaymentsByEmployeePeriod.get(key) ?? [];
    rows.push(payment);
    priorPaymentsByEmployeePeriod.set(key, rows);
  }
  const employeesWithPriorSnapshotDebt = new Set<number>();
  for (const [key, snapshot] of latestPriorSnapshotByEmployeePeriod) {
    const paid = (priorPaymentsByEmployeePeriod.get(key) ?? []).reduce(
      (sum, payment) => sum + signedPayment(payment),
      0,
    );
    if (Number(snapshot.preparedAmount) - paid > 0.01)
      employeesWithPriorSnapshotDebt.add(snapshot.employeeId);
  }
  const employeesWithPriorPreliminaryActivity = new Set<number>([
    ...priorAccruals.map((row) => row.employeeId),
    ...priorPayments.map((row) => row.employeeId),
  ]);
  for (const employee of employees) {
    if (!employmentEnded(employee)) continue;
    if (employee.userId && priorOrdersByManagerUserId.has(employee.userId)) {
      employeesWithPriorPreliminaryActivity.add(employee.id);
      continue;
    }
    const hasPriorSalary = priorPeriods.some((priorPeriod) => {
      const range = companyMonthRange(priorPeriod.year, priorPeriod.month);
      const salary = payrollSalaryForPeriod({
        hiredAt: employee.hiredAt,
        terminatedAt: employee.terminatedAt,
        baseSalary: employee.baseSalary,
        salaryRates: employee.salaryRates,
        periodStart: range.start,
        periodEnd: range.end,
      });
      const rate = employee.salaryRates.find(
        (item) =>
          item.effectiveFrom < range.end &&
          (!item.effectiveTo || item.effectiveTo > range.start),
      );
      const enabled =
        salary.employedInPeriod &&
        (rate?.planEnabled ??
          (employee.salaryRates.length === 0 && employee.salaryPlanEnabled));
      return enabled && Math.abs(salary.amount) > 0.01;
    });
    if (hasPriorSalary) employeesWithPriorPreliminaryActivity.add(employee.id);
  }
  const readinessOrderIssuesByUserId = new Map<number, number>();
  for (const order of readinessOrders) {
    if (order.managerUserId == null || orderDataGaps(order).length === 0) continue;
    readinessOrderIssuesByUserId.set(
      order.managerUserId,
      (readinessOrderIssuesByUserId.get(order.managerUserId) ?? 0) + 1,
    );
  }
  const readinessMeasurementsByUserId = new Map<number, number>();
  for (const measurement of readinessMeasurements) {
    const managerUserId = measurement.client.managerUserId;
    if (managerUserId == null) continue;
    readinessMeasurementsByUserId.set(
      managerUserId,
      (readinessMeasurementsByUserId.get(managerUserId) ?? 0) + 1,
    );
  }
  const readinessTasksByUserId = new Map<number, number>();
  for (const task of readinessTasks) {
    if (task.assigneeId == null) continue;
    readinessTasksByUserId.set(
      task.assigneeId,
      (readinessTasksByUserId.get(task.assigneeId) ?? 0) + 1,
    );
  }
  const manualBonusFromAuditJson = (value: unknown) => {
    if (value == null) return null;
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : null;
  };
  const bonusDecisionHistory = new Map<
    string,
    Array<{
      id: number;
      createdAt: Date;
      actorName: string;
      previousManualBonus: number | null;
      manualBonus: number | null;
      previousEffectiveBonus: number;
      effectiveBonus: number;
      reason: string;
    }>
  >();
  for (const event of bonusDecisionEvents) {
    if (!event.employeeId) continue;
    const before = event.before && typeof event.before === "object" && !Array.isArray(event.before)
      ? event.before as Record<string, unknown>
      : null;
    const after = event.after && typeof event.after === "object" && !Array.isArray(event.after)
      ? event.after as Record<string, unknown>
      : null;
    const orderId = Number(after?.orderId ?? before?.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) continue;
    const key = `${orderId}:${event.employeeId}`;
    const history = bonusDecisionHistory.get(key) ?? [];
    history.push({
      id: event.id,
      createdAt: event.createdAt,
      actorName: event.actor.name,
      previousManualBonus: manualBonusFromAuditJson(before?.manualBonus),
      manualBonus: manualBonusFromAuditJson(after?.manualBonus),
      previousEffectiveBonus:
        manualBonusFromAuditJson(before?.effectiveBonus) ??
        manualBonusFromAuditJson(before?.manualBonus) ??
        0,
      effectiveBonus:
        manualBonusFromAuditJson(after?.effectiveBonus) ??
        manualBonusFromAuditJson(after?.manualBonus) ??
        0,
      reason: event.reason,
    });
    bonusDecisionHistory.set(key, history);
  }
  const visibleEmployees = employees.filter((employee) => {
    if (!employmentEnded(employee)) return employee.active;
    if (
      employee.accruals.length > 0 ||
      employee.payments.length > 0 ||
      employee.paymentConfirmations.length > 0 ||
      employee.advanceRequests.length > 0 ||
      employee.calculationSnapshots.length > 0 ||
      employeesWithPriorSnapshotDebt.has(employee.id) ||
      employeesWithPriorPreliminaryActivity.has(employee.id)
    )
      return true;
    const salaryCondition = payrollSalaryForPeriod({
      hiredAt: employee.hiredAt,
      terminatedAt: employee.terminatedAt,
      baseSalary: employee.baseSalary,
      salaryRates: employee.salaryRates,
      periodStart: periodRange.start,
      periodEnd: periodRange.end,
    });
    const applicableRate = employee.salaryRates.find(
      (rate) =>
        rate.effectiveFrom < periodRange.end &&
        (!rate.effectiveTo || rate.effectiveTo > periodRange.start),
    );
    if (
      salaryCondition.employedInPeriod &&
      (applicableRate?.planEnabled ??
        (employee.salaryRates.length === 0 && employee.salaryPlanEnabled)) &&
      salaryCondition.amount > 0
    )
      return true;
    if (!employeeCanReceiveOrderBonus(employee)) return false;
    const candidateOrders = employee.userId == null
      ? []
      : periodOrdersByManagerUserId.get(employee.userId) ?? [];
    return candidateOrders.some(
      (order) => {
        const assigned = isOrderAssignedToManager(
          {
            responsibleType: order.responsibleType,
            managerUserId: order.managerUserId,
            managerName: order.manager,
          },
          {
            id: employee.userId ?? -1,
            name: employee.user?.name || employee.name,
          },
        );
        if (!assigned) return false;
        const decision = order.payrollBonusDecisions.find(
          (item) => item.employeeId === employee.id,
        );
        return decision
          ? decision.periodId === periodId
          : Boolean(bonusEarnedInRange(order, employee, periodRange));
      },
    );
  });
  const rows = visibleEmployees.map((employee) => {
    const activeAccruals = employee.accruals.filter(
      (row) => !row.reversalOfId && !row.reversedBy,
    );
    // Historical order-bonus accruals are deliberately excluded: an order
    // bonus is an entitlement decision, not an accounting accrual.
    const statementAccruals = activeAccruals.filter(
      (row) =>
        row.type !== PayrollAccrualType.ORDER_BONUS &&
        row.type !== PayrollAccrualType.GUARANTEED_ORDER_BONUS &&
        (row.type !== PayrollAccrualType.MEASUREMENT_BONUS ||
          row.order?.responsibleType === OrderResponsibleType.EMPLOYEE) &&
        !row.reason.startsWith(PAYROLL_POLICY_ADJUSTMENT_PREFIX),
    );
    const paid = employee.payments.reduce(
      (sum, row) => sum + signedPayment(row),
      0,
    );
    const pendingConfirmations = employee.paymentConfirmations
      .filter((row) => row.status === PayrollConfirmationStatus.PENDING)
      .reduce((sum, row) => sum + Number(row.amount), 0);
    const pendingConfirmationAdvances = employee.paymentConfirmations
      .filter(
        (row) =>
          row.status === PayrollConfirmationStatus.PENDING &&
          row.type === PayrollPaymentType.ADVANCE,
      )
      .reduce((sum, row) => sum + Number(row.amount), 0);
    // Legacy advance requests predate payment confirmations.  They remain a
    // pending obligation until paid/rejected and must block period close, but
    // never count as a factual payment.
    const pendingLegacyAdvances = employee.advanceRequests
      .filter(
        (row) =>
          row.paymentId == null &&
          (row.status === AdvanceRequestStatus.REQUESTED ||
            row.status === AdvanceRequestStatus.APPROVED),
      )
      .reduce(
        (sum, row) =>
          sum +
          Number(
            row.status === AdvanceRequestStatus.APPROVED
              ? (row.approvedAmount ?? row.requestedAmount)
              : row.requestedAmount,
          ),
        0,
      );
    const pending = pendingConfirmations + pendingLegacyAdvances;
    const pendingAdvances =
      pendingConfirmationAdvances + pendingLegacyAdvances;
    const increase = (types: PayrollAccrualType[]) => statementAccruals
      .filter((row) => row.direction === PayrollDirection.INCREASE && types.includes(row.type))
      .reduce((sum, row) => sum + Number(row.amount), 0);
    const paymentTypeById = new Map(
      employee.payments.map((row) => [row.id, row.type]),
    );
    const advancesPaid = employee.payments.reduce((sum, row) => {
      if (row.type === PayrollPaymentType.ADVANCE)
        return sum + Number(row.amount);
      if (
        row.type === PayrollPaymentType.EMPLOYEE_REFUND &&
        row.reversalOfId != null &&
        paymentTypeById.get(row.reversalOfId) === PayrollPaymentType.ADVANCE
      )
        return sum - Number(row.amount);
      return sum;
    }, 0);
    const periodSalary = payrollSalaryForPeriod({
      hiredAt: employee.hiredAt,
      terminatedAt: employee.terminatedAt,
      baseSalary: employee.baseSalary,
      salaryRates: employee.salaryRates,
      periodStart: periodRange.start,
      periodEnd: periodRange.end,
    });
    const identity = employee.user
      ? employee.user
      : { id: 0, name: employee.name || "Сотрудник", role: employee.position || "EMPLOYEE", active: false };
    const employeeEmploymentEnded = employmentEnded(employee);
    const latestApproval = employee.calculationSnapshots[0] ?? null;
    const confirmedAccrued = latestApproval
      ? Number(latestApproval.preparedAmount)
      : 0;
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
      ? Math.max(configuredSalary, 0)
      : 0;
    const currentSalary = salaryPlanEnabled ? configuredSalary : 0;
    const orderBonusApplies = employeeCanReceiveOrderBonus(employee);
    const employeePeriodOrders = identity.id
      ? periodOrdersByManagerUserId.get(identity.id) ?? []
      : [];
    const assignedOrders = orderBonusApplies
      ? employeePeriodOrders.filter(
          (order) => {
            const assigned = isOrderAssignedToManager(
              {
                responsibleType: order.responsibleType,
                managerUserId: order.managerUserId,
                managerName: order.manager,
              },
              identity,
            );
            if (!assigned || !isManagerOrderBonusEligible(order)) return false;
            const decision = order.payrollBonusDecisions.find(
              (item) => item.employeeId === employee.id,
            );
            return decision
              ? decision.periodId === periodId
              : Boolean(bonusEarnedInRange(order, employee, periodRange));
          },
        )
      : [];
    const orderBonuses = assignedOrders.map((order) => {
      const decision = order.payrollBonusDecisions.find(
        (item) => item.employeeId === employee.id,
      );
      const systemSuggestion = managerOrderBonus(Number(order.amount));
      const manualBonus = decision?.manualAmount == null
        ? null
        : Number(decision.manualAmount);
      const effectiveBonus = manualBonus ?? 0;
      const earnedAt = decision?.earnedAt ??
        bonusEarnedAt(order, employee) ?? order.orderReceivedAt;
      return {
        id: decision?.id ?? null,
        employeeId: employee.id,
        orderId: order.id,
        orderNumber: order.number,
        clientName: order.client.name,
        clientPhone: order.client.phone,
        orderAmount: Number(order.amount),
        orderStatus: order.status,
        earnedAt,
        orderReceivedAt: order.orderReceivedAt,
        systemSuggestion,
        manualBonus,
        effectiveBonus,
        editable:
          actor.role === Role.DIRECTOR ||
          actor.role === Role.OPERATIONS_DIRECTOR ||
          actor.userId === employee.userId,
        history:
          bonusDecisionHistory.get(`${order.id}:${employee.id}`) ?? [],
        updatedAt: decision?.updatedAt ?? null,
        updatedBy: decision?.updatedBy ?? null,
      };
    });
    const effectiveOrderBonuses = orderBonuses.reduce(
      (sum, item) => sum + item.effectiveBonus,
      0,
    );
    const otherBonuses = increase([
      PayrollAccrualType.MEASUREMENT_BONUS,
      PayrollAccrualType.EXTRA_BONUS,
      PayrollAccrualType.ADJUSTMENT_INCREASE,
    ]);
    const premiums = increase([PayrollAccrualType.PREMIUM]);
    const deductions = statementAccruals
      .filter((row) => row.direction === PayrollDirection.DECREASE)
      .reduce((sum, row) => sum + Number(row.amount), 0);
    const missingBonusCount = orderBonuses.filter(
      (item) => item.manualBonus == null,
    ).length;
    const calculationSource = {
      salaryRateId: activeRate?.id ?? null,
      salaryEffectiveFrom: periodSalary.effectiveFrom?.toISOString() ?? null,
      calculationAccruals: statementAccruals
        .filter((row) => row.type !== PayrollAccrualType.BASE_SALARY)
        .map((row) => ({
          id: row.id,
          type: row.type,
          direction: row.direction,
          amount: Number(row.amount),
        }))
        .sort((a, b) => a.id - b.id),
      orderBonuses: orderBonuses
        .map((item) => ({
          orderId: item.orderId,
          decisionId: item.id,
          earnedAt: item.earnedAt.toISOString(),
          manualAmount: item.manualBonus,
        }))
        .sort((a, b) => a.orderId - b.orderId),
    } satisfies Prisma.InputJsonValue;
    const preparedAmount =
      statementSalary + effectiveOrderBonuses + otherBonuses + premiums - deductions;
    const currentCalculationState: PayrollCalculationState = {
      salary: statementSalary,
      orderBonuses: effectiveOrderBonuses,
      otherBonuses,
      premiums,
      deductions,
      prepared: preparedAmount,
      source: calculationSource,
    };
    const currentCalculationHash = payrollCalculationHash(
      currentCalculationState,
    );
    const approvalStatus = !latestApproval
      ? "PRELIMINARY"
      : payrollSnapshotMatchesCalculation(
          latestApproval,
          currentCalculationState,
          currentCalculationHash,
        )
        ? "CONFIRMED"
        : "NEEDS_CORRECTION";
    const calculated = personalPayrollCalculation({
      salary: statementSalary,
      bonuses: effectiveOrderBonuses + otherBonuses,
      premiums,
      deductions,
      advances: advancesPaid,
      otherPayments: paid - advancesPaid,
      pendingAdvances,
      accrued: confirmedAccrued,
    });
    const remaining =
      (latestApproval ? Number(latestApproval.preparedAmount) : preparedAmount) - paid;
    const personalCalculationBase = {
      ...calculated,
      prepared: preparedAmount,
      orderBonuses: effectiveOrderBonuses,
      otherBonuses,
      paid,
      remaining,
      priorDebt: 0,
      hasActivity:
        salaryPlanEnabled ||
        orderBonuses.length > 0 ||
        statementAccruals.length > 0 ||
        employee.payments.length > 0 ||
        employee.paymentConfirmations.length > 0 ||
        employee.advanceRequests.some(
          (row) =>
            row.status === AdvanceRequestStatus.REQUESTED ||
            row.status === AdvanceRequestStatus.APPROVED,
        ) ||
        latestApproval != null,
      incomplete: missingBonusCount > 0,
      missingBonusCount,
      calculationHash: currentCalculationHash,
      approvalStatus,
      approvedAmount: latestApproval
        ? Number(latestApproval.preparedAmount)
        : null,
      approvedAt: latestApproval?.approvedAt ?? null,
      approvedRevision: latestApproval?.revision ?? null,
    };
    const priorOrderItemsByMonth = new Map<
      string,
      Array<{
        orderId: number;
        decisionId: number | null;
        earnedAt: Date;
        manualAmount: number | null;
      }>
    >();
    if (employeeCanReceiveOrderBonus(employee) && identity.id) {
      const employeePriorOrders =
        priorOrdersByManagerUserId.get(identity.id) ?? [];
      for (const order of employeePriorOrders) {
        if (
          !isOrderAssignedToManager(
            {
              responsibleType: order.responsibleType,
              managerUserId: order.managerUserId,
              managerName: order.manager,
            },
            identity,
          ) ||
          !isManagerOrderBonusEligible(order)
        )
          continue;
        const decision = order.payrollBonusDecisions.find(
          (item) => item.employeeId === employee.id,
        );
        const decisionPeriod = decision
          ? priorPeriodById.get(decision.periodId)
          : undefined;
        if (decision && !decisionPeriod) continue;
        const earnedAt = decision?.earnedAt ?? bonusEarnedAt(order, employee);
        if (!earnedAt) continue;
        const earnedMonth = decisionPeriod ?? companyYearMonth(earnedAt);
        const monthKey = `${earnedMonth.year}-${earnedMonth.month}`;
        if (!priorPeriodMonthKeys.has(monthKey)) continue;
        const items = priorOrderItemsByMonth.get(monthKey) ?? [];
        items.push({
          orderId: order.id,
          decisionId: decision?.id ?? null,
          earnedAt,
          manualAmount:
            decision?.manualAmount == null
              ? null
              : Number(decision.manualAmount),
        });
        priorOrderItemsByMonth.set(monthKey, items);
      }
    }
    const priorDebtBreakdown = priorPeriods.flatMap((priorPeriod) => {
      const priorRange = companyMonthRange(priorPeriod.year, priorPeriod.month);
      const priorSalary = payrollSalaryForPeriod({
        hiredAt: employee.hiredAt,
        terminatedAt: employee.terminatedAt,
        baseSalary: employee.baseSalary,
        salaryRates: employee.salaryRates,
        periodStart: priorRange.start,
        periodEnd: priorRange.end,
      });
      const priorActiveRate = employee.salaryRates.find(
        (rate) =>
          rate.effectiveFrom < priorRange.end &&
          (!rate.effectiveTo || rate.effectiveTo > priorRange.start),
      );
      const priorSalaryPlanEnabled =
        priorSalary.employedInPeriod &&
        (priorActiveRate?.planEnabled ??
          (employee.salaryRates.length === 0 && employee.salaryPlanEnabled));
      const activePriorAccruals = priorPeriod.id == null
        ? []
        : (priorAccrualsByEmployeePeriod.get(
            `${employee.id}:${priorPeriod.id}`,
          ) ?? []).filter((row) => !row.reversalOfId && !row.reversedBy);
      const priorStatementAccruals = activePriorAccruals.filter(
        (row) =>
          row.type !== PayrollAccrualType.BASE_SALARY &&
          row.type !== PayrollAccrualType.ORDER_BONUS &&
          row.type !== PayrollAccrualType.GUARANTEED_ORDER_BONUS &&
          (row.type !== PayrollAccrualType.MEASUREMENT_BONUS ||
            row.order?.responsibleType === OrderResponsibleType.EMPLOYEE) &&
          !row.reason.startsWith(PAYROLL_POLICY_ADJUSTMENT_PREFIX),
      );
      const priorIncrease = (types: PayrollAccrualType[]) =>
        priorStatementAccruals
          .filter(
            (row) =>
              row.direction === PayrollDirection.INCREASE &&
              types.includes(row.type),
          )
          .reduce((sum, row) => sum + Number(row.amount), 0);
      const priorOtherBonuses = priorIncrease([
        PayrollAccrualType.MEASUREMENT_BONUS,
        PayrollAccrualType.EXTRA_BONUS,
        PayrollAccrualType.ADJUSTMENT_INCREASE,
      ]);
      const priorPremiums = priorIncrease([PayrollAccrualType.PREMIUM]);
      const priorDeductions = priorStatementAccruals
        .filter((row) => row.direction === PayrollDirection.DECREASE)
        .reduce((sum, row) => sum + Number(row.amount), 0);
      const priorOrderItems =
        priorOrderItemsByMonth.get(`${priorPeriod.year}-${priorPeriod.month}`) ??
        [];
      const priorOrderBonuses = priorOrderItems.reduce(
        (sum, item) => sum + (item.manualAmount ?? 0),
        0,
      );
      const priorMissingBonusCount = priorOrderItems.filter(
        (item) => item.manualAmount == null,
      ).length;
      const priorStatementSalary = priorSalaryPlanEnabled
        ? Math.max(priorSalary.amount, 0)
        : 0;
      const priorPrepared =
        priorStatementSalary +
        priorOrderBonuses +
        priorOtherBonuses +
        priorPremiums -
        priorDeductions;
      const priorSource = {
        salaryRateId: priorActiveRate?.id ?? null,
        salaryEffectiveFrom: priorSalary.effectiveFrom?.toISOString() ?? null,
        calculationAccruals: priorStatementAccruals
          .map((row) => ({
            id: row.id,
            type: row.type,
            direction: row.direction,
            amount: Number(row.amount),
          }))
          .sort((a, b) => a.id - b.id),
        orderBonuses: priorOrderItems
          .map((item) => ({
            orderId: item.orderId,
            decisionId: item.decisionId,
            earnedAt: item.earnedAt.toISOString(),
            manualAmount: item.manualAmount,
          }))
          .sort((a, b) => a.orderId - b.orderId),
      } satisfies Prisma.InputJsonValue;
      const priorCalculationState: PayrollCalculationState = {
        salary: priorStatementSalary,
        orderBonuses: priorOrderBonuses,
        otherBonuses: priorOtherBonuses,
        premiums: priorPremiums,
        deductions: priorDeductions,
        prepared: priorPrepared,
        source: priorSource,
      };
      const priorHash = payrollCalculationHash(priorCalculationState);
      const priorSnapshot = priorPeriod.id == null
        ? undefined
        : latestPriorSnapshotByEmployeePeriod.get(
            `${employee.id}:${priorPeriod.id}`,
          );
      const priorPaid = (priorPeriod.id == null
        ? []
        : priorPaymentsByEmployeePeriod.get(
            `${employee.id}:${priorPeriod.id}`,
          ) ?? [])
        .reduce((sum, payment) => sum + signedPayment(payment), 0);
      const basis = priorSnapshot
        ? Number(priorSnapshot.preparedAmount)
        : priorPrepared;
      const remaining = basis - priorPaid;
      const hasActivity =
        Math.abs(basis) >= 0.01 ||
        Math.abs(priorPaid) >= 0.01 ||
        priorMissingBonusCount > 0;
      if (!hasActivity) return [];
      return [{
        periodId: priorPeriod.id,
        year: priorPeriod.year,
        month: priorPeriod.month,
        prepared: priorPrepared,
        approvedAmount: priorSnapshot
          ? Number(priorSnapshot.preparedAmount)
          : null,
        paid: priorPaid,
        remaining,
        debt: Math.max(remaining, 0),
        incomplete: priorMissingBonusCount > 0,
        missingBonusCount: priorMissingBonusCount,
        approvalStatus: priorSnapshot
          ? payrollSnapshotMatchesCalculation(
              priorSnapshot,
              priorCalculationState,
              priorHash,
            )
            ? "CONFIRMED"
            : "NEEDS_CORRECTION"
          : "PRELIMINARY",
      }];
    });
    const priorDebt = priorDebtBreakdown.reduce(
      (sum, item) => sum + item.debt,
      0,
    );
    const personalCalculation = {
      ...personalCalculationBase,
      priorDebt,
      priorDebtBreakdown,
    };
    const bonusAccruals = statementAccruals
      .filter(
        (row) =>
          row.direction === PayrollDirection.INCREASE &&
          (row.type === PayrollAccrualType.MEASUREMENT_BONUS ||
            row.type === PayrollAccrualType.EXTRA_BONUS),
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
    const orderBonusAudit = orderBonuses.map((item) => ({
      accrualId: item.id ?? -item.orderId,
      orderId: item.orderId,
      orderNumber: item.orderNumber,
      clientName: item.clientName,
      orderAmount: item.orderAmount,
      orderStatus: item.orderStatus,
      earnedAt: item.orderReceivedAt,
      earnedEvent: managerOrderBonusEarnedEvent({
        active: employee.active,
        terminatedAt: employee.terminatedAt,
        accountActive: employee.user?.active,
      }),
      eligible: true,
      submitted: item.manualBonus ?? 0,
      expected: item.systemSuggestion,
      appliedAdjustment: 0,
      recorded: item.effectiveBonus,
      managerDifference: item.effectiveBonus - item.systemSuggestion,
      ledgerDifference: 0,
      status:
        item.manualBonus == null
          ? ("MISSING" as const)
          : item.manualBonus === item.systemSuggestion
            ? ("MATCH" as const)
          : item.manualBonus > item.systemSuggestion
            ? ("OVER" as const)
            : ("UNDER" as const),
      reconciled: item.manualBonus != null,
    }));
    const salaryDifference = statementSalary - confirmedAccrued;
    const workReadiness =
      orderBonusApplies && identity.id && !employeeEmploymentEnded
      ? {
          orderIssues: readinessOrderIssuesByUserId.get(identity.id) ?? 0,
          measurementsToClose:
            readinessMeasurementsByUserId.get(identity.id) ?? 0,
          openTasks: readinessTasksByUserId.get(identity.id) ?? 0,
          ready: false,
        }
      : { orderIssues: 0, measurementsToClose: 0, openTasks: 0, ready: true };
    workReadiness.ready =
      workReadiness.orderIssues === 0 &&
      workReadiness.measurementsToClose === 0 &&
      workReadiness.openTasks === 0;
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
        salaryPrepared: statementSalary,
        orderBonusesPrepared: effectiveOrderBonuses,
        otherBonusesPrepared: otherBonuses,
        premiumsPrepared: premiums,
        deductionsPrepared: deductions,
        prepared: preparedAmount,
        salaryAccrued: latestApproval
          ? Number(latestApproval.salaryAmount)
          : 0,
        bonusesAccrued: latestApproval
          ? Number(latestApproval.orderBonusAmount) +
            Number(latestApproval.otherBonusAmount)
          : 0,
        premiumsAccrued: latestApproval
          ? Number(latestApproval.premiumAmount)
          : 0,
        advancesPaid,
        totalAccrued: confirmedAccrued,
        totalPaid: paid,
        payable: personalCalculation.remaining,
        priorDebt: personalCalculation.priorDebt,
      },
      bonusAccruals,
      orderBonuses,
      calculation: personalCalculation,
      calculationHistory: employee.calculationSnapshots.map((snapshot) => ({
        id: snapshot.id,
        revision: snapshot.revision,
        preparedAmount: Number(snapshot.preparedAmount),
        salaryAmount: Number(snapshot.salaryAmount),
        orderBonusAmount: Number(snapshot.orderBonusAmount),
        otherBonusAmount: Number(snapshot.otherBonusAmount),
        premiumAmount: Number(snapshot.premiumAmount),
        deductionAmount: Number(snapshot.deductionAmount),
        reason: snapshot.reason,
        approvedAt: snapshot.approvedAt,
        approvedBy: snapshot.approvedBy,
      })),
      payrollAudit: orderBonusApplies
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
            linkedOrders: orderBonusAudit.length,
            submittedOrderBonus: orderBonusAudit.reduce(
              (sum, row) => sum + row.submitted,
              0,
            ),
            requiredOrderBonus: orderBonusAudit.reduce(
              (sum, row) => sum + row.expected,
              0,
            ),
            managerDifference: orderBonusAudit.reduce(
              (sum, row) => sum + row.managerDifference,
              0,
            ),
            salaryRequired: statementSalary,
            salaryPosted: confirmedAccrued,
            salaryDifference,
            premiums: premiums + otherBonuses,
            deductions,
            advances: advancesPaid,
            alreadyPaid: paid,
            ledgerDifference: 0,
            auditedAccrued: confirmedAccrued,
            auditedPayable: personalCalculation.remaining,
            approvedAccrued: confirmedAccrued,
            approvedPayable: personalCalculation.remaining,
            unreconciledOrders: missingBonusCount,
            calculationReady: missingBonusCount === 0,
            manualApproved: false,
            workReadiness,
            readyToPay: missingBonusCount === 0,
            mismatches: orderBonusAudit,
          }
        : null,
      totals: {
        prepared: preparedAmount,
        accrued: confirmedAccrued,
        paid,
        pending,
        payable: personalCalculation.remaining,
        remaining: personalCalculation.remaining,
        priorDebt: personalCalculation.priorDebt,
      },
    };
  });
  const breakdown = rows.reduce((sum, row) => ({
    salaryPrepared: sum.salaryPrepared + row.breakdown.salaryPrepared,
    orderBonusesPrepared: sum.orderBonusesPrepared + row.breakdown.orderBonusesPrepared,
    otherBonusesPrepared: sum.otherBonusesPrepared + row.breakdown.otherBonusesPrepared,
    premiumsPrepared: sum.premiumsPrepared + row.breakdown.premiumsPrepared,
    deductionsPrepared: sum.deductionsPrepared + row.breakdown.deductionsPrepared,
    prepared: sum.prepared + row.breakdown.prepared,
    salaryAccrued: sum.salaryAccrued + row.breakdown.salaryAccrued,
    bonusesAccrued: sum.bonusesAccrued + row.breakdown.bonusesAccrued,
    premiumsAccrued: sum.premiumsAccrued + row.breakdown.premiumsAccrued,
    advancesPaid: sum.advancesPaid + row.breakdown.advancesPaid,
    totalAccrued: sum.totalAccrued + row.breakdown.totalAccrued,
    totalPaid: sum.totalPaid + row.breakdown.totalPaid,
    payable: sum.payable + row.breakdown.payable,
    priorDebt: sum.priorDebt + row.breakdown.priorDebt,
  }), { salaryPrepared: 0, orderBonusesPrepared: 0, otherBonusesPrepared: 0, premiumsPrepared: 0, deductionsPrepared: 0, prepared: 0, salaryAccrued: 0, bonusesAccrued: 0, premiumsAccrued: 0, advancesPaid: 0, totalAccrued: 0, totalPaid: 0, payable: 0, priorDebt: 0 });
  return {
    rows,
    settings: settings ?? { paydayDayOfMonth: 1 },
    breakdown,
    totals: rows.reduce(
      (sum, row) => ({
        prepared: sum.prepared + row.totals.prepared,
        accrued: sum.accrued + row.totals.accrued,
        paid: sum.paid + row.totals.paid,
        pending: sum.pending + row.totals.pending,
        payable: sum.payable + row.totals.payable,
        remaining: sum.remaining + row.totals.remaining,
        priorDebt: sum.priorDebt + row.totals.priorDebt,
      }),
      { prepared: 0, accrued: 0, paid: 0, pending: 0, payable: 0, remaining: 0, priorDebt: 0 },
    ),
  };
}

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
  const range = companyMonthRange(year, month);
  const period = await prisma.payrollPeriod.findUnique({
    where: { companyId_year_month: { companyId, year, month } },
    select: { id: true, year: true, month: true, status: true },
  });
  const managerOwnOnly = actor.role === Role.MANAGER;
  const orders = await prisma.order.findMany({
    where: {
      companyId,
      deletedAt: null,
      orderDateNeedsReview: false,
      responsibleType: OrderResponsibleType.EMPLOYEE,
      managerUserId: managerOwnOnly ? actor.userId : { not: null },
      lifecycle: { not: OrderLifecycle.CANCELLED },
      ...(period
        ? {
            OR: [
              { orderReceivedAt: { gte: range.start, lt: range.end } },
              { payrollBonusDecisions: { some: { periodId: period.id } } },
            ],
          }
        : { orderReceivedAt: { gte: range.start, lt: range.end } }),
    },
    select: {
      id: true,
      number: true,
      amount: true,
      status: true,
      lifecycle: true,
      deletedAt: true,
      responsibleType: true,
      manager: true,
      managerUserId: true,
      orderReceivedAt: true,
      completedAt: true,
      client: { select: { name: true, phone: true } },
      payrollBonusDecisions: {
        select: { employeeId: true, periodId: true, earnedAt: true },
      },
    },
    orderBy: [{ orderReceivedAt: "asc" }, { id: "asc" }],
  });
  const managerIds = orders
    .map((order) => order.managerUserId)
    .filter((id): id is number => id != null);
  const profiles = managerIds.length
    ? await prisma.employeePayrollProfile.findMany({
        where: { companyId, userId: { in: managerIds }, payrollEnabled: true },
        include: { user: { select: { id: true, name: true, role: true, active: true } } },
      })
    : [];
  const profileByUserId = new Map(
    profiles
      .filter(employeeCanReceiveOrderBonus)
      .map((profile) => [profile.userId!, profile]),
  );
  const candidates = orders.flatMap((order) => {
    const employee = order.managerUserId
      ? profileByUserId.get(order.managerUserId)
      : undefined;
    if (!employee) return [];
    if (!isManagerOrderBonusEligible(order)) return [];
    const existingDecision = order.payrollBonusDecisions.find(
      (decision) => decision.employeeId === employee.id,
    );
    if (existingDecision) {
      if (!period || existingDecision.periodId !== period.id) return [];
    } else if (!bonusEarnedInRange(order, employee, range)) return [];
    return [{ order, employee }];
  });
  const decisions = candidates.length
    ? await prisma.payrollOrderBonusDecision.findMany({
        where: {
          companyId,
          OR: candidates.map(({ order, employee }) => ({
            orderId: order.id,
            employeeId: employee.id,
          })),
        },
        include: { updatedBy: { select: { id: true, name: true } } },
      })
    : [];
  const decisionByAssignment = new Map(
    decisions.map((decision) => [
      `${decision.orderId}:${decision.employeeId}`,
      decision,
    ]),
  );
  return {
    period,
    items: candidates.map(({ order, employee }) => {
      const decision = decisionByAssignment.get(`${order.id}:${employee.id}`);
      const systemSuggestion = managerOrderBonus(Number(order.amount));
      const manualBonus = decision?.manualAmount == null
        ? null
        : Number(decision.manualAmount);
      return {
        id: decision?.id ?? null,
        employeeId: employee.id,
        employeeName:
          employee.user?.name || employee.name || "Сотрудник",
        orderId: order.id,
        order: {
          id: order.id,
          number: order.number,
          amount: Number(order.amount),
          orderReceivedAt: order.orderReceivedAt,
          client: order.client,
        },
        systemSuggestion,
        manualBonus,
        effectiveBonus: manualBonus ?? 0,
        editable: true,
        updatedAt: decision?.updatedAt ?? null,
        updatedBy: decision?.updatedBy ?? null,
      };
    }),
  };
}

export async function saveOrderBonusDecision(
  input: {
    year: number;
    month: number;
    orderId: number;
    employeeId: number;
    manualBonus: number | null;
    reason: string;
    key: string;
    requestHash: string;
  },
  actor: PayrollActor,
) {
  orderBonusCorrectionActor(actor);
  if (
    !Number.isInteger(input.year) ||
    !Number.isInteger(input.month) ||
    input.month < 1 ||
    input.month > 12 ||
    !Number.isInteger(input.orderId) ||
    input.orderId <= 0 ||
    !Number.isInteger(input.employeeId) ||
    input.employeeId <= 0
  )
    throw new PayrollError("INVALID_PERIOD");
  const reason = requiredReason(input.reason);
  const manualAmount = optionalBonusAmount(input.manualBonus);
  const companyId = requireTenantIdentity().companyId;
  const range = companyMonthRange(input.year, input.month);
  return prisma.$transaction(async (tx) => {
    const replay = await tx.payrollAuditEvent.findUnique({
      where: { idempotencyKey: `${input.key}:audit` },
      select: {
        id: true,
        periodId: true,
        employeeId: true,
        after: true,
        period: { select: { companyId: true } },
      },
    });
    const [period, employee, order] = await Promise.all([
      tx.payrollPeriod.upsert({
        where: { companyId_year_month: { companyId, year: input.year, month: input.month } },
        create: { companyId, year: input.year, month: input.month },
        update: {},
        select: { id: true, status: true },
      }),
      tx.employeePayrollProfile.findFirst({
        where: { id: input.employeeId, companyId, payrollEnabled: true },
        include: { user: { select: { id: true, name: true, role: true, active: true } } },
      }),
      tx.order.findFirst({
        where: {
          id: input.orderId,
          companyId,
          deletedAt: null,
          orderDateNeedsReview: false,
          responsibleType: OrderResponsibleType.EMPLOYEE,
          managerUserId: { not: null },
          lifecycle: { not: OrderLifecycle.CANCELLED },
        },
        select: {
          id: true,
          number: true,
          amount: true,
          status: true,
          lifecycle: true,
          deletedAt: true,
          responsibleType: true,
          manager: true,
          managerUserId: true,
          orderReceivedAt: true,
          completedAt: true,
          client: { select: { name: true, phone: true } },
        },
      }),
    ]);
    if (!employee || !employeeCanReceiveOrderBonus(employee))
      throw new PayrollError("EMPLOYEE_NOT_FOUND");
    // A manager may only ever edit their own payroll profile. Enforce this
    // before validating the supplied order so a foreign profile cannot be
    // probed through period/eligibility error differences.
    if (actor.role === Role.MANAGER && employee.userId !== actor.userId)
      throw new PayrollError("FORBIDDEN");
    const existing = order
      ? await tx.payrollOrderBonusDecision.findUnique({
          where: {
            orderId_employeeId: {
              orderId: order.id,
              employeeId: employee.id,
            },
          },
        })
      : null;
    const factualEarnedAt = order ? bonusEarnedAt(order, employee) : null;
    if (
      !order ||
      order.managerUserId !== employee.userId ||
      !isManagerOrderBonusEligible(order) ||
      !factualEarnedAt ||
      (existing
        ? existing.periodId !== period.id
        : !isDateInPayrollPeriod(factualEarnedAt, range.start, range.end))
    )
      throw new PayrollError(
        existing && existing.periodId !== period.id
          ? "BONUS_PERIOD_MISMATCH"
          : "ORDER_OUTSIDE_PERIOD",
      );
    if (
      actor.role === Role.MANAGER &&
      order.managerUserId !== actor.userId
    )
      throw new PayrollError("FORBIDDEN");
    if (replay) {
      const replayAfter = replay.after && typeof replay.after === "object" && !Array.isArray(replay.after)
        ? replay.after as Record<string, unknown>
        : null;
      if (
        replay.period?.companyId !== companyId ||
        replay.periodId !== period.id ||
        replay.employeeId !== employee.id ||
        replayAfter?.requestHash !== input.requestHash
      )
        throw new PayrollError("IDEMPOTENCY_CONFLICT");
      const systemSuggestion = managerOrderBonus(Number(order.amount));
      const replayEffectiveBonus = Number(replayAfter?.effectiveBonus);
      return {
        changed: false,
        replay: true,
        decision: existing,
        systemSuggestion,
        effectiveBonus: Number.isFinite(replayEffectiveBonus)
          ? replayEffectiveBonus
          : effectiveOrderBonusAmount(
              Number(order.amount),
              existing?.manualAmount,
            ),
      };
    }
    if (actor.role === Role.MANAGER) {
      const confirmedCalculation = await tx.payrollCalculationSnapshot.findFirst({
        where: {
          companyId,
          periodId: period.id,
          employeeId: employee.id,
        },
        select: { id: true },
      });
      if (
        period.status !== PayrollPeriodStatus.OPEN ||
        confirmedCalculation
      )
        throw new PayrollError("FORBIDDEN");
    }
    const sameValue = existing
      ? existing.manualAmount == null
        ? manualAmount == null
        : manualAmount != null && existing.manualAmount.equals(manualAmount)
      : manualAmount == null;
    const systemSuggestion = managerOrderBonus(Number(order.amount));
    if (sameValue) {
      const effectiveBonus = effectiveOrderBonusAmount(
        Number(order.amount),
        existing?.manualAmount,
      );
      await audit(tx, {
        action: "ORDER_BONUS_DECISION_NOOP",
        actor,
        periodId: period.id,
        employeeId: employee.id,
        before: {
          orderId: order.id,
          decisionId: existing?.id ?? null,
          manualBonus:
            existing?.manualAmount == null
              ? null
              : Number(existing.manualAmount),
          effectiveBonus,
        },
        after: {
          orderId: order.id,
          decisionId: existing?.id ?? null,
          manualBonus:
            existing?.manualAmount == null
              ? null
              : Number(existing.manualAmount),
          systemSuggestion,
          effectiveBonus,
          requestHash: input.requestHash,
        },
        reason,
        idempotencyKey: `${input.key}:audit`,
      });
      return {
        changed: false,
        replay: false,
        decision: existing,
        systemSuggestion,
        effectiveBonus,
      };
    }
    const decision = await tx.payrollOrderBonusDecision.upsert({
      where: { orderId_employeeId: { orderId: order.id, employeeId: employee.id } },
      create: {
        companyId,
        orderId: order.id,
        employeeId: employee.id,
        periodId: period.id,
        earnedAt: factualEarnedAt,
        manualAmount,
        updatedById: actor.userId,
      },
      update: { manualAmount, updatedById: actor.userId },
    });
    await audit(tx, {
      action: "ORDER_BONUS_DECISION_CHANGED",
      actor,
      periodId: period.id,
      employeeId: employee.id,
      before: {
        orderId: order.id,
        periodId: period.id,
        earnedAt: factualEarnedAt.toISOString(),
        manualBonus:
          existing?.manualAmount == null ? null : Number(existing.manualAmount),
        systemSuggestion,
        effectiveBonus: effectiveOrderBonusAmount(
          Number(order.amount),
          existing?.manualAmount,
        ),
      },
      after: {
        orderId: order.id,
        periodId: period.id,
        earnedAt: factualEarnedAt.toISOString(),
        manualBonus: decision.manualAmount == null ? null : Number(decision.manualAmount),
        systemSuggestion,
        effectiveBonus: effectiveOrderBonusAmount(
          Number(order.amount),
          decision.manualAmount,
        ),
        requestHash: input.requestHash,
      },
      reason,
      idempotencyKey: `${input.key}:audit`,
    });
    return {
      changed: true,
      replay: false,
      decision,
      systemSuggestion,
      effectiveBonus: effectiveOrderBonusAmount(
        Number(order.amount),
        decision.manualAmount,
      ),
    };
  }, { ...transactionOptions, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function syncAutomaticOrderBonuses(
  year: number,
  month: number,
  actor: PayrollActor,
) {
  const snapshot = await listOrderBonusesForCorrection(year, month, actor);
  return {
    created: 0,
    removed: 0,
    deferredCreated: 0,
    deferredRemoved: 0,
    skipped: false,
    automaticPeriod: isManagerOrderBonusAutomaticPeriod(year, month),
    periodStatus: snapshot.period?.status ?? null,
    candidates: snapshot.items.length,
  };
}

export async function accrueCompletedTerminatedManagerOrderBonus(
  orderId: number,
  _actor: PayrollActor,
) {
  void _actor;
  const companyId = requireTenantIdentity().companyId;
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      companyId,
      deletedAt: null,
      orderDateNeedsReview: false,
      responsibleType: OrderResponsibleType.EMPLOYEE,
      managerUserId: { not: null },
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
      responsibleType: true,
      manager: true,
      managerUserId: true,
      orderReceivedAt: true,
      completedAt: true,
    },
  });
  if (!order?.managerUserId || !order.completedAt || !isManagerOrderBonusEligible(order))
    return { created: false, skipped: true, reason: "ORDER_NOT_ELIGIBLE" };

  const employee = await prisma.employeePayrollProfile.findFirst({
    where: {
      companyId,
      userId: order.managerUserId,
      payrollEnabled: true,
    },
    include: {
      user: { select: { id: true, name: true, role: true, active: true } },
    },
  });
  if (!employee || !employeeCanReceiveOrderBonus(employee) || !employmentEnded(employee))
    return { created: false, skipped: true, reason: "EMPLOYEE_NOT_TERMINATED" };

  const earnedPeriod = companyYearMonth(order.orderReceivedAt);
  const range = companyMonthRange(earnedPeriod.year, earnedPeriod.month);
  if (!bonusEarnedInRange(order, employee, range))
    return { created: false, skipped: true, reason: "ORDER_NOT_ELIGIBLE" };

  const decision = await prisma.payrollOrderBonusDecision.findUnique({
    where: { orderId_employeeId: { orderId: order.id, employeeId: employee.id } },
  });
  const systemSuggestion = managerOrderBonus(Number(order.amount));
  return {
    created: false,
    skipped: true,
    reason: "ORDER_BONUS_DECISION_ONLY",
    employeeId: employee.id,
    period: earnedPeriod,
    systemSuggestion,
    manualBonus: decision?.manualAmount == null ? null : Number(decision.manualAmount),
    effectiveBonus: effectiveOrderBonusAmount(Number(order.amount), decision?.manualAmount),
  };
}

/** @deprecated Order bonuses are entitlement decisions, never accrual mutations. */
export async function correctOrderBonus(
  _input: unknown,
  actor: PayrollActor,
): Promise<never> {
  orderBonusCorrectionActor(actor);
  throw new PayrollError("ORDER_BONUS_DECISION_REQUIRED");
}
type PayrollAccrualCorrectionInput = {
  accrualId: number;
  amount: number;
  reason: string;
  key: string;
  requestHash: string;
};

const genericAccrualCorrectionTypes = new Set<PayrollAccrualType>([
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
        await assertPayrollEmployeeTenant(
          tx,
          replay.employeeId,
          "IDEMPOTENCY_CONFLICT",
        );
        if (!compareRequestHash(replay.requestHash, input.requestHash))
          throw new PayrollError("IDEMPOTENCY_CONFLICT");
        const replacement = await tx.payrollAccrual.findUnique({
          where: { idempotencyKey: `${input.key}:replacement` },
        });
        if (replacement)
          await assertPayrollEmployeeTenant(
            tx,
            replacement.employeeId,
            "IDEMPOTENCY_CONFLICT",
          );
        return {
          created: false,
          reversal: replay,
          replacement,
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
      await openPeriod(tx, original.periodId);

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
          affectsProfit: false,
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
          affectsProfit: false,
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
        await assertPayrollEmployeeTenant(
          tx,
          replay.employeeId,
          "IDEMPOTENCY_CONFLICT",
        );
        if (!compareRequestHash(replay.requestHash, requestHash))
          throw new PayrollError("IDEMPOTENCY_CONFLICT");
        return { accrual: replay, created: false };
      }
      const original = await tx.payrollAccrual.findFirst({
        where: { id, employee: { companyId } },
        include: {
          period: { select: { id: true, status: true } },
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
      if (periodId !== original.periodId)
        throw new PayrollError("ACCRUAL_PERIOD_MISMATCH");
      await openPeriod(tx, original.periodId);

      const direction =
        original.direction === PayrollDirection.INCREASE
          ? PayrollDirection.DECREASE
          : PayrollDirection.INCREASE;
      const reversal = await tx.payrollAccrual.create({
        data: {
          employeeId: original.employeeId,
          periodId: original.periodId,
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
          affectsProfit: false,
          payrollAccrualId: reversal.id,
        },
      });
      await audit(tx, {
        action: "PAYROLL_ACCRUAL_REVERSED",
        actor,
        periodId: original.periodId,
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
