import {
  InventoryCostStatus,
  Prisma,
  PurchaseAllocationMethod,
  PurchaseBatchStatus,
  Role,
} from "@prisma/client";

import { compareRequestHash } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";

export type PurchaseActor = { userId: number; role: Role; name: string | null };
export class PurchaseError extends Error {
  constructor(
    public code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "INVALID"
      | "CONFLICT"
      | "IDEMPOTENCY_CONFLICT",
  ) {
    super(code);
  }
}

const roundMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
export function allocateLandedCost(
  lines: Array<{
    id: number;
    purchaseValue: number;
    quantity: number;
    weight?: number | null;
  }>,
  total: number,
  method: PurchaseAllocationMethod,
  manual?: Record<number, number>,
) {
  if (!lines.length || total < 0) throw new PurchaseError("INVALID");
  if (method === PurchaseAllocationMethod.MANUAL) {
    const result = lines.map((line) => ({
      lineId: line.id,
      amount: roundMoney(manual?.[line.id] ?? NaN),
    }));
    if (
      result.some((item) => !Number.isFinite(item.amount)) ||
      roundMoney(result.reduce((sum, item) => sum + item.amount, 0)) !==
        roundMoney(total)
    )
      throw new PurchaseError("INVALID");
    return result;
  }
  const basis = lines.map((line) =>
    method === PurchaseAllocationMethod.BY_QUANTITY
      ? line.quantity
      : method === PurchaseAllocationMethod.BY_WEIGHT
        ? Number(line.weight ?? 0)
        : line.purchaseValue,
  );
  const basisTotal = basis.reduce((sum, value) => sum + value, 0);
  if (basisTotal <= 0) throw new PurchaseError("INVALID");
  let allocated = 0;
  return lines.map((line, index) => {
    const amount =
      index === lines.length - 1
        ? roundMoney(total - allocated)
        : roundMoney((total * basis[index]) / basisTotal);
    allocated = roundMoney(allocated + amount);
    return { lineId: line.id, amount };
  });
}

function assertManage(actor: PurchaseActor, manual = false) {
  if (actor.role !== Role.DIRECTOR && actor.role !== Role.ACCOUNTANT)
    throw new PurchaseError("FORBIDDEN");
  if (manual && actor.role !== Role.DIRECTOR)
    throw new PurchaseError("FORBIDDEN");
}

export async function listSuppliers(actor: PurchaseActor) {
  assertManage(actor);
  return prisma.supplier.findMany({ orderBy: { name: "asc" } });
}
export async function createSupplier(
  data: {
    name: string;
    country?: string;
    defaultCurrency?: string;
    contact?: string;
    comment?: string;
  },
  actor: PurchaseActor,
) {
  assertManage(actor);
  return prisma.supplier.create({ data });
}

export async function listPurchaseBatches(
  filters: {
    page: number;
    pageSize: number;
    search?: string;
    status?: PurchaseBatchStatus;
    supplierId?: number;
  },
  actor: PurchaseActor,
) {
  assertManage(actor);
  const where: Prisma.PurchaseBatchWhereInput = {
    ...(filters.search
      ? { number: { contains: filters.search, mode: "insensitive" } }
      : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.purchaseBatch.findMany({
      where,
      select: {
        id: true,
        number: true,
        status: true,
        orderDate: true,
        expectedArrivalDate: true,
        actualArrivalDate: true,
        purchaseCurrency: true,
        purchaseGoodsCostKzt: true,
        additionalCostKzt: true,
        landedCostKzt: true,
        version: true,
        supplier: { select: { id: true, name: true } },
        _count: { select: { lines: true, additionalCosts: true } },
      },
      orderBy: { orderDate: "desc" },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    prisma.purchaseBatch.count({ where }),
  ]);
  return {
    items,
    pagination: {
      ...filters,
      total,
      pages: Math.ceil(total / filters.pageSize),
    },
  };
}

export async function getPurchaseBatch(id: number, actor: PurchaseActor) {
  assertManage(actor);
  return prisma.purchaseBatch.findUnique({
    where: { id },
    include: {
      supplier: true,
      responsibleUser: { select: { id: true, name: true } },
      lines: {
        include: { material: { select: { id: true, name: true, unit: true } } },
      },
      additionalCosts: { orderBy: { documentDate: "asc" } },
      revisions: { orderBy: { createdAt: "desc" } },
    },
  });
}

export async function createPurchaseBatch(
  input: {
    supplierId: number;
    orderDate: Date;
    expectedArrivalDate?: Date;
    purchaseCurrency: string;
    fixedExchangeRate: number;
    allocationMethod: PurchaseAllocationMethod;
    notes?: string;
    lines: Array<{
      materialId: number;
      orderedQuantity: number;
      purchaseUnitPrice: number;
      weight?: number;
    }>;
    key: string;
    requestHash: string;
  },
  actor: PurchaseActor,
) {
  assertManage(
    actor,
    input.allocationMethod === PurchaseAllocationMethod.MANUAL,
  );
  const existing = await prisma.purchaseBatch.findUnique({
    where: { idempotencyKey: input.key },
  });
  if (existing) {
    if (!compareRequestHash(existing.requestHash, input.requestHash))
      throw new PurchaseError("IDEMPOTENCY_CONFLICT");
    return { batch: existing, created: false };
  }
  return prisma.$transaction(
    async (tx) => {
      const year = input.orderDate.getFullYear();
      const count = await tx.purchaseBatch.count({
        where: {
          orderDate: {
            gte: new Date(year, 0, 1),
            lt: new Date(year + 1, 0, 1),
          },
        },
      });
      const number = `PB-${year}-${String(count + 1).padStart(4, "0")}`;
      const goods = roundMoney(
        input.lines.reduce(
          (sum, line) =>
            sum +
            line.orderedQuantity *
              line.purchaseUnitPrice *
              input.fixedExchangeRate,
          0,
        ),
      );
      const batch = await tx.purchaseBatch.create({
        data: {
          number,
          supplierId: input.supplierId,
          orderDate: input.orderDate,
          expectedArrivalDate: input.expectedArrivalDate,
          purchaseCurrency: input.purchaseCurrency,
          fixedExchangeRate: String(input.fixedExchangeRate),
          allocationMethod: input.allocationMethod,
          responsibleUserId: actor.userId,
          notes: input.notes,
          purchaseGoodsCostKzt: String(goods),
          landedCostKzt: String(goods),
          idempotencyKey: input.key,
          requestHash: input.requestHash,
          lines: {
            create: input.lines.map((line) => ({
              materialId: line.materialId,
              orderedQuantity: String(line.orderedQuantity),
              purchaseUnitPrice: String(line.purchaseUnitPrice),
              purchaseCurrency: input.purchaseCurrency,
              exchangeRateSnapshot: String(input.fixedExchangeRate),
              purchaseCostKzt: String(
                roundMoney(
                  line.orderedQuantity *
                    line.purchaseUnitPrice *
                    input.fixedExchangeRate,
                ),
              ),
              provisionalUnitLandedCost: String(
                line.purchaseUnitPrice * input.fixedExchangeRate,
              ),
              weight: line.weight == null ? undefined : String(line.weight),
            })),
          },
        },
      });
      return { batch, created: true };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function addPurchaseCost(
  input: {
    batchId: number;
    type: Prisma.PurchaseAdditionalCostUncheckedCreateInput["type"];
    provider: string;
    currency: string;
    foreignAmount: number;
    exchangeRate: number;
    documentDate: Date;
    paymentDate?: Date;
    allocationMethod: PurchaseAllocationMethod;
    comment?: string;
    reference?: string;
    key: string;
    requestHash: string;
  },
  actor: PurchaseActor,
) {
  assertManage(
    actor,
    input.allocationMethod === PurchaseAllocationMethod.MANUAL,
  );
  const existing = await prisma.purchaseAdditionalCost.findUnique({
    where: { idempotencyKey: input.key },
  });
  if (existing) {
    if (!compareRequestHash(existing.requestHash, input.requestHash))
      throw new PurchaseError("IDEMPOTENCY_CONFLICT");
    return { cost: existing, created: false };
  }
  const sign = input.type === "SUPPLIER_CREDIT" ? -1 : 1,
    amountKzt = roundMoney(input.foreignAmount * input.exchangeRate * sign);
  const cost = await prisma.purchaseAdditionalCost.create({
    data: {
      batchId: input.batchId,
      type: input.type,
      provider: input.provider,
      currency: input.currency,
      foreignAmount: String(input.foreignAmount),
      exchangeRate: String(input.exchangeRate),
      amountKzt: String(amountKzt),
      documentDate: input.documentDate,
      paymentDate: input.paymentDate,
      allocationMethod: input.allocationMethod,
      comment: input.comment,
      reference: input.reference,
      createdByUserId: actor.userId,
      idempotencyKey: input.key,
      requestHash: input.requestHash,
    },
  });
  return { cost, created: true };
}

export async function receivePurchaseBatch(
  batchId: number,
  received: Array<{
    lineId: number;
    receivedQuantity: number;
    rejectedQuantity?: number;
  }>,
  actor: PurchaseActor,
) {
  assertManage(actor);
  return prisma.$transaction(
    async (tx) => {
      const batch = await tx.purchaseBatch.findUnique({
        where: { id: batchId },
        include: { lines: true },
      });
      if (!batch) throw new PurchaseError("NOT_FOUND");
      if (
        batch.status !== PurchaseBatchStatus.ORDERED &&
        batch.status !== PurchaseBatchStatus.IN_TRANSIT &&
        batch.status !== PurchaseBatchStatus.DRAFT
      )
        throw new PurchaseError("CONFLICT");
      for (const item of received) {
        const line = batch.lines.find((value) => value.id === item.lineId);
        if (
          !line ||
          item.receivedQuantity < 0 ||
          (item.rejectedQuantity && item.rejectedQuantity < 0)
        )
          throw new PurchaseError("INVALID");
        const accepted = item.receivedQuantity - (item.rejectedQuantity ?? 0);
        if (accepted <= 0) continue;
        const material = await tx.material.findUniqueOrThrow({
          where: { id: line.materialId },
        });
        const unitCost = Number(line.provisionalUnitLandedCost),
          oldValue = Number(material.inventoryValue),
          newStock = material.stock + accepted,
          newValue = oldValue + accepted * unitCost,
          version = material.valuationVersion + 1;
        await tx.purchaseBatchLine.update({
          where: { id: line.id },
          data: {
            receivedQuantity: String(item.receivedQuantity),
            rejectedQuantity: String(item.rejectedQuantity ?? 0),
          },
        });
        const movement = await tx.materialMovement.create({
          data: {
            materialId: line.materialId,
            purchaseBatchLineId: line.id,
            type: "purchase_receipt",
            quantity: accepted,
            stockDelta: accepted,
            price: String(unitCost),
            amount: String(roundMoney(accepted * unitCost)),
            unitCostSnapshot: String(unitCost),
            valuationMethod: "MOVING_WEIGHTED_AVERAGE",
            valuationVersion: version,
            stockAfter: newStock,
            reservedAfter: material.reserved,
            employeeId: actor.userId,
            comment: `Provisional receipt ${batch.number}`,
          },
        });
        await tx.material.update({
          where: { id: line.materialId },
          data: {
            stock: newStock,
            averageCost: String(newValue / newStock),
            inventoryValue: String(roundMoney(newValue)),
            valuationVersion: version,
            costStatus: InventoryCostStatus.PROVISIONAL,
          },
        });
        await tx.inventoryValuationEntry.create({
          data: {
            materialId: line.materialId,
            quantity: String(accepted),
            unitCost: String(unitCost),
            totalValue: String(roundMoney(accepted * unitCost)),
            type: "PURCHASE_RECEIPT",
            sourceType: "PURCHASE_BATCH_LINE",
            sourceId: line.id,
            version,
            costStatus: InventoryCostStatus.PROVISIONAL,
          },
        });
        void movement;
      }
      return tx.purchaseBatch.update({
        where: { id: batchId },
        data: {
          status: PurchaseBatchStatus.RECEIVED_PROVISIONAL,
          actualArrivalDate: new Date(),
          version: { increment: 1 },
        },
        include: { lines: true },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function finalizePurchaseBatch(
  batchId: number,
  manual: Record<number, number> | undefined,
  reason: string,
  actor: PurchaseActor,
) {
  assertManage(actor, Boolean(manual));
  return prisma.$transaction(
    async (tx) => {
      const batch = await tx.purchaseBatch.findUnique({
        where: { id: batchId },
        include: { lines: true, additionalCosts: true },
      });
      if (!batch) throw new PurchaseError("NOT_FOUND");
      if (
        batch.status !== PurchaseBatchStatus.RECEIVED_PROVISIONAL &&
        batch.status !== PurchaseBatchStatus.COST_FINALIZED
      )
        throw new PurchaseError("CONFLICT");
      const additional = roundMoney(
        batch.additionalCosts.reduce(
          (sum, cost) => sum + Number(cost.amountKzt),
          0,
        ),
      );
      const basis = batch.lines.map((line) => ({
        id: line.id,
        purchaseValue: Number(line.purchaseCostKzt),
        quantity: Number(line.receivedQuantity) - Number(line.rejectedQuantity),
        weight: Number(line.weight ?? 0),
      }));
      const allocations = allocateLandedCost(
        basis,
        Math.abs(additional),
        batch.allocationMethod,
        manual,
      ).map((item) => ({
        ...item,
        amount: additional < 0 ? -item.amount : item.amount,
      }));
      let remainingDelta = 0,
        consumedAdjustment = 0;
      for (const allocation of allocations) {
        const line = batch.lines.find((item) => item.id === allocation.lineId)!;
        const accepted =
          Number(line.receivedQuantity) -
          Number(line.rejectedQuantity) -
          Number(line.returnedQuantity);
        if (accepted <= 0) continue;
        const previous = Number(
            line.finalUnitLandedCost ?? line.provisionalUnitLandedCost,
          ),
          finalUnit =
            (Number(line.purchaseCostKzt) + allocation.amount) / accepted,
          delta = finalUnit - previous;
        const consumes = await tx.materialMovement.findMany({
          where: {
            purchaseBatchLineId: line.id,
            type: { in: ["consume", "outgoing"] },
          },
          include: { cogsEntry: true },
        });
        const consumed = consumes.reduce(
            (sum, movement) => sum + movement.quantity,
            0,
          ),
          remaining = Math.max(0, accepted - consumed);
        const material = await tx.material.findUniqueOrThrow({
            where: { id: line.materialId },
          }),
          remainingImpact = roundMoney(
            Math.min(remaining, material.stock) * delta,
          ),
          version = material.valuationVersion + 1;
        await tx.material.update({
          where: { id: material.id },
          data: {
            inventoryValue: String(
              Number(material.inventoryValue) + remainingImpact,
            ),
            averageCost: String(
              material.stock > 0
                ? (Number(material.inventoryValue) + remainingImpact) /
                    material.stock
                : finalUnit,
            ),
            valuationVersion: version,
            costStatus: InventoryCostStatus.FINAL,
          },
        });
        await tx.purchaseBatchLine.update({
          where: { id: line.id },
          data: {
            allocatedAdditionalCost: String(allocation.amount),
            finalUnitLandedCost: String(finalUnit),
            costStatus: InventoryCostStatus.FINAL,
          },
        });
        await tx.inventoryValuationEntry.create({
          data: {
            materialId: material.id,
            quantity: String(remaining),
            unitCost: String(delta),
            totalValue: String(remainingImpact),
            type: "LATE_COST",
            sourceType: "PURCHASE_BATCH_LINE",
            sourceId: line.id,
            version,
            costStatus: InventoryCostStatus.FINAL,
            reason,
          },
        });
        remainingDelta += remainingImpact;
        for (const consume of consumes)
          if (consume.cogsEntry) {
            const adjustment = roundMoney(consume.quantity * delta);
            consumedAdjustment += adjustment;
            const movement = await tx.materialMovement.create({
              data: {
                materialId: material.id,
                orderId: consume.orderId,
                purchaseBatchLineId: line.id,
                type: "cogs_adjustment",
                quantity: 0,
                stockDelta: 0,
                price: String(delta),
                amount: String(adjustment),
                unitCostSnapshot: String(delta),
                totalCogs: String(adjustment),
                valuationMethod: "MOVING_WEIGHTED_AVERAGE",
                valuationVersion: version,
                stockAfter: material.stock,
                reservedAfter: material.reserved,
                employeeId: actor.userId,
                comment: reason,
              },
            });
            await tx.inventoryCogsEntry.create({
              data: {
                materialId: material.id,
                movementId: movement.id,
                orderId: consume.orderId,
                quantity: String(consume.quantity),
                unitCostSnapshot: String(delta),
                totalCogs: String(adjustment),
                valuationVersion: version,
                adjustmentOfId: consume.cogsEntry.id,
                reason,
              },
            });
          }
      }
      const landed = roundMoney(
        Number(batch.purchaseGoodsCostKzt) + additional,
      );
      await tx.purchaseCostRevision.create({
        data: {
          batchId,
          previousLandedTotal: batch.landedCostKzt,
          addedCost: String(landed - Number(batch.landedCostKzt)),
          newLandedTotal: String(landed),
          allocation: allocations,
          remainingInventoryDelta: String(roundMoney(remainingDelta)),
          consumedCogsAdjustment: String(roundMoney(consumedAdjustment)),
          authorId: actor.userId,
          reason,
        },
      });
      return tx.purchaseBatch.update({
        where: { id: batchId },
        data: {
          additionalCostKzt: String(additional),
          landedCostKzt: String(landed),
          status: PurchaseBatchStatus.COST_FINALIZED,
          finalizedAt: new Date(),
          finalizedByUserId: actor.userId,
          version: { increment: 1 },
        },
        include: { lines: true, revisions: true },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30_000,
    },
  );
}
