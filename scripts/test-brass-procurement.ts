import "./require-test-database";

import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { Role } from "@prisma/client";

import { createRequestHash } from "../lib/idempotency";
import { calculateOrderEconomy } from "../lib/orders/economy";
import { prisma } from "../lib/prisma";
import { deleteAttachment } from "../lib/services/attachment.service";
import {
  createBrassProcurement,
  getOrderBrassProcurement,
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
  let actor = { userId: 0, role: Role.DIRECTOR, name: tag };
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
        role: Role.DIRECTOR,
      },
    });
    ids.user = user.id;
    actor = { ...actor, userId: user.id };
    const supplier = await prisma.supplier.create({
      data: {
        demoKey: tag,
        name: tag,
        phoneMask: "",
        city: "Test",
        country: "KZ",
        defaultCurrency: "KZT",
      },
    });
    ids.supplier = supplier.id;
    const location = await prisma.warehouseLocation.create({
      data: { code: tag, name: tag, type: "WAREHOUSE", isDefault: false },
    });
    ids.location = location.id;
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
      actor,
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
      actor,
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
      actor,
    });
    ids.payment = firstPayment.id;
    const paymentReplay = await recordBrassPayment({
      ...paymentPayload,
      key: key("supplier-payment"),
      requestHash: createRequestHash(paymentHashPayload),
      actor,
    });
    assert.equal(paymentReplay.id, firstPayment.id, "double payment was not idempotent");
    assert.equal(
      await prisma.companyLedgerEntry.count({ where: { idempotencyKey: key("supplier-payment") } }),
      1,
    );
    await assert.rejects(
      () =>
        recordBrassPayment({
          ...paymentPayload,
          key: key("operations-director-payment"),
          requestHash: createRequestHash(paymentHashPayload),
          actor: { ...actor, role: Role.OPERATIONS_DIRECTOR },
        }),
      /FORBIDDEN/,
      "operations director bypassed protected financial payment",
    );

    await markBrassInTransit(ids.procurement, actor);
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
      actor,
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
      actor,
    });
    assert.equal(receivedReplay.landedCostKzt, 135000);
    assert.equal(
      await prisma.purchaseReceipt.count({ where: { batchId: ids.batch } }),
      1,
      "receipt retry created a duplicate",
    );

    const directorView = await getOrderBrassProcurement(order.id, actor);
    assert.equal(directorView?.landedCostKzt, 135000);
    const managerView = await getOrderBrassProcurement(order.id, {
      ...actor,
      role: Role.MANAGER,
    });
    assert.equal(managerView?.landedCostKzt, 0, "manager received internal landed cost");

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

    console.log("brass procurement lifecycle, idempotency, reminder, landed cost and margin checks passed");
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
    if (ids.location) await prisma.warehouseLocation.deleteMany({ where: { id: ids.location } });
    await prisma.warehouseMutation.deleteMany({ where: { key: { startsWith: tag } } });
    if (ids.supplier) await prisma.supplier.deleteMany({ where: { id: ids.supplier } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
    await rm(process.env.TEST_BLOB_DIR!, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
