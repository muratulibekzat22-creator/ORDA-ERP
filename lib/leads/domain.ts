import { LeadLostReason, LeadNextActionType, LeadSource, LeadStage, Role } from "@prisma/client";

export const OPEN_LEAD_STAGES = [
  LeadStage.NEW,
  LeadStage.QUALIFIED,
  LeadStage.CALCULATION_READY,
  LeadStage.PROPOSAL_SENT,
  LeadStage.FOLLOW_UP,
  LeadStage.MEASUREMENT_SCHEDULED,
  LeadStage.MEASUREMENT_COMPLETED,
  LeadStage.NEGOTIATION,
] as const;

export const ACTION_REQUIRED_STAGES = OPEN_LEAD_STAGES.filter((stage) => stage !== LeadStage.NEW);
export const TERMINAL_LEAD_STAGES = [LeadStage.WON, LeadStage.LOST] as const;

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  NEW: "Новое обращение",
  QUALIFIED: "Квалифицирован",
  CALCULATION_READY: "Расчёт готов",
  PROPOSAL_SENT: "КП отправлено",
  FOLLOW_UP: "Повторный контакт",
  MEASUREMENT_SCHEDULED: "Замер назначен",
  MEASUREMENT_COMPLETED: "Замер проведён",
  NEGOTIATION: "Согласование",
  WON: "Выиграно",
  LOST: "Проиграно",
};

export const NEXT_ACTION_LABELS: Record<LeadNextActionType, string> = {
  CALL: "Позвонить", WHATSAPP: "Написать WhatsApp", FOLLOW_UP: "Повторный контакт",
  MEASUREMENT: "Замер", MEETING: "Встреча", CALCULATION: "Подготовить расчёт",
  PROPOSAL: "Отправить КП", OTHER: "Другое",
};

export const LOST_REASON_LABELS: Record<LeadLostReason, string> = {
  EXPENSIVE: "Дорого", NO_RESPONSE: "Не отвечает", COMPETITOR: "Выбрал конкурента",
  POSTPONED: "Отложил", NO_BUDGET: "Нет бюджета", NOT_RELEVANT: "Неактуально",
  LOCATION: "Регион/локация", TIMING: "Не подходит срок", OTHER: "Другое",
};

export function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

export function normalizeLeadSource(value: unknown): LeadSource | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (Object.values(LeadSource).includes(normalized as LeadSource)) return normalized as LeadSource;
  const legacy = value.trim().toLowerCase();
  if (legacy.includes("whatsapp") || legacy.includes("ватсап")) return LeadSource.WHATSAPP;
  if (legacy.includes("instagram")) return LeadSource.INSTAGRAM;
  if (legacy.includes("звон")) return LeadSource.CALL;
  if (legacy.includes("сайт")) return LeadSource.WEBSITE;
  if (legacy.includes("рекомен")) return LeadSource.REFERRAL;
  if (legacy.includes("офис")) return LeadSource.OFFICE;
  if (legacy.includes("повтор")) return LeadSource.REPEAT;
  return legacy ? LeadSource.OTHER : null;
}

export function canAccessLead(role: Role, userId: number, lead: { managerUserId: number | null }) {
  return role === Role.DIRECTOR || (role === Role.MANAGER && lead.managerUserId === userId);
}

export function requiresNextAction(stage: LeadStage) {
  return (ACTION_REQUIRED_STAGES as readonly LeadStage[]).includes(stage);
}

export function isTerminalStage(stage: LeadStage) {
  return (TERMINAL_LEAD_STAGES as readonly LeadStage[]).includes(stage);
}

export function parseEnum<T extends string>(values: readonly T[], value: unknown): T | null {
  return typeof value === "string" && values.includes(value as T) ? value as T : null;
}
