import { Prisma, Role } from "@prisma/client";
import { normalizePhone } from "@/lib/leads/domain";
import { prisma } from "@/lib/prisma";
import { compareRequestHash, isPrismaUniqueConflict } from "@/lib/idempotency";
import { del } from "@vercel/blob";

export async function getOrders(where: import("@prisma/client").Prisma.OrderWhereInput = {}) {
  return prisma.order.findMany({
    where,
    select: {
      id: true,
      number: true,
      address: true,
      staircase: true,
      material: true,
      amount: true,
      prepayment: true,
      balance: true,
      partnerPrice: true,
      companyProfit: true,
      partnerPaid: true,
      partnerBalance: true,
      manager: true,
      managerUserId: true,
      lifecycle: true,
      version: true,
      status: true,
      productionDeadline: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
      client: { select: { id: true, name: true, phone: true, city: true } },
      partner: { select: { id: true, name: true } },
      productions: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: { stage: true, master: true, plannedEndAt: true },
      },
      installation: {
        select: { scheduledAt: true, installerUser: { select: { name: true } } },
      },
      blockers: {
        where: { status: "OPEN" },
        take: 1,
        orderBy: { createdAt: "desc" },
        select: { title: true, severity: true },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function getOrder(id: number) {
  return prisma.order.findUnique({
    where: {
      id,
    },
    include: {
      client: true,
      partner: true,
      measurements: true,
      payments: { include: { partner: true }, orderBy: [{ operationDate: "desc" }, { id: "desc" }] },
      partnerAssignmentHistory: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      productions: true,
      documents: true,
      calculations: {
        orderBy: { createdAt: "desc" },
        include: { lines: { orderBy: { position: "asc" } } },
      },
      statusHistory: { orderBy: { createdAt: "desc" } },
      events: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });
}

// Retained only for backwards-compatible source history; new writes use createOrder below.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function createLegacyOrder(data: {
  number: string;
  clientId: number;

  partnerId?: number | null;

  address: string;
  staircase: string;
  material: string;

  amount: string;
  prepayment: string;
  balance: string;

  partnerPrice: string;
  companyProfit: string;
  partnerPaid: string;
  partnerBalance: string;

  manager: string;
  managerUserId?: number;
  status: string;
}) {
  const order = await prisma.order.create({
    data,
  });

  await prisma.orderEvent.create({
    data: {
      orderId: order.id,
      title: "Создан заказ",
      description: `Заказ ${order.number} успешно создан.`,
      user: data.manager,
    },
  });

  await prisma.production.create({
    data: {
      orderId: order.id,
      stage: data.status,
      percent: 0,
      master: "",
    },
  });

  return order;
}

type CreateOrderInput = {
  clientId?: number;
  client?: {
    name: string;
    phone: string;
    city: string;
    address: string;
  };
  partnerId: number | null;
  address: string;
  staircase: string;
  material: string;
  mapUrl?: string;
  orderReceivedAt?: Date;
  promisedAt?: Date | null;
  frameComment?: string;
  railingType?: string;
  supportType?: string;
  color?: string;
  lighting?: boolean;
  lightingDetails?: string;
  cladding?: boolean;
  claddingDetails?: string;
  additionalDetails?: string;
  paymentMethod?: string;
  initialPaymentDate?: Date;
  initialPaymentComment?: string;
  amount: number;
  prepayment: number;
  partnerPrice: number;
  partnerPaid: number;
  manager: string;
  managerUserId?: number;
  actorRole?: Role;
  enforceClientOwnership?: boolean;
  idempotencyKey?: string;
  requestHash?: string;
};

function orderNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `ORD-${date}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

function money(value: number) {
  return value.toFixed(2);
}

export async function createOrder(data: CreateOrderInput) {
  if (data.partnerPaid > 0 && !data.partnerId) throw new Error("PARTNER_REQUIRED_FOR_INITIAL_PAYOUT");
  if (!data.clientId && !data.client) throw new Error("CLIENT_REQUIRED");
  if (data.actorRole === Role.MANAGER && !data.managerUserId) throw new Error("MANAGER_REQUIRED");
  const eventKey = data.idempotencyKey
    ? `order:${data.idempotencyKey}`
    : undefined;
  const balance = data.amount - data.prepayment;
  const partnerBalance = data.partnerPrice - data.partnerPaid;
  const companyProfit = data.amount - data.partnerPrice;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        if (eventKey && data.requestHash) {
          const existingEvent = await tx.orderEvent.findUnique({
            where: { idempotencyKey: eventKey },
            select: { orderId: true, requestHash: true },
          });
          if (existingEvent) {
            if (
              !compareRequestHash(existingEvent.requestHash, data.requestHash)
            )
              throw new Error("IDEMPOTENCY_CONFLICT");
            return {
              order: await tx.order.findUniqueOrThrow({
                where: { id: existingEvent.orderId },
              }),
              created: false,
            };
          }
        }

        let clientId = data.clientId;
        if (data.client) {
          const phone = normalizePhone(data.client.phone);
          if (!phone) throw new Error("INVALID_CLIENT_PHONE");
          const existing = await tx.client.findFirst({
            where: { active: true, OR: [{ phone }, { whatsapp: phone }] },
            select: { id: true, managerUserId: true, manager: true },
          });
          if (existing) {
            if (
              (data.actorRole === Role.MANAGER || data.enforceClientOwnership) &&
              existing.managerUserId &&
              existing.managerUserId !== data.managerUserId
            )
              throw new Error("FORBIDDEN_CLIENT_OWNERSHIP");
            if (!existing.managerUserId && data.actorRole === Role.MANAGER && existing.manager && existing.manager !== data.manager)
              throw new Error("FORBIDDEN_CLIENT_OWNERSHIP");
            if (!existing.managerUserId) await tx.client.update({ where: { id: existing.id }, data: { managerUserId: data.managerUserId, manager: data.manager } });
            if (clientId && clientId !== existing.id) throw new Error("CLIENT_PHONE_MISMATCH");
            clientId = existing.id;
          } else if (clientId) {
            throw new Error("CLIENT_PHONE_MISMATCH");
          } else {
            const createdClient = await tx.client.create({
              data: {
                name: data.client.name,
                phone,
                whatsapp: phone,
                city: data.client.city,
                address: data.client.address,
                manager: data.manager,
                managerUserId: data.managerUserId,
                amount: money(data.amount),
                estimatedAmount: money(data.amount),
                status: "Order registered",
                stage: "WON",
                source: "Existing order",
                comment: "Created while registering an existing order",
              },
              select: { id: true },
            });
            clientId = createdClient.id;
          }
        }
        if (!clientId) throw new Error("CLIENT_REQUIRED");
        const ownedClient = await tx.client.findUnique({ where: { id: clientId }, select: { managerUserId: true, manager: true } });
        if (!ownedClient) throw new Error("CLIENT_NOT_FOUND");
        if (
          (data.actorRole === Role.MANAGER || data.enforceClientOwnership) &&
          ownedClient.managerUserId &&
          ownedClient.managerUserId !== data.managerUserId
        )
          throw new Error("FORBIDDEN_CLIENT_OWNERSHIP");
        if (!ownedClient.managerUserId && data.actorRole === Role.MANAGER && ownedClient.manager && ownedClient.manager !== data.manager)
          throw new Error("FORBIDDEN_CLIENT_OWNERSHIP");
        if (!ownedClient.managerUserId) await tx.client.update({ where: { id: clientId }, data: { managerUserId: data.managerUserId, manager: data.manager } });

        const order = await tx.order.create({
          data: {
            number: orderNumber(),
            clientId,
            partnerId: data.partnerId,
            address: data.address,
            staircase: data.staircase,
            material: data.material,
            mapUrl: data.mapUrl ?? "",
            orderReceivedAt: data.orderReceivedAt ?? new Date(),
            promisedAt: data.promisedAt,
            frameComment: data.frameComment ?? "",
            railingType: data.railingType ?? "",
            supportType: data.supportType ?? "",
            color: data.color ?? "",
            lighting: data.lighting ?? false,
            lightingDetails: data.lightingDetails ?? "",
            cladding: data.cladding ?? false,
            claddingDetails: data.claddingDetails ?? "",
            additionalDetails: data.additionalDetails ?? "",
            paymentMethod: data.paymentMethod ?? "",
            amount: money(data.amount),
            prepayment: money(data.prepayment),
            balance: money(balance),
            partnerPrice: money(data.partnerPrice),
            partnerPaid: money(data.partnerPaid),
            partnerBalance: money(partnerBalance),
            companyProfit: money(companyProfit),
            manager: data.manager,
            managerUserId: data.managerUserId,
            status: "Новая заявка",
          },
        });
        if (data.prepayment > 0) await tx.payment.create({ data: { orderId: order.id, amount: money(data.prepayment), type: "CLIENT_PAYMENT", method: data.paymentMethod || "OTHER", operationDate: data.initialPaymentDate ?? new Date(), comment: data.initialPaymentComment || "Initial payment registered with existing order", author: data.manager, idempotencyKey: data.idempotencyKey ? `order-client-payment:${data.idempotencyKey}` : undefined, requestHash: data.requestHash } });
        if (data.partnerPaid > 0) await tx.payment.create({ data: { orderId: order.id, partnerId: data.partnerId, amount: money(data.partnerPaid), type: "PARTNER_PAYOUT", method: "initial_order_posting", comment: "Initial partner payout", author: data.manager, idempotencyKey: data.idempotencyKey ? `order-partner-payout:${data.idempotencyKey}` : undefined, requestHash: data.requestHash } });
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            title: "Создан заказ",
            description: `Заказ ${order.number} успешно создан.`,
            user: data.manager,
            idempotencyKey: eventKey,
            requestHash: data.requestHash,
          },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: null,
            toStatus: "Новая заявка",
            changedByName: data.manager,
            changedByRole: data.actorRole ?? "MANAGER",
            comment: "Заказ создан",
          },
        });
        await tx.orderLifecycleEvent.create({ data: { orderId: order.id, type: "ORDER_CREATED", toLifecycle: "CREATED", actorId: data.managerUserId, actorName: data.manager, role: data.actorRole ?? "MANAGER", idempotencyKey: data.idempotencyKey ? `order-lifecycle:${data.idempotencyKey}` : undefined, requestHash: data.requestHash } });
        return { order, created: true };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 20_000 });
    } catch (error) {
      if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT")
        throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") continue;
      if (!isPrismaUniqueConflict(error)) throw error;
      if (eventKey && data.requestHash) {
        const existingEvent = await prisma.orderEvent.findUnique({
          where: { idempotencyKey: eventKey },
          select: { orderId: true, requestHash: true },
        });
        if (existingEvent) {
          if (!compareRequestHash(existingEvent.requestHash, data.requestHash))
            throw new Error("IDEMPOTENCY_CONFLICT");
          return {
            order: await prisma.order.findUniqueOrThrow({
              where: { id: existingEvent.orderId },
            }),
            created: false,
          };
        }
      }
    }
  }

  throw new Error("ORDER_NUMBER_CONFLICT");
}

export async function updateOrder(
  id: number,
  data: {
    number: string;
    clientId: number;

    partnerId?: number | null;

    address: string;
    staircase: string;
    material: string;

    amount: string;
    prepayment: string;
    balance: string;

    partnerPrice: string;
    companyProfit: string;
    partnerPaid: string;
    partnerBalance: string;

    manager: string;
    status: string;
  },
) {
  const order = await prisma.order.update({
    where: {
      id,
    },
    data,
  });

  await prisma.orderEvent.create({
    data: {
      orderId: id,
      title: "Обновление заказа",
      description: "Карточка заказа была изменена.",
      user: data.manager,
    },
  });

  return order;
}

export async function deleteOrder(id: number) {
  const attachments = await prisma.attachment.findMany({
    where: { orderId: id },
    select: { pathname: true },
  });
  if (attachments.length)
    await del(attachments.map((attachment) => attachment.pathname));
  await prisma.orderEvent.deleteMany({
    where: {
      orderId: id,
    },
  });

  return prisma.order.delete({
    where: {
      id,
    },
  });
}
export async function addPayment(data: {
  orderId: number;
  amount: number;
  method: string;
  type: string;
  comment?: string;
}) {
  const payment = await prisma.payment.create({
    data,
  });

  await prisma.order.update({
    where: {
      id: data.orderId,
    },
    data: {
      prepayment: {
        increment: data.amount,
      },
      balance: {
        decrement: data.amount,
      },
    },
  });

  await prisma.orderEvent.create({
    data: {
      orderId: data.orderId,
      title: "Поступила оплата",
      description: `${data.amount.toLocaleString()} ₸`,
      user: "ERP",
    },
  });

  return payment;
}

export async function addMeasurement(data: {
  orderId: number;
  measurer: string;
  visitDate: Date;
  floorHeight?: number;
  staircaseWidth?: number;
  stepsCount?: number;
  comment?: string;
}) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: data.orderId }, select: { clientId: true } });
  const measurement = await prisma.measurement.create({
    data: { ...data, clientId: order.clientId },
  });

  await prisma.orderEvent.create({
    data: {
      orderId: data.orderId,
      title: "Добавлен замер",
      description: data.comment,
      user: data.measurer,
    },
  });

  return measurement;
}

export async function addProduction(data: {
  orderId: number;
  stage: string;
  percent: number;
  master: string;
  comment?: string;
}) {
  const production = await prisma.production.create({
    data,
  });

  await prisma.orderEvent.create({
    data: {
      orderId: data.orderId,
      title: "Производство",
      description: `${data.stage} (${data.percent}%)`,
      user: data.master,
    },
  });

  return production;
}

export async function addOrderEvent(data: {
  orderId: number;
  title: string;
  description?: string;
  user?: string;
}) {
  return prisma.orderEvent.create({
    data,
  });
}
