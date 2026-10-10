import "./require-test-database";

import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { Role } from "@prisma/client";

import { createRequestHash } from "../lib/idempotency";
import { calculateOrderEconomy } from "../lib/orders/economy";
import { prisma } from "../lib/prisma";
import { deleteAttachment } from "../lib/services/attachment.service";
import { createSupplier } from "../lib/services/purchase.service";
import { createWarehouseOperation } from "../lib/services/warehouse.service";
import {
  createBrassProcurement,
  getOrderBrassProcurement,
  listBrassProcurements,
  markBrassInTransit,
  placeBrassOrder,
  receiveBrassProcurement,
  recordBrassPayment,
} from "../lib/services/brass-procurement.service";

if (!process.env.TEST_BLOB_DIR) throw new Error("TEST_BLOB_DIR is required");

const tag = `brass-procurement-${Date.now()}`;
const key = (value: string) => `${tag}:${value}`;
const ids: Record<string, number> = {};
const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

async function main() {
  let actor = { userId: 0, role: Role.MANAGER, name: tag };
  let attachmentId = 0;
  let materialCreated = false;
  try {
    const materialBefore = await prisma.material.findFirst({
      where: { lookupKey: "brass-baluster-pair" },
      select: { id: true },
    });
    const user = await prisma.user.create({
      data: {
        name: tag,
        email: `${tag}@test.local`,
        password: "test-only-not-for-login",
        role: Role.MANAGER,
      },
    });
    ids.user = user.id;
    actor = { ...actor, userId: user.id };
    const founder = await prisma.user.create({
      data: {
        name: `${tag}-founder`,
        email: `${tag}-founder@test.local`,
        password: "test-only-not-for-login",
        role: Role.DIRECTOR,
      },
    });
    ids.founder = founder.id;
    const founderActor = { userId: founder.id, role: Role.DIRECTOR, name: founder.name };
    const otherManager = await prisma.user.create({
      data: {
        name: `${tag}-other-manager`,
        email: `${tag}-other-manager@test.local`,
        password: "test-only-not-for-login",
        role: Role.MANAGER,
      },
    });
    ids.otherManager = otherManager.id;
    await assert.rejects(
      () => createSupplier({ name: `${tag}-forbidden`, country: "KZ" }, founderActor),
      /FORBIDDEN/,
      "founder was able to create a supplier",
    );
    await assert.rejects(
      () => createWarehouseOperation({
        data: { materialId: 1, type: "incoming", quantity: 1 },
        key: key("founder-warehouse-operation"),
        requestHash: createRequestHash({ founder: true }),
        actor: founderActor,
      }),
      /FORBIDDEN/,
      "founder was able to post a warehouse operation",
    );
    const supplier = await createSupplier(
      {
        name: tag,
        country: "KZ",
        defaultCurrency: "KZT",
        contact: "",
      },
      actor,
    );
    ids.supplier = supplier.id;
    const location = await prisma.warehouseLocation.create({
      data: { code: tag, name: tag, type: "WAREHOUSE", isDefault: false },
    });
    ids.location = location.id;
    const locationAccess = await prisma.warehouseLocationAccess.create({
      data: {
        userId: user.id,
        locationId: location.id,
        canSell: true,
        canReceive: true,
      },
    });
    ids.locationAccess = locationAccess.id;
    const client = await prisma.client.create({
      data: {
        name: tag,
        phone: `+7700${String(Date.now()).slice(-7)}`,
        city: "Test",
        address: "Test",
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
        number: `TEST-BRASS-${Date.now()}`,
        clientId: client.id,
        address: "Test",
        staircase: "Test",
        material: "Латунь",
        amount: 500000,
        prepayment: 0,
        balance: 500000,
        partnerPrice: 200000,
        partnerAgreedAt: new Date(),
        companyProfit: 300000,
        partnerPaid: 0,
        partnerBalance: 200000,
        manager: tag,
        managerUserId: user.id,
      },
    });
    ids.order = order.id;
    const createPayload = {
      orderId: order.id,
      quantityPairs: 6,
      notes: "Полированная латунь",
      fileName: "brass.png",
      contentType: "image/png",
      size: png.byteLength,
    };
    const create = await createBrassProcurement({
      orderId: order.id,
      quantityPairs: 6,
      notes: createPayload.notes,
      photo: new File([png], createPayload.fileName, { type: createPayload.contentType }),
      key: key("request"),
      requestHash: createRequestHash(createPayload),
      actor,
    });
    assert.equal(create.created, true);
    ids.procurement = create.procurement.id;
    ids.material = create.procurement.material.id;
    ids.orderItem = create.procurement.orderItem.id;
    attachmentId = create.procurement.photoAttachment.id;
    materialCreated = materialBefore === null;
    assert.equal(create.procurement.quantityPairs, 6);
    assert.equal(create.procurement.status, "REQUESTED");

    const replay = await createBrassProcurement({
      orderId: order.id,
      quantityPairs: 6,
      notes: createPayload.notes,
      photo: new File([png], createPayload.fileName, { type: createPayload.contentType }),
      key: key("request"),
      requestHash: createRequestHash(createPayload),
      actor,
    });
    assert.equal(replay.created, false, "double submit created a second request");
    assert.equal(await prisma.orderBrassProcurement.count({ where: { orderId: order.id } }), 1);

    const internalRoles = Object.values(Role).filter((role) => role !== Role.PARTNER);
    for (const role of internalRoles)
      assert.equal(
        (await listBrassProcurements({ userId: founder.id, role, name: founder.name })).length >= 1,
        true,
        `${role} cannot view the shared brass workflow`,
      );
    await assert.rejects(
      () => listBrassProcurements({ userId: founder.id, role: Role.PARTNER, name: founder.name }),
      /FORBIDDEN/,
      "external partner can view the internal brass workflow",
    );
    assert.equal(
      (await listBrassProcurements({ userId: otherManager.id, role: Role.MANAGER, name: otherManager.name })).length,
      1,
      "employee cannot see another manager's brass procurement",
    );

    const expectedArrivalDate = new Date(Date.now() + 10 * 86_400_000);
    const orderPayload = {
      procurementId: ids.procurement,
      supplierId: supplier.id,
      expectedArrivalDate: expectedArrivalDate.toISOString(),
      purchaseCurrency: "KZT",
      exchangeRate: 1,
      unitPurchasePrice: 20000,
      responsibleUserId: user.id,
      notes: "Поставка под заказ",
    };
    const ordered = await placeBrassOrder({
      ...orderPayload,
      expectedArrivalDate,
      key: key("order"),
      requestHash: createRequestHash(orderPayload),
      actor: founderActor,
    });
    ids.batch = ordered.purchaseBatch!.id;
    ids.task = ordered.reminderTask!.id;
    assert.equal(ordered.status, "ORDERED");
    assert.equal(ordered.goodsCostKzt, 120000);
    const reminderDistance = expectedArrivalDate.getTime() - new Date(ordered.reminderTask!.dueAt).getTime();
    assert.equal(reminderDistance, 3 * 86_400_000, "reminder is not three days before delivery");
    const orderedReplay = await placeBrassOrder({
      ...orderPayload,
      expectedArrivalDate,
      key: key("order"),
      requestHash: createRequestHash(orderPayload),
      actor: founderActor,
    });
    assert.equal(orderedReplay.purchaseBatch?.id, ids.batch, "order retry created another batch");
    assert.equal(await prisma.purchaseBatch.count({ where: { idempotencyKey: key("order") + ":batch" } }), 1);

    const paymentPayload = {
      procurementId: ids.procurement,
      kind: "SUPPLIER" as const,
      amount: 50000,
      method: "KASPI_TRANSFER",
      paidAt: new Date(),
      comment: "Первый платёж",
    };
    const paymentHashPayload = { ...paymentPayload, paidAt: paymentPayload.paidAt.toISOString() };
    const firstPayment = await recordBrassPayment({
      ...paymentPayload,
      key: key("supplier-payment"),
      requestHash: createRequestHash(paymentHashPayload),
      actor: founderActor,
    });
    ids.payment = firstPayment.id;
    const paymentReplay = await recordBrassPayment({
      ...paymentPayload,
      key: key("supplier-payment"),
      requestHash: createRequestHash(paymentHashPayload),
      actor: founderActor,
    });
    assert.equal(paymentReplay.id, firstPayment.id, "double payment was not idempotent");
    assert.equal(
      await prisma.companyLedgerEntry.count({ where: { idempotencyKey: key("supplier-payment") } }),
      1,
    );
    await markBrassInTransit(ids.procurement, {
      userId: otherManager.id,
      role: Role.MANAGER,
      name: otherManager.name,
    });
    const receivePayload = {
      procurementId: ids.procurement,
      locationId: location.id,
      receivedAt: new Date(),
      cargoCostKzt: 15000,
      cargoProvider: "Test cargo",
      supplierDocumentNumber: "TEST-1",
      note: "Без повреждений",
    };
    const receiveHashPayload = { ...receivePayload, receivedAt: receivePayload.receivedAt.toISOString() };
    const received = await receiveBrassProcurement({
      ...receivePayload,
      key: key("receive"),
      requestHash: createRequestHash(receiveHashPayload),
      actor: { userId: otherManager.id, role: Role.MANAGER, name: otherManager.name },
    });
    assert.equal(received.status, "COST_FINALIZED");
    assert.equal(received.landedCostKzt, 135000);
    assert.equal(received.supplierBalanceKzt, 70000);
    assert.equal(received.cargoBalanceKzt, 15000);
    assert.equal(received.reminderTask?.status, "COMPLETED");
    assert.equal(Number(received.orderItem.reservedQuantity), 6);
    const receivedReplay = await receiveBrassProcurement({
      ...receivePayload,
      key: key("receive"),
      requestHash: createRequestHash(receiveHashPayload),
      actor: { userId: otherManager.id, role: Role.MANAGER, name: otherManager.name },
    });
    assert.equal(receivedReplay.landedCostKzt, 135000);
    assert.equal(
      await prisma.purchaseReceipt.count({ where: { batchId: ids.batch } }),
      1,
      "receipt retry created a duplicate",
    );

    for (const role of internalRoles) {
      const employeeView = await getOrderBrassProcurement(order.id, {
        userId: founder.id,
        role,
        name: founder.name,
      });
      assert.equal(
        employeeView?.landedCostKzt,
        135000,
        `${role} cannot see the full brass landed cost`,
      );
    }

    const economy = calculateOrderEconomy({
      totalSale: 500000,
      partnerAgreed: 200000,
      partnerAgreedAt: new Date(),
      brassProcurement: { status: received.status, landedCostKzt: received.landedCostKzt },
      ledgerEntries: [
        {
          direction: "EXPENSE",
          amount: 50000,
          source: "BRASS_PROCUREMENT_PAYMENT",
          category: "MATERIALS",
          type: "BRASS_SUPPLIER_PAYMENT",
          affectsProfit: false,
        },
      ],
    });
    assert.equal(Number(economy.profit.brass), 135000);
    assert.equal(Number(economy.profit.netProfit), 165000);
    assert.equal(Number(economy.cash.otherExpensesPaid), 50000);

    console.log("shared brass access, lifecycle, idempotency, reminder, landed cost and margin checks passed");
  } finally {
    if (ids.order) {
      await prisma.financeAuditEvent.deleteMany({ where: { orderId: ids.order } });
      await prisma.companyLedgerEntry.deleteMany({ where: { orderId: ids.order, source: "BRASS_PROCUREMENT_PAYMENT" } });
      await prisma.orderEvent.deleteMany({ where: { orderId: ids.order } });
    }
    if (ids.procurement)
      await prisma.orderBrassProcurement.deleteMany({ where: { id: ids.procurement } });
    if (ids.task) {
      await prisma.calendarTaskAudit.deleteMany({ where: { taskId: ids.task } });
      await prisma.calendarTaskResultAttachment.deleteMany({ where: { taskId: ids.task } });
      await prisma.calendarTask.deleteMany({ where: { id: ids.task } });
    }
    if (ids.material) {
      await prisma.inventoryCogsEntry.deleteMany({ where: { materialId: ids.material } });
      await prisma.inventoryValuationEntry.deleteMany({ where: { materialId: ids.material } });
      await prisma.materialReservation.deleteMany({ where: { materialId: ids.material, orderId: ids.order } });
      const receipts = ids.batch ? await prisma.purchaseReceipt.findMany({ where: { batchId: ids.batch }, select: { id: true, documentId: true } }) : [];
      const receiptIds = receipts.map((row) => row.id);
      const documentIds = receipts.map((row) => row.documentId);
      if (receiptIds.length) await prisma.purchaseReceiptLine.deleteMany({ where: { receiptId: { in: receiptIds } } });
      if (ids.batch) await prisma.purchaseReceipt.deleteMany({ where: { batchId: ids.batch } });
      if (documentIds.length) {
        await prisma.documentAudit.deleteMany({ where: { documentId: { in: documentIds } } });
        await prisma.documentVersion.deleteMany({ where: { documentId: { in: documentIds } } });
        await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
      }
      await prisma.materialMovement.deleteMany({ where: { materialId: ids.material } });
      if (ids.batch) {
        await prisma.purchaseCostRevision.deleteMany({ where: { batchId: ids.batch } });
        await prisma.purchaseAdditionalCost.deleteMany({ where: { batchId: ids.batch } });
        await prisma.purchaseBatchLine.deleteMany({ where: { batchId: ids.batch } });
        await prisma.purchaseBatch.deleteMany({ where: { id: ids.batch } });
      }
      await prisma.warehouseBalance.deleteMany({ where: { materialId: ids.material, locationId: ids.location } });
    }
    if (ids.orderItem) await prisma.orderItem.deleteMany({ where: { id: ids.orderItem } });
    if (attachmentId) await deleteAttachment(attachmentId, actor).catch(() => undefined);
    if (ids.order) await prisma.order.deleteMany({ where: { id: ids.order } });
    if (ids.client) await prisma.client.deleteMany({ where: { id: ids.client } });
    if (materialCreated && ids.material) await prisma.material.deleteMany({ where: { id: ids.material } });
    if (ids.locationAccess) await prisma.warehouseLocationAccess.deleteMany({ where: { id: ids.locationAccess } });
    if (ids.location) await prisma.warehouseLocation.deleteMany({ where: { id: ids.location } });
    await prisma.warehouseMutation.deleteMany({ where: { key: { startsWith: tag } } });
    if (ids.supplier) await prisma.supplier.deleteMany({ where: { id: ids.supplier } });
    if (ids.otherManager) await prisma.user.deleteMany({ where: { id: ids.otherManager } });
    if (ids.founder) await prisma.user.deleteMany({ where: { id: ids.founder } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
    await rm(process.env.TEST_BLOB_DIR!, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
