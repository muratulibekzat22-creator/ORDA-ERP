import "./require-test-database";

import assert from "node:assert/strict";
import {
  PurchaseAllocationMethod,
  PurchaseCostType,
  Role,
} from "@prisma/client";
import { createRequestHash } from "../lib/idempotency";
import { prisma } from "../lib/prisma";
import {
  addPurchaseCost,
  allocateLandedCost,
  createPurchaseBatch,
  finalizePurchaseBatch,
  receivePurchaseBatch,
} from "../lib/services/purchase.service";
import {
  createWarehouseOperation,
  getActualOrderMaterialCost,
} from "../lib/services/warehouse.service";

if (
  !process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL
)
  throw new Error("Purchase integration requires TEST_DATABASE_URL");
const tag = `purchase-${Date.now()}`,
  ids: Record<string, number> = {};
const key = (value: string) => `${tag}:${value}`;
const actor = { role: Role.DIRECTOR, userId: 0, name: tag };

async function main() {
  try {
    assert.deepEqual(
      allocateLandedCost(
        [
          { id: 1, purchaseValue: 100, quantity: 1 },
          { id: 2, purchaseValue: 300, quantity: 1 },
        ],
        100,
        PurchaseAllocationMethod.BY_PURCHASE_VALUE,
      ),
      [
        { lineId: 1, amount: 25 },
        { lineId: 2, amount: 75 },
      ],
    );
    assert.equal(
      allocateLandedCost(
        [
          { id: 1, purchaseValue: 1, quantity: 1 },
          { id: 2, purchaseValue: 1, quantity: 1 },
          { id: 3, purchaseValue: 1, quantity: 1 },
        ],
        100,
        PurchaseAllocationMethod.BY_QUANTITY,
      ).reduce((sum, row) => sum + row.amount, 0),
      100,
    );
    assert.deepEqual(
      allocateLandedCost(
        [
          { id: 1, purchaseValue: 1, quantity: 1 },
          { id: 2, purchaseValue: 1, quantity: 1 },
        ],
        10,
        PurchaseAllocationMethod.MANUAL,
        { 1: 4, 2: 6 },
      ),
      [
        { lineId: 1, amount: 4 },
        { lineId: 2, amount: 6 },
      ],
    );
    const user = await prisma.user.create({
      data: {
        name: tag,
        email: `${tag}@test.local`,
        password: "test",
        role: Role.DIRECTOR,
      },
    });
    ids.user = user.id;
    actor.userId = user.id;
    const supplier = await prisma.supplier.create({
      data: { name: tag, country: "CN", defaultCurrency: "KZT" },
    });
    ids.supplier = supplier.id;
    const client = await prisma.client.create({
      data: {
        name: tag,
        phone: `+7${Date.now()}`,
        city: "Test",
        manager: tag,
        managerUserId: user.id,
        amount: "0",
        status: "NEW",
        stage: "NEW",
      },
    });
    ids.client = client.id;
    const order = await prisma.order.create({
      data: {
        number: key("order"),
        clientId: client.id,
        address: "Test",
        staircase: "Test",
        material: "Test",
        amount: 100000,
        balance: 100000,
        manager: tag,
      },
    });
    ids.order = order.id;
    const material = await prisma.material.create({
      data: {
        name: tag,
        category: "Test",
        unit: "pair",
        lookupKey: key("material"),
        stock: 1,
        purchasePrice: 10000,
        averageCost: 10000,
        inventoryValue: 10000,
        costStatus: "LEGACY_UNVERIFIED",
      },
    });
    ids.material = material.id;
    const payload = {
      supplierId: supplier.id,
      orderDate: new Date(),
      purchaseCurrency: "KZT",
      fixedExchangeRate: 1,
      allocationMethod: PurchaseAllocationMethod.BY_PURCHASE_VALUE,
      lines: [
        {
          materialId: material.id,
          orderedQuantity: 1,
          purchaseUnitPrice: 15000,
        },
      ],
    };
    const batch = (
      await createPurchaseBatch(
        {
          ...payload,
          key: key("batch"),
          requestHash: createRequestHash(payload),
        },
        actor,
      )
    ).batch;
    ids.batch = batch.id;
    const line = await prisma.purchaseBatchLine.findFirstOrThrow({
      where: { batchId: batch.id },
    });
    await receivePurchaseBatch(
      batch.id,
      [{ lineId: line.id, receivedQuantity: 1 }],
      actor,
    );
    assert.equal(
      Number(
        (
          await prisma.material.findUniqueOrThrow({
            where: { id: material.id },
          })
        ).averageCost,
      ),
      12500,
      "provisional moving average",
    );
    for (const [type, amount] of [
      [PurchaseCostType.CARGO, 2000],
      [PurchaseCostType.OTHER, 500],
    ] as const) {
      const costPayload = {
        batchId: batch.id,
        type,
        provider: tag,
        currency: "KZT",
        foreignAmount: amount,
        exchangeRate: 1,
        documentDate: new Date(),
        allocationMethod: PurchaseAllocationMethod.BY_PURCHASE_VALUE,
      };
      await addPurchaseCost(
        {
          ...costPayload,
          key: key(type),
          requestHash: createRequestHash(costPayload),
        },
        actor,
      );
    }
    const finalized = await finalizePurchaseBatch(
      batch.id,
      undefined,
      "Cargo finalized",
      actor,
    );
    assert.equal(Number(finalized.landedCostKzt), 17500);
    assert.equal(Number(finalized.lines[0].finalUnitLandedCost), 17500);
    assert.equal(
      Number(
        (
          await prisma.material.findUniqueOrThrow({
            where: { id: material.id },
          })
        ).averageCost,
      ),
      13750,
      "final moving average",
    );
    await createWarehouseOperation({
      data: {
        materialId: material.id,
        type: "reserve",
        quantity: 1,
        orderId: order.id,
      },
      key: key("reserve"),
      requestHash: "reserve",
      actor,
    });
    assert.equal(
      await prisma.inventoryCogsEntry.count({ where: { orderId: order.id } }),
      0,
      "reserve created COGS",
    );
    const consumed = await createWarehouseOperation({
      data: {
        materialId: material.id,
        type: "consume",
        quantity: 1,
        orderId: order.id,
      },
      key: key("consume"),
      requestHash: "consume",
      actor,
    });
    const originalCost = await getActualOrderMaterialCost(order.id);
    assert(originalCost > 0);
    const lateCostPayload = {
      batchId: batch.id,
      type: PurchaseCostType.DELIVERY,
      provider: tag,
      currency: "KZT",
      foreignAmount: 500,
      exchangeRate: 1,
      documentDate: new Date(),
      allocationMethod: PurchaseAllocationMethod.BY_PURCHASE_VALUE,
    };
    await addPurchaseCost(
      {
        ...lateCostPayload,
        key: key("late-delivery"),
        requestHash: createRequestHash(lateCostPayload),
      },
      actor,
    );
    const refinalized = await finalizePurchaseBatch(
      batch.id,
      undefined,
      "Late delivery invoice",
      actor,
    );
    assert.equal(Number(refinalized.landedCostKzt), 18000);
    const adjustedCost = await getActualOrderMaterialCost(order.id);
    assert.equal(adjustedCost, originalCost + 500, "late cost COGS adjustment");
    await createWarehouseOperation({
      data: {
        materialId: material.id,
        type: "incoming",
        quantity: 1,
        price: 50000,
      },
      key: key("new-purchase"),
      requestHash: "new-purchase",
      actor,
    });
    assert.equal(
      await getActualOrderMaterialCost(order.id),
      adjustedCost,
      "new purchase changed historical COGS",
    );
    await createWarehouseOperation({
      data: {
        materialId: material.id,
        type: "return",
        quantity: 1,
        orderId: order.id,
        reversalOfId: consumed.result.movement.id,
        comment: "Customer return",
      },
      key: key("return"),
      requestHash: "return",
      actor,
    });
    assert.equal(
      await getActualOrderMaterialCost(order.id),
      500,
      "customer return did not preserve late cost adjustment",
    );
    const replay = await createPurchaseBatch(
      {
        ...payload,
        key: key("batch"),
        requestHash: createRequestHash(payload),
      },
      actor,
    );
    assert.equal(replay.created, false);
    const legacy = await prisma.inventoryValuationEntry.findFirst({
      where: { costStatus: "LEGACY_UNVERIFIED", sourceType: "LEGACY" },
    });
    assert(legacy, "legacy opening valuation missing");
    console.log(
      "purchase batch, landed cost, moving average and COGS checks passed",
    );
  } finally {
    if (ids.material) {
      await prisma.inventoryCogsEntry.deleteMany({
        where: { materialId: ids.material },
      });
      await prisma.inventoryValuationEntry.deleteMany({
        where: { materialId: ids.material },
      });
      await prisma.financeAuditEvent.deleteMany({
        where: { OR: [{ orderId: ids.order }, { authorId: ids.user }] },
      });
      await prisma.orderEvent.deleteMany({ where: { orderId: ids.order } });
      await prisma.materialReservation.deleteMany({
        where: { materialId: ids.material },
      });
      await prisma.materialMovement.deleteMany({
        where: { materialId: ids.material },
      });
      await prisma.purchaseCostRevision.deleteMany({
        where: { batchId: ids.batch },
      });
      await prisma.purchaseAdditionalCost.deleteMany({
        where: { batchId: ids.batch },
      });
      await prisma.purchaseBatchLine.deleteMany({
        where: { batchId: ids.batch },
      });
      await prisma.purchaseBatch.deleteMany({ where: { id: ids.batch } });
      await prisma.order.deleteMany({ where: { id: ids.order } });
      await prisma.client.deleteMany({ where: { id: ids.client } });
      await prisma.material.deleteMany({ where: { id: ids.material } });
      await prisma.supplier.deleteMany({ where: { id: ids.supplier } });
      await prisma.user.deleteMany({ where: { id: ids.user } });
    }
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
