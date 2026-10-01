import "./require-test-database";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { runFounderControl, getFounderControl } from "@/lib/services/founder-control.service";
import { getMandatoryTask, acknowledgeMandatoryTask, submitMandatoryTaskResult } from "@/lib/services/mandatory-task.service";

async function main(role: "MANAGER" | "OPERATIONS_DIRECTOR") {
  const tag = `control-${role}-${Date.now()}`;
  const now = new Date();
  const founder = await prisma.user.create({ data: { companyId: 1, name: tag, email: `${tag}@test.local`, password: "test", role: "DIRECTOR" } });
  const manager = await prisma.user.create({ data: { companyId: 1, name: tag, email: `${tag}-manager@test.local`, password: "test", role } });
  const client = await prisma.client.create({ data: { companyId: 1, name: tag, phone: "70000000000", city: "Алматы", manager: manager.name, managerUserId: manager.id, amount: "0", status: "NEW", createdAt: new Date(now.getTime() - 2 * 86400000) } });
  const key = `lead:${client.id}`;
  try {
    assert((await getFounderControl()).issues.some(i => i.key === key));
    await Promise.all([runFounderControl(founder.id, [key], now), runFounderControl(founder.id, [key], now)]);
    const tasks = await prisma.calendarTask.findMany({ where: { controlKey: key } });
    assert.equal(tasks.length, 1, "Concurrent scans must not create duplicates");
    const task = tasks[0];
    const actor = { userId: manager.id, name: manager.name, role: manager.role };
    assert.equal((await getMandatoryTask(actor))?.phase, "ACKNOWLEDGE");
    await assert.rejects(acknowledgeMandatoryTask({ userId: founder.id, name: founder.name, role: founder.role }, task.id, new Date(now.getTime() + 3600000), "Не мой исполнитель"), /TASK_NOT_FOUND/);
    await acknowledgeMandatoryTask(actor, task.id, new Date(now.getTime() + 3600000), "Принял");
    await prisma.calendarTask.update({ where: { id: task.id }, data: { plannedCompletionAt: new Date(now.getTime() - 3600000) } });
    assert.equal(await getMandatoryTask(actor), null, "Acknowledged automated tasks must allow access to work");
    await submitMandatoryTaskResult(actor, task.id, "Готово без исправления карточки");
    assert((await getFounderControl()).issues.some(i => i.key === key), "Submission alone must not resolve the source issue");
    const tomorrow = new Date(now.getTime() + 86460000);
    assert.equal((await runFounderControl(founder.id, [key], tomorrow)).reminded, 1);
    assert.equal((await runFounderControl(founder.id, [key], tomorrow)).reminded, 0, "Only one reminder per 24 hours");
    assert.equal((await getMandatoryTask(actor))?.phase, "ACKNOWLEDGE", "Reminder requires renewed acknowledgement");
    await acknowledgeMandatoryTask(actor, task.id, new Date(now.getTime() + 3600000), "Исправляю");
    await submitMandatoryTaskResult(actor, task.id, "Повторный результат принят");
    assert.equal(await prisma.calendarTaskAudit.count({ where: { taskId: task.id, action: "RESULT_SUBMITTED" } }), 2, "Both result attempts remain in the audit trail");
    await prisma.clientInteraction.create({ data: { clientId: client.id, authorId: manager.id, authorName: manager.name, comment: "Связался, следующий звонок согласован" } });
    await prisma.client.update({ where: { id: client.id }, data: { nextContactAt: new Date(tomorrow.getTime() + 86400000) } });
    await runFounderControl(founder.id, [key], tomorrow);
    const verified = await prisma.calendarTask.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(verified.status, "COMPLETED");
    assert(verified.controlVerifiedAt);
    assert.equal(await getMandatoryTask(actor), null);
    console.log(`${role}: deduplication, authorization, acknowledgement, reminders, resubmission and evidence verification passed`);
  } finally {
    const tasks = await prisma.calendarTask.findMany({ where: { controlKey: key }, select: { id: true } });
    await prisma.calendarTaskAudit.deleteMany({ where: { taskId: { in: tasks.map(t => t.id) } } });
    await prisma.calendarTask.deleteMany({ where: { controlKey: key } });
    await prisma.clientInteraction.deleteMany({ where: { clientId: client.id } });
    await prisma.client.delete({ where: { id: client.id } });
    await prisma.user.deleteMany({ where: { id: { in: [founder.id, manager.id] } } });
    await prisma.$disconnect();
  }
}
main("MANAGER").then(() => main("OPERATIONS_DIRECTOR")).catch(e => { console.error(e); process.exitCode = 1; });
