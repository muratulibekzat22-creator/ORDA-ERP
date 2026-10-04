import {
  ManagementMarketingReportPeriod,
  ManagementMarketingReportStatus,
  ManagementMarketingTaskStatus,
  RecruitmentVacancyStatus,
  Role,
} from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { MetaAdsSyncError, metaAdsIntegrationStatus, syncMetaAdsMonth } from "@/lib/integrations/meta-ads";
import { effectiveMarketingMetrics, marketingMonthRange } from "@/lib/marketing";
import { requirePermission } from "@/lib/server-auth";
import { getDailyCrmSnapshot } from "@/lib/services/daily-operations.service";
import { getMarketingAnalytics } from "@/lib/services/marketing-analytics.service";
import { getManagerMonthlySales } from "@/lib/services/manager-monthly-sales.service";

const canUseMarketing = (role: Role) =>
  role === Role.DIRECTOR ||
  role === Role.OPERATIONS_DIRECTOR ||
  role === Role.MARKETER;
const canReviewMarketing = (role: Role) =>
  role === Role.DIRECTOR || role === Role.OPERATIONS_DIRECTOR;
const text = (value: unknown, max = 1000) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const money = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const count = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

export async function GET(request: Request) {
  const auth = await requirePermission("marketing");
  if (auth.response) return auth.response;
  const role = (auth.session!.user.accountRole || auth.session!.user.role) as Role;
  if (!canUseMarketing(role))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const requestedMonth = new URL(request.url).searchParams.get("month") ?? undefined;
  if (requestedMonth && !/^\d{4}-\d{2}$/.test(requestedMonth))
    return NextResponse.json({ error: "Некорректный месяц" }, { status: 400 });
  const month = marketingMonthRange(requestedMonth);
  const companyId = Number(auth.session!.user.companyId);
  const [tasks, metrics, reports, assignees, dailyCrm, managerSales] = await Promise.all([
    prisma.managementMarketingTask.findMany({
      where: { companyId },
      include: {
        assignee: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: [{ status: "asc" }, { priority: "desc" }, { dueAt: "asc" }],
    }),
    prisma.managementMarketingMetric.findMany({
      where: { companyId, metricMonth: { gte: month.start, lt: month.end } },
      orderBy: [{ metricMonth: "desc" }, { channel: "asc" }],
    }),
    prisma.managementMarketingReport.findMany({
      where: { companyId, periodStart: { lt: month.end }, periodEnd: { gte: month.start } },
      include: {
        author: { select: { id: true, name: true, role: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ periodEnd: "desc" }, { submittedAt: "desc" }],
    }),
    prisma.user.findMany({
      where: {
        companyId,
        active: true,
        role: { in: [Role.OPERATIONS_DIRECTOR, Role.MARKETER, Role.MANAGER] },
      },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
    getDailyCrmSnapshot(),
    getManagerMonthlySales({ companyId, start: month.start, end: month.end }),
  ]);
  const effectiveMetrics = effectiveMarketingMetrics(metrics);
  const summary = await getMarketingAnalytics({
    companyId,
    start: month.start,
    end: month.end,
    metrics,
  });
  const integrationStatus = metaAdsIntegrationStatus();
  return NextResponse.json({
    role,
    month: month.key,
    tasks,
    metrics: effectiveMetrics,
    reports,
    assignees,
    dailyCrm,
    managerSales,
    integration: {
      ...integrationStatus,
      state: !integrationStatus.configured
        ? "NEEDS_SETUP"
        : metrics.some((metric) => metric.channel === "Instagram / Meta" && metric.note?.startsWith("Автосинхронизация Meta"))
          ? "ACTIVE"
          : "READY",
      lastSyncedAt: metrics.find((metric) => metric.channel === "Instagram / Meta" && metric.note?.startsWith("Автосинхронизация Meta"))?.updatedAt ?? null,
    },
    summary: {
      ...summary,
    },
  });
}

export async function POST(request: Request) {
  const auth = await requirePermission("marketing");
  if (auth.response) return auth.response;
  const role = (auth.session!.user.accountRole || auth.session!.user.role) as Role;
  if (!canUseMarketing(role))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const companyId = Number(auth.session!.user.companyId);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = text(body.action, 40);
    if (action === "sync-meta") {
      const month = text(body.month, 7);
      return NextResponse.json(await syncMetaAdsMonth({ actorId: Number(auth.session!.user.id), month: month || undefined }));
    }
    if (action === "task") {
      const title = text(body.title, 200);
      const priority = count(body.priority);
      const assigneeId = body.assigneeId ? Number(body.assigneeId) : null;
      const dueAt = body.dueAt ? new Date(String(body.dueAt)) : null;
      if (!title || priority === null || priority > 3 || (dueAt && Number.isNaN(dueAt.getTime())))
        return NextResponse.json({ error: "Проверьте задачу" }, { status: 400 });
      if (assigneeId) {
        const assignee = await prisma.user.findFirst({ where: { id: assigneeId, companyId, active: true }, select: { id: true } });
        if (!assignee) return NextResponse.json({ error: "Ответственный не найден" }, { status: 400 });
      }
      return NextResponse.json(
        await prisma.managementMarketingTask.create({
          data: {
            companyId,
            title,
            description: text(body.description, 2000) || null,
            priority,
            dueAt,
            assigneeId: Number.isInteger(assigneeId) && assigneeId! > 0 ? assigneeId : null,
            createdById: Number(auth.session!.user.id),
          },
        }),
        { status: 201 },
      );
    }
    if (action === "report") {
      const periodType = body.periodType as ManagementMarketingReportPeriod;
      const periodStart = text(body.periodStart, 10);
      const periodEnd = text(body.periodEnd, 10);
      const start = /^\d{4}-\d{2}-\d{2}$/.test(periodStart) ? new Date(`${periodStart}T00:00:00.000Z`) : null;
      const end = /^\d{4}-\d{2}-\d{2}$/.test(periodEnd) ? new Date(`${periodEnd}T00:00:00.000Z`) : null;
      const workCompleted = text(body.workCompleted, 4000);
      const resultSummary = text(body.resultSummary, 4000);
      const bestResult = text(body.bestResult, 2000);
      const problems = text(body.problems, 2000);
      const nextActions = text(body.nextActions, 4000);
      const creativesPublished = count(body.creativesPublished);
      const qualifiedLeads = count(body.qualifiedLeads);
      const unqualifiedLeads = count(body.unqualifiedLeads);
      if (
        !Object.values(ManagementMarketingReportPeriod).includes(periodType) ||
        !start || !end || end < start ||
        !workCompleted || !resultSummary || !bestResult || !problems || !nextActions ||
        [creativesPublished, qualifiedLeads, unqualifiedLeads].some((value) => value === null)
      ) return NextResponse.json({ error: "Заполните все поля отчёта" }, { status: 400 });
      const report = await prisma.managementMarketingReport.upsert({
        where: {
          companyId_authorId_periodType_periodStart_periodEnd: {
            companyId,
            authorId: Number(auth.session!.user.id),
            periodType,
            periodStart: start,
            periodEnd: end,
          },
        },
        create: {
          companyId,
          authorId: Number(auth.session!.user.id),
          periodType,
          periodStart: start,
          periodEnd: end,
          workCompleted,
          resultSummary,
          bestResult,
          problems,
          nextActions,
          creativesPublished: creativesPublished!,
          qualifiedLeads: qualifiedLeads!,
          unqualifiedLeads: unqualifiedLeads!,
        },
        update: {
          workCompleted,
          resultSummary,
          bestResult,
          problems,
          nextActions,
          creativesPublished: creativesPublished!,
          qualifiedLeads: qualifiedLeads!,
          unqualifiedLeads: unqualifiedLeads!,
          status: ManagementMarketingReportStatus.SUBMITTED,
          directorComment: null,
          reviewedById: null,
          reviewedAt: null,
          submittedAt: new Date(),
        },
      });
      return NextResponse.json(report, { status: 201 });
    }
    if (action === "metric") {
      const channel = text(body.channel, 120);
      if (/instagram|meta|facebook/i.test(channel))
        return NextResponse.json({ error: "Показатели Meta загружаются автоматически; ручной ввод отключён" }, { status: 409 });
      const metricMonth = body.metricMonth
        ? new Date(`${String(body.metricMonth).slice(0, 7)}-01T00:00:00+05:00`)
        : new Date();
      const spend = money(body.spend), revenue = money(body.revenue);
      const leads = count(body.leads), orders = count(body.orders);
      if (!channel || [spend, revenue, leads, orders].some((value) => value === null) || Number.isNaN(metricMonth.getTime()))
        return NextResponse.json({ error: "Проверьте показатели" }, { status: 400 });
      const result = await prisma.$transaction(async (tx) => {
        const metric = await tx.managementMarketingMetric.upsert({
          where: { companyId_metricMonth_channel: { companyId: Number(auth.session!.user.companyId), metricMonth, channel } },
          create: { metricMonth, channel, spend: spend!, leads: leads!, orders: orders!, revenue: revenue!, note: text(body.note, 1000) || null, createdById: Number(auth.session!.user.id) },
          update: { spend: spend!, leads: leads!, orders: orders!, revenue: revenue!, note: text(body.note, 1000) || null },
        });
        await tx.companyLedgerEntry.upsert({
          where: { idempotencyKey: `marketing-metric:${metric.id}` },
          create: {
            type: "MARKETING_SPEND",
            category: "ADVERTISING",
            direction: "EXPENSE",
            source: "MANUAL",
            amount: spend!,
            operationDate: metricMonth,
            comment: `Реклама · ${channel}`,
            authorId: Number(auth.session!.user.id),
            affectsProfit: true,
            idempotencyKey: `marketing-metric:${metric.id}`,
          },
          update: {
            amount: spend!,
            operationDate: metricMonth,
            comment: `Реклама · ${channel}`,
            authorId: Number(auth.session!.user.id),
            affectsProfit: true,
            voidedAt: null,
            voidReason: null,
          },
        });
        return metric;
      });
      return NextResponse.json(result, { status: 201 });
    }
    if (action === "vacancy") {
      if (!canReviewMarketing(role)) return NextResponse.json({ error: "Найм ведёт директор" }, { status: 403 });
      const title = text(body.title, 200);
      if (!title) return NextResponse.json({ error: "Укажите вакансию" }, { status: 400 });
      return NextResponse.json(
        await prisma.recruitmentVacancy.create({
          data: { companyId, title, note: text(body.note, 2000) || null, createdById: Number(auth.session!.user.id) },
        }),
        { status: 201 },
      );
    }
    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    if (error instanceof MetaAdsSyncError) {
      const messages: Record<string, string> = {
        META_NOT_CONFIGURED: "Нужно подключить служебный доступ Meta и указать ID кампаний",
        META_EXCHANGE_RATE_UNAVAILABLE: "Не удалось получить курс валюты НБК",
        META_SYNC_FORBIDDEN: "Недостаточно прав для синхронизации Meta",
      };
      return NextResponse.json({ error: messages[error.message] ?? "Meta временно не отдала показатели" }, { status: error.message === "META_NOT_CONFIGURED" ? 503 : 502 });
    }
    return NextResponse.json({ error: "Не удалось сохранить" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requirePermission("marketing");
  if (auth.response) return auth.response;
  const role = (auth.session!.user.accountRole || auth.session!.user.role) as Role;
  if (!canUseMarketing(role))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const companyId = Number(auth.session!.user.companyId);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0)
      return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
    if (body.action === "task-status" && Object.values(ManagementMarketingTaskStatus).includes(body.status as ManagementMarketingTaskStatus)) {
      const result = await prisma.managementMarketingTask.updateMany({ where: { id, companyId }, data: { status: body.status as ManagementMarketingTaskStatus } });
      if (!result.count) return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });
      return NextResponse.json(await prisma.managementMarketingTask.findFirstOrThrow({ where: { id, companyId } }));
    }
    if (body.action === "vacancy-status" && Object.values(RecruitmentVacancyStatus).includes(body.status as RecruitmentVacancyStatus)) {
      if (!canReviewMarketing(role)) return NextResponse.json({ error: "Найм ведёт директор" }, { status: 403 });
      const candidates = count(body.candidates);
      const result = await prisma.recruitmentVacancy.updateMany({ where: { id, companyId }, data: { status: body.status as RecruitmentVacancyStatus, ...(candidates === null ? {} : { candidates }) } });
      if (!result.count) return NextResponse.json({ error: "Вакансия не найдена" }, { status: 404 });
      return NextResponse.json(await prisma.recruitmentVacancy.findFirstOrThrow({ where: { id, companyId } }));
    }
    if (body.action === "report-review") {
      if (!canReviewMarketing(role)) return NextResponse.json({ error: "Проверка доступна директору" }, { status: 403 });
      const status = body.status as ManagementMarketingReportStatus;
      if (status !== ManagementMarketingReportStatus.APPROVED && status !== ManagementMarketingReportStatus.NEEDS_REVISION)
        return NextResponse.json({ error: "Некорректный статус отчёта" }, { status: 400 });
      const directorComment = text(body.directorComment, 3000);
      if (status === ManagementMarketingReportStatus.NEEDS_REVISION && !directorComment)
        return NextResponse.json({ error: "Укажите, что нужно доработать" }, { status: 400 });
      const result = await prisma.managementMarketingReport.updateMany({
        where: { id, companyId },
        data: {
          status,
          directorComment: directorComment || null,
          reviewedById: Number(auth.session!.user.id),
          reviewedAt: new Date(),
        },
      });
      if (!result.count) return NextResponse.json({ error: "Отчёт не найден" }, { status: 404 });
      return NextResponse.json(await prisma.managementMarketingReport.findFirstOrThrow({ where: { id, companyId } }));
    }
    return NextResponse.json({ error: "Некорректное изменение" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Не удалось обновить" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requirePermission("marketing");
  if (auth.response) return auth.response;
  const role = (auth.session!.user.accountRole || auth.session!.user.role) as Role;
  if (!canUseMarketing(role))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  if (!canReviewMarketing(role))
    return NextResponse.json({ error: "Удаление доступно директору" }, { status: 403 });
  const companyId = Number(auth.session!.user.companyId);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = Number(body.id);
    const action = text(body.action, 40);
    if (!Number.isInteger(id) || id <= 0)
      return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
    let deleted = 0;
    if (action === "task")
      deleted = (await prisma.managementMarketingTask.deleteMany({ where: { id, companyId } })).count;
    else if (action === "metric") {
      const metric = await prisma.managementMarketingMetric.findFirst({ where: { id, companyId }, select: { id: true } });
      if (metric) {
        await prisma.$transaction([
          prisma.companyLedgerEntry.deleteMany({ where: { companyId, idempotencyKey: `marketing-metric:${id}` } }),
          prisma.managementMarketingMetric.deleteMany({ where: { id, companyId } }),
        ]);
        deleted = 1;
      }
    } else if (action === "report")
      deleted = (await prisma.managementMarketingReport.deleteMany({ where: { id, companyId } })).count;
    else if (action === "vacancy")
      deleted = (await prisma.recruitmentVacancy.deleteMany({ where: { id, companyId } })).count;
    else
      return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
    if (!deleted) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Не удалось удалить" }, { status: 500 });
  }
}
