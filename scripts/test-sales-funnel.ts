import assert from "node:assert/strict";
import { LeadLostReason, LeadNextActionType, LeadSource, LeadStage, Role } from "@prisma/client";
import { getAnalytics } from "../lib/services/analytics.service";
import { prisma } from "../lib/prisma";
import { completeNextAction, createNextAction, LeadError, transitionLead } from "../lib/services/lead.service";

if (!process.env.DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("Sales funnel integration requires TEST_DATABASE_URL");
const tag = `funnel-${Date.now()}`;
const ids: number[] = [], userIds: number[] = [];

async function expectCode(promise: Promise<unknown>, code: LeadError["code"]) {
  await assert.rejects(promise, (error) => error instanceof LeadError && error.code === code);
}

async function main() {
try {
  const [director, manager, other] = await Promise.all([
    prisma.user.create({ data: { name: `${tag}-director`, email: `${tag}-director@test.local`, password: "test", role: Role.DIRECTOR } }),
    prisma.user.create({ data: { name: `${tag}-manager`, email: `${tag}-manager@test.local`, password: "test", role: Role.MANAGER } }),
    prisma.user.create({ data: { name: `${tag}-other`, email: `${tag}-other@test.local`, password: "test", role: Role.MANAGER } }),
  ]); userIds.push(director.id, manager.id, other.id);
  const actor = { userId: manager.id, name: manager.name, role: Role.MANAGER };
  const lead = await prisma.client.create({ data: { name: tag, phone: `+7700${Date.now().toString().slice(-7)}`, city: "Алматы", manager: manager.name, managerUserId: manager.id, amount: "0", status: LeadStage.NEW, stage: LeadStage.NEW, source: "WhatsApp", sourceCode: LeadSource.WHATSAPP, comment: "Лестница" } }); ids.push(lead.id);
  await prisma.leadStatusHistory.create({ data: { clientId: lead.id, toStatus: LeadStage.NEW, toStage: LeadStage.NEW, authorId: manager.id, authorName: manager.name } });

  await expectCode(transitionLead({ clientId: lead.id, stage: LeadStage.QUALIFIED, actor }), "NEXT_ACTION_REQUIRED");
  const nextAt = new Date(Date.now() + 3_600_000);
  await transitionLead({ clientId: lead.id, stage: LeadStage.QUALIFIED, nextAction: { type: LeadNextActionType.CALL, at: nextAt }, actor });
  let action = await prisma.leadNextAction.findFirstOrThrow({ where: { clientId: lead.id, completedAt: null } });
  await expectCode(completeNextAction({ clientId: lead.id, actionId: action.id, actor }), "NEXT_ACTION_AFTER_COMPLETION_REQUIRED");
  await completeNextAction({ clientId: lead.id, actionId: action.id, resultComment: "Связались", nextAction: { type: LeadNextActionType.CALCULATION, at: new Date(Date.now() + 7_200_000) }, actor });
  action = await prisma.leadNextAction.findFirstOrThrow({ where: { clientId: lead.id, completedAt: null } });
  assert.equal(action.nextActionType, LeadNextActionType.CALCULATION);
  await expectCode(transitionLead({ clientId: lead.id, stage: LeadStage.LOST, actor }), "LOST_REASON_REQUIRED");
  await expectCode(transitionLead({ clientId: lead.id, stage: LeadStage.LOST, lostReason: LeadLostReason.OTHER, actor }), "LOST_COMMENT_REQUIRED");
  await transitionLead({ clientId: lead.id, stage: LeadStage.LOST, lostReason: LeadLostReason.EXPENSIVE, actor });
  assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: lead.id } })).lostByUserId, manager.id);

  const wonLead = await prisma.client.create({ data: { name: `${tag}-won`, phone: `+7711${Date.now().toString().slice(-7)}`, city: "Алматы", manager: manager.name, managerUserId: manager.id, amount: "0", status: LeadStage.NEW, stage: LeadStage.NEW, source: "CALL", sourceCode: LeadSource.CALL, comment: "Лестница" } }); ids.push(wonLead.id);
  await transitionLead({ clientId: wonLead.id, stage: LeadStage.QUALIFIED, nextAction: { type: LeadNextActionType.CALL, at: new Date(Date.now() + 3_600_000) }, actor });
  await transitionLead({ clientId: wonLead.id, stage: LeadStage.PROPOSAL_SENT, actor });
  await transitionLead({ clientId: wonLead.id, stage: LeadStage.WON, actor });
  await expectCode(createNextAction({ clientId: wonLead.id, type: LeadNextActionType.CALL, at: new Date(Date.now() + 10_000), actor }), "INVALID");
  await expectCode(transitionLead({ clientId: wonLead.id, stage: LeadStage.NEGOTIATION, actor: { userId: other.id, name: other.name, role: Role.MANAGER } }), "NOT_FOUND");

  const analytics = await getAnalytics({ period: "all", role: Role.MANAGER, managerUserId: manager.id });
  assert(analytics.sales.newLeads >= 2);
  assert(analytics.sales.won >= 1);
  assert.equal(analytics.sales.conversion, 50);
  assert(analytics.managers.some((row) => row.managerUserId === manager.id && row.won >= 1));
  const history = await prisma.leadStatusHistory.findMany({ where: { clientId: wonLead.id }, orderBy: { createdAt: "asc" } });
  assert(history.some((item) => item.toStage === LeadStage.WON && item.authorId === manager.id));
  console.log("sales funnel, mandatory next action, ownership and lead analytics checks passed");
} finally {
  if (ids.length) await prisma.client.deleteMany({ where: { id: { in: ids } } });
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
  console.log("sales funnel cleanup completed");
}
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
