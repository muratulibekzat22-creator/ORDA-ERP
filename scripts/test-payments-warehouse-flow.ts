import "./require-test-database";

import assert from "node:assert/strict";

import { Role, StockCondition } from "@prisma/client";

import { createRequestHash } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import {
  ensurePaymentReceiptPdf,
  paymentReceiptPublicProjection,
  setPaymentReceiptPublicAccess,
} from "@/lib/services/payment-receipt.service";
import { createPayment } from "@/lib/services/payment.service";
import { createPaymentRefund } from "@/lib/services/refund.service";
import {
  createRetailSale,
  createWarehouseReturn,
  createWarehouseShipment,
  fillMiniSpigotFacts,
  getWarehouseLocations,
  transferWarehouseStock,
} from "@/lib/services/warehouse-retail.service";
import {
  getWarehouse,
  updateMaterialCommand,
  WarehouseError,
  type WarehouseActor,
} from "@/lib/services/warehouse.service";

const tag = `payments-warehouse-flow-${Date.now()}`;
const key = (value: string) => `${tag}:${value}`;

function hash(value: unknown) {
  return createRequestHash(value);
}

function asResult<T>(value: unknown) {
  return value as T;
}

async function expectWarehouseError(work: () => Promise<unknown>, code: WarehouseError["code"]) {
  await assert.rejects(work, (error: unknown) => error instanceof WarehouseError && error.code === code);
}

async function main() {
  const leaderUser = await prisma.user.findFirstOrThrow({
    where: { role: Role.OPERATIONS_DIRECTOR, active: true },
  });
  const managerUser = await prisma.user.create({
    data: {
      name: `${tag}-manager`,
      email: `${tag}@test.local`,
      password: "test-only",
      role: Role.MANAGER,
    },
  });
  const leader: WarehouseActor = { userId: leaderUser.id, role: leaderUser.role, name: leaderUser.name };
  const manager: WarehouseActor = { userId: managerUser.id, role: managerUser.role, name: managerUser.name };
  const leaderDocumentActor = { userId: leaderUser.id, role: leaderUser.role, name: leaderUser.name };
  const defaultLocation = await prisma.warehouseLocation.findFirstOrThrow({ where: { isDefault: true, active: true } });
  await prisma.warehouseLocationAccess.create({
    data: { userId: managerUser.id, locationId: defaultLocation.id, canSell: true, canReceive: false, canAdjust: false },
  });

  const variants = await prisma.material.findMany({
    where: { variantGroup: "MINI_SPIGOT_200", active: true },
    orderBy: { code: "asc" },
  });
  assert.equal(variants.length, 4, "migration must create exactly four mini-spigot variants");
  assert.deepEqual(
    variants.map((item) => item.code).sort(),
    ["MSP-200-BLACK-MATTE", "MSP-200-GOLD", "MSP-200-ROSE-GOLD", "MSP-200-WHITE"],
  );
  assert(variants.every((item) => !item.quantityKnown && item.purchasePrice === null && item.sellingPrice === null));
  assert(variants.every((item) => item.mainImagePath === null), "bundled catalog images must not impersonate a private uploaded blob");
  assert(!variants.some((item) => /gray|grey|сер(?:ая|ый|ое)/iu.test(`${item.name} ${item.color ?? ""}`)));

  const black = variants.find((item) => item.code === "MSP-200-BLACK-MATTE")!;
  const gold = variants.find((item) => item.code === "MSP-200-GOLD")!;
  const rose = variants.find((item) => item.code === "MSP-200-ROSE-GOLD")!;
  const white = variants.find((item) => item.code === "MSP-200-WHITE")!;

  await expectWarehouseError(
    () => createRetailSale({
      locationId: defaultLocation.id,
      walkIn: true,
      items: [{ materialId: rose.id, quantity: 1 }],
      issueNow: false,
      key: key("unknown-sale"),
      requestHash: hash({ materialId: rose.id, quantity: 1 }),
      actor: manager,
    }),
    "INVALID_OPERATION",
  );
  await expectWarehouseError(
    () => updateMaterialCommand({
      id: black.id,
      data: { purchasePrice: 1 },
      key: key("manager-cost"),
      requestHash: hash({ purchasePrice: 1 }),
      actor: manager,
    }),
    "FORBIDDEN",
  );

  const factsPayload = {
    locationId: defaultLocation.id,
    rows: [
      { materialId: black.id, quantity: 30, purchasePrice: 10_000, sellingPrice: 15_000 },
      { materialId: gold.id, quantity: 2, sellingPrice: 5_000 },
    ],
  };
  const facts = await fillMiniSpigotFacts({
    ...factsPayload,
    key: key("facts"),
    requestHash: hash(factsPayload),
    actor: leader,
  });
  const factsReplay = await fillMiniSpigotFacts({
    ...factsPayload,
    key: key("facts"),
    requestHash: hash(factsPayload),
    actor: leader,
  });
  assert.equal(facts.replayed, false);
  assert.equal(factsReplay.replayed, true);

  const leadershipWarehouse = await getWarehouse(leader);
  const managerWarehouse = await getWarehouse(manager);
  const leadershipGold = leadershipWarehouse.materials.find((item) => item.id === gold.id) as unknown as Record<string, unknown>;
  const managerBlack = managerWarehouse.materials.find((item) => item.id === black.id) as unknown as Record<string, unknown>;
  assert.equal(leadershipGold.marginStatus, "Маржа не рассчитана");
  for (const field of ["purchasePrice", "averageCost", "inventoryValue", "valuationVersion", "costStatus"])
    assert(!(field in managerBlack), `manager response leaked ${field}`);
  assert(!((managerBlack.alerts as string[] | undefined) ?? []).includes("NO_COST"), "manager response leaked cost state");

  const salePayload = {
    locationId: defaultLocation.id,
    client: { name: `${tag}-client`, phone: "+7 777 123 45 67", city: "Алматы", address: "Тестовый адрес" },
    items: [{ materialId: black.id, quantity: 6, discount: 0 }],
    payment: {
      amount: 30_000,
      parts: [
        { method: "Наличные", amount: 10_000 },
        { method: "Kaspi перевод", amount: 20_000 },
      ],
      comment: "Тестовая предоплата",
    },
    issueNow: false,
  };
  const sale = await createRetailSale({
    ...salePayload,
    key: key("sale"),
    requestHash: hash(salePayload),
    actor: manager,
  });
  const saleReplay = await createRetailSale({
    ...salePayload,
    key: key("sale"),
    requestHash: hash(salePayload),
    actor: manager,
  });
  assert.equal(sale.replayed, false);
  assert.equal(saleReplay.replayed, true);
  assert.equal(sale.receiptPdfStatus, "READY");
  const saleResult = asResult<{ orderId: number; paymentId: number }>(sale.result);
  assert.equal(saleResult.orderId, asResult<{ orderId: number }>(saleReplay.result).orderId);

  let order = await prisma.order.findUniqueOrThrow({ where: { id: saleResult.orderId }, include: { items: true } });
  let blackBalance = await prisma.warehouseBalance.findUniqueOrThrow({
    where: { materialId_locationId: { materialId: black.id, locationId: defaultLocation.id } },
  });
  assert.equal(Number(order.amount), 90_000);
  assert.equal(Number(order.prepayment), 30_000);
  assert.equal(Number(order.balance), 60_000);
  assert.equal(Number(blackBalance.stock), 30);
  assert.equal(Number(blackBalance.reserved), 6);
  assert.equal(Number(blackBalance.stock.sub(blackBalance.reserved)), 24);
  assert.equal(await prisma.payment.count({ where: { orderId: order.id, type: "CLIENT_PAYMENT" } }), 1);
  assert.equal(await prisma.paymentReceipt.count({ where: { orderId: order.id } }), 1);

  const firstReceipt = await prisma.paymentReceipt.findUniqueOrThrow({
    where: { paymentId: saleResult.paymentId },
    include: { document: { include: { versions: true } } },
  });
  const immutableReceiptSnapshot = JSON.stringify(firstReceipt.snapshot);
  assert.equal(firstReceipt.document.versions.length, 1);
  assert(await paymentReceiptPublicProjection(firstReceipt.verificationToken));
  await ensurePaymentReceiptPdf(saleResult.paymentId);
  assert.equal(await prisma.documentVersion.count({ where: { documentId: firstReceipt.documentId } }), 1);
  await setPaymentReceiptPublicAccess(firstReceipt.id, false, leaderDocumentActor);
  assert.equal(await paymentReceiptPublicProjection(firstReceipt.verificationToken), null);

  await updateMaterialCommand({
    id: black.id,
    data: { sellingPrice: 16_000 },
    key: key("price-change"),
    requestHash: hash({ sellingPrice: 16_000 }),
    actor: leaderDocumentActor,
  });
  const unchangedReceipt = await prisma.paymentReceipt.findUniqueOrThrow({ where: { id: firstReceipt.id } });
  assert.equal(JSON.stringify(unchangedReceipt.snapshot), immutableReceiptSnapshot);

  const secondPaymentPayload = {
    orderId: order.id,
    amount: 60_000,
    method: "Банковская карта",
    type: "payment",
    comment: "Окончательный расчёт",
    author: manager.name ?? "Менеджер",
    authorId: manager.userId,
    idempotencyKey: key("second-payment"),
    requestHash: hash({ orderId: order.id, amount: 60_000, method: "Банковская карта" }),
    parts: [{ method: "Банковская карта", amount: 60_000 }],
  };
  const duplicatePayments = await Promise.all([
    createPayment(secondPaymentPayload),
    createPayment(secondPaymentPayload),
  ]);
  assert(duplicatePayments.every(Boolean));
  order = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
  assert.equal(Number(order.prepayment), 90_000);
  assert.equal(Number(order.balance), 0);
  assert.equal(await prisma.payment.count({ where: { orderId: order.id, type: "CLIENT_PAYMENT" } }), 2);
  assert.equal(await prisma.paymentReceipt.count({ where: { orderId: order.id } }), 2);

  const orderItem = order.items[0];
  const shipmentPayload = {
    orderId: order.id,
    locationId: defaultLocation.id,
    lines: [{ orderItemId: orderItem.id, quantity: 6 }],
    recipientName: `${tag}-client`,
  };
  const shipment = await createWarehouseShipment({
    ...shipmentPayload,
    key: key("shipment"),
    requestHash: hash(shipmentPayload),
    actor: manager,
  });
  const shipmentReplay = await createWarehouseShipment({
    ...shipmentPayload,
    key: key("shipment"),
    requestHash: hash(shipmentPayload),
    actor: manager,
  });
  assert.equal(shipment.replayed, false);
  assert.equal(shipmentReplay.replayed, true);
  assert.equal(shipment.pdfStatus, "READY");
  const shipmentResult = asResult<{ shipmentId: number; documentId: number }>(shipment.result);
  blackBalance = await prisma.warehouseBalance.findUniqueOrThrow({
    where: { materialId_locationId: { materialId: black.id, locationId: defaultLocation.id } },
  });
  assert.equal(Number(blackBalance.stock), 24);
  assert.equal(Number(blackBalance.reserved), 0);
  assert.equal(await prisma.warehouseShipment.count({ where: { orderId: order.id } }), 1);
  assert.equal(await prisma.documentVersion.count({ where: { documentId: shipmentResult.documentId } }), 1);

  const shipmentLine = await prisma.warehouseShipmentLine.findFirstOrThrow({ where: { shipmentId: shipmentResult.shipmentId } });
  const returnPayload = {
    shipmentId: shipmentResult.shipmentId,
    locationId: defaultLocation.id,
    reason: "Контрольный возврат двух пригодных стоек",
    lines: [{ shipmentLineId: shipmentLine.id, quantity: 2, condition: StockCondition.SELLABLE }],
  };
  const goodsReturn = await createWarehouseReturn({
    ...returnPayload,
    key: key("goods-return"),
    requestHash: hash(returnPayload),
    actor: leaderDocumentActor,
  });
  const goodsReturnReplay = await createWarehouseReturn({
    ...returnPayload,
    key: key("goods-return"),
    requestHash: hash(returnPayload),
    actor: leader,
  });
  assert.equal(goodsReturn.replayed, false);
  assert.equal(goodsReturnReplay.replayed, true);
  blackBalance = await prisma.warehouseBalance.findUniqueOrThrow({
    where: { materialId_locationId: { materialId: black.id, locationId: defaultLocation.id } },
  });
  order = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
  assert.equal(Number(blackBalance.stock), 26);
  assert.equal(Number(order.amount), 60_000);
  assert.equal(Number(order.prepayment), 90_000);
  assert.equal(Number(order.balance), 0);

  const refundPayload = {
    originalPaymentId: saleResult.paymentId,
    amount: 30_000,
    parts: [{ method: "Наличные", amount: 30_000 }],
    reason: "Возврат денег за две принятые стойки",
  };
  const refund = await createPaymentRefund({
    ...refundPayload,
    key: key("refund"),
    requestHash: hash(refundPayload),
    actor: leaderDocumentActor,
  });
  const refundReplay = await createPaymentRefund({
    ...refundPayload,
    key: key("refund"),
    requestHash: hash(refundPayload),
    actor: leaderDocumentActor,
  });
  assert.equal(refund.created, true);
  assert.equal(refundReplay.created, false);
  assert.equal(refund.pdfStatus, "READY");
  order = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
  assert.equal(Number(order.amount), 60_000);
  assert.equal(Number(order.prepayment), 60_000);
  assert.equal(Number(order.balance), 0);
  const payments = await prisma.payment.findMany({ where: { orderId: order.id } });
  const netPaid = payments.reduce((sum, payment) => sum + Number(payment.amount) * (payment.type === "REFUND" ? -1 : 1), 0);
  assert.equal(netPaid, 60_000);
  assert.equal(payments.filter((payment) => payment.type === "REFUND").length, 1);

  const secondLocation = await prisma.warehouseLocation.create({
    data: { code: `${Date.now()}-SHOWROOM`, name: `${tag}-showroom`, type: "OFFICE", address: "Тестовый шоурум" },
  });
  const transferPayload = {
    materialId: black.id,
    fromLocationId: defaultLocation.id,
    toLocationId: secondLocation.id,
    quantity: 1,
    reason: "Контрольное перемещение",
  };
  const transfer = await transferWarehouseStock({
    ...transferPayload,
    key: key("transfer"),
    requestHash: hash(transferPayload),
    actor: leader,
  });
  const transferReplay = await transferWarehouseStock({
    ...transferPayload,
    key: key("transfer"),
    requestHash: hash(transferPayload),
    actor: leader,
  });
  assert.equal(transfer.replayed, false);
  assert.equal(transferReplay.replayed, true);
  const transferBalances = await prisma.warehouseBalance.findMany({ where: { materialId: black.id } });
  assert.equal(transferBalances.reduce((sum, balance) => sum + Number(balance.stock), 0), 26);
  assert.equal(Number(transferBalances.find((balance) => balance.locationId === defaultLocation.id)?.stock), 25);
  assert.equal(Number(transferBalances.find((balance) => balance.locationId === secondLocation.id)?.stock), 1);
  assert.equal((await getWarehouseLocations(manager)).length, 1, "manager must only see the explicitly allowed location");

  const clientId = order.clientId;
  const duplicateLineOrder = await prisma.order.create({
    data: {
      number: `${tag}-duplicate-lines`,
      clientId,
      address: "Тест",
      staircase: "Розничная продажа",
      material: "Складские товары",
      amount: 10_000,
      balance: 10_000,
      manager: managerUser.name,
      managerUserId: managerUser.id,
      orderKind: "RETAIL",
      fulfillmentStatus: "PENDING_ISSUE",
    },
  });
  const duplicateItems = await Promise.all([0, 1].map((position) => prisma.orderItem.create({
    data: {
      orderId: duplicateLineOrder.id,
      materialId: gold.id,
      skuSnapshot: gold.code ?? `MAT-${gold.id}`,
      nameSnapshot: gold.name,
      variantSnapshot: gold.color,
      unitSnapshot: gold.unit,
      quantity: 1,
      unitPrice: 5_000,
      lineTotal: 5_000,
      unitCostSnapshot: null,
      position,
    },
  })));
  await createWarehouseShipment({
    orderId: duplicateLineOrder.id,
    locationId: defaultLocation.id,
    lines: duplicateItems.map((item) => ({ orderItemId: item.id, quantity: 1 })),
    key: key("duplicate-material-lines"),
    requestHash: hash({ orderId: duplicateLineOrder.id, lines: duplicateItems.map((item) => item.id) }),
    actor: manager,
  });
  const goldBalance = await prisma.warehouseBalance.findUniqueOrThrow({
    where: { materialId_locationId: { materialId: gold.id, locationId: defaultLocation.id } },
  });
  assert.equal(Number(goldBalance.stock), 0, "both rows of the same material must reduce stock");
  assert.equal(await prisma.inventoryCogsEntry.count({ where: { orderId: duplicateLineOrder.id } }), 0, "unknown cost must not create false COGS");

  const whiteFacts = {
    locationId: defaultLocation.id,
    rows: [{ materialId: white.id, quantity: 1, purchasePrice: 500, sellingPrice: 1_000 }],
  };
  await fillMiniSpigotFacts({ ...whiteFacts, key: key("white-facts"), requestHash: hash(whiteFacts), actor: leader });
  const concurrentPayload = (suffix: string) => ({
    locationId: defaultLocation.id,
    clientId,
    items: [{ materialId: white.id, quantity: 1 }],
    issueNow: false,
    key: key(`last-unit-${suffix}`),
    requestHash: hash({ materialId: white.id, quantity: 1, suffix }),
    actor: manager,
  });
  const concurrent = await Promise.allSettled([
    createRetailSale(concurrentPayload("a")),
    createRetailSale(concurrentPayload("b")),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
  const whiteBalance = await prisma.warehouseBalance.findUniqueOrThrow({
    where: { materialId_locationId: { materialId: white.id, locationId: defaultLocation.id } },
  });
  assert.equal(Number(whiteBalance.stock), 1);
  assert.equal(Number(whiteBalance.reserved), 1);

  console.log("payments/warehouse isolated flow passed: 4 variants, 30→24→26 stock, 90k→60k net paid, PDFs, idempotency, locations and concurrency");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
