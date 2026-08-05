import "dotenv/config";

import { Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  createMaterialCommand,
  createWarehouseOperation,
  deleteMaterialCommand,
  getOrderMaterials,
  getWarehouse,
  updateMaterialCommand,
  WarehouseActor,
  WarehouseError,
} from "@/lib/services/warehouse.service";

const tag = `warehouse-${Date.now()}`;
const ids: { users: number[]; client?: number; orders: number[]; materials: number[] } = { users: [], orders: [], materials: [] };
const check: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(`FAILED: ${message}`); };
const actor = (user: { id: number; name: string; role: Role }): WarehouseActor => ({ userId: user.id, name: user.name, role: user.role });
const isWarehouseError = (error: unknown, code: WarehouseError["code"]) => error instanceof WarehouseError && error.code === code;
async function rejects(work: () => Promise<unknown>, code: WarehouseError["code"]) { try { await work(); } catch (error) { if (isWarehouseError(error, code)) return; throw error; } throw new Error(`FAILED: expected ${code}`); }

async function main() {
  let step = "initialize";
  try {
    const users = await Promise.all([Role.DIRECTOR, Role.MANAGER, Role.ACCOUNTANT, Role.PRODUCTION, Role.PRODUCTION, Role.INSTALLER, Role.PARTNER].map((role, index) => prisma.user.create({ data: { name: `${tag}-${role}-${index}`, email: `${tag}-${index}@test.local`, password: "test-only", role } })));
    ids.users = users.map(({ id }) => id);
    const [director, manager, accountant, production, foreignProduction, installer, partner] = users;
    const client = await prisma.client.create({ data: { name: tag, phone: tag, city: "QA", manager: manager.name, amount: "0", status: "Новый" } }); ids.client = client.id;
    const orders = await Promise.all(["own", "foreign"].map((suffix) => prisma.order.create({ data: { number: `${tag}-${suffix}`, clientId: client.id, address: "QA", staircase: "Прямая", material: "QA", amount: "100", manager: manager.name } })));
    ids.orders = orders.map(({ id }) => id);
    await prisma.production.createMany({ data: [{ orderId: orders[0].id, stage: "Каркас", master: production.name, masterUserId: production.id }, { orderId: orders[1].id, stage: "Каркас", master: foreignProduction.name, masterUserId: foreignProduction.id }] });

    step = "material CRUD, duplicate and idempotency";
    const materialInput = { name: `${tag} steel`, category: "Metal", unit: "кг", minimumStock: 5, purchasePrice: 10, supplier: "QA", initialStock: 20 };
    const create = { data: materialInput, key: `${tag}:material`, requestHash: "material-v1", actor: actor(director) };
    const [created, replay] = await Promise.all([createMaterialCommand(create), createMaterialCommand(create)]);
    const materialId = (created.result as { id: number }).id; ids.materials.push(materialId);
    check((replay.result as { id: number }).id === materialId, "parallel idempotent material replay");
    await rejects(() => createMaterialCommand({ ...create, requestHash: "material-conflict" }), "IDEMPOTENCY_CONFLICT");
    await rejects(() => createMaterialCommand({ ...create, key: `${tag}:duplicate`, requestHash: "duplicate" }), "MATERIAL_DUPLICATE");
    const concurrentData = { ...materialInput, name: `${tag} concurrent`, initialStock: 0 };
    const concurrent = await Promise.allSettled(["one", "two"].map((suffix) => createMaterialCommand({ data: concurrentData, key: `${tag}:concurrent:${suffix}`, requestHash: suffix, actor: actor(director) })));
    check(concurrent.filter((result) => result.status === "fulfilled").length === 1 && concurrent.filter((result) => result.status === "rejected" && isWarehouseError(result.reason, "MATERIAL_DUPLICATE")).length === 1, "concurrent duplicate material is rejected");
    const concurrentMaterial = await prisma.material.findUniqueOrThrow({ where: { lookupKey: `${concurrentData.name.toLocaleLowerCase("ru")}::кг` } }); ids.materials.push(concurrentMaterial.id);
    await updateMaterialCommand({ id: materialId, data: { minimumStock: 6, active: false }, key: `${tag}:disable`, requestHash: "disable", actor: actor(director) });
    await updateMaterialCommand({ id: materialId, data: { active: true }, key: `${tag}:enable`, requestHash: "enable", actor: actor(director) });

    step = "roles, physical stock and actual price snapshot";
    await rejects(() => getWarehouse(actor(partner)), "FORBIDDEN");
    await rejects(() => createMaterialCommand({ ...create, key: `${tag}:manager-create`, actor: actor(manager) }), "FORBIDDEN");
    await rejects(() => createWarehouseOperation({ data: { materialId, type: "incoming", quantity: 1 }, key: `${tag}:manager-incoming`, requestHash: "x", actor: actor(manager) }), "FORBIDDEN");
    await rejects(() => createWarehouseOperation({ data: { materialId, type: "outgoing", quantity: 1 }, key: `${tag}:accountant-out`, requestHash: "x", actor: actor(accountant) }), "FORBIDDEN");
    await createWarehouseOperation({ data: { materialId, type: "incoming", quantity: 5, price: 12 }, key: `${tag}:incoming`, requestHash: "incoming", actor: actor(accountant) });
    await createWarehouseOperation({ data: { materialId, type: "outgoing", quantity: 2, price: 12, orderId: orders[0].id }, key: `${tag}:outgoing`, requestHash: "outgoing", actor: actor(director) });
    await rejects(() => createWarehouseOperation({ data: { materialId, type: "outgoing", quantity: 10_000 }, key: `${tag}:negative`, requestHash: "negative", actor: actor(director) }), "INSUFFICIENT_AVAILABLE");

    step = "reservations, ownership and concurrency";
    const reserve = { data: { materialId, type: "reserve" as const, quantity: 8, orderId: orders[0].id }, key: `${tag}:reserve`, requestHash: "reserve", actor: actor(manager) };
    await Promise.all([createWarehouseOperation(reserve), createWarehouseOperation(reserve)]);
    check(await prisma.materialMovement.count({ where: { idempotencyKey: reserve.key } }) === 1, "duplicate reserve creates one movement");
    await rejects(() => createWarehouseOperation({ data: { materialId, type: "reserve", quantity: 10_000, orderId: orders[1].id }, key: `${tag}:overreserve`, requestHash: "overreserve", actor: actor(manager) }), "INSUFFICIENT_AVAILABLE");
    await createWarehouseOperation({ data: { materialId, type: "reserve", quantity: 3, orderId: orders[1].id }, key: `${tag}:reserve-foreign`, requestHash: "reserve-foreign", actor: actor(manager) });
    await rejects(() => createWarehouseOperation({ data: { materialId, type: "consume", quantity: 1, orderId: orders[1].id }, key: `${tag}:foreign-consume`, requestHash: "foreign", actor: actor(production) }), "FORBIDDEN");
    await rejects(() => createWarehouseOperation({ data: { materialId, type: "consume", quantity: 1, orderId: orders[0].id }, key: `${tag}:installer-consume`, requestHash: "installer", actor: actor(installer) }), "FORBIDDEN");
    await createWarehouseOperation({ data: { materialId, type: "release", quantity: 2, orderId: orders[0].id }, key: `${tag}:release`, requestHash: "release", actor: actor(manager) });
    await createWarehouseOperation({ data: { materialId, type: "consume", quantity: 3, orderId: orders[0].id, comment: "QA consume" }, key: `${tag}:consume`, requestHash: "consume", actor: actor(production) });

    step = "scope, totals, history and delete conflict";
    const own = await getWarehouse(actor(production));
    const foreign = await getWarehouse(actor(foreignProduction));
    check(own.orders.length === 1 && own.orders[0].id === orders[0].id, "production sees own order");
    check(foreign.orders.length === 1 && foreign.orders[0].id === orders[1].id, "foreign production isolated");
    check(own.movements.every((movement) => movement.orderId === orders[0].id || movement.employeeId === production.id), "movement scope");
    const costs = await getOrderMaterials(orders[0].id);
    check(costs.totalCost === 60 && costs.items.length === 2, "order actual cost uses movement price snapshot");
    await updateMaterialCommand({ id: materialId, data: { purchasePrice: 99 }, key: `${tag}:price`, requestHash: "price", actor: actor(accountant) });
    check((await getOrderMaterials(orders[0].id)).totalCost === 60, "historical cost remains stable");
    const latest = await getWarehouse(actor(director), { page: 1, pageSize: 2 });
    check(latest.movements.length === 2 && latest.pagination.total >= 7 && latest.movements[0].operationAt >= latest.movements[1].operationAt, "paginated sorted history");
    const stored = await prisma.material.findUniqueOrThrow({ where: { id: materialId } });
    check(stored.stock >= 0 && stored.reserved >= 0 && stored.reserved <= stored.stock, "warehouse invariants");
    await rejects(() => deleteMaterialCommand({ id: materialId, key: `${tag}:delete`, requestHash: "delete", actor: actor(director) }), "MATERIAL_IN_USE");
    console.log("warehouse final integration passed");
  } catch (error) {
    console.error(`warehouse final failed at ${step}`, error);
    process.exitCode = 1;
  } finally {
    await prisma.warehouseMutation.deleteMany({ where: { key: { startsWith: tag } } });
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: ids.orders } } });
    await prisma.materialMovement.deleteMany({ where: { OR: [{ materialId: { in: ids.materials } }, { orderId: { in: ids.orders } }] } });
    await prisma.materialReservation.deleteMany({ where: { OR: [{ materialId: { in: ids.materials } }, { orderId: { in: ids.orders } }] } });
    await prisma.productionStageHistory.deleteMany({ where: { production: { orderId: { in: ids.orders } } } });
    await prisma.production.deleteMany({ where: { orderId: { in: ids.orders } } });
    await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
    if (ids.materials.length) await prisma.material.deleteMany({ where: { id: { in: ids.materials } } });
    if (ids.client) await prisma.client.deleteMany({ where: { id: ids.client } });
    if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.$disconnect();
  }
}

void main();
