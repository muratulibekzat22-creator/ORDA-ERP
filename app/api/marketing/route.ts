import {
  ManagementMarketingTaskStatus,
  RecruitmentVacancyStatus,
  Role,
} from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { marketingMonthRange } from "@/lib/marketing";
import { requirePermission } from "@/lib/server-auth";

const canUseMarketing = (role: Role) =>
  role === Role.DIRECTOR ||
  role === Role.OPERATIONS_DIRECTOR ||
  role === Role.MARKETER;
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

export async function GET() {
  const auth = await requirePermission("marketing");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (!canUseMarketing(role))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const month = marketingMonthRange();
  const [tasks, metrics, vacancies, assignees] = await Promise.all([
    prisma.managementMarketingTask.findMany({
      include: { assignee: { select: { id: true, name: true } } },
      orderBy: [{ status: "asc" }, { priority: "desc" }, { dueAt: "asc" }],
    }),
    prisma.managementMarketingMetric.findMany({
      where: { metricMonth: { gte: month.start, lt: month.end } },
      orderBy: [{ metricMonth: "desc" }, { channel: "asc" }],
    }),
    prisma.recruitmentVacancy.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.user.findMany({
      where: {
        active: true,
        role: { in: [Role.OPERATIONS_DIRECTOR, Role.MARKETER, Role.MANAGER] },
      },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const totals = metrics.reduce(
    (sum, item) => ({
      spend: sum.spend + Number(item.spend),
      leads: sum.leads + item.leads,
      orders: sum.orders + item.orders,
      revenue: sum.revenue + Number(item.revenue),
    }),
    { spend: 0, leads: 0, orders: 0, revenue: 0 },
  );
  return NextResponse.json({
    role,
    tasks,
    metrics,
    vacancies,
    assignees,
    summary: {
      ...totals,
      cpl: totals.leads ? totals.spend / totals.leads : 0,
      cac: totals.orders ? totals.spend / totals.orders : 0,
      roas: totals.spend ? totals.revenue / totals.spend : 0,
      conversion: totals.leads ? (totals.orders / totals.leads) * 100 : 0,
    },
  });
}

export async function POST(request: Request) {
  const auth = await requirePermission("marketing");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (!canUseMarketing(role))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = text(body.action, 40);
    if (action === "task") {
      const title = text(body.title, 200);
      const priority = count(body.priority);
      const assigneeId = body.assigneeId ? Number(body.assigneeId) : null;
      const dueAt = body.dueAt ? new Date(String(body.dueAt)) : null;
      if (!title || priority === null || priority > 3 || (dueAt && Number.isNaN(dueAt.getTime())))
        return NextResponse.json({ error: "Проверьте задачу" }, { status: 400 });
      return NextResponse.json(
        await prisma.managementMarketingTask.create({
          data: {
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
    if (action === "metric") {
      const channel = text(body.channel, 120);
      const metricMonth = body.metricMonth
        ? new Date(`${String(body.metricMonth).slice(0, 7)}-01T00:00:00+05:00`)
        : new Date();
      const spend = money(body.spend), revenue = money(body.revenue);
      const leads = count(body.leads), orders = count(body.orders);
      if (!channel || [spend, revenue, leads, orders].some((value) => value === null) || Number.isNaN(metricMonth.getTime()))
        return NextResponse.json({ error: "Проверьте показатели" }, { status: 400 });
      return NextResponse.json(
        await prisma.managementMarketingMetric.upsert({
          where: { companyId_metricMonth_channel: { companyId: Number(auth.session!.user.companyId), metricMonth, channel } },
          create: { metricMonth, channel, spend: spend!, leads: leads!, orders: orders!, revenue: revenue!, note: text(body.note, 1000) || null, createdById: Number(auth.session!.user.id) },
          update: { spend: spend!, leads: leads!, orders: orders!, revenue: revenue!, note: text(body.note, 1000) || null },
        }),
        { status: 201 },
      );
    }
    if (action === "vacancy") {
      const title = text(body.title, 200);
      if (!title) return NextResponse.json({ error: "Укажите вакансию" }, { status: 400 });
      return NextResponse.json(
        await prisma.recruitmentVacancy.create({
          data: { title, note: text(body.note, 2000) || null, createdById: Number(auth.session!.user.id) },
        }),
        { status: 201 },
      );
    }
    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Не удалось сохранить" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requirePermission("marketing");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (!canUseMarketing(role))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0)
      return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
    if (body.action === "task-status" && Object.values(ManagementMarketingTaskStatus).includes(body.status as ManagementMarketingTaskStatus))
      return NextResponse.json(await prisma.managementMarketingTask.update({ where: { id }, data: { status: body.status as ManagementMarketingTaskStatus } }));
    if (body.action === "vacancy-status" && Object.values(RecruitmentVacancyStatus).includes(body.status as RecruitmentVacancyStatus)) {
      const candidates = count(body.candidates);
      return NextResponse.json(await prisma.recruitmentVacancy.update({ where: { id }, data: { status: body.status as RecruitmentVacancyStatus, ...(candidates === null ? {} : { candidates }) } }));
    }
    return NextResponse.json({ error: "Некорректное изменение" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Не удалось обновить" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requirePermission("marketing");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (!canUseMarketing(role))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = Number(body.id);
    const action = text(body.action, 40);
    if (!Number.isInteger(id) || id <= 0)
      return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
    if (action === "task")
      await prisma.managementMarketingTask.delete({ where: { id } });
    else if (action === "metric")
      await prisma.managementMarketingMetric.delete({ where: { id } });
    else if (action === "vacancy")
      await prisma.recruitmentVacancy.delete({ where: { id } });
    else
      return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Не удалось удалить" }, { status: 500 });
  }
}
