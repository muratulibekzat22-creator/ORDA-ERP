import {
  EmployeeKpiKind,
  EmployeeKpiRequestStatus,
  EmployeeKpiUnit,
  Role,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getManagerMonthlySales } from "@/lib/services/manager-monthly-sales.service";
import { requireTenantIdentity } from "@/lib/tenant-context";

export type KpiActor = { userId: number; role: Role };
type MetricDefinition = {
  code: string;
  title: string;
  unit: EmployeeKpiUnit;
  actual: number;
  source: string;
};
type KpiMetric = Omit<MetricDefinition, "actual"> & {
  kind: EmployeeKpiKind;
  actual: number | null;
  target: number | null;
  completionPercent: number | null;
  evidence: string | null;
};

const OFFSET_MS = 5 * 60 * 60 * 1000;
const canManage = (role: Role) => role === Role.DIRECTOR || role === Role.OPERATIONS_DIRECTOR;

export function kpiMonthRange(value?: string) {
  const local = new Date(Date.now() + OFFSET_MS);
  const key = value ?? local.toISOString().slice(0, 7);
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) throw new Error("INVALID_MONTH");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2200 || month < 1 || month > 12) throw new Error("INVALID_MONTH");
  return {
    key,
    year,
    month,
    start: new Date(Date.UTC(year, month - 1, 1) - OFFSET_MS),
    end: new Date(Date.UTC(year, month, 1) - OFFSET_MS),
  };
}

function effectiveRole(role: Role | null, position: string): Role | null {
  if (/замер/i.test(position)) return Role.MEASURER;
  return role;
}

function completion(actual: number | null, target: number | null) {
  return actual === null || target === null || target <= 0
    ? null
    : Math.round((actual / target) * 10_000) / 100;
}

export async function getEmployeeKpi(monthValue: string | undefined, actor: KpiActor) {
  const period = kpiMonthRange(monthValue);
  const companyId = requireTenantIdentity().companyId;
  const manager = canManage(actor.role);
  const [profiles, storedTargets, requests, tasks, measurements, productions, installations, managerSales] = await Promise.all([
    prisma.employeePayrollProfile.findMany({
      where: {
        companyId,
        active: true,
        OR: [{ terminatedAt: null }, { terminatedAt: { gte: period.start } }],
        ...(manager ? {} : { userId: actor.userId }),
      },
      select: { id: true, userId: true, name: true, position: true, user: { select: { name: true, role: true, active: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.employeeKpiTarget.findMany({
      where: { companyId, year: period.year, month: period.month, ...(manager ? {} : { employee: { userId: actor.userId } }) },
      orderBy: { id: "asc" },
    }),
    prisma.employeeKpiRequest.findMany({
      where: { companyId, year: period.year, month: period.month, ...(manager ? {} : { employee: { userId: actor.userId } }) },
      include: { requestedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.calendarTask.groupBy({
      by: ["assigneeId"],
      where: { companyId, status: "COMPLETED", completedAt: { gte: period.start, lt: period.end } },
      _count: { _all: true },
    }),
    prisma.measurement.groupBy({
      by: ["measurerUserId"],
      where: { companyId, completedAt: { gte: period.start, lt: period.end }, measurerUserId: { not: null } },
      _count: { _all: true },
    }),
    prisma.production.groupBy({
      by: ["masterUserId"],
      where: { companyId, completedAt: { gte: period.start, lt: period.end }, masterUserId: { not: null }, archivedAt: null },
      _count: { _all: true },
    }),
    prisma.orderInstallation.groupBy({
      by: ["installerUserId"],
      where: { completedAt: { gte: period.start, lt: period.end }, order: { companyId, deletedAt: null } },
      _count: { _all: true },
    }),
    getManagerMonthlySales({ companyId, start: period.start, end: period.end }),
  ]);
  const salesByUser = new Map(managerSales.rows.map((row) => [row.userId, row]));
  const rows = profiles.map((profile) => {
    const role = effectiveRole(profile.user?.role ?? null, profile.position);
    const userId = profile.userId;
    const definitions: MetricDefinition[] = [{
      code: "tasks_completed",
      title: "Выполненные задачи",
      unit: EmployeeKpiUnit.COUNT,
      actual: tasks.find((item) => item.assigneeId === userId)?._count._all ?? 0,
      source: "Календарь · дата завершения",
    }];
    if (role === Role.MANAGER) {
      const sales = userId ? salesByUser.get(userId) : undefined;
      definitions.push(
        { code: "leads", title: "Новые обращения", unit: EmployeeKpiUnit.COUNT, actual: sales?.leads ?? 0, source: "CRM · дата создания обращения" },
        { code: "orders", title: "Оформленные заказы", unit: EmployeeKpiUnit.COUNT, actual: sales?.orders ?? 0, source: "Заказы · подтверждённая дата оформления" },
        { code: "sales", title: "Продажи", unit: EmployeeKpiUnit.MONEY, actual: sales?.sales ?? 0, source: "Заказы · подтверждённая дата оформления" },
      );
    } else if (role === Role.MEASURER) {
      definitions.push({ code: "measurements_completed", title: "Завершённые замеры", unit: EmployeeKpiUnit.COUNT, actual: measurements.find((item) => item.measurerUserId === userId)?._count._all ?? 0, source: "Замеры · дата завершения" });
    } else if (role === Role.PRODUCTION) {
      definitions.push({ code: "production_completed", title: "Завершённые работы", unit: EmployeeKpiUnit.COUNT, actual: productions.find((item) => item.masterUserId === userId)?._count._all ?? 0, source: "Производство · дата завершения" });
    } else if (role === Role.INSTALLER) {
      definitions.push({ code: "installations_completed", title: "Завершённые монтажи", unit: EmployeeKpiUnit.COUNT, actual: installations.find((item) => item.installerUserId === userId)?._count._all ?? 0, source: "Монтаж · дата завершения" });
    }
    const ownTargets = storedTargets.filter((target) => target.employeeId === profile.id);
    const metrics: KpiMetric[] = definitions.map((definition) => {
      const target = ownTargets.find((item) => item.metricCode === definition.code);
      const planned = target ? Number(target.target) : null;
      return {
        ...definition,
        kind: EmployeeKpiKind.AUTO,
        target: planned,
        completionPercent: completion(definition.actual, planned),
        evidence: null as string | null,
      };
    });
    for (const target of ownTargets.filter((item) => item.kind === EmployeeKpiKind.CUSTOM)) {
      const actual = target.manualActual === null ? null : Number(target.manualActual);
      const planned = Number(target.target);
      metrics.push({
        code: target.metricCode,
        title: target.title,
        kind: EmployeeKpiKind.CUSTOM,
        unit: target.unit,
        actual,
        target: planned,
        completionPercent: completion(actual, planned),
        source: "Факт внесён директором",
        evidence: target.evidence,
      });
    }
    const planned = metrics.filter((metric) => metric.target !== null);
    const request = requests.find((item) => item.employeeId === profile.id);
    return {
      employeeId: profile.id,
      userId,
      name: profile.user?.name || profile.name,
      position: profile.position || role || "Должность не указана",
      role,
      metrics,
      summary: {
        planned: planned.length,
        achieved: planned.filter((metric) => metric.completionPercent !== null && metric.completionPercent >= 100).length,
        missing: metrics.length - planned.length,
      },
      request: request ? { id: request.id, status: request.status, note: request.note, requestedBy: request.requestedBy.name } : null,
    };
  });
  return {
    month: period.key,
    canManage: manager,
    rows,
    requests: manager ? requests.map((request) => ({
      id: request.id,
      employeeId: request.employeeId,
      employeeName: rows.find((row) => row.employeeId === request.employeeId)?.name ?? "Сотрудник",
      status: request.status,
      note: request.note,
      requestedBy: request.requestedBy.name,
    })) : [],
  };
}

export async function saveEmployeeKpiTarget(input: {
  month: string;
  employeeId: number;
  code: string;
  title?: string;
  kind: EmployeeKpiKind;
  unit: EmployeeKpiUnit;
  target: number;
  actual?: number | null;
  evidence?: string | null;
}, actor: KpiActor) {
  if (!canManage(actor.role)) throw new Error("FORBIDDEN");
  const period = kpiMonthRange(input.month);
  const companyId = requireTenantIdentity().companyId;
  const profile = await prisma.employeePayrollProfile.findFirst({ where: { id: input.employeeId, companyId, active: true }, select: { id: true } });
  if (!profile) throw new Error("INVALID_EMPLOYEE");
  if (!Number.isFinite(input.target) || input.target <= 0 || input.target > 999_999_999_999) throw new Error("INVALID_TARGET");
  const current = await getEmployeeKpi(input.month, actor);
  const metric = current.rows.find((row) => row.employeeId === input.employeeId)?.metrics.find((row) => row.code === input.code);
  const isCustom = input.kind === EmployeeKpiKind.CUSTOM;
  if (isCustom && (!input.code.startsWith("custom:") || !input.title?.trim() || input.title.trim().length > 120)) throw new Error("INVALID_METRIC");
  if (!isCustom && (!metric || metric.kind !== EmployeeKpiKind.AUTO || metric.unit !== input.unit)) throw new Error("INVALID_METRIC");
  const actual = input.actual ?? null;
  if (isCustom && actual !== null && (!Number.isFinite(actual) || actual < 0 || !input.evidence?.trim())) throw new Error("INVALID_ACTUAL");
  if (!isCustom && actual !== null) throw new Error("INVALID_ACTUAL");
  await prisma.$transaction(async (tx) => {
    await tx.employeeKpiTarget.upsert({
      where: { companyId_employeeId_year_month_metricCode: { companyId, employeeId: input.employeeId, year: period.year, month: period.month, metricCode: input.code } },
      create: {
        companyId,
        employeeId: input.employeeId,
        year: period.year,
        month: period.month,
        metricCode: input.code,
        title: isCustom ? input.title!.trim() : metric!.title,
        kind: input.kind,
        unit: input.unit,
        target: input.target,
        manualActual: isCustom ? actual : null,
        evidence: isCustom ? input.evidence?.trim() || null : null,
        updatedById: actor.userId,
      },
      update: {
        title: isCustom ? input.title!.trim() : metric!.title,
        kind: input.kind,
        unit: input.unit,
        target: input.target,
        manualActual: isCustom ? actual : null,
        evidence: isCustom ? input.evidence?.trim() || null : null,
        updatedById: actor.userId,
      },
    });
    await tx.employeeKpiRequest.updateMany({
      where: { companyId, employeeId: input.employeeId, year: period.year, month: period.month, status: EmployeeKpiRequestStatus.OPEN },
      data: { status: EmployeeKpiRequestStatus.FULFILLED, resolvedById: actor.userId, resolvedAt: new Date() },
    });
  });
  return getEmployeeKpi(input.month, actor);
}

export async function deleteEmployeeKpiTarget(input: { month: string; employeeId: number; code: string }, actor: KpiActor) {
  if (!canManage(actor.role)) throw new Error("FORBIDDEN");
  const period = kpiMonthRange(input.month);
  const companyId = requireTenantIdentity().companyId;
  await prisma.employeeKpiTarget.deleteMany({ where: { companyId, employeeId: input.employeeId, year: period.year, month: period.month, metricCode: input.code } });
  return getEmployeeKpi(input.month, actor);
}

export async function requestEmployeeKpi(month: string, employeeId: number, note: string, actor: KpiActor) {
  const period = kpiMonthRange(month);
  const companyId = requireTenantIdentity().companyId;
  const profile = await prisma.employeePayrollProfile.findFirst({
    where: { id: employeeId, companyId, active: true, ...(canManage(actor.role) ? {} : { userId: actor.userId }) },
    select: { id: true },
  });
  if (!profile) throw new Error("FORBIDDEN");
  const existingTarget = await prisma.employeeKpiTarget.count({ where: { companyId, employeeId, year: period.year, month: period.month } });
  if (existingTarget > 0) throw new Error("PLAN_EXISTS");
  await prisma.employeeKpiRequest.upsert({
    where: { companyId_employeeId_year_month: { companyId, employeeId, year: period.year, month: period.month } },
    create: { companyId, employeeId, year: period.year, month: period.month, requestedById: actor.userId, note: note.trim().slice(0, 500) || null },
    update: { status: EmployeeKpiRequestStatus.OPEN, note: note.trim().slice(0, 500) || null, requestedById: actor.userId, resolvedById: null, resolvedAt: null },
  });
  return getEmployeeKpi(month, actor);
}
