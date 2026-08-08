import "dotenv/config";

import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createPayment } from "@/lib/services/payment.service";
import { assignPartnerToOrder, payPartner } from "@/lib/services/partner.service";
import { createMaterialMovement } from "@/lib/services/warehouse.service";
import { createProduction, updateProduction } from "@/lib/services/production.service";
import { createCalendarEvent, moveCalendarEvent } from "@/lib/services/calendar.service";
import { createOrder } from "@/lib/services/order.service";

const tag = `e2e-${Date.now()}`;
const assert = (value: boolean, step: string) => { if (!value) throw new Error(`FAILED: ${step}`); };

async function main() {
  const ids: { users: number[]; client?: number; partner?: number; order?: number; material?: number } = { users: [] };
  let step = "initialization";
  try {
    step = "create staff";
    const roles = [Role.DIRECTOR, Role.MANAGER, Role.MEASURER, Role.PRODUCTION, Role.INSTALLER];
    for (const role of roles) {
      const user = await prisma.user.create({ data: { name: `${tag}-${role}`, email: `${tag}-${role}@test.local`, password: "e2e-only", role } });
      ids.users.push(user.id);
    }
    const [directorId, , measurerId, productionId, installerId] = ids.users;
    void directorId;

    step = "create partner and client";
    const partner = await prisma.partner.create({ data: { name: tag } }); ids.partner = partner.id;
    const client = await prisma.client.create({ data: { name: tag, phone: `+7${Date.now()}`, city: "E2E", manager: `${tag}-MANAGER`, amount: "0", status: "Новый" } }); ids.client = client.id;

    step = "create generated order";
    const generatedOrder = (await createOrder({ clientId: client.id, partnerId: partner.id, address: "E2E generated", staircase: "Straight", material: "Oak", amount: 100, prepayment: 10, partnerPrice: 40, partnerPaid: 5, manager: `${tag}-MANAGER`, idempotencyKey: `${tag}:generated-order`, requestHash: "generated-order" })).order;
    assert(/^ORD-\d{8}-[A-F0-9]{12}$/.test(generatedOrder.number) && Number(generatedOrder.balance) === 90 && Number(generatedOrder.partnerBalance) === 35 && Number(generatedOrder.companyProfit) === 60, step);
    await prisma.orderLifecycleEvent.deleteMany({ where: { orderId: generatedOrder.id } });
    await prisma.orderEvent.deleteMany({ where: { orderId: generatedOrder.id } });
    await prisma.payment.deleteMany({ where: { orderId: generatedOrder.id } });
    await prisma.production.deleteMany({ where: { orderId: generatedOrder.id } });
    await prisma.order.delete({ where: { id: generatedOrder.id } });
    step = "create order";
    const order = await prisma.order.create({ data: { number: tag, clientId: client.id, address: "E2E", staircase: "Прямая", material: "Дуб", amount: "1000", prepayment: "0", balance: "1000", partnerPrice: "400", partnerPaid: "0", partnerBalance: "400", companyProfit: "600", manager: `${tag}-MANAGER`, status: "Новая заявка" } }); ids.order = order.id;
    await prisma.orderEvent.create({ data: { orderId: order.id, title: "Создан заказ", user: `${tag}-MANAGER` } });

    step = "client payment and idempotency";
    const payment = { orderId: order.id, amount: 500, method: "Kaspi", type: "Предоплата", idempotencyKey: `${tag}:payment`, requestHash: "payment" };
    await createPayment(payment); await createPayment(payment);
    let current = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert(Number(current.prepayment) === 500 && Number(current.balance) === 500, step);
    assert(await prisma.payment.count({ where: { orderId: order.id } }) === 1, `${step} duplicate`);

    step = "measurement create and edit";
    const measurement = await prisma.measurement.create({ data: { orderId: order.id, clientId: client.id, measurerUserId: measurerId, measurer: `${tag}-MEASURER`, visitDate: new Date(), floorHeight: 3, staircaseWidth: 1.2, stepsCount: 16 } });
    await prisma.measurement.update({ where: { id: measurement.id }, data: { comment: "edited", stepsCount: 17 } });
    assert((await prisma.measurement.findUniqueOrThrow({ where: { id: measurement.id } })).measurerUserId === measurerId, step);

    step = "assign partner";
    const assigned = await assignPartnerToOrder({ orderId: order.id, partnerId: partner.id, partnerPrice: 400, manager: `${tag}-MANAGER` });
    assert(assigned?.partnerId === partner.id && Number(assigned.partnerPrice) === 400 && Number(assigned.companyProfit) === 600, step);

    step = "partner payout and idempotency";
    const payout = { orderId: order.id, amount: 100, method: "Kaspi", idempotencyKey: `${tag}:payout`, requestHash: "payout" };
    await payPartner(payout); await payPartner(payout);
    current = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert(Number(current.partnerPaid) === 100 && Number(current.partnerBalance) === 300, `${step}: paid=${current.partnerPaid} balance=${current.partnerBalance}`);

    step = "production stages";
    const production = await createProduction({ orderId: order.id, stage: "Дерево", percent: 10, master: `${tag}-PRODUCTION`, masterUserId: productionId, startDate: new Date() });
    assert(production?.masterUserId === productionId, step);
    for (const stage of ["Покраска", "Комплектация", "Готово к монтажу"]) await updateProduction(production!.id, { stage });
    await updateProduction(production!.id, { stage: "Монтаж", master: `${tag}-INSTALLER`, masterUserId: installerId });
    await updateProduction(production!.id, { stage: "Сдано", percent: 100 });
    current = await prisma.order.findUniqueOrThrow({ where: { id: order.id } }); assert(current.status === "Новая заявка", `${step}: production stage must not overwrite Order status`);
    assert((await prisma.production.findUniqueOrThrow({ where: { id: production.id } })).stage === "Сдано", step);

    step = "warehouse movements and idempotency";
    const material = await prisma.material.create({ data: { name: tag, lookupKey: `${tag.toLocaleLowerCase("ru")}::шт`, category: "E2E", unit: "шт", stock: 10, minimumStock: 0, purchasePrice: "10" } }); ids.material = material.id;
    await createMaterialMovement({ materialId: material.id, type: "incoming", quantity: 5, idempotencyKey: `${tag}:in`, requestHash: "in" });
    const out = { materialId: material.id, orderId: order.id, type: "outgoing" as const, quantity: 3, idempotencyKey: `${tag}:out`, requestHash: "out" };
    await createMaterialMovement(out); await createMaterialMovement(out);
    assert((await prisma.material.findUniqueOrThrow({ where: { id: material.id } })).stock === 12, step);

    step = "calendar create and move";
    const calendarItem = await createCalendarEvent({ sourceType: "production", orderId: order.id, startDate: new Date(), assignedUserId: installerId, stage: "Монтаж", user: `${tag}-MANAGER` });
    assert(calendarItem !== null, step);
    await moveCalendarEvent({ sourceType: "production", id: calendarItem!.id, startDate: new Date(Date.now() + 86400000), user: `${tag}-MANAGER` });

    step = "financial integrity";
    current = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert(Number(current.balance) >= 0 && Number(current.partnerBalance) >= 0 && Number(current.companyProfit) >= 0, step);
    console.log("e2e business flow passed");
  } catch (error) {
    console.error(step, error);
    process.exitCode = 1;
  } finally {
    if (ids.order) { await prisma.orderGateOverride.deleteMany({ where: { orderId: ids.order } }); await prisma.orderLifecycleEvent.deleteMany({ where: { orderId: ids.order } }); await prisma.orderBlocker.deleteMany({ where: { orderId: ids.order } }); await prisma.orderInstallation.deleteMany({ where: { orderId: ids.order } }); await prisma.orderEvent.deleteMany({ where: { orderId: ids.order } }); await prisma.payment.deleteMany({ where: { orderId: ids.order } }); await prisma.materialMovement.deleteMany({ where: { orderId: ids.order } }); await prisma.measurement.deleteMany({ where: { orderId: ids.order } }); await prisma.production.deleteMany({ where: { orderId: ids.order } }); }
    if (ids.material) await prisma.material.delete({ where: { id: ids.material } });
    if (ids.order) await prisma.order.delete({ where: { id: ids.order } });
    if (ids.partner) await prisma.partner.delete({ where: { id: ids.partner } });
    if (ids.client) await prisma.client.delete({ where: { id: ids.client } });
    if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.$disconnect();
  }
}

void main();
