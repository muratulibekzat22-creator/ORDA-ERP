import { DocumentType, Prisma, Role } from "@prisma/client";
import { del } from "@vercel/blob";

import { compareRequestHash, isPrismaUniqueConflict } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { getOrder } from "@/lib/services/order.service";

export type DocumentActor = { role: Role; userId: number };

const documentInclude = {
  order: {
    select: {
      id: true,
      number: true,
      address: true,
      client: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.DocumentInclude;

async function partnerId(actor: DocumentActor) {
  if (actor.role !== Role.PARTNER) return undefined;
  return (
    (
      await prisma.partner.findUnique({
        where: { userId: actor.userId },
        select: { id: true },
      })
    )?.id ?? -1
  );
}

export async function getDocuments(
  actor: DocumentActor,
  filters: { orderId?: number; type?: DocumentType } = {},
) {
  const ownerPartnerId = await partnerId(actor);
  return prisma.document.findMany({
    where: {
      ...(filters.orderId ? { orderId: filters.orderId } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(ownerPartnerId === undefined
        ? {}
        : { order: { partnerId: ownerPartnerId } }),
    },
    include: documentInclude,
    orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }],
  });
}

export async function createDocument(input: {
  orderId: number;
  type: DocumentType;
  number: string;
  documentDate: Date;
  idempotencyKey: string;
  requestHash: string;
  actor: DocumentActor;
}) {
  if (input.actor.role !== Role.DIRECTOR && input.actor.role !== Role.MANAGER)
    throw new Error("FORBIDDEN");
  const repeated = await prisma.document.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: documentInclude,
  });
  if (repeated) {
    if (!compareRequestHash(repeated.requestHash, input.requestHash))
      throw new Error("IDEMPOTENCY_CONFLICT");
    return { document: repeated, created: false };
  }
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: { id: true },
  });
  if (!order) return null;
  try {
    const document = await prisma.document.create({
      data: {
        orderId: input.orderId,
        type: input.type,
        number: input.number,
        documentDate: input.documentDate,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      },
      include: documentInclude,
    });
    return { document, created: true };
  } catch (error) {
    if (!isPrismaUniqueConflict(error)) throw error;
    const afterRace = await prisma.document.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: documentInclude,
    });
    if (
      afterRace &&
      compareRequestHash(afterRace.requestHash, input.requestHash)
    )
      return { document: afterRace, created: false };
    throw new Error("DOCUMENT_CONFLICT");
  }
}

export async function deleteDocument(id: number, actor: DocumentActor) {
  if (actor.role !== Role.DIRECTOR && actor.role !== Role.MANAGER)
    throw new Error("FORBIDDEN");
  const document = await prisma.document.findUnique({
    where: { id },
    select: { id: true, attachments: { select: { pathname: true } } },
  });
  if (!document) return null;
  if (document.attachments.length)
    await del(document.attachments.map((attachment) => attachment.pathname));
  return prisma.document.delete({ where: { id }, select: { id: true } });
}

export async function getDocumentOrder(id: number, actor: DocumentActor) {
  if (!Number.isInteger(id) || id <= 0) return null;
  if (actor.role === Role.PARTNER) {
    const ownerPartnerId = await partnerId(actor);
    const owned = await prisma.order.findFirst({
      where: { id, partnerId: ownerPartnerId },
      select: { id: true },
    });
    if (!owned) return null;
  }
  const [order, company] = await Promise.all([
    getOrder(id),
    prisma.companySettings.findUnique({ where: { id: 1 } }),
  ]);
  return order ? { ...order, company } : null;
}
