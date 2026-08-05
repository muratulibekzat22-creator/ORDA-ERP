import { Role } from "@prisma/client";

export type CalendarSourceType = "measurement" | "production";

type CalendarEventAccess = {
  sourceType: CalendarSourceType;
  assignedUserId: number | null;
  stage?: string | null;
};

const installationStage = "Монтаж";

export function isScopedCalendarRole(role: Role) {
  return role === Role.MEASURER || role === Role.PRODUCTION || role === Role.INSTALLER;
}

export function canCreateCalendarEvent(role: Role, userId: number, event: CalendarEventAccess) {
  if (role === Role.DIRECTOR || role === Role.MANAGER) return true;
  if (event.assignedUserId !== userId) return false;
  if (role === Role.MEASURER) return event.sourceType === "measurement";
  if (role === Role.PRODUCTION) return event.sourceType === "production" && event.stage !== installationStage;
  return role === Role.INSTALLER && event.sourceType === "production" && event.stage === installationStage;
}

export function canManageCalendarEvent(role: Role, userId: number, event: CalendarEventAccess) {
  if (role === Role.DIRECTOR || role === Role.MANAGER) return true;
  if (event.assignedUserId !== userId) return false;
  if (role === Role.MEASURER) return event.sourceType === "measurement";
  if (role === Role.PRODUCTION) return event.sourceType === "production" && event.stage !== installationStage;
  return role === Role.INSTALLER && event.sourceType === "production" && event.stage === installationStage;
}

export { installationStage };
