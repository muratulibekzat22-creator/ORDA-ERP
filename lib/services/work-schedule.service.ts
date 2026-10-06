import { CalendarTaskStatus, CalendarTaskWorkflow } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";
import { DEFAULT_WEEKLY_DAY_OFF, isWeeklyDayOff, validWeeklyDayOff, weekdayLabel } from "@/lib/work-schedule";

const ACTIVE_REPORT_STATUSES = [CalendarTaskStatus.PLANNED, CalendarTaskStatus.IN_PROGRESS] as const;

function reportDateKey(workflowKey: string | null) {
  const match = workflowKey?.match(/^daily-crm:(\d{4}-\d{2}-\d{2}):\d+$/);
  return match?.[1] ?? null;
}

export async function getWorkScheduleSettings() {
  const { companyId } = requireTenantIdentity();
  const settings = await prisma.systemSettings.findUnique({
    where: { companyId },
    select: { weeklyDayOff: true },
  });
  const weeklyDayOff = settings?.weeklyDayOff ?? DEFAULT_WEEKLY_DAY_OFF;
  return { weeklyDayOff, weeklyDayOffLabel: weekdayLabel(weeklyDayOff) };
}

export async function updateWorkScheduleSettings(value: unknown, actorId: number) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "")
    throw new Error("INVALID_WEEKLY_DAY_OFF");
  const weeklyDayOff = Number(value);
  if (!validWeeklyDayOff(weeklyDayOff)) throw new Error("INVALID_WEEKLY_DAY_OFF");
  const { companyId } = requireTenantIdentity();
  return prisma.$transaction(async (tx) => {
    const settings = await tx.systemSettings.upsert({
      where: { companyId },
      create: { weeklyDayOff },
      update: { weeklyDayOff },
      select: { weeklyDayOff: true },
    });
    const activeReports = await tx.calendarTask.findMany({
      where: {
        companyId,
        workflow: CalendarTaskWorkflow.DAILY_CRM_REPORT,
        status: { in: [...ACTIVE_REPORT_STATUSES] },
      },
      select: { id: true, workflowKey: true, status: true },
    });
    const cancelled = activeReports.filter((task) => {
      const dateKey = reportDateKey(task.workflowKey);
      return dateKey ? isWeeklyDayOff(dateKey, weeklyDayOff) : false;
    });
    if (cancelled.length) {
      const now = new Date();
      await tx.calendarTask.updateMany({
        where: { id: { in: cancelled.map((task) => task.id) } },
        data: { status: CalendarTaskStatus.CANCELLED, cancelledAt: now },
      });
      await tx.calendarTaskAudit.createMany({
        data: cancelled.map((task) => ({
          taskId: task.id,
          action: "WEEKLY_DAY_OFF_APPLIED",
          actorId,
          before: { status: task.status },
          after: { status: CalendarTaskStatus.CANCELLED, weeklyDayOff, reportRequired: false },
        })),
      });
    }
    return {
      weeklyDayOff: settings.weeklyDayOff,
      weeklyDayOffLabel: weekdayLabel(settings.weeklyDayOff),
      cancelledReportTasks: cancelled.length,
    };
  });
}
