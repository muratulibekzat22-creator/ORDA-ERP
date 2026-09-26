import {
  LeadNextActionType,
  LeadStage,
  type Prisma,
} from "@prisma/client";

const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

export const PROPOSAL_FOLLOW_UP_COPY = {
  1: "Здравствуйте! Получили наше коммерческое предложение? Если нужно, уточню комплектацию, дизайн или варианты стоимости.",
  2: "Здравствуйте! Хотели уточнить, какое решение вы приняли по нашему предложению. Остались ли вопросы?",
} as const;

function localParts(value: Date) {
  const local = new Date(value.getTime() + ALMATY_OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    day: local.getUTCDate(),
  };
}

function atAlmatyTen(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day, 10) - ALMATY_OFFSET_MS);
}

function isBusinessDay(value: Date) {
  const day = value.getUTCDay();
  return day !== 0 && day !== 6;
}

export function addBusinessDaysAtTen(value: Date, count: number) {
  const parts = localParts(value);
  const cursor = new Date(Date.UTC(parts.year, parts.month, parts.day));
  let remaining = count;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isBusinessDay(cursor)) remaining -= 1;
  }
  return atAlmatyTen(
    cursor.getUTCFullYear(),
    cursor.getUTCMonth(),
    cursor.getUTCDate(),
  );
}

export function addCalendarDaysAtBusinessStart(value: Date, count: number) {
  const parts = localParts(value);
  const cursor = new Date(Date.UTC(parts.year, parts.month, parts.day + count));
  while (!isBusinessDay(cursor)) cursor.setUTCDate(cursor.getUTCDate() + 1);
  return atAlmatyTen(
    cursor.getUTCFullYear(),
    cursor.getUTCMonth(),
    cursor.getUTCDate(),
  );
}

export function proposalFollowUpSchedule(sentAt: Date) {
  return {
    first: addBusinessDaysAtTen(sentAt, 3),
    second: addCalendarDaysAtBusinessStart(sentAt, 10),
  };
}

export async function scheduleProposalFollowUp(
  tx: Prisma.TransactionClient,
  input: {
    proposalId: number;
    clientId: number;
    actorId: number;
    sentAt: Date;
  },
) {
  const schedule = proposalFollowUpSchedule(input.sentAt);
  const existing = await tx.leadNextAction.findUnique({
    where: { workflowKey: `proposal:${input.proposalId}:follow-up:1` },
  });
  if (existing) return existing;
  await tx.leadNextAction.updateMany({
    where: { clientId: input.clientId, completedAt: null },
    data: {
      completedAt: input.sentAt,
      completedByUserId: input.actorId,
      resultComment: "Заменено обязательным контролем после КП",
    },
  });
  return tx.leadNextAction.upsert({
    where: { workflowKey: `proposal:${input.proposalId}:follow-up:1` },
    create: {
      clientId: input.clientId,
      proposalId: input.proposalId,
      nextActionType: LeadNextActionType.WHATSAPP,
      nextActionAt: schedule.first,
      nextActionComment: PROPOSAL_FOLLOW_UP_COPY[1],
      createdByUserId: input.actorId,
      mandatory: true,
      followUpStep: 1,
      workflowKey: `proposal:${input.proposalId}:follow-up:1`,
    },
    update: {},
  });
}

export async function completeMandatoryProposalFollowUp(
  tx: Prisma.TransactionClient,
  input: {
    action: {
      id: number;
      clientId: number;
      proposalId: number | null;
      followUpStep: number | null;
    };
    resultComment: string;
    actorId: number;
    actorName: string;
  },
) {
  const proposal = input.action.proposalId
    ? await tx.commercialProposal.findUnique({
        where: { id: input.action.proposalId },
        select: { id: true, sentAt: true, number: true },
      })
    : null;
  if (!proposal?.sentAt || !input.action.followUpStep)
    throw new Error("PROPOSAL_FOLLOW_UP_INVALID");

  const completedAt = new Date();
  await tx.leadNextAction.update({
    where: { id: input.action.id },
    data: {
      completedAt,
      completedByUserId: input.actorId,
      resultComment: input.resultComment,
    },
  });
  await tx.clientInteraction.create({
    data: {
      clientId: input.action.clientId,
      authorId: input.actorId,
      authorName: input.actorName,
      comment: `Контроль после КП №${proposal.number}, шаг ${input.action.followUpStep}: ${input.resultComment}`,
    },
  });
  await tx.client.update({
    where: { id: input.action.clientId },
    data: { stage: LeadStage.FOLLOW_UP, status: "Повторный контакт после КП" },
  });

  if (input.action.followUpStep !== 1) return null;
  const dueAt = proposalFollowUpSchedule(proposal.sentAt).second;
  return tx.leadNextAction.upsert({
    where: { workflowKey: `proposal:${proposal.id}:follow-up:2` },
    create: {
      clientId: input.action.clientId,
      proposalId: proposal.id,
      nextActionType: LeadNextActionType.WHATSAPP,
      nextActionAt: dueAt,
      nextActionComment: PROPOSAL_FOLLOW_UP_COPY[2],
      createdByUserId: input.actorId,
      mandatory: true,
      followUpStep: 2,
      workflowKey: `proposal:${proposal.id}:follow-up:2`,
    },
    update: {},
  });
}
