import "./require-test-database";

import assert from "node:assert/strict";

import { LeadNextActionType, Role } from "@prisma/client";

import {
  proposalFollowUpSchedule,
  scheduleProposalFollowUp,
} from "@/lib/leads/proposal-follow-up";
import { prisma } from "@/lib/prisma";
import {
  completeNextAction,
  createNextAction,
  LeadError,
} from "@/lib/services/lead.service";
import {
  createRecurringExpensePlan,
  getRecurringExpensePlans,
  postRecurringExpensePlan,
} from "@/lib/services/recurring-expense.service";

if (
  !process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL
)
  throw new Error("Recurring/follow-up integration requires TEST_DATABASE_URL");

const tag = `recurring-followup-${Date.now()}`;

async function main() {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: 1 } });
  const manager = await prisma.user.create({
    data: {
      companyId: company.id,
      name: tag,
      email: `${tag}@test.local`,
      password: "test",
      role: Role.MANAGER,
    },
  });
  let clientId = 0;
  let calculationId = 0;
  let proposalId = 0;
  let planId = 0;
  try {
    const client = await prisma.client.create({
      data: {
        companyId: company.id,
        name: tag,
        phone: "+77000000001",
        whatsapp: "+77000000001",
        city: "Алматы",
        manager: manager.name,
        managerUserId: manager.id,
        amount: "1000000",
        status: "КП отправлено",
        stage: "PROPOSAL_SENT",
      },
    });
    clientId = client.id;
    const calculation = await prisma.leadCalculation.create({
      data: {
        clientId,
        material: "Сосна",
        baseClientPrice: 1_000_000,
        clientPrice: 1_000_000,
        internalCost: 500_000,
        snapshot: { tag },
        authorId: manager.id,
        authorName: manager.name,
      },
    });
    calculationId = calculation.id;
    const sentAt = new Date("2026-09-28T08:00:00.000Z");
    const proposal = await prisma.commercialProposal.create({
      data: {
        companyId: company.id,
        clientId,
        calculationId,
        number: `TEST-${Date.now()}`,
        status: "SENT",
        snapshot: { tag },
        validUntil: new Date("2026-10-01T08:00:00.000Z"),
        executionTerm: "40–50 дней",
        paymentTerms: "По договору",
        warranty: "6 месяцев",
        managerContact: manager.name,
        sentAt,
        createdById: manager.id,
        createdByName: manager.name,
      },
    });
    proposalId = proposal.id;

    const first = await prisma.$transaction((tx) =>
      scheduleProposalFollowUp(tx, {
        proposalId,
        clientId,
        actorId: manager.id,
        sentAt,
      }),
    );
    await prisma.$transaction((tx) =>
      scheduleProposalFollowUp(tx, {
        proposalId,
        clientId,
        actorId: manager.id,
        sentAt,
      }),
    );
    assert.equal(
      await prisma.leadNextAction.count({
        where: { proposalId, followUpStep: 1 },
      }),
      1,
      "first proposal follow-up is not idempotent",
    );
    assert.equal(first.mandatory, true);
    assert.equal(
      first.nextActionAt.toISOString(),
      proposalFollowUpSchedule(sentAt).first.toISOString(),
    );

    const actor = { userId: manager.id, name: manager.name, role: manager.role };
    await assert.rejects(
      () =>
        createNextAction({
          clientId,
          type: LeadNextActionType.CALL,
          at: new Date("2098-01-01T10:00:00.000Z"),
          actor,
        }),
      (error: unknown) =>
        error instanceof LeadError &&
        error.code === "MANDATORY_FOLLOW_UP_PENDING",
    );
    await assert.rejects(
      () =>
        completeNextAction({
          clientId,
          actionId: first.id,
          resultComment: " ",
          actor,
        }),
      (error: unknown) =>
        error instanceof LeadError && error.code === "RESULT_REQUIRED",
    );
    const second = await completeNextAction({
      clientId,
      actionId: first.id,
      resultComment: "Сообщение отправлено, клиент попросил другой дизайн",
      actor,
    });
    assert(second && second.followUpStep === 2, "second follow-up was not created");
    assert.equal(
      second.nextActionAt.toISOString(),
      proposalFollowUpSchedule(sentAt).second.toISOString(),
    );
    const afterSecond = await completeNextAction({
      clientId,
      actionId: second.id,
      resultComment: "Повторно написала, клиент пока думает",
      actor,
    });
    assert.equal(afterSecond, null, "workflow must finish after the second contact");
    assert.equal(
      await prisma.clientInteraction.count({ where: { clientId } }),
      2,
      "follow-up results were not saved in client history",
    );

    const category = await prisma.financeCategory.findFirstOrThrow({
      where: { companyId: company.id, direction: "EXPENSE", code: "RENT" },
    });
    const plan = await createRecurringExpensePlan({
      name: tag,
      categoryId: category.id,
      amount: 250_000,
      dayOfMonth: 5,
      method: "bank_transfer",
      counterparty: "Тестовый арендодатель",
    });
    planId = plan.id;
    const posted = await postRecurringExpensePlan({
      planId,
      period: "2098-06",
      authorId: manager.id,
    });
    const replay = await postRecurringExpensePlan({
      planId,
      period: "2098-06",
      authorId: manager.id,
    });
    assert.equal(posted.created, true);
    assert.equal(replay.created, false, "monthly expense posting is not idempotent");
    assert.equal(
      await prisma.companyLedgerEntry.count({
        where: { recurringExpensePlanId: planId, recurringPeriod: "2098-06" },
      }),
      1,
    );
    await prisma.companyLedgerEntry.update({
      where: { id: posted.entry.id },
      data: { voidedAt: new Date(), voidReason: "Тест отмены" },
    });
    const restored = await postRecurringExpensePlan({
      planId,
      period: "2098-06",
      authorId: manager.id,
    });
    assert.equal(restored.created, true, "voided monthly expense was not restored");
    assert.equal(restored.entry.voidedAt, null);
    const plans = await getRecurringExpensePlans("2098-06");
    const row = plans.plans.find((item) => item.id === planId);
    assert(row?.posted && row.amount === 250_000, "posted plan is missing from monthly summary");
    console.log("Mandatory proposal follow-ups and recurring expenses integration passed");
  } finally {
    if (planId) {
      await prisma.companyLedgerEntry.deleteMany({ where: { recurringExpensePlanId: planId } });
      await prisma.recurringExpensePlan.deleteMany({ where: { id: planId } });
    }
    if (proposalId)
      await prisma.leadNextAction.deleteMany({ where: { proposalId } });
    if (proposalId)
      await prisma.commercialProposal.deleteMany({ where: { id: proposalId } });
    if (clientId)
      await prisma.clientInteraction.deleteMany({ where: { clientId } });
    if (calculationId)
      await prisma.leadCalculation.deleteMany({ where: { id: calculationId } });
    if (clientId) await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: manager.id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
