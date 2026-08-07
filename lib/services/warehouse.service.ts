import { Prisma, Role } from "@prisma/client";

import { compareRequestHash, isPrismaUniqueConflict } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";

export const WAREHOUSE_OPERATION_TYPES = ["incoming", "outgoing", "adjustment", "return", "reserve", "release", "consume"] as const;
export type WarehouseOperationType = (typeof WAREHOUSE_OPERATION_TYPES)[number];
export type WarehouseActor = { role: Role; userId: number; name: string | null };

export class WarehouseError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_OPERATION" | "INSUFFICIENT_STOCK" | "INSUFFICIENT_AVAILABLE" | "INSUFFICIENT_RESERVED" | "MATERIAL_DUPLICATE" | "MATERIAL_IN_USE" | "IDEMPOTENCY_CONFLICT") { super(code); }
}

const materialSelect = { id: true, name: true, category: true, unit: true, minimumStock: true, stock: true, reserved: true, purchasePrice: true, supplier: true, active: true, createdAt: true, updatedAt: true } as const;
const movementInclude = { material: { select: { id: true, name: true, unit: true } }, order: { select: { id: true, number: true, client: { select: { name: true } } } }, employee: { select: { id: true, name: true } } } as const;
const reservationInclude = { material: { select: { id: true, name: true, unit: true } }, order: { select: { id: true, number: true, client: { select: { name: true } } } }, createdBy: { select: { id: true, name: true } } } as const;

function lookupKey(name: string, unit: string) { return `${name.trim().toLocaleLowerCase("ru")}::${unit.trim().toLocaleLowerCase("ru")}`; }
function jsonValue(value: unknown) { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }

async function scopedOrderIds(actor: WarehouseActor) {
  if (actor.role === Role.DIRECTOR || actor.role === Role.MANAGER || actor.role === Role.ACCOUNTANT) return undefined;
  if (actor.role === Role.PRODUCTION) return (await prisma.production.findMany({ where: { masterUserId: actor.userId }, select: { orderId: true } })).map((item) => item.orderId);
  if (actor.role === Role.INSTALLER) return (await prisma.production.findMany({ where: { masterUserId: actor.userId, stage: "Монтаж" }, select: { orderId: true } })).map((item) => item.orderId);
  return [];
}

export async function getWarehouse(actor: WarehouseActor, filters: { page?: number; pageSize?: number; movementType?: string; orderId?: number; materialId?: number } = {}) {
  if (actor.role === Role.PARTNER) throw new WarehouseError("FORBIDDEN");
  const page = filters.page ?? 1, pageSize = filters.pageSize ?? 50;
  const orderIds = await scopedOrderIds(actor);
  const movementWhere: Prisma.MaterialMovementWhereInput = {
    ...(filters.movementType ? { type: filters.movementType } : {}), ...(filters.orderId ? { orderId: filters.orderId } : {}), ...(filters.materialId ? { materialId: filters.materialId } : {}),
    ...(orderIds === undefined ? {} : { OR: [{ orderId: { in: orderIds } }, { employeeId: actor.userId }] }),
  };
  const reservationWhere: Prisma.MaterialReservationWhereInput = orderIds === undefined ? {} : { orderId: { in: orderIds } };
  const [materials, orders, movements, movementTotal, reservations] = await Promise.all([
    prisma.material.findMany({ where: actor.role === Role.PRODUCTION || actor.role === Role.INSTALLER ? { active: true } : {}, select: materialSelect, orderBy: { name: "asc" } }),
    prisma.order.findMany({ where: orderIds === undefined ? {} : { id: { in: orderIds } }, select: { id: true, number: true, client: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.materialMovement.findMany({ where: movementWhere, include: movementInclude, orderBy: [{ operationAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.materialMovement.count({ where: movementWhere }),
    prisma.materialReservation.findMany({ where: reservationWhere, include: reservationInclude, orderBy: { updatedAt: "desc" } }),
  ]);
  const enriched = materials.map((material) => ({ ...material, available: material.stock - material.reserved, alerts: [material.stock <= material.minimumStock ? "LOW_STOCK" : null, material.stock - material.reserved <= 0 ? "NO_AVAILABLE" : null, material.reserved > material.stock ? "OVER_RESERVED" : null, Number(material.purchasePrice) <= 0 ? "NO_PRICE" : null].filter(Boolean) }));
  const canSeeCost = actor.role === Role.DIRECTOR || actor.role === Role.ACCOUNTANT;
  const visibleMaterials = canSeeCost ? enriched : enriched.map((item) => { const material = { ...item } as Partial<typeof item>; delete material.purchasePrice; return material as typeof item; });
  const visibleMovements = canSeeCost ? movements : movements.map((item) => { const movement = { ...item } as Partial<typeof item>; delete movement.price; delete movement.amount; return movement as typeof item; });
  return { materials: visibleMaterials, orders, movements: visibleMovements, reservations, pagination: { page, pageSize, total: movementTotal, pages: Math.ceil(movementTotal / pageSize) }, stats: { materials: materials.length, lowStock: materials.filter((item) => item.stock <= item.minimumStock).length, ...(canSeeCost ? { stockValue: materials.reduce((sum, item) => sum + item.stock * Number(item.purchasePrice), 0), noPrice: materials.filter((item) => Number(item.purchasePrice) <= 0).length } : {}), reserved: materials.reduce((sum, item) => sum + item.reserved, 0), available: materials.reduce((sum, item) => sum + item.stock - item.reserved, 0), suppliers: [...new Set(materials.map((item) => item.supplier).filter((value): value is string => Boolean(value)))] } };
}

async function idempotentMutation<T>(input: { key: string; requestHash: string; action: string; actor: WarehouseActor }, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  const existing = await prisma.warehouseMutation.findUnique({ where: { key: input.key } });
  if (existing) {
    if (!compareRequestHash(existing.requestHash, input.requestHash)) throw new WarehouseError("IDEMPOTENCY_CONFLICT");
    return { result: existing.result as T, replayed: true };
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const repeated = await tx.warehouseMutation.findUnique({ where: { key: input.key } });
        if (repeated) {
          if (!compareRequestHash(repeated.requestHash, input.requestHash)) throw new WarehouseError("IDEMPOTENCY_CONFLICT");
          return repeated.result as T;
        }
        const value = await work(tx);
        await tx.warehouseMutation.create({ data: { key: input.key, requestHash: input.requestHash, action: input.action, actorId: input.actor.userId, result: jsonValue(value) } });
        return value;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 20_000 });
      return { result, replayed: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 7) { await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1))); continue; }
      if (isPrismaUniqueConflict(error)) {
        const repeated = await prisma.warehouseMutation.findUnique({ where: { key: input.key } });
        if (repeated && compareRequestHash(repeated.requestHash, input.requestHash)) return { result: repeated.result as T, replayed: true };
        if (repeated) throw new WarehouseError("IDEMPOTENCY_CONFLICT");
      }
      throw error;
    }
  }
  throw new WarehouseError("IDEMPOTENCY_CONFLICT");
}

export async function createMaterialCommand(input: { data: { name: string; category: string; unit: string; minimumStock: number; purchasePrice: number; supplier?: string; initialStock: number }; key: string; requestHash: string; actor: WarehouseActor }) {
  if (input.actor.role !== Role.DIRECTOR) throw new WarehouseError("FORBIDDEN");
  try {
    return await idempotentMutation({ key: input.key, requestHash: input.requestHash, action: "material.create", actor: input.actor }, async (tx) => {
      const key = lookupKey(input.data.name, input.data.unit);
      if (await tx.material.findUnique({ where: { lookupKey: key }, select: { id: true } })) throw new WarehouseError("MATERIAL_DUPLICATE");
      const material = await tx.material.create({ data: { name: input.data.name, category: input.data.category, unit: input.data.unit, minimumStock: input.data.minimumStock, stock: input.data.initialStock, purchasePrice: String(input.data.purchasePrice), supplier: input.data.supplier || null, lookupKey: key }, select: materialSelect });
      if (input.data.initialStock > 0) await tx.materialMovement.create({ data: { materialId: material.id, type: "incoming", quantity: input.data.initialStock, stockDelta: input.data.initialStock, price: String(input.data.purchasePrice), amount: String(input.data.initialStock * input.data.purchasePrice), stockAfter: input.data.initialStock, reservedAfter: 0, employeeId: input.actor.userId, supplier: input.data.supplier, comment: "Начальный остаток", idempotencyKey: `initial:${input.key}`, requestHash: input.requestHash } });
      return material;
    });
  } catch (error) {
    if (isPrismaUniqueConflict(error)) throw new WarehouseError("MATERIAL_DUPLICATE");
    throw error;
  }
}

export async function updateMaterialCommand(input: { id: number; data: { name?: string; category?: string; unit?: string; minimumStock?: number; purchasePrice?: number; supplier?: string | null; active?: boolean }; key: string; requestHash: string; actor: WarehouseActor }) {
  if (input.actor.role !== Role.DIRECTOR && input.actor.role !== Role.ACCOUNTANT) throw new WarehouseError("FORBIDDEN");
  return idempotentMutation({ key: input.key, requestHash: input.requestHash, action: "material.update", actor: input.actor }, async (tx) => {
    const current = await tx.material.findUnique({ where: { id: input.id } }); if (!current) throw new WarehouseError("NOT_FOUND");
    const name = input.data.name ?? current.name, unit = input.data.unit ?? current.unit, key = lookupKey(name, unit);
    if (key !== current.lookupKey && await tx.material.findUnique({ where: { lookupKey: key }, select: { id: true } })) throw new WarehouseError("MATERIAL_DUPLICATE");
    return tx.material.update({ where: { id: input.id }, data: { ...input.data, purchasePrice: input.data.purchasePrice === undefined ? undefined : String(input.data.purchasePrice), lookupKey: key }, select: materialSelect });
  });
}

export async function deleteMaterialCommand(input: { id: number; key: string; requestHash: string; actor: WarehouseActor }) {
  if (input.actor.role !== Role.DIRECTOR) throw new WarehouseError("FORBIDDEN");
  return idempotentMutation({ key: input.key, requestHash: input.requestHash, action: "material.delete", actor: input.actor }, async (tx) => {
    const material = await tx.material.findUnique({ where: { id: input.id }, select: { id: true, _count: { select: { movements: true, reservations: true } } } });
    if (!material) throw new WarehouseError("NOT_FOUND");
    if (material._count.movements || material._count.reservations) throw new WarehouseError("MATERIAL_IN_USE");
    await tx.material.delete({ where: { id: input.id } }); return { id: input.id };
  });
}

async function canOperateOrder(tx: Prisma.TransactionClient, actor: WarehouseActor, orderId: number, type: WarehouseOperationType) {
  if (actor.role === Role.DIRECTOR) return Boolean(await tx.order.findUnique({ where: { id: orderId }, select: { id: true } }));
  if (actor.role === Role.MANAGER) return ["reserve", "release"].includes(type) && Boolean(await tx.order.findUnique({ where: { id: orderId }, select: { id: true } }));
  if (actor.role === Role.ACCOUNTANT) return ["incoming", "adjustment", "return"].includes(type) && Boolean(await tx.order.findUnique({ where: { id: orderId }, select: { id: true } }));
  if (actor.role === Role.PRODUCTION && type === "consume") return Boolean(await tx.order.findFirst({ where: { id: orderId, productions: { some: { masterUserId: actor.userId } } }, select: { id: true } }));
  if (actor.role === Role.INSTALLER && type === "consume") return Boolean(await tx.order.findFirst({ where: { id: orderId, productions: { some: { masterUserId: actor.userId, stage: "Монтаж" } } }, select: { id: true } }));
  return false;
}

export async function createWarehouseOperation(input: { data: { materialId: number; type: WarehouseOperationType; quantity: number; price?: number; orderId?: number; supplier?: string; comment?: string; operationAt?: Date; expiresAt?: Date | null; reversalOfId?: number }; key: string; requestHash: string; actor: WarehouseActor }) {
  if (input.actor.role === Role.PARTNER) throw new WarehouseError("FORBIDDEN");
  if (input.actor.role === Role.MANAGER && !["reserve", "release"].includes(input.data.type)) throw new WarehouseError("FORBIDDEN");
  return idempotentMutation({ key: input.key, requestHash: input.requestHash, action: `movement.${input.data.type}`, actor: input.actor }, async (tx) => {
    const material = await tx.material.findUnique({ where: { id: input.data.materialId } }); if (!material || !material.active) throw new WarehouseError("NOT_FOUND");
    const needsOrder = ["reserve", "release", "consume"].includes(input.data.type);
    if (needsOrder && !input.data.orderId) throw new WarehouseError("INVALID_OPERATION");
    if (input.data.orderId && !await canOperateOrder(tx, input.actor, input.data.orderId, input.data.type)) throw new WarehouseError("FORBIDDEN");
    if (!input.data.orderId && !([Role.DIRECTOR, Role.MANAGER, Role.ACCOUNTANT] as Role[]).includes(input.actor.role)) throw new WarehouseError("FORBIDDEN");
    if (input.actor.role === Role.ACCOUNTANT && !["incoming", "adjustment", "return"].includes(input.data.type)) throw new WarehouseError("FORBIDDEN");
    let stock = material.stock, reserved = material.reserved, stockDelta = 0, reserveDelta = 0;
    let reservation = input.data.orderId ? await tx.materialReservation.findUnique({ where: { orderId_materialId: { orderId: input.data.orderId, materialId: material.id } } }) : null;
    let reversalOfId: number | undefined;
    if (input.data.type === "return") {
      if (!input.data.reversalOfId) throw new WarehouseError("INVALID_OPERATION");
      const original = await tx.materialMovement.findUnique({ where: { id: input.data.reversalOfId }, include: { reversal: { select: { id: true } } } });
      if (!original || original.reversal || !["consume", "outgoing"].includes(original.type) || original.materialId !== material.id || original.orderId !== (input.data.orderId ?? null) || input.data.quantity > original.quantity) throw new WarehouseError("INVALID_OPERATION");
      reversalOfId = original.id; stockDelta = input.data.quantity; stock += stockDelta;
    } else if (input.data.type === "incoming") { stockDelta = input.data.quantity; stock += stockDelta; }
    else if (input.data.type === "outgoing") { if (stock - reserved < input.data.quantity) throw new WarehouseError("INSUFFICIENT_AVAILABLE"); stockDelta = -input.data.quantity; stock += stockDelta; }
    else if (input.data.type === "adjustment") { if (input.data.quantity < reserved) throw new WarehouseError("INSUFFICIENT_RESERVED"); stockDelta = input.data.quantity - stock; stock = input.data.quantity; }
    else if (input.data.type === "reserve") {
      if (stock - reserved < input.data.quantity) throw new WarehouseError("INSUFFICIENT_AVAILABLE"); reserveDelta = input.data.quantity; reserved += reserveDelta;
      reservation = reservation ? await tx.materialReservation.update({ where: { id: reservation.id }, data: { quantity: { increment: input.data.quantity }, status: "ACTIVE", expiresAt: input.data.expiresAt } }) : await tx.materialReservation.create({ data: { materialId: material.id, orderId: input.data.orderId!, quantity: input.data.quantity, createdById: input.actor.userId, expiresAt: input.data.expiresAt } });
    } else if (input.data.type === "release") {
      if (!reservation || reservation.quantity < input.data.quantity) throw new WarehouseError("INSUFFICIENT_RESERVED"); reserveDelta = -input.data.quantity; reserved += reserveDelta;
      reservation = await tx.materialReservation.update({ where: { id: reservation.id }, data: { quantity: { decrement: input.data.quantity }, status: reservation.quantity === input.data.quantity ? "RELEASED" : "ACTIVE" } });
    } else if (input.data.type === "consume") {
      if (!reservation || reservation.quantity < input.data.quantity || reserved < input.data.quantity) throw new WarehouseError("INSUFFICIENT_RESERVED");
      if (stock < input.data.quantity) throw new WarehouseError("INSUFFICIENT_STOCK"); stockDelta = -input.data.quantity; reserveDelta = -input.data.quantity; stock += stockDelta; reserved += reserveDelta;
      reservation = await tx.materialReservation.update({ where: { id: reservation.id }, data: { quantity: { decrement: input.data.quantity }, consumed: { increment: input.data.quantity }, status: reservation.quantity === input.data.quantity ? "CONSUMED" : "ACTIVE" } });
    }
    const unitPrice = input.actor.role === Role.PRODUCTION || input.actor.role === Role.INSTALLER ? Number(material.purchasePrice) : input.data.price ?? Number(material.purchasePrice);
    const movementQuantity = input.data.type === "adjustment" ? Math.abs(stockDelta) : input.data.quantity;
    const updated = await tx.material.update({ where: { id: material.id }, data: { stock, reserved, ...(input.data.supplier ? { supplier: input.data.supplier } : {}), ...(["incoming", "return", "adjustment"].includes(input.data.type) && input.data.price !== undefined ? { purchasePrice: String(input.data.price) } : {}) } });
    const movement = await tx.materialMovement.create({ data: { materialId: material.id, orderId: input.data.orderId, type: input.data.type, quantity: movementQuantity, stockDelta, reserveDelta, price: String(unitPrice), amount: String(movementQuantity * unitPrice), stockAfter: updated.stock, reservedAfter: updated.reserved, employeeId: input.actor.userId, supplier: input.data.supplier, comment: input.data.comment, operationAt: input.data.operationAt, idempotencyKey: input.key, requestHash: input.requestHash, reversalOfId }, include: movementInclude });
    if (input.data.type === "return") await tx.financeAuditEvent.create({ data: { orderId: input.data.orderId, action: "WAREHOUSE_RETURN", entityType: "MaterialMovement", entityId: movement.id, before: { movementId: reversalOfId }, after: { quantity: movementQuantity, materialId: material.id }, reason: input.data.comment ?? "Warehouse return", authorId: input.actor.userId } });
    if (input.data.orderId) await tx.orderEvent.create({ data: { orderId: input.data.orderId, title: `Склад: ${input.data.type}`, description: `${material.name}: ${movementQuantity} ${material.unit}`, user: input.actor.name, idempotencyKey: `warehouse-event:${input.key}`, requestHash: input.requestHash } });
    return { movement, reservation, material: { ...updated, available: updated.stock - updated.reserved } };
  });
}

// Compatibility entry points used by regression scripts.
export async function createMaterial(data: { name: string; category: string; unit: string; minimumStock: number; purchasePrice: number; supplier?: string; initialStock?: number; idempotencyKey?: string; requestHash?: string }) {
  if (data.idempotencyKey) { const repeated = await prisma.material.findUnique({ where: { idempotencyKey: data.idempotencyKey } }); if (repeated) { if (!data.requestHash || !compareRequestHash(repeated.requestHash, data.requestHash)) throw new Error("IDEMPOTENCY_CONFLICT"); return repeated; } }
  const key = lookupKey(data.name, data.unit); if (await prisma.material.findFirst({ where: { OR: [{ lookupKey: key }, { name: { equals: data.name, mode: "insensitive" } }] }, select: { id: true } })) throw new Error("MATERIAL_DUPLICATE");
  return prisma.$transaction(async (tx) => { const material = await tx.material.create({ data: { name: data.name, category: data.category, unit: data.unit, lookupKey: key, minimumStock: data.minimumStock, stock: data.initialStock ?? 0, purchasePrice: String(data.purchasePrice), supplier: data.supplier, idempotencyKey: data.idempotencyKey, requestHash: data.requestHash } }); if ((data.initialStock ?? 0) > 0) await tx.materialMovement.create({ data: { materialId: material.id, type: "incoming", quantity: data.initialStock!, stockDelta: data.initialStock!, price: String(data.purchasePrice), amount: String(data.initialStock! * data.purchasePrice), stockAfter: data.initialStock, reservedAfter: 0, supplier: data.supplier, comment: "Начальный остаток", idempotencyKey: data.idempotencyKey ? `initial:${data.idempotencyKey}` : undefined, requestHash: data.requestHash } }); return material; });
}

export async function createMaterialMovement(data: { materialId: number; type: "incoming" | "outgoing"; quantity: number; price?: number; supplier?: string; orderId?: number; comment?: string; date?: Date; idempotencyKey?: string; requestHash?: string }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        if (data.idempotencyKey && data.requestHash) {
          const existing = await tx.materialMovement.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
          if (existing) {
            if (!compareRequestHash(existing.requestHash, data.requestHash)) throw new Error("IDEMPOTENCY_CONFLICT");
            return existing;
          }
        }
        const material = await tx.material.findUnique({ where: { id: data.materialId } });
        if (!material) return null;
        const available = material.stock - material.reserved;
        if (data.type === "outgoing" && available < data.quantity) throw new Error("Недостаточно материала на складе");
        const delta = data.type === "incoming" ? data.quantity : -data.quantity;
        const nextStock = material.stock + delta;
        const price = data.price ?? Number(material.purchasePrice);
        const movement = await tx.materialMovement.create({ data: { materialId: data.materialId, type: data.type, quantity: data.quantity, stockDelta: delta, price: String(price), amount: String(price * data.quantity), stockAfter: nextStock, reservedAfter: material.reserved, supplier: data.supplier, orderId: data.orderId, comment: data.comment, operationAt: data.date, idempotencyKey: data.idempotencyKey, requestHash: data.requestHash } });
        await tx.material.update({ where: { id: material.id }, data: { stock: nextStock, ...(data.type === "incoming" && data.price !== undefined ? { purchasePrice: String(data.price) } : {}), ...(data.supplier ? { supplier: data.supplier } : {}) } });
        if (data.orderId) await tx.orderEvent.create({ data: { orderId: data.orderId, title: "Расход материала", description: `${material.name}: ${data.quantity} ${material.unit}`, user: "Склад", idempotencyKey: data.idempotencyKey ? `warehouse-event:${data.idempotencyKey}` : undefined, requestHash: data.requestHash } });
        return movement;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue;
      if (isPrismaUniqueConflict(error) && data.idempotencyKey && data.requestHash) {
        const existing = await prisma.materialMovement.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
        if (existing && compareRequestHash(existing.requestHash, data.requestHash)) return existing;
        throw new Error("IDEMPOTENCY_CONFLICT");
      }
      throw error;
    }
  }
  throw new Error("WAREHOUSE_CONCURRENCY_RETRY_EXHAUSTED");
}

export async function getOrderMaterials(orderId: number, canSeeCost = true) {
  const items = await prisma.materialMovement.findMany({ where: { orderId, type: { in: ["outgoing", "consume"] } }, include: { material: true, employee: { select: { id: true, name: true } } }, orderBy: { operationAt: "desc" } });
  if (canSeeCost) return { items, totalCost: items.reduce((sum, item) => sum + Number(item.amount), 0) };
  return { items: items.map((value) => { const item = { ...value, material: { ...value.material } } as Record<string, unknown> & { material: Record<string, unknown> }; for (const key of ["price", "amount"]) delete item[key]; for (const key of ["purchasePrice"]) delete item.material[key]; return item; }) };
}
