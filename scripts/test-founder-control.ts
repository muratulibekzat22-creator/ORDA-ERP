import "./require-test-database";

import assert from "node:assert/strict";
import { CalendarTaskType, Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getFounderControl, runFounderControl } from "@/lib/services/founder-control.service";

async function main() {
  const tag = `control-summary-${Date.now()}`;
  const now = new Date();
  const [founder, director, manager] = await Promise.all([
    prisma.user.create({ data: { companyId: 1, name: `${tag}-founder`, email: `${tag}-founder@test.local`, password: "test", role: Role.DIRECTOR } }),
    prisma.user.create({ data: { companyId: 1, name: `${tag}-director`, email: `${tag}-director@test.local`, password: "test", role: Role.OPERATIONS_DIRECTOR } }),
    prisma.user.create({ data: { companyId: 1, name: `${tag}-manager`, email: `${tag}-manager@test.local`, password: "test", role: Role.MANAGER } }),
  ]);
  const client = await prisma.client.create({ data: {
    companyId: 1,
    name: tag,
    phone: "70000000000",
    city: "Алматы",
    manager: manager.name,
    managerUserId: manager.id,
    amount: "0",
    status: "NEW",
    createdAt: new Date(now.getTime() - 2 * 86_400_000),
  } });
  const key = `lead:${client.id}`;
  const task = await prisma.calendarTask.create({ data: {
    companyId: 1,
    title: "Legacy per-lead control",
    type: CalendarTaskType.TASK,
    dueAt: now,
    assigneeId: manager.id,
    creatorId: founder.id,
    clientId: client.id,
    controlKey: key,
    acknowledgementRequired: true,
  } });
  try {
    const control = await getFounderControl();
    assert(control.issues.some((issue) => issue.key === "group:lead-follow-up"), "lead deviations must be grouped");
    assert.equal(control.issues.some((issue) => issue.key === key), false, "founder view must not expose one card per lead");
    const result = await runFounderControl(director.id, undefined, now);
    assert.equal(result.consolidated, 1, "legacy per-item task was not consolidated");
    const cancelled = await prisma.calendarTask.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(cancelled.status, "CANCELLED");
    assert(cancelled.cancelledAt);
    assert.equal(await prisma.calendarTaskAudit.count({ where: { taskId: task.id, action: "CONTROL_CONSOLIDATED" } }), 1);
    assert.equal((await runFounderControl(director.id, undefined, now)).consolidated, 0, "cleanup must be idempotent");
    assert.equal(await prisma.calendarTask.count({ where: { controlKey: key } }), 1, "legacy history must be preserved without creating a duplicate");
    console.log("Founder control grouping and legacy task consolidation passed");
  } finally {
    await prisma.calendarTaskAudit.deleteMany({ where: { taskId: task.id } });
    await prisma.calendarTask.delete({ where: { id: task.id } });
    await prisma.client.delete({ where: { id: client.id } });
    await prisma.user.deleteMany({ where: { id: { in: [founder.id, director.id, manager.id] } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
