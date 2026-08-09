import "./require-test-database";

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Role, type PrismaClient } from "@prisma/client";

const tag = `manager-order-${Date.now()}`;
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
let prisma!: PrismaClient;
const userIds: number[] = [];
const orderIds: number[] = [];
const clientIds: number[] = [];

async function main() {
  ({ prisma } = await import("@/lib/prisma"));
  const { createOrder } = await import("@/lib/services/order.service");
  try {
    const [managerA, managerB, director] = await Promise.all([
      prisma.user.create({ data: { name: `${tag}-A`, email: `${tag}-a@test.local`, password: "not-used", role: Role.MANAGER, active: true } }),
      prisma.user.create({ data: { name: `${tag}-B`, email: `${tag}-b@test.local`, password: "not-used", role: Role.MANAGER, active: true } }),
      prisma.user.create({ data: { name: `${tag}-D`, email: `${tag}-d@test.local`, password: "not-used", role: Role.DIRECTOR, active: true } }),
    ]);
    userIds.push(managerA.id, managerB.id, director.id);
    const phone = `+7700${String(Date.now()).slice(-7)}`;
    const base = {
      partnerId: null,
      address: "Алматы, тестовый адрес",
      staircase: "Металлический каркас",
      material: "Дуб ламель",
      mapUrl: "https://maps.example.test/object",
      orderReceivedAt: new Date("2026-07-01T00:00:00.000Z"),
      promisedAt: new Date("2026-08-01T00:00:00.000Z"),
      frameComment: "Существующий каркас",
      railingType: "Стекло",
      supportType: "Центральная стойка",
      color: "Орех",
      lighting: true,
      lightingDetails: "Тёплая LED",
      cladding: false,
      claddingDetails: "",
      additionalDetails: "Сложный монтаж",
      paymentMethod: "BANK_TRANSFER",
      initialPaymentDate: new Date("2026-07-02T00:00:00.000Z"),
      initialPaymentComment: "Оплачено до регистрации в ORDA",
      amount: 3_000_000,
      prepayment: 1_000_000,
      partnerPrice: 0,
      partnerPaid: 0,
      manager: managerA.name,
      managerUserId: managerA.id,
      actorRole: Role.MANAGER,
    };
    const first = await createOrder({ ...base, client: { name: "Иван", phone, city: "Алматы", address: "Алматы, тестовый адрес" }, idempotencyKey: `${tag}-first`, requestHash: hash("first") });
    orderIds.push(first.order.id);
    clientIds.push(first.order.clientId);
    assert.equal(Number(first.order.balance), 2_000_000);
    assert.equal(first.order.managerUserId, managerA.id);
    assert.equal(first.order.orderReceivedAt.toISOString(), "2026-07-01T00:00:00.000Z");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { idempotencyKey: `order-client-payment:${tag}-first` } });
    assert.equal(Number(payment.amount), 1_000_000);
    assert.equal(payment.method, "BANK_TRANSFER");
    assert.equal(payment.operationDate.toISOString(), "2026-07-02T00:00:00.000Z");

    const second = await createOrder({ ...base, prepayment: 0, client: { name: "Другое имя", phone, city: "Алматы", address: "" }, idempotencyKey: `${tag}-second`, requestHash: hash("second") });
    orderIds.push(second.order.id);
    assert.equal(second.order.clientId, first.order.clientId);
    assert.equal(await prisma.client.count({ where: { OR: [{ phone }, { whatsapp: phone }] } }), 1);

    await assert.rejects(
      () => createOrder({ ...base, prepayment: 0, manager: managerB.name, managerUserId: managerB.id, client: { name: "Иван", phone, city: "Алматы", address: "" }, idempotencyKey: `${tag}-foreign`, requestHash: hash("foreign") }),
      /FORBIDDEN_CLIENT_OWNERSHIP/,
    );
    assert.equal(await prisma.order.count({ where: { managerUserId: managerB.id } }), 0);

    const directorOrder = await createOrder({ ...base, clientId: first.order.clientId, prepayment: 0, actorRole: Role.DIRECTOR, idempotencyKey: `${tag}-director`, requestHash: hash("director") });
    orderIds.push(directorOrder.order.id);
    assert.equal(directorOrder.order.managerUserId, managerA.id);
    assert.equal(await prisma.payment.count({ where: { orderId: first.order.id, type: "CLIENT_PAYMENT" } }), 1);
    console.log("manager order registration: ownership, client deduplication, backend balance and canonical initial payment passed");
  } finally {
    if (orderIds.length) {
      await prisma.orderLifecycleEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (clientIds.length) await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
