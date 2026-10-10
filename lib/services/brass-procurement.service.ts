import {
  CalendarTaskPriority,
  CalendarTaskStatus,
  CalendarTaskType,
  Prisma,
  PurchaseAllocationMethod,
  PurchaseBatchStatus,
  PurchaseCostType,
  Role,
} from "@prisma/client";

import {
  brassModelSummary,
  normalizeBrassCostBearer,
  normalizeBrassModelQuantities,
  totalBrassPairs,
  type BrassCostBearer,
  type BrassModelQuantities,
} from "@/lib/brass/catalog";
import { compareRequestHash } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import {
  deleteAttachment,
  uploadAttachment,
} from "@/lib/services/attachment.service";
import {
  addPurchaseCost,
  createPurchaseBatch,
  finalizePurchaseBatch,
  receivePurchaseBatch,
} from "@/lib/services/purchase.service";
import { createWarehouseOperation } from "@/lib/services/warehouse.service";

export const BRASS_STATUSES = [
  "REQUESTED",
  "ORDERED",
  "IN_TRANSIT",
  "RECEIVED",
  "COST_FINALIZED",
  "CANCELLED",
] as const;

export type BrassProcurementActor = {
  userId: number;
  role: Role;
  name: string;
};

export class BrassProcurementError extends Error {
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

const brassPurchaseContext = { workflow: "BRASS_PROCUREMENT" } as const;
const roundMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const procurementInclude = {
  order: {
    select: {
      id: true,
      number: true,
      managerUserId: true,
      deletedAt: true,
      client: { select: { id: true, name: true, phone: true } },
    },
  },
  photoAttachment: {
    select: { id: true, fileName: true, contentType: true, size: true },
  },
  material: { select: { id: true, name: true, unit: true } },
  orderItem: {
    select: {
      id: true,
      quantity: true,
      reservedQuantity: true,
      issuedQuantity: true,
    },
  },
  supplier: { select: { id: true, name: true, contact: true } },
  responsibleUser: { select: { id: true, name: true, role: true } },
  reminderTask: {
    select: { id: true, dueAt: true, status: true, acknowledgedAt: true },
  },
  purchaseBatch: {
    select: {
      id: true,
      number: true,
      status: true,
      expectedArrivalDate: true,
      actualArrivalDate: true,
      purchaseGoodsCostKzt: true,
      additionalCostKzt: true,
      landedCostKzt: true,
    },
  },
  purchaseBatchLine: {
    select: {
      id: true,
      orderedQuantity: true,
      receivedQuantity: true,
      finalUnitLandedCost: true,
      provisionalUnitLandedCost: true,
    },
  },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
} satisfies Prisma.OrderBrassProcurementInclude;

type ProcurementRow = Prisma.OrderBrassProcurementGetPayload<{
  include: typeof procurementInclude;
}>;

function publicRow(row: ProcurementRow) {
  const goodsCost = Number(row.goodsCostKzt);
  const cargoCost = Number(row.cargoCostKzt);
  const supplierPaid = Number(row.supplierPaidKzt);
  const cargoPaid = Number(row.cargoPaidKzt);
  return {
    ...row,
    quantityPairs: Number(row.quantityPairs),
    modelQuantities: normalizeBrassModelQuantities(row.modelQuantities),
    costBearer: normalizeBrassCostBearer(row.costBearer),
    exchangeRate: Number(row.exchangeRate),
    unitPurchasePrice: Number(row.unitPurchasePrice),
    goodsCostKzt: goodsCost,
    cargoCostKzt: cargoCost,
    landedCostKzt: Number(row.landedCostKzt),
    supplierPaidKzt: supplierPaid,
    cargoPaidKzt: cargoPaid,
    supplierBalanceKzt: Math.max(0, roundMoney(goodsCost - supplierPaid)),
    cargoBalanceKzt: Math.max(0, roundMoney(cargoCost - cargoPaid)),
    totalPaidKzt: roundMoney(supplierPaid + cargoPaid),
    photoUrl: row.photoAttachment
      ? `/api/attachments/${row.photoAttachment.id}?disposition=inline`
      : null,
  };
}

function assertInternalEmployee(actor: BrassProcurementActor) {
  if (actor.role === Role.PARTNER)
    throw new BrassProcurementError("FORBIDDEN");
}

async function findAccessibleOrder(orderId: number) {
  return prisma.order.findFirst({
    where: {
      id: orderId,
      deletedAt: null,
    },
    select: {
      id: true,
      companyId: true,
      number: true,
      managerUserId: true,
      brassCostBearer: true,
    },
  });
}

export async function getOrderBrassProcurement(
  orderId: number,
  actor: BrassProcurementActor,
) {
  assertInternalEmployee(actor);
  if (!(await findAccessibleOrder(orderId)))
    throw new BrassProcurementError("NOT_FOUND");
  const row = await prisma.orderBrassProcurement.findFirst({
    where: { orderId },
    include: procurementInclude,
  });
  return row ? publicRow(row) : null;
}

const activeProcurementsQuery = () =>
  prisma.orderBrassProcurement.findMany({
    where: {
      status: { not: "CANCELLED" },
    },
    include: procurementInclude,
    orderBy: [
      { expectedArrivalDate: { sort: "asc", nulls: "last" } },
      { createdAt: "desc" },
    ],
    take: 200,
  });

export async function listBrassProcurements(actor: BrassProcurementActor) {
  assertInternalEmployee(actor);
  const rows = await activeProcurementsQuery();
  return rows.map(publicRow);
}

export async function getBrassProcurementWorkspace(
  actor: BrassProcurementActor,
) {
  assertInternalEmployee(actor);
  const [rows, suppliers, locations, availableOrders] = await prisma.$transaction([
    activeProcurementsQuery(),
    prisma.supplier.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        country: true,
        defaultCurrency: true,
        contact: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.warehouseLocation.findMany({
      where: { active: true },
      select: { id: true, name: true, isDefault: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
    prisma.order.findMany({
      where: { deletedAt: null, brassProcurement: null },
      select: {
        id: true,
        number: true,
        brassCostBearer: true,
        client: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);
  return {
    procurements: rows.map(publicRow),
    suppliers,
    locations,
    availableOrders,
  };
}

export async function getBrassProcurement(
  procurementId: number,
  actor: BrassProcurementActor,
) {
  assertInternalEmployee(actor);
  const row = await prisma.orderBrassProcurement.findFirst({
    where: { id: procurementId, status: { not: "CANCELLED" } },
    include: procurementInclude,
  });
  if (!row) throw new BrassProcurementError("NOT_FOUND");
  return publicRow(row);
}

export async function createBrassProcurement(input: {
  orderId: number;
  modelQuantities?: Partial<BrassModelQuantities>;
  quantityPairs?: number;
  costBearer?: BrassCostBearer;
  notes?: string;
  photo?: File | null;
  key: string;
  requestHash: string;
  actor: BrassProcurementActor;
}) {
  assertInternalEmployee(input.actor);
  let modelQuantities = normalizeBrassModelQuantities(input.modelQuantities);
  let quantityPairs = totalBrassPairs(modelQuantities);
  if (
    quantityPairs === 0 &&
    Number.isInteger(input.quantityPairs) &&
    Number(input.quantityPairs) > 0
  ) {
    modelQuantities = {
      ...modelQuantities,
      OVAL_BLACK: Number(input.quantityPairs),
    };
    quantityPairs = totalBrassPairs(modelQuantities);
  }
  if (
    quantityPairs <= 0 ||
    quantityPairs > 10_000 ||
    (input.photo && !input.photo.type.startsWith("image/"))
  )
    throw new BrassProcurementError("INVALID");
  const order = await findAccessibleOrder(input.orderId);
  if (!order) throw new BrassProcurementError("NOT_FOUND");
  const costBearer = normalizeBrassCostBearer(
    input.costBearer ?? order.brassCostBearer,
  );
  const repeated = await prisma.orderBrassProcurement.findUnique({
    where: { idempotencyKey: input.key },
    include: procurementInclude,
  });
  if (repeated) {
    if (!compareRequestHash(repeated.requestHash, input.requestHash))
      throw new BrassProcurementError("IDEMPOTENCY_CONFLICT");
    return { procurement: publicRow(repeated), created: false };
  }
  if (await prisma.orderBrassProcurement.findFirst({ where: { orderId: order.id } }))
    throw new BrassProcurementError("CONFLICT");

  const uploaded = input.photo
    ? await uploadAttachment({
        orderId: order.id,
        purpose: "BRASS_REFERENCE",
        file: input.photo,
        idempotencyKey: `${input.key}:photo`,
        actor: input.actor,
      })
    : null;
  if (input.photo && !uploaded) throw new BrassProcurementError("FORBIDDEN");

  try {
    const row = await prisma.$transaction(
      async (tx) => {
        const material = await tx.material.upsert({
          where: {
            companyId_lookupKey: {
              companyId: order.companyId,
              lookupKey: "brass-baluster-pair",
            },
          },
          create: {
            name: "Балясина латунь",
            category: "Латунь",
            unit: "пара",
            lookupKey: "brass-baluster-pair",
            code: "BRASS-BALUSTER-PAIR",
            description: "Комплект латунных балясин; количество учитывается в парах.",
            quantityPrecision: 0,
            quantityKnown: true,
            availabilityConfirmed: false,
          },
          update: { active: true },
        });
        const position = await tx.orderItem.count({ where: { orderId: order.id } });
        const item = await tx.orderItem.create({
          data: {
            orderId: order.id,
            materialId: material.id,
            skuSnapshot: material.code ?? "BRASS-BALUSTER-PAIR",
            nameSnapshot: material.name,
            variantSnapshot: brassModelSummary(modelQuantities),
            unitSnapshot: "пара",
            quantity: String(quantityPairs),
            unitPrice: 0,
            lineTotal: 0,
            stockTracked: true,
            position,
          },
        });
        const procurement = await tx.orderBrassProcurement.create({
          data: {
            orderId: order.id,
            quantityPairs: String(quantityPairs),
            modelQuantities,
            costBearer,
            photoAttachmentId: uploaded?.attachment.id,
            materialId: material.id,
            orderItemId: item.id,
            responsibleUserId: input.actor.userId,
            notes: input.notes?.trim().slice(0, 1000) ?? "",
            createdById: input.actor.userId,
            updatedById: input.actor.userId,
            idempotencyKey: input.key,
            requestHash: input.requestHash,
          },
          include: procurementInclude,
        });
        await tx.order.update({
          where: { id: order.id },
          data: { brassCostBearer: costBearer },
        });
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            title: "Запрошена закупка латуни",
            description: `${quantityPairs} пар: ${brassModelSummary(modelQuantities)}. Расходы: ${costBearer === "COMPANY" ? "компания" : "подрядчик / цех"}. Заявка передана на склад${uploaded ? ", фото приложено" : ""}.`,
            user: input.actor.name,
          },
        });
        return procurement;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return { procurement: publicRow(row), created: true };
  } catch (error) {
    if (uploaded?.created)
      await deleteAttachment(uploaded.attachment.id, input.actor).catch(() => undefined);
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new BrassProcurementError("CONFLICT");
    throw error;
  }
}

export async function placeBrassOrder(input: {
  procurementId: number;
  supplierId: number;
  expectedArrivalDate: Date;
  purchaseCurrency: string;
  exchangeRate: number;
  unitPurchasePrice: number;
  responsibleUserId: number;
  notes?: string;
  key: string;
  requestHash: string;
  actor: BrassProcurementActor;
}) {
  assertInternalEmployee(input.actor);
  if (
    !Number.isInteger(input.supplierId) ||
    !Number.isInteger(input.responsibleUserId) ||
    !Number.isFinite(input.expectedArrivalDate.getTime()) ||
    input.expectedArrivalDate.getTime() <= Date.now() ||
    !Number.isFinite(input.exchangeRate) ||
    input.exchangeRate <= 0 ||
    !Number.isFinite(input.unitPurchasePrice) ||
    input.unitPurchasePrice <= 0
  )
    throw new BrassProcurementError("INVALID");
  const request = await prisma.orderBrassProcurement.findFirst({
    where: { id: input.procurementId },
    include: { order: true },
  });
  if (!request) throw new BrassProcurementError("NOT_FOUND");
  if (request.status === "ORDERED" && request.purchaseBatchId) {
    const existingBatch = await prisma.purchaseBatch.findUnique({
      where: { id: request.purchaseBatchId },
      select: { idempotencyKey: true, requestHash: true },
    });
    if (
      existingBatch?.idempotencyKey !== `${input.key}:batch` ||
      !compareRequestHash(existingBatch.requestHash, input.requestHash)
    )
      throw new BrassProcurementError("CONFLICT");
    const existingRequest = await prisma.orderBrassProcurement.findFirst({
      where: { id: request.id },
      include: procurementInclude,
    });
    if (!existingRequest) throw new BrassProcurementError("NOT_FOUND");
    return publicRow(existingRequest);
  }
  if (request.status !== "REQUESTED")
    throw new BrassProcurementError("CONFLICT");
  // The shared pg adapter uses one client for the current tenant context. Keep
  // these authorization reads sequential so a concurrent query cannot cross
  // responses or leak a stale identifier into the purchase transaction.
  const supplier = await prisma.supplier.findFirst({
    where: { id: input.supplierId, active: true },
  });
  const responsible = await prisma.user.findFirst({
    where: {
      id: input.responsibleUserId,
      active: true,
      role: {
        not: Role.PARTNER,
      },
    },
  });
  if (!supplier || !responsible) throw new BrassProcurementError("INVALID");

  const batchResult = await createPurchaseBatch(
    {
      supplierId: supplier.id,
      orderDate: new Date(),
      expectedArrivalDate: input.expectedArrivalDate,
      purchaseCurrency: input.purchaseCurrency.trim().toUpperCase().slice(0, 8),
      fixedExchangeRate: input.exchangeRate,
      allocationMethod: PurchaseAllocationMethod.BY_QUANTITY,
      notes: `Латунь для заказа ${request.order.number}. ${input.notes ?? ""}`.trim(),
      lines: [
        {
          materialId: request.materialId,
          orderedQuantity: Number(request.quantityPairs),
          purchaseUnitPrice: input.unitPurchasePrice,
        },
      ],
      key: `${input.key}:batch`,
      requestHash: input.requestHash,
    },
    input.actor,
    brassPurchaseContext,
  );
  const line = await prisma.purchaseBatchLine.findFirst({
    where: { batchId: batchResult.batch.id, materialId: request.materialId },
  });
  if (!line) throw new BrassProcurementError("CONFLICT");
  const reminderDue = new Date(
    input.expectedArrivalDate.getTime() - 3 * 24 * 60 * 60 * 1000,
  );
  const dueAt = reminderDue.getTime() > Date.now() ? reminderDue : new Date();

  const updated = await prisma.$transaction(async (tx) => {
    let task = await tx.calendarTask.findFirst({
      where: { controlKey: `brass-procurement:${request.id}` },
    });
    const taskData = {
      title: `Уточнить доставку латуни · ${request.order.number}`,
      description: `Связаться с поставщиком ${supplier.name}, проверить отправку и срок доставки ${Number(request.quantityPairs)} пар латунных балясин.`,
      type: CalendarTaskType.REMINDER,
      dueAt,
      status: CalendarTaskStatus.PLANNED,
      priority: CalendarTaskPriority.IMPORTANT,
      assigneeId: responsible.id,
      creatorId: input.actor.userId,
      orderId: request.orderId,
      acknowledgementRequired: true,
      controlKey: `brass-procurement:${request.id}`,
    };
    task = task
      ? await tx.calendarTask.update({ where: { id: task.id }, data: taskData })
      : await tx.calendarTask.create({ data: taskData });
    await tx.purchaseBatch.update({
      where: { id: batchResult.batch.id },
      data: {
        status: PurchaseBatchStatus.ORDERED,
        responsibleUserId: responsible.id,
        version: { increment: 1 },
      },
    });
    const procurement = await tx.orderBrassProcurement.update({
      where: { id: request.id },
      data: {
        status: "ORDERED",
        supplierId: supplier.id,
        purchaseBatchId: batchResult.batch.id,
        purchaseBatchLineId: line.id,
        responsibleUserId: responsible.id,
        reminderTaskId: task.id,
        expectedArrivalDate: input.expectedArrivalDate,
        purchaseCurrency: input.purchaseCurrency.trim().toUpperCase().slice(0, 8),
        exchangeRate: String(input.exchangeRate),
        unitPurchasePrice: String(input.unitPurchasePrice),
        goodsCostKzt: batchResult.batch.purchaseGoodsCostKzt,
        landedCostKzt: batchResult.batch.landedCostKzt,
        notes: input.notes?.trim().slice(0, 1000) ?? request.notes,
        updatedById: input.actor.userId,
        version: { increment: 1 },
      },
      include: procurementInclude,
    });
    await tx.orderEvent.create({
      data: {
        orderId: request.orderId,
        title: "Латунь заказана у поставщика",
        description: `${supplier.name} · ожидается ${input.expectedArrivalDate.toLocaleDateString("ru-RU")} · ${batchResult.batch.number}`,
        user: input.actor.name,
      },
    });
    return procurement;
  });
  return publicRow(updated);
}

export async function markBrassInTransit(
  procurementId: number,
  actor: BrassProcurementActor,
) {
  assertInternalEmployee(actor);
  const request = await prisma.orderBrassProcurement.findFirst({
    where: { id: procurementId },
  });
  if (!request) throw new BrassProcurementError("NOT_FOUND");
  if (request.status === "IN_TRANSIT") {
    const current = await prisma.orderBrassProcurement.findFirst({
      where: { id: request.id },
      include: procurementInclude,
    });
    if (!current) throw new BrassProcurementError("NOT_FOUND");
    return publicRow(current);
  }
  if (request.status !== "ORDERED" || !request.purchaseBatchId)
    throw new BrassProcurementError("CONFLICT");
  return prisma.$transaction(async (tx) => {
    await tx.purchaseBatch.update({
      where: { id: request.purchaseBatchId! },
      data: { status: PurchaseBatchStatus.IN_TRANSIT, version: { increment: 1 } },
    });
    const row = await tx.orderBrassProcurement.update({
      where: { id: request.id },
      data: {
        status: "IN_TRANSIT",
        updatedById: actor.userId,
        version: { increment: 1 },
      },
      include: procurementInclude,
    });
    return publicRow(row);
  });
}

export async function recordBrassPayment(input: {
  procurementId: number;
  kind: "SUPPLIER" | "CARGO";
  amount: number;
  method: string;
  paidAt: Date;
  comment?: string;
  key: string;
  requestHash: string;
  actor: BrassProcurementActor;
}) {
  assertInternalEmployee(input.actor);
  if (
    !Number.isFinite(input.amount) ||
    input.amount <= 0 ||
    !Number.isFinite(input.paidAt.getTime())
  )
    throw new BrassProcurementError("INVALID");
  const accessible = await prisma.orderBrassProcurement.findFirst({
    where: { id: input.procurementId },
    select: { id: true },
  });
  if (!accessible) throw new BrassProcurementError("NOT_FOUND");
  const existing = await prisma.companyLedgerEntry.findUnique({
    where: { idempotencyKey: input.key },
  });
  if (existing) {
    if (!compareRequestHash(existing.requestHash, input.requestHash))
      throw new BrassProcurementError("IDEMPOTENCY_CONFLICT");
    return existing;
  }
  try {
    return await prisma.$transaction(
      async (tx) => {
      const request = await tx.orderBrassProcurement.findFirst({
        where: { id: input.procurementId },
        include: {
          supplier: { select: { name: true } },
          order: { select: { managerUserId: true } },
        },
      });
      if (!request) throw new BrassProcurementError("NOT_FOUND");
      const current = input.kind === "SUPPLIER"
        ? Number(request.supplierPaidKzt)
        : Number(request.cargoPaidKzt);
      const maximum = input.kind === "SUPPLIER"
        ? Number(request.goodsCostKzt)
        : Number(request.cargoCostKzt);
      if (maximum <= 0 || roundMoney(current + input.amount) > roundMoney(maximum))
        throw new BrassProcurementError("INVALID");
      const ledger = await tx.companyLedgerEntry.create({
        data: {
          type: input.kind === "SUPPLIER" ? "BRASS_SUPPLIER_PAYMENT" : "BRASS_CARGO_PAYMENT",
          category: input.kind === "SUPPLIER" ? "MATERIALS" : "DELIVERY",
          direction: "EXPENSE",
          source: "BRASS_PROCUREMENT_PAYMENT",
          amount: String(input.amount),
          operationDate: input.paidAt,
          method: input.method.trim().slice(0, 80),
          counterparty: input.kind === "SUPPLIER" ? request.supplier?.name : "Карго / доставка",
          orderId: request.orderId,
          comment: `Закупка латуни #${request.id}. ${input.comment ?? ""}`.trim(),
          authorId: input.actor.userId,
          affectsProfit: false,
          idempotencyKey: input.key,
          requestHash: input.requestHash,
        },
      });
      await tx.orderBrassProcurement.update({
        where: { id: request.id },
        data: {
          ...(input.kind === "SUPPLIER"
            ? { supplierPaidKzt: { increment: input.amount } }
            : { cargoPaidKzt: { increment: input.amount } }),
          updatedById: input.actor.userId,
          version: { increment: 1 },
        },
      });
      await tx.financeAuditEvent.create({
        data: {
          orderId: request.orderId,
          action: "BRASS_PROCUREMENT_PAYMENT",
          entityType: "CompanyLedgerEntry",
          entityId: ledger.id,
          after: { procurementId: request.id, kind: input.kind, amount: input.amount },
          reason: input.comment?.trim().slice(0, 500) || "Оплата по закупке латуни",
          authorId: input.actor.userId,
        },
      });
      return ledger;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const repeated = await prisma.companyLedgerEntry.findUnique({
        where: { idempotencyKey: input.key },
      });
      if (repeated && compareRequestHash(repeated.requestHash, input.requestHash))
        return repeated;
      throw new BrassProcurementError("IDEMPOTENCY_CONFLICT");
    }
    throw error;
  }
}

export async function finalizeBrassCost(input: {
  procurementId: number;
  goodsCostKzt: number;
  cargoCostKzt: number;
  receivedAt: Date;
  note?: string;
  key: string;
  requestHash: string;
  actor: BrassProcurementActor;
}) {
  assertInternalEmployee(input.actor);
  if (
    !Number.isFinite(input.goodsCostKzt) ||
    input.goodsCostKzt <= 0 ||
    !Number.isFinite(input.cargoCostKzt) ||
    input.cargoCostKzt < 0 ||
    !Number.isFinite(input.receivedAt.getTime())
  )
    throw new BrassProcurementError("INVALID");

  const eventKey = `brass-direct-cost:${input.key}`;
  const replay = await prisma.orderEvent.findUnique({
    where: { idempotencyKey: eventKey },
    select: { requestHash: true, orderId: true },
  });
  if (replay) {
    if (!compareRequestHash(replay.requestHash, input.requestHash))
      throw new BrassProcurementError("IDEMPOTENCY_CONFLICT");
    const row = await prisma.orderBrassProcurement.findFirst({
      where: { id: input.procurementId, orderId: replay.orderId },
      include: procurementInclude,
    });
    if (!row) throw new BrassProcurementError("NOT_FOUND");
    return publicRow(row);
  }

  const landedCostKzt = roundMoney(
    input.goodsCostKzt + input.cargoCostKzt,
  );
  try {
    const updated = await prisma.$transaction(
      async (tx) => {
        const request = await tx.orderBrassProcurement.findFirst({
          where: { id: input.procurementId },
        });
        if (!request) throw new BrassProcurementError("NOT_FOUND");
        if (request.status !== "REQUESTED")
          throw new BrassProcurementError("CONFLICT");
        const quantityPairs = Number(request.quantityPairs);
        await tx.orderItem.update({
          where: { id: request.orderItemId },
          data: {
            unitPrice: String(roundMoney(landedCostKzt / quantityPairs)),
            lineTotal: String(landedCostKzt),
            stockTracked: false,
          },
        });
        const row = await tx.orderBrassProcurement.update({
          where: { id: request.id },
          data: {
            status: "COST_FINALIZED",
            goodsCostKzt: String(input.goodsCostKzt),
            cargoCostKzt: String(input.cargoCostKzt),
            landedCostKzt: String(landedCostKzt),
            receivedAt: input.receivedAt,
            notes: input.note?.trim().slice(0, 1000) || request.notes,
            updatedById: input.actor.userId,
            version: { increment: 1 },
          },
          include: procurementInclude,
        });
        await tx.orderEvent.create({
          data: {
            orderId: request.orderId,
            title: "Зафиксирована себестоимость латуни",
            description: `${quantityPairs} пар · товар ${roundMoney(input.goodsCostKzt).toLocaleString("ru-RU")} ₸ · карго ${roundMoney(input.cargoCostKzt).toLocaleString("ru-RU")} ₸ · итого ${landedCostKzt.toLocaleString("ru-RU")} ₸. Расходы несёт ${request.costBearer === "CONTRACTOR" ? "подрядчик / цех" : "компания"}.`,
            user: input.actor.name,
            idempotencyKey: eventKey,
            requestHash: input.requestHash,
          },
        });
        return row;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return publicRow(updated);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const repeated = await prisma.orderEvent.findUnique({
        where: { idempotencyKey: eventKey },
        select: { requestHash: true, orderId: true },
      });
      if (repeated && compareRequestHash(repeated.requestHash, input.requestHash)) {
        const row = await prisma.orderBrassProcurement.findFirst({
          where: { id: input.procurementId, orderId: repeated.orderId },
          include: procurementInclude,
        });
        if (row) return publicRow(row);
      }
      throw new BrassProcurementError("IDEMPOTENCY_CONFLICT");
    }
    throw error;
  }
}

export async function receiveBrassProcurement(input: {
  procurementId: number;
  locationId: number;
  receivedAt: Date;
  cargoCostKzt: number;
  cargoProvider: string;
  supplierDocumentNumber?: string;
  note?: string;
  key: string;
  requestHash: string;
  actor: BrassProcurementActor;
}) {
  assertInternalEmployee(input.actor);
  if (
    !Number.isInteger(input.locationId) ||
    input.locationId <= 0 ||
    !Number.isFinite(input.receivedAt.getTime()) ||
    !Number.isFinite(input.cargoCostKzt) ||
    input.cargoCostKzt < 0
  )
    throw new BrassProcurementError("INVALID");
  const request = await prisma.orderBrassProcurement.findFirst({
    where: { id: input.procurementId },
    include: {
      order: { select: { managerUserId: true } },
      purchaseBatch: true,
      purchaseBatchLine: true,
      reminderTask: true,
    },
  });
  if (!request) throw new BrassProcurementError("NOT_FOUND");
  if (request.status === "COST_FINALIZED") {
    const repeatedReceipt = await prisma.purchaseReceipt.findUnique({
      where: { idempotencyKey: `${input.key}:receipt` },
      select: { requestHash: true },
    });
    if (
      !repeatedReceipt ||
      !compareRequestHash(repeatedReceipt.requestHash, input.requestHash)
    )
      throw new BrassProcurementError("CONFLICT");
    const row = await prisma.orderBrassProcurement.findFirst({
      where: { id: request.id },
      include: procurementInclude,
    });
    return publicRow(row!);
  }
  if (!request.purchaseBatch || !request.purchaseBatchLine)
    throw new BrassProcurementError("CONFLICT");

  await receivePurchaseBatch(
    request.purchaseBatch.id,
    [
      {
        lineId: request.purchaseBatchLine.id,
        receivedQuantity: Number(request.quantityPairs),
        rejectedQuantity: 0,
      },
    ],
    input.actor,
    {
      locationId: input.locationId,
      supplierDocumentNumber: input.supplierDocumentNumber,
      receivedAt: input.receivedAt,
      note: input.note,
      key: `${input.key}:receipt`,
      requestHash: input.requestHash,
    },
    brassPurchaseContext,
  );
  if (input.cargoCostKzt > 0)
    await addPurchaseCost(
      {
        batchId: request.purchaseBatch.id,
        type: PurchaseCostType.CARGO,
        provider: input.cargoProvider.trim().slice(0, 160) || "Карго",
        currency: "KZT",
        foreignAmount: input.cargoCostKzt,
        exchangeRate: 1,
        documentDate: input.receivedAt,
        allocationMethod: PurchaseAllocationMethod.BY_QUANTITY,
        comment: input.note?.trim().slice(0, 1000),
        key: `${input.key}:cargo`,
        requestHash: input.requestHash,
      },
      input.actor,
      brassPurchaseContext,
    );
  const batch = await finalizePurchaseBatch(
    request.purchaseBatch.id,
    undefined,
    `Латунь по заказу #${request.orderId}: товар + карго`,
    input.actor,
    brassPurchaseContext,
  );

  await createWarehouseOperation({
    data: {
      materialId: request.materialId,
      locationId: input.locationId,
      type: "reserve",
      quantity: Number(request.quantityPairs),
      orderId: request.orderId,
      comment: "Автоматический резерв латуни после приёмки",
    },
    key: `${input.key}:reserve`,
    requestHash: input.requestHash,
    actor: input.actor,
    authorizationContext: brassPurchaseContext,
  });

  const updated = await prisma.$transaction(async (tx) => {
    const reserved = await tx.materialReservation.aggregate({
      where: {
        orderId: request.orderId,
        materialId: request.materialId,
        status: "ACTIVE",
      },
      _sum: { quantity: true },
    });
    await tx.orderItem.update({
      where: { id: request.orderItemId },
      data: { reservedQuantity: String(reserved._sum.quantity ?? 0) },
    });
    if (request.reminderTaskId)
      await tx.calendarTask.update({
        where: { id: request.reminderTaskId },
        data: {
          status: CalendarTaskStatus.COMPLETED,
          completedAt: input.receivedAt,
          completedById: input.actor.userId,
          resultText: "Латунь получена и принята на склад",
          resultSubmittedAt: input.receivedAt,
        },
      });
    const row = await tx.orderBrassProcurement.update({
      where: { id: request.id },
      data: {
        status: "COST_FINALIZED",
        cargoCostKzt: String(input.cargoCostKzt),
        landedCostKzt: batch.landedCostKzt,
        receivedAt: input.receivedAt,
        updatedById: input.actor.userId,
        version: { increment: 1 },
      },
      include: procurementInclude,
    });
    await tx.orderEvent.create({
      data: {
        orderId: request.orderId,
        title: "Латунь получена",
        description: `${Number(request.quantityPairs)} пар принято. Полная себестоимость ${Number(batch.landedCostKzt).toLocaleString("ru-RU")} ₸, включая карго.`,
        user: input.actor.name,
      },
    });
    return row;
  });
  return publicRow(updated);
}
