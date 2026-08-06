import { LeadLostReason, LeadNextActionType, LeadStage, Prisma, Role } from "@prisma/client";

import { canAccessLead, isTerminalStage, requiresNextAction } from "@/lib/leads/domain";
import { prisma } from "@/lib/prisma";

export type LeadActor = { userId: number; name: string; role: Role };

export class LeadError extends Error {
  constructor(public code: "NOT_FOUND" | "FORBIDDEN" | "NEXT_ACTION_REQUIRED" | "LOST_REASON_REQUIRED" | "LOST_COMMENT_REQUIRED" | "INVALID" | "ACTION_NOT_FOUND" | "ACTION_ALREADY_COMPLETED" | "NEXT_ACTION_AFTER_COMPLETION_REQUIRED" | "ALREADY_CONVERTED") { super(code); }
}

const activeActionWhere = { completedAt: null } as const;

async function accessibleLead(tx: Prisma.TransactionClient, id: number, actor: LeadActor) {
  const lead = await tx.client.findUnique({ where: { id }, select: { id: true, stage: true, managerUserId: true } });
  if (!lead || !canAccessLead(actor.role, actor.userId, lead)) throw new LeadError("NOT_FOUND");
  return lead;
}

export async function transitionLead(input: { clientId: number; stage: LeadStage; comment?: string; lostReason?: LeadLostReason; lostComment?: string; nextAction?: { type: LeadNextActionType; at: Date; comment?: string }; actor: LeadActor }) {
  return prisma.$transaction(async (tx) => {
    const lead = await accessibleLead(tx, input.clientId, input.actor);
    if (input.stage === LeadStage.LOST && !input.lostReason) throw new LeadError("LOST_REASON_REQUIRED");
    if (input.stage === LeadStage.LOST && input.lostReason === LeadLostReason.OTHER && !input.lostComment?.trim()) throw new LeadError("LOST_COMMENT_REQUIRED");
    const existingAction = await tx.leadNextAction.findFirst({ where: { clientId: input.clientId, ...activeActionWhere }, select: { id: true } });
    if (requiresNextAction(input.stage) && !existingAction && !input.nextAction) throw new LeadError("NEXT_ACTION_REQUIRED");
    if (input.nextAction && (!Number.isFinite(input.nextAction.at.getTime()) || input.nextAction.at <= new Date())) throw new LeadError("INVALID");
    const updated = await tx.client.update({ where: { id: input.clientId }, data: {
      stage: input.stage,
      status: input.stage,
      ...(input.stage === LeadStage.LOST ? { lostReason: input.lostReason, lostComment: input.lostComment?.trim() || null, lostAt: new Date(), lostByUserId: input.actor.userId } : { lostReason: null, lostComment: null, lostAt: null, lostByUserId: null }),
    } });
    await tx.leadStatusHistory.create({ data: { clientId: input.clientId, fromStatus: lead.stage, toStatus: input.stage, fromStage: lead.stage, toStage: input.stage, authorId: input.actor.userId, authorName: input.actor.name, comment: input.comment?.trim() || null } });
    if (isTerminalStage(input.stage)) await tx.leadNextAction.updateMany({ where: { clientId: input.clientId, completedAt: null }, data: { completedAt: new Date(), completedByUserId: input.actor.userId, resultComment: `Закрыто при переходе в ${input.stage}` } });
    if (input.nextAction && !isTerminalStage(input.stage)) await tx.leadNextAction.create({ data: { clientId: input.clientId, nextActionType: input.nextAction.type, nextActionAt: input.nextAction.at, nextActionComment: input.nextAction.comment?.trim() || null, createdByUserId: input.actor.userId } });
    return updated;
  });
}

export async function createNextAction(input: { clientId: number; type: LeadNextActionType; at: Date; comment?: string; actor: LeadActor }) {
  if (!Number.isFinite(input.at.getTime()) || input.at <= new Date()) throw new LeadError("INVALID");
  return prisma.$transaction(async (tx) => {
    const lead = await accessibleLead(tx, input.clientId, input.actor);
    if (isTerminalStage(lead.stage)) throw new LeadError("INVALID");
    await tx.leadNextAction.updateMany({ where: { clientId: input.clientId, completedAt: null }, data: { completedAt: new Date(), completedByUserId: input.actor.userId, resultComment: "Заменено новым действием" } });
    return tx.leadNextAction.create({ data: { clientId: input.clientId, nextActionType: input.type, nextActionAt: input.at, nextActionComment: input.comment?.trim() || null, createdByUserId: input.actor.userId } });
  });
}

export async function completeNextAction(input: { clientId: number; actionId: number; resultComment?: string; nextAction?: { type: LeadNextActionType; at: Date; comment?: string }; actor: LeadActor }) {
  return prisma.$transaction(async (tx) => {
    const lead = await accessibleLead(tx, input.clientId, input.actor);
    const action = await tx.leadNextAction.findFirst({ where: { id: input.actionId, clientId: input.clientId } });
    if (!action) throw new LeadError("ACTION_NOT_FOUND");
    if (action.completedAt) throw new LeadError("ACTION_ALREADY_COMPLETED");
    if (!isTerminalStage(lead.stage) && !input.nextAction) throw new LeadError("NEXT_ACTION_AFTER_COMPLETION_REQUIRED");
    if (input.nextAction && (!Number.isFinite(input.nextAction.at.getTime()) || input.nextAction.at <= new Date())) throw new LeadError("INVALID");
    await tx.leadNextAction.update({ where: { id: action.id }, data: { completedAt: new Date(), completedByUserId: input.actor.userId, resultComment: input.resultComment?.trim() || null } });
    return input.nextAction ? tx.leadNextAction.create({ data: { clientId: input.clientId, nextActionType: input.nextAction.type, nextActionAt: input.nextAction.at, nextActionComment: input.nextAction.comment?.trim() || null, createdByUserId: input.actor.userId } }) : action;
  });
}

export function leadErrorResponse(error: unknown) {
  if (!(error instanceof LeadError)) return null;
  const messages: Record<LeadError["code"], string> = {
    NOT_FOUND: "Заявка не найдена", FORBIDDEN: "Недостаточно прав", NEXT_ACTION_REQUIRED: "Укажите следующее действие и дату",
    LOST_REASON_REQUIRED: "Укажите причину проигрыша", LOST_COMMENT_REQUIRED: "Для причины «Другое» обязателен комментарий",
    INVALID: "Некорректные данные", ACTION_NOT_FOUND: "Действие не найдено", ACTION_ALREADY_COMPLETED: "Действие уже выполнено",
    NEXT_ACTION_AFTER_COMPLETION_REQUIRED: "Для открытой заявки необходимо назначить следующее действие", ALREADY_CONVERTED: "Заявка уже конвертирована",
  };
  return { message: messages[error.code], status: error.code === "NOT_FOUND" || error.code === "ACTION_NOT_FOUND" ? 404 : error.code === "ACTION_ALREADY_COMPLETED" || error.code === "ALREADY_CONVERTED" ? 409 : 400 };
}
