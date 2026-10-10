import { randomUUID } from "node:crypto";

import {
  DocumentSource,
  DocumentStatus,
  DocumentType,
  Prisma,
  Role,
  StockCondition,
  WarehouseShipmentStatus,
} from "@prisma/client";

import { companyDisplayPhones } from "@/lib/company-contacts";
import type { WarehouseShipmentSnapshot } from "@/lib/documents/warehouse-shipment-pdf";
import { WAREHOUSE_SHIPMENT_TEMPLATE_VERSION } from "@/lib/documents/warehouse-shipment-pdf";
import { compareRequestHash, isPrismaUniqueConflict } from "@/lib/idempotency";
import { normalizePhone } from "@/lib/leads/domain";
import { prisma } from "@/lib/prisma";
import { nextBusinessDocumentNumber } from "@/lib/services/business-document-number.service";
import { createPaymentReceiptRecord, ensurePaymentReceiptPdf } from "@/lib/services/payment-receipt.service";
import { ensureWarehouseShipmentPdf } from "@/lib/services/warehouse-document.service";
import { WarehouseError, type WarehouseActor } from "@/lib/services/warehouse.service";
import { requireTenantIdentity } from "@/lib/tenant-context";
import { isInternalWarehouseRole } from "@/lib/warehouse-access";

const RETRIES = 6;

type MutationResult = Record<string, unknown>;
type PaymentPartInput = { method: string; amount: number; reference?: string };
type ShipmentLineInput = { orderItemId: number; quantity: number };

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function decimal(value: number, scale: number, code = "INVALID_OPERATION") {
  if (!Number.isFinite(value)) throw new WarehouseError(code as "INVALID_OPERATION");
  const result = new Prisma.Decimal(value);
  if (result.decimalPlaces() > scale) throw new WarehouseError(code as "INVALID_OPERATION");
  return result;
}

async function idempotent<T extends MutationResult>(input: {
  key: string;
  requestHash: string;
  action: string;
  actor: WarehouseActor;
  work: (tx: Prisma.TransactionClient) => Promise<T>;
}) {
  const existing = await prisma.warehouseMutation.findUnique({ where: { key: input.key } });
  if (existing) {
    if (!compareRequestHash(existing.requestHash, input.requestHash)) throw new WarehouseError("IDEMPOTENCY_CONFLICT");
    return { result: existing.result as T, replayed: true };
  }
  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const replay = await tx.warehouseMutation.findUnique({ where: { key: input.key } });
        if (replay) {
          if (!compareRequestHash(replay.requestHash, input.requestHash)) throw new WarehouseError("IDEMPOTENCY_CONFLICT");
          return replay.result as T;
        }
        const value = await input.work(tx);
        await tx.warehouseMutation.create({
          data: { key: input.key, requestHash: input.requestHash, action: input.action, actorId: input.actor.userId, result: json(value) },
        });
        return value;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
      return { result, replayed: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < RETRIES - 1) continue;
      if (isPrismaUniqueConflict(error)) {
        const replay = await prisma.warehouseMutation.findUnique({ where: { key: input.key } });
        if (replay && compareRequestHash(replay.requestHash, input.requestHash)) return { result: replay.result as T, replayed: true };
      }
      throw error;
    }
  }
  throw new WarehouseError("IDEMPOTENCY_CONFLICT");
}

async function locationFor(
  tx: Prisma.TransactionClient,
  actor: WarehouseActor,
  locationId: number,
  permission: "sell" | "receive" | "adjust",
) {
  const location = await tx.warehouseLocation.findFirst({ where: { id: locationId, active: true } });
  if (!location) throw new WarehouseError("NOT_FOUND");
  if (!isInternalWarehouseRole(actor.role)) throw new WarehouseError("FORBIDDEN");
  void permission;
  return location;
}

async function balanceFor(tx: Prisma.TransactionClient, materialId: number, locationId: number) {
  await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${materialId}, ${0})`;
  await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${materialId}, ${locationId})`;
  const { companyId } = requireTenantIdentity();
  return tx.warehouseBalance.upsert({
    where: { materialId_locationId: { materialId, locationId } },
    create: { companyId, materialId, locationId, stock: 0, reserved: 0 },
    update: {},
  });
}

async function syncMaterialTotals(tx: Prisma.TransactionClient, materialId: number) {
  const balances = await tx.warehouseBalance.findMany({
    where: { materialId, location: { type: { not: "QUARANTINE" } } },
    select: { stock: true, reserved: true },
  });
  const stock = balances.reduce((sum, item) => sum.add(item.stock), new Prisma.Decimal(0));
  const reserved = balances.reduce((sum, item) => sum.add(item.reserved), new Prisma.Decimal(0));
  await tx.material.update({
    where: { id: materialId },
    data: {
      stock: stock.toNumber(),
      reserved: reserved.toNumber(),
    },
  });
  return { stock, reserved };
}

async function assertOrderAccess(tx: Prisma.TransactionClient, actor: WarehouseActor, orderId: number) {
  const order = await tx.order.findFirst({
    where: { id: orderId, deletedAt: null },
    include: { client: true },
  });
  if (!order) throw new WarehouseError("NOT_FOUND");
  if (!isInternalWarehouseRole(actor.role))
    throw new WarehouseError("FORBIDDEN");
  return order;
}

function validatePayment(amount: number, parts: PaymentPartInput[]) {
  const total = decimal(amount, 2);
  if (!total.isPositive() || !parts.length) throw new WarehouseError("INVALID_OPERATION");
  const normalized = parts.map((part) => ({
    method: part.method.trim(),
    amount: decimal(part.amount, 2),
    reference: part.reference?.trim() || undefined,
  }));
  if (normalized.some((part) => !part.method || !part.amount.isPositive())) throw new WarehouseError("INVALID_OPERATION");
  if (!normalized.reduce((sum, part) => sum.add(part.amount), new Prisma.Decimal(0)).equals(total))
    throw new WarehouseError("INVALID_OPERATION");
  return { total, parts: normalized, method: normalized.length > 1 ? "MIXED" : normalized[0].method };
}

export async function getWarehouseLocations(actor: WarehouseActor) {
  if (actor.role === Role.PARTNER) throw new WarehouseError("FORBIDDEN");
  const locations = await prisma.warehouseLocation.findMany({
    where: { active: true },
    include: { access: { where: { userId: actor.userId }, select: { canSell: true, canReceive: true, canAdjust: true } } },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return locations;
}

export async function fillMiniSpigotFacts(input: {
  locationId: number;
  rows: Array<{ materialId: number; quantity?: number; purchasePrice?: number | null; sellingPrice?: number | null }>;
  key: string;
  requestHash: string;
  actor: WarehouseActor;
}) {
  if (!isInternalWarehouseRole(input.actor.role)) throw new WarehouseError("FORBIDDEN");
  if (!input.rows.length || new Set(input.rows.map((row) => row.materialId)).size !== input.rows.length)
    throw new WarehouseError("INVALID_OPERATION");
  return idempotent({
    key: input.key,
    requestHash: input.requestHash,
    action: "mini-spigots.fill-facts",
    actor: input.actor,
    work: async (tx) => {
      await locationFor(tx, input.actor, input.locationId, "adjust");
      const changes: Array<Record<string, unknown>> = [];
      for (const row of input.rows) {
        let material = await tx.material.findFirst({ where: { id: row.materialId, active: true, variantGroup: "MINI_SPIGOT_200" } });
        if (!material) throw new WarehouseError("NOT_FOUND");
        await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${material.id}, ${0})`;
        material = await tx.material.findFirst({ where: { id: row.materialId, active: true, variantGroup: "MINI_SPIGOT_200" } });
        if (!material) throw new WarehouseError("NOT_FOUND");
        const audits: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
        if (row.quantity !== undefined) {
          const target = decimal(row.quantity, material.quantityPrecision);
          if (target.isNegative()) throw new WarehouseError("INVALID_OPERATION");
          const balance = await balanceFor(tx, material.id, input.locationId);
          if (target.lt(balance.reserved)) throw new WarehouseError("INSUFFICIENT_RESERVED");
          const delta = target.sub(balance.stock);
          await tx.warehouseBalance.update({ where: { id: balance.id }, data: { stock: target } });
          if (!delta.isZero()) {
            const openingCost = row.purchasePrice ?? material.purchasePrice;
            await tx.materialMovement.create({ data: {
              materialId: material.id,
              locationId: input.locationId,
              type: "opening_adjustment",
              quantity: delta.abs().toNumber(),
              stockDelta: delta.toNumber(),
              reserveDelta: 0,
              stockAfter: target.toNumber(),
              reservedAfter: balance.reserved.toNumber(),
              employeeId: input.actor.userId,
              price: openingCost ?? 0,
              amount: openingCost === null ? 0 : delta.abs().mul(openingCost).toDecimalPlaces(2),
              unitCostSnapshot: openingCost,
              valuationMethod: openingCost === null ? null : "MOVING_WEIGHTED_AVERAGE",
              valuationVersion: openingCost === null ? null : material.valuationVersion + 1,
              comment: "Фактический начальный остаток",
              idempotencyKey: `opening:${input.key}:${material.id}`,
              requestHash: input.requestHash,
            } });
          }
          audits.push({ field: "quantity", oldValue: material.quantityKnown ? String(balance.stock) : null, newValue: target.toString() });
        }
        if (row.purchasePrice !== undefined)
          audits.push({ field: "purchasePrice", oldValue: material.purchasePrice?.toString() ?? null, newValue: row.purchasePrice == null ? null : String(row.purchasePrice) });
        if (row.sellingPrice !== undefined)
          audits.push({ field: "sellingPrice", oldValue: material.sellingPrice?.toString() ?? null, newValue: row.sellingPrice == null ? null : String(row.sellingPrice) });
        const totals = await syncMaterialTotals(tx, material.id);
        const valuation = row.purchasePrice !== undefined
          ? row.purchasePrice === null
            ? { purchasePrice: null }
            : { purchasePrice: row.purchasePrice, averageCost: row.purchasePrice, inventoryValue: totals.stock.mul(row.purchasePrice).toDecimalPlaces(2) }
          : row.quantity !== undefined && material.purchasePrice !== null
            ? { inventoryValue: totals.stock.mul(material.averageCost).toDecimalPlaces(2) }
            : {};
        await tx.material.update({
          where: { id: material.id },
          data: {
            availabilityConfirmed: true,
            ...(row.quantity !== undefined ? { quantityKnown: true } : {}),
            ...valuation,
            ...(row.sellingPrice !== undefined ? { sellingPrice: row.sellingPrice } : {}),
          },
        });
        if (row.sellingPrice != null && material.sellingPrice?.toString() !== String(row.sellingPrice))
          await tx.materialPriceHistory.create({ data: { materialId: material.id, sellingPrice: row.sellingPrice, changedById: input.actor.userId } });
        for (const audit of audits) await tx.materialChangeAudit.create({
          data: { materialId: material.id, ...audit, reason: "Ручное заполнение фактических данных", actorId: input.actor.userId },
        });
        changes.push({ materialId: material.id, stock: totals.stock.toString(), reserved: totals.reserved.toString() });
      }
      return { changes };
    },
  });
}

async function companySnapshot(tx: Prisma.TransactionClient) {
  const settings = await tx.companySettings.upsert({ where: { companyId: requireTenantIdentity().companyId }, create: {}, update: {} });
  return {
    name: settings.name,
    bin: settings.bin,
    address: settings.actualAddress || settings.legalAddress,
    phones: companyDisplayPhones(settings),
    bankDetails: settings.bankDetails,
  };
}

async function postShipment(tx: Prisma.TransactionClient, input: {
  orderId: number;
  locationId: number;
  lines: ShipmentLineInput[];
  recipientName?: string;
  key: string;
  requestHash: string;
  actor: WarehouseActor;
}) {
  const order = await assertOrderAccess(tx, input.actor, input.orderId);
  const location = await locationFor(tx, input.actor, input.locationId, "sell");
  if (!input.lines.length || new Set(input.lines.map((line) => line.orderItemId)).size !== input.lines.length)
    throw new WarehouseError("INVALID_OPERATION");
  const prepared: Array<{
    item: Awaited<ReturnType<typeof tx.orderItem.findFirst>> & object;
    material: Awaited<ReturnType<typeof tx.material.findUniqueOrThrow>>;
    quantity: Prisma.Decimal;
    balanceId: number;
    balanceStock: Prisma.Decimal;
    balanceReserved: Prisma.Decimal;
    reservationId?: number;
    reservedUsed: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
  }> = [];
  const projectedBalances = new Map<number, { stock: Prisma.Decimal; reserved: Prisma.Decimal }>();
  for (const requested of input.lines) {
    const quantity = decimal(requested.quantity, 3);
    if (!quantity.isPositive()) throw new WarehouseError("INVALID_OPERATION");
    const item = await tx.orderItem.findFirst({ where: { id: requested.orderItemId, orderId: order.id, stockTracked: true } });
    if (!item || !item.materialId || quantity.gt(item.quantity.sub(item.issuedQuantity))) throw new WarehouseError("INVALID_OPERATION");
    let material = await tx.material.findUniqueOrThrow({ where: { id: item.materialId } });
    if (!material.quantityKnown) throw new WarehouseError("INVALID_OPERATION");
    if (quantity.decimalPlaces() > material.quantityPrecision) throw new WarehouseError("INVALID_OPERATION");
    const balance = await balanceFor(tx, material.id, location.id);
    material = await tx.material.findUniqueOrThrow({ where: { id: item.materialId } });
    if (!material.quantityKnown) throw new WarehouseError("INVALID_OPERATION");
    const projected = projectedBalances.get(material.id) ?? {
      stock: new Prisma.Decimal(balance.stock),
      reserved: new Prisma.Decimal(balance.reserved),
    };
    const reservation = await tx.materialReservation.findFirst({ where: { orderItemId: item.id, locationId: location.id, status: "ACTIVE" } });
    const reservationQuantity = reservation ? new Prisma.Decimal(reservation.quantity) : new Prisma.Decimal(0);
    const reservedUsed = Prisma.Decimal.min(quantity, reservationQuantity);
    const outsideReservation = quantity.sub(reservedUsed);
    if (projected.stock.lt(quantity)) throw new WarehouseError("INSUFFICIENT_STOCK");
    if (projected.stock.sub(projected.reserved).lt(outsideReservation)) throw new WarehouseError("INSUFFICIENT_AVAILABLE");
    const ratio = quantity.div(item.quantity);
    const lineTotal = item.unitPrice.mul(quantity).sub(item.discount.mul(ratio)).toDecimalPlaces(2);
    prepared.push({ item: item as typeof prepared[number]["item"], material, quantity, balanceId: balance.id, balanceStock: projected.stock, balanceReserved: projected.reserved, reservationId: reservation?.id, reservedUsed, lineTotal });
    projectedBalances.set(material.id, {
      stock: projected.stock.sub(quantity),
      reserved: projected.reserved.sub(reservedUsed),
    });
  }
  const shippedAt = new Date();
  const number = await nextBusinessDocumentNumber(tx, "OUT", shippedAt);
  const contract = await tx.document.findFirst({ where: { orderId: order.id, type: DocumentType.CONTRACT, status: { in: [DocumentStatus.READY, DocumentStatus.SIGNED] } }, orderBy: [{ documentDate: "desc" }, { id: "desc" }], select: { number: true } });
  const company = await companySnapshot(tx);
  const amount = prepared.reduce((sum, row) => sum.add(row.lineTotal), new Prisma.Decimal(0));
  const discount = prepared.reduce((sum, row) => sum.add(row.item.discount.mul(row.quantity.div(row.item.quantity))), new Prisma.Decimal(0));
  const snapshot: WarehouseShipmentSnapshot = {
    templateVersion: WAREHOUSE_SHIPMENT_TEMPLATE_VERSION,
    number,
    shippedAt: shippedAt.toISOString(),
    company,
    buyer: { name: order.client.name, iinBin: order.client.iin, phone: order.client.phone, address: order.client.address },
    basis: contract?.number ? `Заказ № ${order.number}, договор № ${contract.number}` : `Заказ № ${order.number}`,
    warehouse: { id: location.id, name: location.name, address: location.address },
    order: { id: order.id, number: order.number, contractNumber: contract?.number ?? null },
    issuedBy: { userId: input.actor.userId, name: input.actor.name || "Сотрудник ORDA" },
    recipientName: input.recipientName || order.client.name,
    items: prepared.map((row) => ({
      sku: row.item.skuSnapshot,
      name: row.item.nameSnapshot,
      variant: row.item.variantSnapshot,
      unit: row.item.unitSnapshot,
      quantity: row.quantity.toNumber(),
      unitPrice: row.item.unitPrice.toNumber(),
      discount: row.item.discount.mul(row.quantity.div(row.item.quantity)).toNumber(),
      total: row.lineTotal.toNumber(),
    })),
    totals: { amount: amount.toNumber(), discount: discount.toNumber() },
  };
  const document = await tx.document.create({
    data: {
      orderId: order.id,
      clientId: order.clientId,
      type: DocumentType.OUTGOING_INVOICE,
      number,
      title: `Расходная накладная ${number}`,
      documentDate: shippedAt,
      status: DocumentStatus.DRAFT,
      source: DocumentSource.GENERATED_WAREHOUSE,
      authorId: input.actor.userId,
      templateVersion: WAREHOUSE_SHIPMENT_TEMPLATE_VERSION,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      idempotencyKey: `shipment-document:${input.key}`,
      requestHash: input.requestHash,
    },
  });
  const shipment = await tx.warehouseShipment.create({
    data: {
      number,
      orderId: order.id,
      locationId: location.id,
      issuedById: input.actor.userId,
      recipientName: input.recipientName || order.client.name,
      documentId: document.id,
      idempotencyKey: `shipment:${input.key}`,
      requestHash: input.requestHash,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
  });
  for (const row of prepared) {
    const stockAfter = row.balanceStock.sub(row.quantity);
    const reservedAfter = row.balanceReserved.sub(row.reservedUsed);
    await tx.warehouseBalance.update({ where: { id: row.balanceId }, data: { stock: stockAfter, reserved: reservedAfter } });
    if (row.reservationId) {
      const reservation = await tx.materialReservation.findUniqueOrThrow({ where: { id: row.reservationId } });
      await tx.materialReservation.update({
        where: { id: reservation.id },
        data: {
          quantity: { decrement: row.reservedUsed.toNumber() },
          consumed: { increment: row.reservedUsed.toNumber() },
          status: new Prisma.Decimal(reservation.quantity).equals(row.reservedUsed) ? "CONSUMED" : "ACTIVE",
        },
      });
    }
    const movement = await tx.materialMovement.create({
      data: {
        materialId: row.material.id,
        orderId: order.id,
        locationId: location.id,
        type: "shipment",
        quantity: row.quantity.toNumber(),
        stockDelta: row.quantity.neg().toNumber(),
        reserveDelta: row.reservedUsed.neg().toNumber(),
        stockAfter: stockAfter.toNumber(),
        reservedAfter: reservedAfter.toNumber(),
        employeeId: input.actor.userId,
        price: row.item.unitPrice,
        amount: row.lineTotal,
        unitCostSnapshot: row.material.purchasePrice === null ? null : row.material.averageCost,
        totalCogs: row.material.purchasePrice === null ? null : row.material.averageCost.mul(row.quantity).toDecimalPlaces(2),
        valuationMethod: row.material.purchasePrice === null ? null : "MOVING_WEIGHTED_AVERAGE",
        valuationVersion: row.material.purchasePrice === null ? null : row.material.valuationVersion,
        comment: `Отгрузка ${number}`,
        idempotencyKey: `shipment-movement:${input.key}:${row.item.id}`,
        requestHash: input.requestHash,
      },
    });
    await tx.warehouseShipmentLine.create({
      data: { shipmentId: shipment.id, orderItemId: row.item.id, materialId: row.material.id, quantity: row.quantity, unitPriceSnapshot: row.item.unitPrice, lineTotal: row.lineTotal, movementId: movement.id },
    });
    await tx.orderItem.update({
      where: { id: row.item.id },
      data: { issuedQuantity: { increment: row.quantity }, reservedQuantity: { decrement: row.reservedUsed } },
    });
    if (row.material.purchasePrice !== null) await tx.inventoryCogsEntry.create({
      data: {
        materialId: row.material.id,
        movementId: movement.id,
        orderId: order.id,
        quantity: row.quantity,
        unitCostSnapshot: row.material.averageCost,
        totalCogs: row.material.averageCost.mul(row.quantity).toDecimalPlaces(2),
        valuationVersion: row.material.valuationVersion,
      } as Prisma.InventoryCogsEntryUncheckedCreateInput,
    });
    await syncMaterialTotals(tx, row.material.id);
    if (row.material.purchasePrice !== null) {
      const currentMaterial = await tx.material.findUniqueOrThrow({ where: { id: row.material.id } });
      const inventoryValue = Prisma.Decimal.max(
        0,
        currentMaterial.inventoryValue.sub(row.material.averageCost.mul(row.quantity)),
      ).toDecimalPlaces(2);
      await tx.material.update({ where: { id: row.material.id }, data: { inventoryValue } });
    }
  }
  const allItems = await tx.orderItem.findMany({ where: { orderId: order.id, stockTracked: true }, select: { quantity: true, issuedQuantity: true } });
  const complete = allItems.every((item) => item.issuedQuantity.gte(item.quantity));
  await tx.order.update({ where: { id: order.id }, data: { fulfillmentStatus: complete ? "ISSUED" : "PARTIALLY_ISSUED" } });
  await tx.orderEvent.create({ data: { orderId: order.id, title: complete ? "Товар выдан" : "Частичная выдача", description: `${number} · ${amount.toFixed(2)} ₸`, user: input.actor.name || "ORDA" } });
  await tx.documentAudit.create({ data: { documentId: document.id, actorId: input.actor.userId, action: "WAREHOUSE_SHIPMENT_POSTED", after: { shipmentId: shipment.id, number, amount: amount.toString() } } });
  return { shipmentId: shipment.id, documentId: document.id, number, amount: amount.toNumber() };
}

export async function createRetailSale(input: {
  locationId: number;
  clientId?: number;
  client?: { name: string; phone: string; city: string; address?: string };
  walkIn?: boolean;
  items: Array<{ materialId: number; quantity: number; discount?: number }>;
  payment?: { amount: number; parts: PaymentPartInput[]; comment?: string };
  issueNow: boolean;
  recipientName?: string;
  key: string;
  requestHash: string;
  actor: WarehouseActor;
}) {
  if (!isInternalWarehouseRole(input.actor.role)) throw new WarehouseError("FORBIDDEN");
  const { companyId } = requireTenantIdentity();
  const response = await idempotent({
    key: input.key,
    requestHash: input.requestHash,
    action: "retail-sale.create",
    actor: input.actor,
    work: async (tx) => {
      const location = await locationFor(tx, input.actor, input.locationId, "sell");
      const actorUser = await tx.user.findFirst({ where: { id: input.actor.userId, active: true }, select: { id: true, name: true } });
      if (!actorUser) throw new WarehouseError("FORBIDDEN");
      let client = input.clientId ? await tx.client.findFirst({ where: { id: input.clientId, active: true, deletedAt: null } }) : null;
      if (!client && input.walkIn) {
        client = await tx.client.findFirst({ where: { isWalkIn: true, active: true, deletedAt: null } });
        if (!client) client = await tx.client.create({ data: { name: "Розничный покупатель", phone: "", whatsapp: "", city: "Алматы", address: "", manager: "Розница", amount: "0", estimatedAmount: 0, status: "Розничный покупатель", stage: "WON", source: "Склад", isWalkIn: true } });
      }
      if (!client && input.client) {
        const phone = normalizePhone(input.client.phone);
        if (!input.client.name.trim() || !phone || !input.client.city.trim()) throw new WarehouseError("INVALID_OPERATION");
        client = await tx.client.findFirst({ where: { active: true, deletedAt: null, OR: [{ phone }, { whatsapp: phone }] } });
        if (!client) client = await tx.client.create({ data: { name: input.client.name.trim(), phone, whatsapp: phone, city: input.client.city.trim(), address: input.client.address?.trim() || "", manager: actorUser.name, managerUserId: input.actor.role === Role.MANAGER ? actorUser.id : null, amount: "0", estimatedAmount: 0, status: "Продажа со склада", stage: "WON", source: "Склад" } });
      }
      if (!client || !input.items.length || new Set(input.items.map((item) => item.materialId)).size !== input.items.length)
        throw new WarehouseError("INVALID_OPERATION");
      const lines: Array<{ material: Awaited<ReturnType<typeof tx.material.findUniqueOrThrow>>; quantity: Prisma.Decimal; discount: Prisma.Decimal; total: Prisma.Decimal }> = [];
      for (const requested of input.items) {
        const material = await tx.material.findFirst({ where: { id: requested.materialId, active: true, productKind: "STOCK" } });
        if (!material || !material.quantityKnown || material.sellingPrice === null || !material.sellingPrice.isPositive()) throw new WarehouseError("INVALID_OPERATION");
        const quantity = decimal(requested.quantity, material.quantityPrecision);
        const discount = decimal(requested.discount ?? 0, 2);
        if (!quantity.isPositive() || discount.isNegative()) throw new WarehouseError("INVALID_OPERATION");
        const subtotal = material.sellingPrice.mul(quantity);
        if (discount.gt(subtotal)) throw new WarehouseError("INVALID_OPERATION");
        const balance = await balanceFor(tx, material.id, location.id);
        if (new Prisma.Decimal(balance.stock).sub(balance.reserved).lt(quantity)) throw new WarehouseError("INSUFFICIENT_AVAILABLE");
        lines.push({ material, quantity, discount, total: subtotal.sub(discount).toDecimalPlaces(2) });
      }
      const amount = lines.reduce((sum, line) => sum.add(line.total), new Prisma.Decimal(0));
      const order = await tx.order.create({
        data: {
          number: `RTL-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
          clientId: client.id,
          address: client.address,
          staircase: "Розничная продажа",
          material: "Складские товары",
          amount,
          balance: amount,
          companyProfit: amount,
          manager: actorUser.name,
          managerUserId: actorUser.id,
          status: "Продажа со склада",
          orderKind: "RETAIL",
          fulfillmentStatus: input.issueNow ? "PENDING_ISSUE" : "RESERVED",
          paymentMethod: input.payment ? (input.payment.parts.length > 1 ? "MIXED" : input.payment.parts[0]?.method ?? "") : "",
        },
      });
      const orderItems = [];
      for (const [position, line] of lines.entries()) {
        orderItems.push(await tx.orderItem.create({
          data: {
            companyId,
            orderId: order.id,
            materialId: line.material.id,
            skuSnapshot: line.material.code || `MAT-${line.material.id}`,
            nameSnapshot: line.material.name,
            variantSnapshot: [line.material.color, line.material.finish, line.material.dimensions].filter(Boolean).join(" · ") || null,
            unitSnapshot: line.material.unit,
            quantity: line.quantity,
            unitPrice: line.material.sellingPrice!,
            discount: line.discount,
            lineTotal: line.total,
            unitCostSnapshot: line.material.purchasePrice === null ? null : line.material.averageCost,
            position,
          },
        }));
      }
      let shipment: Awaited<ReturnType<typeof postShipment>> | null = null;
      if (input.issueNow) {
        shipment = await postShipment(tx, { orderId: order.id, locationId: location.id, lines: orderItems.map((item) => ({ orderItemId: item.id, quantity: item.quantity.toNumber() })), recipientName: input.recipientName, key: input.key, requestHash: input.requestHash, actor: input.actor });
      } else {
        for (const item of orderItems) {
          const balance = await balanceFor(tx, item.materialId!, location.id);
          const reservedAfter = balance.reserved.add(item.quantity);
          await tx.warehouseBalance.update({ where: { id: balance.id }, data: { reserved: reservedAfter } });
          await tx.materialReservation.create({ data: { materialId: item.materialId!, orderId: order.id, locationId: location.id, orderItemId: item.id, quantity: item.quantity.toNumber(), createdById: input.actor.userId } });
          await tx.orderItem.update({ where: { id: item.id }, data: { reservedQuantity: item.quantity } });
          await tx.materialMovement.create({ data: { materialId: item.materialId!, orderId: order.id, locationId: location.id, type: "reserve", quantity: item.quantity.toNumber(), stockDelta: 0, reserveDelta: item.quantity.toNumber(), stockAfter: balance.stock.toNumber(), reservedAfter: reservedAfter.toNumber(), employeeId: input.actor.userId, comment: `Резерв по заказу ${order.number}`, idempotencyKey: `sale-reserve:${input.key}:${item.id}`, requestHash: input.requestHash } });
          await syncMaterialTotals(tx, item.materialId!);
        }
      }
      let paymentId: number | null = null;
      if (input.payment) {
        const payment = validatePayment(input.payment.amount, input.payment.parts);
        if (payment.total.gt(amount)) throw new WarehouseError("INVALID_OPERATION");
        const record = await tx.payment.create({
          data: {
            orderId: order.id,
            amount: payment.total,
            type: "CLIENT_PAYMENT",
            method: payment.method,
            comment: input.payment.comment?.trim() || "Оплата продажи со склада",
            author: actorUser.name,
            registeredByUserId: actorUser.id,
            idempotencyKey: `sale-payment:${input.key}`,
            requestHash: input.requestHash,
            parts: { create: payment.parts.map((part) => ({ companyId, method: part.method, amount: part.amount, reference: part.reference })) },
          },
        });
        paymentId = record.id;
        await tx.order.update({ where: { id: order.id }, data: { prepayment: payment.total, balance: amount.sub(payment.total) } });
        await createPaymentReceiptRecord(tx, record.id, actorUser.id);
      }
      await tx.orderEvent.create({ data: { orderId: order.id, title: "Продажа со склада", description: `${lines.length} поз. · ${amount.toFixed(2)} ₸`, user: actorUser.name, idempotencyKey: `retail-order:${input.key}`, requestHash: input.requestHash } });
      await tx.orderStatusHistory.create({ data: { orderId: order.id, fromStatus: null, toStatus: "Продажа со склада", changedByUserId: actorUser.id, changedByName: actorUser.name, changedByRole: input.actor.role, comment: "Заказ создан из склада" } });
      return { orderId: order.id, paymentId, shipmentId: shipment?.shipmentId ?? null, documentId: shipment?.documentId ?? null, amount: amount.toNumber() };
    },
  });
  let receiptPdfStatus: "READY" | "FAILED" | null = null;
  let invoicePdfStatus: "READY" | "FAILED" | null = null;
  if (typeof response.result.paymentId === "number") {
    try { await ensurePaymentReceiptPdf(response.result.paymentId); receiptPdfStatus = "READY"; } catch { receiptPdfStatus = "FAILED"; }
  }
  if (typeof response.result.shipmentId === "number") {
    try { await ensureWarehouseShipmentPdf(response.result.shipmentId); invoicePdfStatus = "READY"; } catch { invoicePdfStatus = "FAILED"; }
  }
  return { ...response, receiptPdfStatus, invoicePdfStatus };
}

export async function createWarehouseShipment(input: {
  orderId: number;
  locationId: number;
  lines: ShipmentLineInput[];
  recipientName?: string;
  key: string;
  requestHash: string;
  actor: WarehouseActor;
}) {
  if (!isInternalWarehouseRole(input.actor.role)) throw new WarehouseError("FORBIDDEN");
  const response = await idempotent({ key: input.key, requestHash: input.requestHash, action: "shipment.post", actor: input.actor, work: (tx) => postShipment(tx, input) });
  let pdfStatus: "READY" | "FAILED" = "READY";
  try { await ensureWarehouseShipmentPdf(Number(response.result.shipmentId)); } catch { pdfStatus = "FAILED"; }
  return { ...response, pdfStatus };
}

export async function releaseWarehouseReservation(input: {
  orderItemId: number;
  locationId: number;
  quantity: number;
  reason?: string;
  key: string;
  requestHash: string;
  actor: WarehouseActor;
}) {
  if (!isInternalWarehouseRole(input.actor.role))
    throw new WarehouseError("FORBIDDEN");
  return idempotent({
    key: input.key,
    requestHash: input.requestHash,
    action: "reservation.release",
    actor: input.actor,
    work: async (tx) => {
      const item = await tx.orderItem.findFirst({
        where: { id: input.orderItemId, stockTracked: true },
        include: {
          order: { select: { id: true, number: true } },
          material: { select: { quantityPrecision: true } },
        },
      });
      if (!item?.materialId) throw new WarehouseError("NOT_FOUND");
      await assertOrderAccess(tx, input.actor, item.orderId);
      const location = await locationFor(tx, input.actor, input.locationId, "sell");
      const quantity = decimal(input.quantity, item.material?.quantityPrecision ?? 3);
      if (!quantity.isPositive()) throw new WarehouseError("INVALID_OPERATION");
      const reservation = await tx.materialReservation.findFirst({
        where: {
          orderItemId: item.id,
          materialId: item.materialId,
          locationId: location.id,
          status: "ACTIVE",
        },
      });
      if (!reservation) throw new WarehouseError("NOT_FOUND");
      const reserved = new Prisma.Decimal(reservation.quantity);
      if (quantity.gt(reserved) || quantity.gt(item.reservedQuantity))
        throw new WarehouseError("INSUFFICIENT_RESERVED");
      const balance = await balanceFor(tx, item.materialId, location.id);
      if (quantity.gt(balance.reserved))
        throw new WarehouseError("INSUFFICIENT_RESERVED");
      const remaining = reserved.sub(quantity);
      const reservedAfter = balance.reserved.sub(quantity);
      await tx.materialReservation.update({
        where: { id: reservation.id },
        data: {
          quantity: remaining.toNumber(),
          status: remaining.isZero() ? "RELEASED" : "ACTIVE",
        },
      });
      await tx.orderItem.update({
        where: { id: item.id },
        data: { reservedQuantity: { decrement: quantity } },
      });
      await tx.warehouseBalance.update({
        where: { id: balance.id },
        data: { reserved: reservedAfter },
      });
      const movement = await tx.materialMovement.create({
        data: {
          materialId: item.materialId,
          orderId: item.orderId,
          locationId: location.id,
          type: "release",
          quantity: quantity.toNumber(),
          stockDelta: 0,
          reserveDelta: quantity.neg().toNumber(),
          stockAfter: balance.stock.toNumber(),
          reservedAfter: reservedAfter.toNumber(),
          employeeId: input.actor.userId,
          comment: input.reason?.trim() || `Снятие резерва по заказу ${item.order.number}`,
          idempotencyKey: `reservation-release:${input.key}`,
          requestHash: input.requestHash,
        },
      });
      await syncMaterialTotals(tx, item.materialId);
      await tx.orderEvent.create({
        data: {
          orderId: item.orderId,
          title: "Снят резерв товара",
          description: `${item.nameSnapshot} · ${quantity.toString()} ${item.unitSnapshot} · ${location.name}`,
          user: input.actor.name || "ORDA",
        },
      });
      return {
        reservationId: reservation.id,
        movementId: movement.id,
        orderId: item.orderId,
        orderItemId: item.id,
        released: quantity.toNumber(),
        remaining: remaining.toNumber(),
      };
    },
  });
}

export async function transferWarehouseStock(input: {
  materialId: number;
  fromLocationId: number;
  toLocationId: number;
  quantity: number;
  reason: string;
  key: string;
  requestHash: string;
  actor: WarehouseActor;
}) {
  if (!isInternalWarehouseRole(input.actor.role)) throw new WarehouseError("FORBIDDEN");
  if (input.fromLocationId === input.toLocationId || !input.reason.trim())
    throw new WarehouseError("INVALID_OPERATION");
  return idempotent({
    key: input.key,
    requestHash: input.requestHash,
    action: "warehouse-transfer.post",
    actor: input.actor,
    work: async (tx) => {
      const [fromLocation, toLocation] = await Promise.all([
        locationFor(tx, input.actor, input.fromLocationId, "adjust"),
        locationFor(tx, input.actor, input.toLocationId, "adjust"),
      ]);
      let material = await tx.material.findFirst({ where: { id: input.materialId, active: true, productKind: "STOCK" } });
      if (!material || !material.quantityKnown) throw new WarehouseError("NOT_FOUND");
      const quantity = decimal(input.quantity, material.quantityPrecision);
      if (!quantity.isPositive()) throw new WarehouseError("INVALID_OPERATION");
      const balanceByLocation = new Map<number, Awaited<ReturnType<typeof balanceFor>>>();
      for (const locationId of [fromLocation.id, toLocation.id].sort((a, b) => a - b))
        balanceByLocation.set(locationId, await balanceFor(tx, material.id, locationId));
      material = await tx.material.findUniqueOrThrow({ where: { id: material.id } });
      const fromBalance = balanceByLocation.get(fromLocation.id)!;
      const toBalance = balanceByLocation.get(toLocation.id)!;
      if (fromBalance.stock.sub(fromBalance.reserved).lt(quantity)) throw new WarehouseError("INSUFFICIENT_AVAILABLE");
      const fromAfter = fromBalance.stock.sub(quantity);
      const toAfter = toBalance.stock.add(quantity);
      await tx.warehouseBalance.update({ where: { id: fromBalance.id }, data: { stock: fromAfter } });
      await tx.warehouseBalance.update({ where: { id: toBalance.id }, data: { stock: toAfter } });
      const movedAt = new Date();
      const number = await nextBusinessDocumentNumber(tx, "MOV", movedAt);
      const unitCost = material.purchasePrice === null ? null : material.averageCost;
      const movement = await tx.materialMovement.create({
        data: {
          materialId: material.id,
          locationId: fromLocation.id,
          fromLocationId: fromLocation.id,
          toLocationId: toLocation.id,
          type: "transfer",
          quantity: quantity.toNumber(),
          stockDelta: 0,
          reserveDelta: 0,
          stockAfter: fromAfter.toNumber(),
          reservedAfter: fromBalance.reserved.toNumber(),
          employeeId: input.actor.userId,
          price: unitCost ?? 0,
          amount: unitCost === null ? 0 : unitCost.mul(quantity).toDecimalPlaces(2),
          unitCostSnapshot: unitCost,
          valuationMethod: unitCost === null ? null : "MOVING_WEIGHTED_AVERAGE",
          valuationVersion: unitCost === null ? null : material.valuationVersion,
          comment: `${number} · ${input.reason.trim()}`,
          idempotencyKey: `warehouse-transfer-movement:${input.key}`,
          requestHash: input.requestHash,
        },
      });
      const snapshot = {
        templateVersion: "ALTYN_SAPA_STOCK_TRANSFER_V1",
        number,
        movedAt: movedAt.toISOString(),
        movementId: movement.id,
        material: {
          id: material.id,
          sku: material.code,
          name: material.name,
          variant: [material.color, material.finish, material.dimensions].filter(Boolean).join(" · ") || null,
          unit: material.unit,
        },
        quantity: quantity.toNumber(),
        from: { id: fromLocation.id, name: fromLocation.name, address: fromLocation.address },
        to: { id: toLocation.id, name: toLocation.name, address: toLocation.address },
        reason: input.reason.trim(),
        movedBy: { userId: input.actor.userId, name: input.actor.name || "Сотрудник ORDA" },
      };
      const document = await tx.document.create({
        data: {
          type: DocumentType.STOCK_TRANSFER,
          number,
          title: `Перемещение товара ${number}`,
          documentDate: movedAt,
          status: DocumentStatus.READY,
          source: DocumentSource.GENERATED_WAREHOUSE,
          authorId: input.actor.userId,
          templateVersion: "ALTYN_SAPA_STOCK_TRANSFER_V1",
          snapshot,
          idempotencyKey: `warehouse-transfer-document:${input.key}`,
          requestHash: input.requestHash,
        },
      });
      await tx.materialMovement.update({ where: { id: movement.id }, data: { documentId: document.id } });
      await syncMaterialTotals(tx, material.id);
      await tx.documentAudit.create({
        data: {
          documentId: document.id,
          actorId: input.actor.userId,
          action: "WAREHOUSE_TRANSFER_POSTED",
          after: { movementId: movement.id, materialId: material.id, quantity: quantity.toString(), fromLocationId: fromLocation.id, toLocationId: toLocation.id },
          comment: input.reason.trim(),
        },
      });
      return { movementId: movement.id, documentId: document.id, number, materialId: material.id, quantity: quantity.toNumber() };
    },
  });
}

export async function createWarehouseReturn(input: {
  shipmentId: number;
  locationId: number;
  reason: string;
  lines: Array<{ shipmentLineId: number; quantity: number; condition: StockCondition }>;
  key: string;
  requestHash: string;
  actor: WarehouseActor;
}) {
  if (!isInternalWarehouseRole(input.actor.role)) throw new WarehouseError("FORBIDDEN");
  if (
    !input.reason.trim() ||
    !input.lines.length ||
    new Set(input.lines.map((line) => line.shipmentLineId)).size !== input.lines.length
  )
    throw new WarehouseError("INVALID_OPERATION");
  return idempotent({
    key: input.key,
    requestHash: input.requestHash,
    action: "warehouse-return.post",
    actor: input.actor,
    work: async (tx) => {
      await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${1_800_000_000 + input.shipmentId})`;
      const shipment = await tx.warehouseShipment.findFirst({ where: { id: input.shipmentId }, include: { order: { include: { client: true } }, lines: true } });
      if (!shipment) throw new WarehouseError("NOT_FOUND");
      await assertOrderAccess(tx, input.actor, shipment.orderId);
      const normalLocation = await locationFor(tx, input.actor, input.locationId, "sell");
      const { companyId } = requireTenantIdentity();
      const damagedLocation = await tx.warehouseLocation.upsert({
        where: { companyId_code: { companyId, code: "DAMAGED" } },
        create: { companyId, code: "DAMAGED", name: "Повреждённый товар", type: "QUARANTINE", active: true, isDefault: false },
        update: {},
      });
      const prepared = [];
      for (const requested of input.lines) {
        const line = await tx.warehouseShipmentLine.findFirst({
          where: { id: requested.shipmentLineId, shipmentId: shipment.id },
          include: {
            orderItem: true,
            material: true,
            movement: { include: { cogsEntry: true } },
            returnLines: { select: { quantity: true } },
          },
        });
        if (!line) throw new WarehouseError("NOT_FOUND");
        const quantity = decimal(requested.quantity, 3);
        const returned = line.returnLines.reduce((sum, item) => sum.add(item.quantity), new Prisma.Decimal(0));
        if (
          quantity.decimalPlaces() > line.material.quantityPrecision ||
          !quantity.isPositive() ||
          quantity.gt(line.quantity.sub(returned))
        ) throw new WarehouseError("INVALID_OPERATION");
        prepared.push({ line, quantity, condition: requested.condition });
      }
      const acceptedAt = new Date();
      const number = await nextBusinessDocumentNumber(tx, "RET", acceptedAt);
      const total = prepared.reduce((sum, row) => sum.add(row.line.lineTotal.div(row.line.quantity).mul(row.quantity)), new Prisma.Decimal(0)).toDecimalPlaces(2);
      const snapshot = {
        templateVersion: "ALTYN_SAPA_GOODS_RETURN_V1",
        number,
        acceptedAt: acceptedAt.toISOString(),
        shipmentNumber: shipment.number,
        order: { id: shipment.order.id, number: shipment.order.number },
        client: { name: shipment.order.client.name },
        reason: input.reason.trim(),
        acceptedBy: { userId: input.actor.userId, name: input.actor.name || "Сотрудник ORDA" },
        lines: prepared.map((row) => ({ shipmentLineId: row.line.id, materialId: row.line.materialId, name: row.line.orderItem.nameSnapshot, quantity: row.quantity.toNumber(), condition: row.condition, amount: row.line.lineTotal.div(row.line.quantity).mul(row.quantity).toNumber() })),
        total: total.toNumber(),
      };
      const document = await tx.document.create({ data: { orderId: shipment.orderId, clientId: shipment.order.clientId, type: DocumentType.GOODS_RETURN, number, title: `Возврат товара ${number}`, documentDate: acceptedAt, status: DocumentStatus.READY, source: DocumentSource.GENERATED_WAREHOUSE, authorId: input.actor.userId, templateVersion: "ALTYN_SAPA_GOODS_RETURN_V1", snapshot, idempotencyKey: `return-document:${input.key}`, requestHash: input.requestHash } });
      const warehouseReturn = await tx.warehouseReturn.create({ data: { number, orderId: shipment.orderId, shipmentId: shipment.id, locationId: normalLocation.id, acceptedById: input.actor.userId, acceptedAt, reason: input.reason.trim(), documentId: document.id, idempotencyKey: `warehouse-return:${input.key}`, requestHash: input.requestHash, snapshot } });
      for (const row of prepared) {
        const location = row.condition === StockCondition.SELLABLE ? normalLocation : damagedLocation;
        const balance = await balanceFor(tx, row.line.materialId, location.id);
        const material = await tx.material.findUniqueOrThrow({ where: { id: row.line.materialId } });
        const originalCogs = row.line.movement.cogsEntry;
        const returnUnitCost = originalCogs?.unitCostSnapshot ?? row.line.movement.unitCostSnapshot;
        const stockAfter = balance.stock.add(row.quantity);
        await tx.warehouseBalance.update({ where: { id: balance.id }, data: { stock: stockAfter } });
        const movement = await tx.materialMovement.create({ data: { materialId: row.line.materialId, orderId: shipment.orderId, locationId: location.id, type: "customer_return", quantity: row.quantity.toNumber(), stockDelta: row.quantity.toNumber(), reserveDelta: 0, stockAfter: stockAfter.toNumber(), reservedAfter: balance.reserved.toNumber(), employeeId: input.actor.userId, price: row.line.unitPriceSnapshot, amount: row.line.lineTotal.div(row.line.quantity).mul(row.quantity), unitCostSnapshot: returnUnitCost, totalCogs: returnUnitCost && row.condition === StockCondition.SELLABLE ? returnUnitCost.mul(row.quantity).neg().toDecimalPlaces(2) : null, valuationMethod: returnUnitCost ? "MOVING_WEIGHTED_AVERAGE" : null, valuationVersion: returnUnitCost ? material.valuationVersion + 1 : null, comment: `${number} · ${input.reason.trim()}`, idempotencyKey: `warehouse-return-movement:${input.key}:${row.line.id}`, requestHash: input.requestHash } });
        await tx.warehouseReturnLine.create({ data: { returnId: warehouseReturn.id, shipmentLineId: row.line.id, orderItemId: row.line.orderItemId, materialId: row.line.materialId, quantity: row.quantity, condition: row.condition, movementId: movement.id } });
        await tx.orderItem.update({ where: { id: row.line.orderItemId }, data: { returnedQuantity: { increment: row.quantity } } });
        const totals = await syncMaterialTotals(tx, row.line.materialId);
        if (returnUnitCost && row.condition === StockCondition.SELLABLE) {
          const inventoryValue = material.inventoryValue.add(returnUnitCost.mul(row.quantity)).toDecimalPlaces(2);
          const averageCost = totals.stock.isPositive() ? inventoryValue.div(totals.stock) : material.averageCost;
          await tx.material.update({ where: { id: material.id }, data: { inventoryValue, averageCost, valuationVersion: { increment: 1 } } });
          await tx.inventoryValuationEntry.create({
            data: {
              materialId: material.id,
              quantity: row.quantity,
              unitCost: returnUnitCost,
              totalValue: returnUnitCost.mul(row.quantity).toDecimalPlaces(2),
              type: "CUSTOMER_RETURN",
              sourceType: "WAREHOUSE_RETURN_LINE",
              sourceId: row.line.id,
              version: material.valuationVersion + 1,
              costStatus: material.costStatus,
              reason: input.reason.trim(),
            },
          });
          if (originalCogs) await tx.inventoryCogsEntry.create({
            data: {
              materialId: material.id,
              movementId: movement.id,
              orderId: shipment.orderId,
              quantity: row.quantity.neg(),
              unitCostSnapshot: returnUnitCost,
              totalCogs: returnUnitCost.mul(row.quantity).neg().toDecimalPlaces(2),
              valuationVersion: material.valuationVersion + 1,
              adjustmentOfId: originalCogs.id,
              reason: input.reason.trim(),
            },
          });
        }
      }
      const newAmount = Prisma.Decimal.max(0, shipment.order.amount.sub(total));
      const newBalance = Prisma.Decimal.max(0, newAmount.sub(shipment.order.prepayment));
      const allShipmentLines = await tx.warehouseShipmentLine.findMany({ where: { shipmentId: shipment.id }, include: { returnLines: { select: { quantity: true } } } });
      const shipmentFullyReturned = allShipmentLines.every((line) => line.returnLines.reduce((sum, item) => sum.add(item.quantity), new Prisma.Decimal(0)).gte(line.quantity));
      const allOrderItems = await tx.orderItem.findMany({
        where: { orderId: shipment.orderId, stockTracked: true },
        select: { quantity: true, issuedQuantity: true, returnedQuantity: true },
      });
      const orderFullyReturned = allOrderItems.length > 0 && allOrderItems.every((item) =>
        item.issuedQuantity.gte(item.quantity) && item.returnedQuantity.gte(item.issuedQuantity),
      );
      await tx.order.update({ where: { id: shipment.orderId }, data: { amount: newAmount, balance: newBalance, fulfillmentStatus: orderFullyReturned ? "RETURNED" : "RETURNED_PARTIALLY" } });
      await tx.warehouseShipment.update({ where: { id: shipment.id }, data: { status: shipmentFullyReturned ? WarehouseShipmentStatus.RETURNED : WarehouseShipmentStatus.RETURNED_PARTIALLY } });
      await tx.orderEvent.create({ data: { orderId: shipment.orderId, title: "Возврат товара", description: `${number} · ${total.toFixed(2)} ₸ · денежный возврат оформляется отдельно`, user: input.actor.name || "ORDA" } });
      return { returnId: warehouseReturn.id, documentId: document.id, number, amountReduction: total.toNumber(), refundCreated: false };
    },
  });
}
