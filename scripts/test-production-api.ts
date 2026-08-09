import "./require-test-database";

import assert from "node:assert/strict";
import { Role } from "@prisma/client";

import { prisma } from "../lib/prisma";
import { PRODUCTION_STAGES, type ProductionStage } from "../lib/production/stage-policy";
import {
  createProductionCommand,
  getProductions,
  ProductionServiceError,
  updateProductionCommand,
} from "../lib/services/production.service";

const tag = `production-api-${Date.now()}`;
const key = (name: string) => `${tag}:${name}`;
const hash = (name: string) => `hash:${name}`;

async function main() {
  const users = await Promise.all([
    prisma.user.create({ data: { name: `${tag}-director`, email: `${tag}-director@test.local`, password: "test", role: Role.DIRECTOR } }),
    prisma.user.create({ data: { name: `${tag}-production`, email: `${tag}-production@test.local`, password: "test", role: Role.PRODUCTION } }),
    prisma.user.create({ data: { name: `${tag}-other`, email: `${tag}-other@test.local`, password: "test", role: Role.PRODUCTION } }),
    prisma.user.create({ data: { name: `${tag}-installer`, email: `${tag}-installer@test.local`, password: "test", role: Role.INSTALLER } }),
  ]);
  const [director, worker, otherWorker, installer] = users;
  let clientId: number | undefined;
  let orderId: number | undefined;

  try {
    const client = await prisma.client.create({ data: { name: tag, phone: tag, city: "test", manager: director.name, amount: "0", status: "test" } });
    clientId = client.id;
    const order = await prisma.order.create({ data: { number: tag, clientId: client.id, address: "test", staircase: "test", material: "test", amount: 1000, manager: director.name } });
    orderId = order.id;
    const directorActor = { role: Role.DIRECTOR, userId: director.id, name: director.name };
    const workerActor = { role: Role.PRODUCTION, userId: worker.id, name: worker.name };
    const otherActor = { role: Role.PRODUCTION, userId: otherWorker.id, name: otherWorker.name };
    const installerActor = { role: Role.INSTALLER, userId: installer.id, name: installer.name };
    const createInput = {
      orderId: order.id,
      data: { stage: "Подготовка" as const, percent: 0, masterUserId: worker.id, priority: 2 },
      actor: directorActor,
      idempotencyKey: key("create"),
      requestHash: hash("create"),
    };
    const created = await createProductionCommand(createInput);
    assert(created?.created);
    const repeated = await createProductionCommand(createInput);
    assert.equal(repeated?.production.id, created?.production.id);
    assert.equal(repeated?.created, false);
    await assert.rejects(
      () => createProductionCommand({ ...createInput, requestHash: hash("conflict") }),
      (error) => error instanceof ProductionServiceError && error.code === "IDEMPOTENCY_CONFLICT",
    );
    const productionId = created!.production.id;
    assert.equal((await getProductions(workerActor)).some((item) => item.id === productionId), true);
    assert.equal((await getProductions(otherActor)).some((item) => item.id === productionId), false);
    await assert.rejects(
      () => updateProductionCommand({ id: productionId, data: { comment: "forbidden" }, actor: otherActor, idempotencyKey: key("forbidden"), requestHash: hash("forbidden") }),
      (error) => error instanceof ProductionServiceError && error.code === "FORBIDDEN",
    );
    await assert.rejects(
      () => updateProductionCommand({ id: productionId, data: { stage: "Дерево" }, actor: workerActor, idempotencyKey: key("skip"), requestHash: hash("skip") }),
      (error) => error instanceof ProductionServiceError && error.code === "INVALID_STAGE",
    );

    let currentStage: ProductionStage = "Подготовка";
    for (const nextStage of PRODUCTION_STAGES.slice(1)) {
      const handoff = nextStage === "Монтаж" ? { masterUserId: installer.id } : {};
      const actor = nextStage === "Сдано" ? installerActor : nextStage === "Монтаж" ? directorActor : workerActor;
      const transition = { id: productionId, data: { stage: nextStage, ...handoff }, actor, idempotencyKey: key(`to-${nextStage}`), requestHash: hash(`to-${nextStage}`) };
      const updated = await updateProductionCommand(transition);
      assert.equal(updated?.stage, nextStage);
      const repeatedTransition = await updateProductionCommand(transition);
      assert.equal(repeatedTransition?.stage, nextStage);
      currentStage = nextStage;
    }
    assert.equal(currentStage, "Сдано");
    const final = await prisma.production.findUniqueOrThrow({ where: { id: productionId }, include: { stageHistory: true } });
    assert.equal(final.percent, 100);
    assert.ok(final.completedAt);
    assert.ok(final.actualEndAt);
    assert.equal(final.stageHistory.length, PRODUCTION_STAGES.length);
    assert.equal(final.stageHistory[0].fromStage, null);
    assert.equal(final.stageHistory.filter((item) => item.toStage === "Сдано").length, 1);
    assert.equal((await getProductions(installerActor)).some((item) => item.id === productionId), false);
    console.log("production API service checks passed");
  } finally {
    if (orderId) await prisma.order.delete({ where: { id: orderId } });
    if (clientId) await prisma.client.delete({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
