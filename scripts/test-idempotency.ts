import "dotenv/config";

import { prisma } from "@/lib/prisma";
import { createPayment } from "@/lib/services/payment.service";
import { payPartner } from "@/lib/services/partner.service";
import { createMaterialMovement } from "@/lib/services/warehouse.service";
import { createOrder } from "@/lib/services/order.service";

const tag = `idem-${Date.now()}`;

function key(name: string) {
  return `${tag}:${name}`;
}

function hash(name: string) {
  return `hash:${name}`;
}

function ensure(value: boolean, message: string) {
  if (!value) {
    throw new Error(message);
  }
}

async function expectConflict(run: () => Promise<unknown>) {
  try {
    await run();
    throw new Error("conflict missing");
  } catch (error) {
    ensure(
      error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT",
      "wrong conflict"
    );
  }
}

async function main() {
  let clientId: number | undefined;
  let partnerId: number | undefined;
  let orderId: number | undefined;
  let materialId: number | undefined;

  try {
    const client = await prisma.client.create({
      data: {
        name: tag,
        phone: `+7${Date.now()}`,
        city: "test",
        manager: "test",
        amount: "0",
        status: "test",
      },
    });
    clientId = client.id;

    const partner = await prisma.partner.create({ data: { name: tag } });
    partnerId = partner.id;

    const orderInput = { clientId: client.id, partnerId: partner.id, address: "test", staircase: "test", material: "test", amount: 1000, prepayment: 100, partnerPrice: 400, partnerPaid: 50, manager: "test", idempotencyKey: key("order"), requestHash: hash("order") };
    const createdOrder = (await createOrder(orderInput)).order;
    orderId = createdOrder.id;
    const repeatedOrder = await createOrder(orderInput);
    ensure(repeatedOrder.order.id === createdOrder.id && !repeatedOrder.created, "order repeat");
    await expectConflict(() => createOrder({ ...orderInput, amount: 1001, requestHash: hash("order-other") }));
    const parallelOrders = await Promise.all(["one", "two"].map((suffix) => createOrder({ ...orderInput, idempotencyKey: key(`order-${suffix}`), requestHash: hash(`order-${suffix}`) })));
    ensure(parallelOrders[0].order.number !== parallelOrders[1].order.number, "parallel order numbers");
    ensure(Number(createdOrder.balance) === 900 && Number(createdOrder.partnerBalance) === 350 && Number(createdOrder.companyProfit) === 600, "order calculated totals");
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: parallelOrders.map((result) => result.order.id) } } });
    await prisma.production.deleteMany({ where: { orderId: { in: parallelOrders.map((result) => result.order.id) } } });
    await prisma.order.deleteMany({ where: { id: { in: parallelOrders.map((result) => result.order.id) } } });

    const material = await prisma.material.create({
      data: {
        name: tag,
        category: "test",
        unit: "pcs",
        stock: 10,
        minimumStock: 0,
        purchasePrice: "10",
      },
    });
    materialId = material.id;

    const payment = {
      orderId: createdOrder.id,
      amount: 100,
      method: "Kaspi",
      type: "Предоплата",
      idempotencyKey: key("pay"),
      requestHash: hash("pay"),
    };
    await createPayment(payment);
    await createPayment(payment);
    await createPayment({ ...payment, idempotencyKey: key("pay-race"), requestHash: hash("pay-race") });
    await createPayment({ ...payment, idempotencyKey: key("pay-race"), requestHash: hash("pay-race") });
    await expectConflict(() =>
      createPayment({ ...payment, amount: 101, requestHash: hash("other") })
    );

    let currentOrder = await prisma.order.findUniqueOrThrow({
      where: { id: createdOrder.id },
    });
    ensure(
      (await prisma.payment.count({ where: { orderId: createdOrder.id } })) === 2,
      "payments"
    );
    ensure(
      Number(currentOrder.prepayment) === 300 && Number(currentOrder.balance) === 700,
      "payment totals"
    );

    const payout = {
      orderId: createdOrder.id,
      amount: 100,
      method: "Kaspi",
      idempotencyKey: key("partner"),
      requestHash: hash("partner"),
    };
    await payPartner(payout);
    await payPartner(payout);
    await Promise.all([
      payPartner({
        ...payout,
        idempotencyKey: key("partner-race"),
        requestHash: hash("partner-race"),
      }),
      payPartner({
        ...payout,
        idempotencyKey: key("partner-race"),
        requestHash: hash("partner-race"),
      }),
    ]);
    await expectConflict(() =>
      payPartner({ ...payout, amount: 1, requestHash: hash("partner-other") })
    );

    currentOrder = await prisma.order.findUniqueOrThrow({
      where: { id: createdOrder.id },
    });
    ensure(
      (await prisma.payment.count({ where: { orderId: createdOrder.id } })) === 4,
      "partner payments"
    );
    ensure(
      Number(currentOrder.partnerPaid) === 250 &&
        Number(currentOrder.partnerBalance) === 150,
      "partner totals"
    );

    const incoming = {
      materialId: material.id,
      type: "incoming" as const,
      quantity: 5,
      idempotencyKey: key("in"),
      requestHash: hash("in"),
    };
    await createMaterialMovement(incoming);
    await createMaterialMovement(incoming);
    await Promise.all([
      createMaterialMovement({
        ...incoming,
        idempotencyKey: key("in-race"),
        requestHash: hash("in-race"),
      }),
      createMaterialMovement({
        ...incoming,
        idempotencyKey: key("in-race"),
        requestHash: hash("in-race"),
      }),
    ]);
    await expectConflict(() =>
      createMaterialMovement({
        ...incoming,
        quantity: 6,
        requestHash: hash("in-other"),
      })
    );

    const outgoing = {
      materialId: material.id,
      type: "outgoing" as const,
      quantity: 3,
      orderId: createdOrder.id,
      idempotencyKey: key("out"),
      requestHash: hash("out"),
    };
    await createMaterialMovement(outgoing);
    await createMaterialMovement(outgoing);
    await Promise.all([
      createMaterialMovement({
        ...outgoing,
        idempotencyKey: key("out-race"),
        requestHash: hash("out-race"),
      }),
      createMaterialMovement({
        ...outgoing,
        idempotencyKey: key("out-race"),
        requestHash: hash("out-race"),
      }),
    ]);
    await expectConflict(() =>
      createMaterialMovement({
        ...outgoing,
        quantity: 4,
        requestHash: hash("out-other"),
      })
    );

    ensure(
      (await prisma.materialMovement.count({ where: { materialId: material.id } })) === 4,
      "movements"
    );
    ensure(
      (await prisma.material.findUniqueOrThrow({ where: { id: material.id } })).stock === 14,
      "stock"
    );
    console.log("all idempotency scenarios passed");
  } finally {
    if (orderId) {
      await prisma.orderEvent.deleteMany({ where: { orderId } });
      await prisma.payment.deleteMany({ where: { orderId } });
      await prisma.materialMovement.deleteMany({ where: { orderId } });
    }

    if (materialId) {
      await prisma.material.delete({ where: { id: materialId } });
    }
    if (orderId) {
      await prisma.order.delete({ where: { id: orderId } });
    }
    if (partnerId) {
      await prisma.partner.delete({ where: { id: partnerId } });
    }
    if (clientId) {
      await prisma.client.delete({ where: { id: clientId } });
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
