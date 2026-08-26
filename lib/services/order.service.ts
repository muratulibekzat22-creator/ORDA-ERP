import {
  DocumentStatus,
  DocumentType,
  PartnerRewardRule,
  PartnerSettlementStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { normalizePhone } from "@/lib/leads/domain";
import { prisma } from "@/lib/prisma";
import { compareRequestHash, isPrismaUniqueConflict } from "@/lib/idempotency";
import { createPaymentReceiptRecord, ensurePaymentReceiptPdf } from "@/lib/services/payment-receipt.service";
import { requireTenantIdentity } from "@/lib/tenant-context";

export async function getOrders(
  where: import("@prisma/client").Prisma.OrderWhereInput = {},
  options: { includeDeleted?: boolean; skip?: number; take?: number } = {},
) {
  const effectiveWhere: Prisma.OrderWhereInput =
    options.includeDeleted || Object.hasOwn(where, "deletedAt")
      ? where
      : { AND: [where, { deletedAt: null }] };
  const orders = await prisma.order.findMany({
    where: effectiveWhere,
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
      partnerAgreedAt: true,
      companyProfit: true,
      partnerPaid: true,
      partnerBalance: true,
      manager: true,
      managerUserId: true,
      deletedAt: true,
      deletedById: true,
      deletedBy: { select: { id: true, name: true } },
      lifecycle: true,
      version: true,
      status: true,
      productionDeadline: true,
      promisedAt: true,
      partnerPlannedReadyAt: true,
      completedAt: true,
      financialClosedAt: true,
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
        select: {
          scheduledAt: true,
          installerUser: { select: { name: true } },
        },
      },
      blockers: {
        where: { status: "OPEN" },
        take: 1,
        orderBy: { createdAt: "desc" },
        select: { title: true, severity: true },
      },
      documents: {
        where: {
          type: DocumentType.CONTRACT,
          status: {
            notIn: [DocumentStatus.ARCHIVED, DocumentStatus.CANCELLED],
          },
        },
        take: 1,
        select: { id: true },
      },
      _count: {
        select: {
          payments: true,
          companyLedgerEntries: true,
          financeAuditEvents: true,
          payrollAccruals: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: Math.max(0, options.skip ?? 0),
    take: Math.min(100, Math.max(1, options.take ?? 100)),
  });
  return orders.map(({ _count, ...order }) => ({
    ...order,
    hasFinancialHistory:
      _count.payments > 0 ||
      _count.companyLedgerEntries > 0 ||
      _count.financeAuditEvents > 0 ||
      _count.payrollAccruals > 0,
  }));
}

export type OrderSearchActor = { role: Role; userId: number; name: string };

export async function searchOrderOptions(actor: OrderSearchActor, query = "", limit = 20) {
  const roleScope: Prisma.OrderWhereInput = actor.role === Role.MANAGER
    ? { OR: [
        { managerUserId: actor.userId },
        { managerUserId: null, manager: actor.name },
        { leadConversion: { managerId: actor.userId } },
      ] }
    : actor.role === Role.PARTNER
      ? { partner: { userId: actor.userId }, partnerAgreedAt: { not: null } }
      : actor.role === Role.PRODUCTION
        ? { productions: { some: { masterUserId: actor.userId, archivedAt: null } } }
        : actor.role === Role.INSTALLER
          ? { installation: { installerUserId: actor.userId } }
          : actor.role === Role.MEASURER
            ? { measurements: { some: { measurerUserId: actor.userId } } }
            : {};
  const search = query.trim().slice(0, 120);
  const digits = search.replace(/\D/g, "");
  const searchWhere: Prisma.OrderWhereInput = search ? { OR: [
    { number: { contains: search, mode: "insensitive" } },
    { client: { name: { contains: search, mode: "insensitive" } } },
    { client: { phone: { contains: search } } },
    ...(digits.length >= 3 && digits !== search ? [{ client: { phone: { contains: digits } } }] : []),
  ] } : {};
  return prisma.order.findMany({
    where: { deletedAt: null, lifecycle: { not: "CANCELLED" }, AND: [roleScope, searchWhere] },
    select: { id: true, number: true, createdAt: true, client: { select: { id: true, name: true, phone: true } }, partner: { select: { id: true, name: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(50, Math.max(1, Math.trunc(limit))),
  });
}

export function countOrders(where: Prisma.OrderWhereInput = {}) {
  return prisma.order.count({ where });
}

export async function getOrder(id: number) {
  return prisma.order.findUnique({
    where: {
      id,
    },
    include: {
      client: true,
      partner: true,
      deletedBy: { select: { id: true, name: true } },
      managerUser: { include: { payrollProfile: { select: { id: true } } } },
      measurements: {
        include: {
          measurerUser: {
            include: { payrollProfile: { select: { id: true } } },
          },
        },
      },
      payments: {
        include: { partner: true },
        orderBy: [{ operationDate: "desc" }, { id: "desc" }],
      },
      partnerAssignmentHistory: {
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
      partnerRelation: {
        include: {
          createdBy: { select: { name: true } },
          operations: {
            include: {
              createdBy: { select: { name: true } },
              reversalOf: { select: { id: true } },
              reversal: { select: { id: true } },
            },
            orderBy: [{ operationDate: "desc" }, { id: "desc" }],
          },
          auditEvents: {
            include: { actor: { select: { name: true } } },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          },
        },
      },
      costPlan: true,
      costPlanRevisions: { orderBy: { createdAt: "desc" }, take: 20 },
      payrollAccruals: {
        include: {
          employee: { include: { user: { select: { name: true, role: true } } } },
          payments: true,
          reversedBy: { select: { id: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      productions: true,
      commercialAdjustments: { orderBy: { createdAt: "asc" } },
      companyLedgerEntries: { orderBy: { operationDate: "asc" } },
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
      _count: {
        select: {
          payments: true,
          companyLedgerEntries: true,
          financeAuditEvents: true,
          payrollAccruals: true,
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
  partnerPriceSet?: boolean;
  partnerPaid: number;
  partnerWorkDueAt?: Date | null;
  partnerPaymentDueAt?: Date | null;
  partnerComment?: string;
  manager: string;
  managerUserId?: number;
  actorId?: number;
  actorName?: string;
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

function isTransactionWriteConflict(error: unknown) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  )
    return true;
  if (!error || typeof error !== "object" || !("cause" in error)) return false;
  const cause = (error as { cause?: { kind?: unknown } }).cause;
  return cause?.kind === "TransactionWriteConflict";
}

export async function createOrder(data: CreateOrderInput) {
  if (data.partnerPaid > 0 && !data.partnerId)
    throw new Error("PARTNER_REQUIRED_FOR_INITIAL_PAYOUT");
  if (data.partnerPaid > 0 && !data.partnerPriceSet)
    throw new Error("PARTNER_PRICE_REQUIRED");
  if (!data.clientId && !data.client) throw new Error("CLIENT_REQUIRED");
  if (data.actorRole === Role.MANAGER && !data.managerUserId)
    throw new Error("MANAGER_REQUIRED");
  const eventKey = data.idempotencyKey
    ? `order:${data.idempotencyKey}`
    : undefined;
  const balance = data.amount - data.prepayment;
  const partnerBalance = data.partnerPrice - data.partnerPaid;
  const companyProfit = data.amount - data.partnerPrice;
  const tenant = requireTenantIdentity().companyId;
  const actorId = data.actorId ?? data.managerUserId;
  const actorName = data.actorName ?? data.manager;
  if (!actorId) throw new Error("ACTOR_REQUIRED");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
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
            const clientName = data.client.name.trim();
            const clientCity = data.client.city.trim();
            if (!clientId && !clientName) throw new Error("CLIENT_NAME_REQUIRED");
            if (!clientCity) throw new Error("CLIENT_CITY_REQUIRED");
            const phone = normalizePhone(data.client.phone);
            if (!phone) throw new Error("INVALID_CLIENT_PHONE");
            const existing = await tx.client.findFirst({
              where: { active: true, OR: [{ phone }, { whatsapp: phone }] },
              select: { id: true, name: true, city: true, address: true, managerUserId: true, manager: true },
            });
            if (existing) {
              if (
                (data.actorRole === Role.MANAGER ||
                  data.enforceClientOwnership) &&
                existing.managerUserId &&
                existing.managerUserId !== data.managerUserId
              )
                throw new Error("FORBIDDEN_CLIENT_OWNERSHIP");
              if (
                !existing.managerUserId &&
                data.actorRole === Role.MANAGER &&
                existing.manager &&
                existing.manager !== data.manager
              )
                throw new Error("FORBIDDEN_CLIENT_OWNERSHIP");
              if (!existing.managerUserId || (!existing.name.trim() && clientName) || (!existing.city.trim() && clientCity) || (!existing.address.trim() && data.client.address.trim()))
                await tx.client.update({
                  where: { id: existing.id },
                  data: {
                    ...(!existing.managerUserId ? { managerUserId: data.managerUserId, manager: data.manager } : {}),
                    ...(!existing.name.trim() && clientName ? { name: clientName } : {}),
                    ...(!existing.city.trim() && clientCity ? { city: clientCity } : {}),
                    ...(!existing.address.trim() && data.client.address.trim() ? { address: data.client.address.trim() } : {}),
                  },
                });
              if (clientId && clientId !== existing.id)
                throw new Error("CLIENT_PHONE_MISMATCH");
              clientId = existing.id;
            } else if (clientId) {
              throw new Error("CLIENT_PHONE_MISMATCH");
            } else {
              const createdClient = await tx.client.create({
                data: {
                  name: clientName,
                  phone,
                  whatsapp: phone,
                  city: clientCity,
                  address: data.client.address.trim(),
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
          const ownedClient = await tx.client.findUnique({
            where: { id: clientId },
            select: { name: true, city: true, managerUserId: true, manager: true },
          });
          if (!ownedClient) throw new Error("CLIENT_NOT_FOUND");
          if (data.enforceClientOwnership && !ownedClient.name.trim()) throw new Error("CLIENT_NAME_REQUIRED");
          if (data.enforceClientOwnership && !ownedClient.city.trim()) throw new Error("CLIENT_CITY_REQUIRED");
          if (
            (data.actorRole === Role.MANAGER || data.enforceClientOwnership) &&
            ownedClient.managerUserId &&
            ownedClient.managerUserId !== data.managerUserId
          )
            throw new Error("FORBIDDEN_CLIENT_OWNERSHIP");
          if (
            !ownedClient.managerUserId &&
            data.actorRole === Role.MANAGER &&
            ownedClient.manager &&
            ownedClient.manager !== data.manager
          )
            throw new Error("FORBIDDEN_CLIENT_OWNERSHIP");
          if (!ownedClient.managerUserId)
            await tx.client.update({
              where: { id: clientId },
              data: {
                managerUserId: data.managerUserId,
                manager: data.manager,
              },
            });

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
              partnerAgreedAt:
                data.partnerId && data.partnerPriceSet ? new Date() : null,
              partnerPaid: money(data.partnerPaid),
              partnerBalance: money(partnerBalance),
              companyProfit: money(companyProfit),
              manager: data.manager,
              managerUserId: data.managerUserId,
              status: "Новая заявка",
            },
          });
          if (data.partnerId) {
            const relation = await tx.partnerOrderRelation.create({
              data: {
                companyId: tenant,
                partnerId: data.partnerId,
                orderId: order.id,
                rewardRule: PartnerRewardRule.MANUAL,
                rewardPercent: null,
                fixedAmount: null,
                manualAmount: data.partnerPriceSet ? money(data.partnerPrice) : null,
                profitBasis: money(companyProfit),
                startsAt: order.orderReceivedAt,
                workDueAt: data.partnerWorkDueAt,
                paymentDueAt: data.partnerPaymentDueAt,
                settlementStatus: data.partnerPriceSet
                  ? PartnerSettlementStatus.CALCULATED
                  : PartnerSettlementStatus.NOT_CALCULATED,
                comment: data.partnerComment?.trim().slice(0, 2000) || null,
                createdById: actorId,
              },
            });
            await tx.partnerAuditEvent.create({
              data: {
                companyId: tenant,
                partnerId: data.partnerId,
                relationId: relation.id,
                action: "ORDER_LINKED",
                after: {
                  orderId: order.id,
                  partnerPrice: data.partnerPriceSet ? money(data.partnerPrice) : null,
                },
                comment: data.partnerComment?.trim().slice(0, 2000) || null,
                actorId,
              },
            });
          }
          let initialPaymentId: number | null = null;
          if (data.prepayment > 0) {
            const initialPayment = await tx.payment.create({
              data: {
                orderId: order.id,
                amount: money(data.prepayment),
                type: "CLIENT_PAYMENT",
                method: data.paymentMethod || "OTHER",
                operationDate: data.initialPaymentDate ?? new Date(),
                comment:
                  data.initialPaymentComment ||
                  "Initial payment registered with existing order",
                author: data.manager,
                idempotencyKey: data.idempotencyKey
                  ? `order-client-payment:${data.idempotencyKey}`
                  : undefined,
                requestHash: data.requestHash,
              },
            });
            initialPaymentId = initialPayment.id;
            await createPaymentReceiptRecord(tx, initialPayment.id, data.managerUserId);
          }
          if (data.partnerPaid > 0)
            await tx.payment.create({
              data: {
                orderId: order.id,
                partnerId: data.partnerId,
                amount: money(data.partnerPaid),
                type: "PARTNER_PAYOUT",
                method: "initial_order_posting",
                comment: "Initial partner payout",
                author: data.manager,
                idempotencyKey: data.idempotencyKey
                  ? `order-partner-payout:${data.idempotencyKey}`
                  : undefined,
                requestHash: data.requestHash,
              },
            });
          await tx.orderEvent.create({
            data: {
              orderId: order.id,
              title: "Создан заказ",
              description: data.partnerId
                ? `Заказ ${order.number} создан и передан выбранному исполнителю.`
                : `Заказ ${order.number} успешно создан.`,
              user: actorName,
              idempotencyKey: eventKey,
              requestHash: data.requestHash,
            },
          });
          await tx.orderStatusHistory.create({
            data: {
              orderId: order.id,
              fromStatus: null,
              toStatus: "Новая заявка",
              changedByName: actorName,
              changedByRole: data.actorRole ?? "MANAGER",
              comment: "Заказ создан",
            },
          });
          await tx.orderLifecycleEvent.create({
            data: {
              orderId: order.id,
              type: "ORDER_CREATED",
              toLifecycle: "CREATED",
              actorId,
              actorName,
              role: data.actorRole ?? "MANAGER",
              idempotencyKey: data.idempotencyKey
                ? `order-lifecycle:${data.idempotencyKey}`
                : undefined,
              requestHash: data.requestHash,
            },
          });
          return { order, created: true, initialPaymentId };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 20_000,
        },
      );
      if ("initialPaymentId" in result && result.initialPaymentId) {
        try { await ensurePaymentReceiptPdf(result.initialPaymentId); } catch { /* PDF remains retryable from Documents. */ }
      }
      return result;
    } catch (error) {
      if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT")
        throw error;
      if (isTransactionWriteConflict(error)) {
        if (attempt < 2)
          await new Promise((resolve) =>
            setTimeout(resolve, 25 * (attempt + 1)),
          );
        continue;
      }
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
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: data.orderId },
    select: { clientId: true },
  });
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
