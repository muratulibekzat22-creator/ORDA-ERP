import { prisma } from "@/lib/prisma";
import { compareRequestHash, isPrismaUniqueConflict } from "@/lib/idempotency";

export async function getWarehouse() {
  const [materials, orders] = await Promise.all([
    prisma.material.findMany({
      include: { movements: { include: { order: { select: { id: true, number: true } } }, orderBy: { createdAt: "desc" } } },
      orderBy: { name: "asc" },
    }),
    prisma.order.findMany({ select: { id: true, number: true, client: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
  ]);
  const movements = materials.flatMap((material) => material.movements.map((movement) => ({ ...movement, material: { id: material.id, name: material.name, unit: material.unit } })).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
  const stockValue = materials.reduce((sum, material) => sum + material.stock * Number(material.purchasePrice), 0);
  return { materials, movements, orders, stats: { materials: materials.length, lowStock: materials.filter((material) => material.stock <= material.minimumStock).length, stockValue, suppliers: [...new Set(materials.map((material) => material.supplier).filter(Boolean))] } };
}

export async function createMaterial(data: { name: string; category: string; unit: string; minimumStock: number; purchasePrice: number; supplier?: string; initialStock?: number; idempotencyKey?: string; requestHash?: string }) {
  if (data.idempotencyKey) {
    const repeated = await prisma.material.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
    if (repeated) {
      if (!data.requestHash || !compareRequestHash(repeated.requestHash, data.requestHash)) throw new Error("IDEMPOTENCY_CONFLICT");
      return repeated;
    }
  }
  if (await prisma.material.findFirst({ where: { name: { equals: data.name, mode: "insensitive" } }, select: { id: true } })) throw new Error("MATERIAL_DUPLICATE");
  try {
    return await prisma.$transaction(async (tx) => {
      const material = await tx.material.create({ data: { name: data.name, category: data.category, unit: data.unit, minimumStock: data.minimumStock, stock: data.initialStock ?? 0, purchasePrice: String(data.purchasePrice), supplier: data.supplier, idempotencyKey: data.idempotencyKey, requestHash: data.requestHash } });
      if ((data.initialStock ?? 0) > 0) await tx.materialMovement.create({ data: { materialId: material.id, type: "incoming", quantity: data.initialStock!, price: String(data.purchasePrice), supplier: data.supplier, comment: "Начальный остаток", idempotencyKey: data.idempotencyKey ? `initial:${data.idempotencyKey}` : undefined, requestHash: data.requestHash } });
      return material;
    });
  } catch (error) {
    if (isPrismaUniqueConflict(error) && data.idempotencyKey && data.requestHash) {
      const repeated = await prisma.material.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
      if (repeated && compareRequestHash(repeated.requestHash, data.requestHash)) return repeated;
      throw new Error("IDEMPOTENCY_CONFLICT");
    }
    throw error;
  }
}

export async function createMaterialMovement(data: { materialId: number; type: "incoming" | "outgoing"; quantity: number; price?: number; supplier?: string; orderId?: number; comment?: string; date?: Date; idempotencyKey?:string; requestHash?:string }) {
  try { return await prisma.$transaction(async (tx) => {
    if(data.idempotencyKey&&data.requestHash){const existing=await tx.materialMovement.findUnique({where:{idempotencyKey:data.idempotencyKey}});if(existing){if(existing.requestHash!==data.requestHash)throw new Error("IDEMPOTENCY_CONFLICT");return existing;}}
    const material = await tx.material.findUnique({ where: { id: data.materialId } });
    if (!material) return null;
    const nextStock = data.type === "incoming" ? material.stock + data.quantity : material.stock - data.quantity;
    if (nextStock < 0) throw new Error("Недостаточно материала на складе");
    const movement = await tx.materialMovement.create({ data: { materialId: data.materialId, type: data.type, quantity: data.quantity, price: String(data.price ?? material.purchasePrice), supplier: data.supplier, orderId: data.orderId, comment: data.comment, createdAt: data.date,idempotencyKey:data.idempotencyKey,requestHash:data.requestHash } });
    await tx.material.update({ where: { id: material.id }, data: { stock: nextStock, ...(data.type === "incoming" && data.price !== undefined ? { purchasePrice: String(data.price) } : {}), ...(data.supplier ? { supplier: data.supplier } : {}) } });
    if (data.orderId) await tx.orderEvent.create({ data: { orderId: data.orderId, title: "Расход материала", description: `${material.name}: ${data.quantity} ${material.unit}${data.comment ? ` • ${data.comment}` : ""}`, user: "Склад",idempotencyKey:data.idempotencyKey?`warehouse-event:${data.idempotencyKey}`:undefined,requestHash:data.requestHash } });
    return movement;
  }); } catch(error) { if(isPrismaUniqueConflict(error)&&data.idempotencyKey&&data.requestHash){const existing=await prisma.materialMovement.findUnique({where:{idempotencyKey:data.idempotencyKey}});if(existing&&compareRequestHash(existing.requestHash,data.requestHash))return existing;throw new Error("IDEMPOTENCY_CONFLICT");}throw error; }
}

export async function getOrderMaterials(orderId: number) { return prisma.materialMovement.findMany({ where: { orderId, type: "outgoing" }, include: { material: true }, orderBy: { createdAt: "desc" } }); }
