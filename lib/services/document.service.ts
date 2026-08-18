import { createHash, randomUUID } from "crypto";
import { del, get, put } from "@/lib/private-blob";
import {
  DocumentSource,
  DocumentStatus,
  DocumentType,
  MeasurementPhotoType,
  Prisma,
  Role,
} from "@prisma/client";

import { compareRequestHash, isPrismaUniqueConflict } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { getOrder } from "@/lib/services/order.service";
import { requireTenantIdentity } from "@/lib/tenant-context";

export type DocumentActor = { role: Role; userId: number; name: string };
export const MAX_DOCUMENT_SIZE = 15 * 1024 * 1024;
export const DOCUMENT_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const financialTypes: DocumentType[] = [DocumentType.INVOICE, DocumentType.PAYMENT_RECEIPT];
const technicalTypes: DocumentType[] = [DocumentType.PROJECT, DocumentType.MEASUREMENT_SHEET, DocumentType.PHOTO, DocumentType.OTHER];
const installerTypes: DocumentType[] = [...technicalTypes, DocumentType.ACT];
const measurableTypes: DocumentType[] = [DocumentType.MEASUREMENT_SHEET, DocumentType.PHOTO, DocumentType.PROJECT, DocumentType.OTHER];
const legacyReadOnlyTypes = new Set<DocumentType>([
  DocumentType.PREPAYMENT_CONFIRMATION,
  DocumentType.CLOSING_ACT,
  DocumentType.WARRANTY,
  DocumentType.FINAL_PAYMENT_CONFIRMATION,
]);

const documentInclude = {
  client: { select: { id: true, name: true, phone: true, managerUserId: true, manager: true } },
  order: { select: { id: true, number: true, clientId: true } },
  payment: { select: { id: true, amount: true, method: true, operationDate: true, type: true } },
  author: { select: { id: true, name: true } },
  versions: { select: { id: true, version: true, fileName: true, contentType: true, size: true, checksum: true, comment: true, createdAt: true, pdfFileName: true, pdfContentType: true, pdfSize: true, pdfChecksum: true, pdfStatus: true, pdfGeneratedAt: true, pdfErrorCode: true, uploadedBy: { select: { id: true, name: true } } }, orderBy: { version: "desc" as const } },
  auditEvents: { select: { id: true, action: true, before: true, after: true, comment: true, createdAt: true, actor: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" as const }, take: 100 },
} satisfies Prisma.DocumentInclude;

function partnerId(actor: DocumentActor) {
  return prisma.partner.findUnique({ where: { userId: actor.userId }, select: { id: true } }).then((value) => value?.id ?? -1);
}

export function allowedDocumentTypes(actor: DocumentActor): DocumentType[] {
  if (actor.role === Role.ACCOUNTANT) return financialTypes;
  if (actor.role === Role.PRODUCTION) return technicalTypes;
  if (actor.role === Role.INSTALLER) return installerTypes;
  if (actor.role === Role.MEASURER) return measurableTypes;
  if (actor.role === Role.PARTNER) return [DocumentType.OFFER, ...technicalTypes];
  if (actor.role === Role.DESIGNER) return [DocumentType.PROJECT, DocumentType.MEASUREMENT_SHEET];
  return Object.values(DocumentType);
}

async function entityScope(actor: DocumentActor): Promise<{ client: Prisma.ClientWhereInput; order: Prisma.OrderWhereInput }> {
  if (actor.role === Role.DIRECTOR || actor.role === Role.ACCOUNTANT) return { client: {}, order: {} };
  if (actor.role === Role.MANAGER) {
    const client = { active: true, deletedAt: null, OR: [{ managerUserId: actor.userId }, { managerUserId: null, manager: actor.name }] };
    return { client, order: { deletedAt: null, client } };
  }
  if (actor.role === Role.PRODUCTION) return { client: { id: -1 }, order: { deletedAt: null, productions: { some: { masterUserId: actor.userId, archivedAt: null } } } };
  if (actor.role === Role.INSTALLER) return { client: { id: -1 }, order: { deletedAt: null, installation: { installerUserId: actor.userId } } };
  if (actor.role === Role.MEASURER) {
    const measurement = { some: { measurerUserId: actor.userId } };
    return { client: { active: true, deletedAt: null, measurements: measurement }, order: { deletedAt: null, measurements: measurement } };
  }
  if (actor.role === Role.DESIGNER) return { client: { id: -1 }, order: { id: -1 } };
  if (actor.role === Role.PARTNER) {
    const ownerPartnerId = await partnerId(actor);
    return { client: { id: -1 }, order: { deletedAt: null, partnerId: ownerPartnerId } };
  }
  return { client: { id: -1 }, order: { id: -1 } };
}

async function documentScope(actor: DocumentActor): Promise<Prisma.DocumentWhereInput> {
  const scope = await entityScope(actor);
  return {
    type: { in: allowedDocumentTypes(actor) },
    OR: [
      { orderId: { not: null }, order: scope.order },
      { orderId: null, clientId: { not: null }, client: scope.client },
    ],
  };
}

export async function canUseEntities(actor: DocumentActor, clientId?: number | null, orderId?: number | null) {
  if (!clientId && !orderId) return null;
  const scope = await entityScope(actor);
  const order = orderId ? await prisma.order.findFirst({ where: { id: orderId, deletedAt: null, AND: [scope.order] }, select: { id: true, clientId: true } }) : null;
  if (orderId && !order) return null;
  const effectiveClientId = clientId ?? order?.clientId ?? null;
  if (clientId && order && order.clientId !== clientId) throw new Error("ENTITY_MISMATCH");
  if (effectiveClientId && !orderId && !await prisma.client.findFirst({ where: { id: effectiveClientId, AND: [scope.client] }, select: { id: true } })) return null;
  return { clientId: effectiveClientId, orderId: order?.id ?? null };
}

function listSelect() {
  return {
    id: true, type: true, number: true, title: true, documentDate: true, status: true, source: true, currentVersion: true, createdAt: true,
    client: { select: { id: true, name: true, phone: true } },
    order: { select: { id: true, number: true } },
    payment: { select: { id: true, amount: true, method: true, operationDate: true, type: true } },
    author: { select: { id: true, name: true } },
  } satisfies Prisma.DocumentSelect;
}

export async function getDocuments(actor: DocumentActor, filters: { orderId?: number; clientId?: number; type?: DocumentType; status?: DocumentStatus; query?: string; from?: Date; to?: Date; authorId?: number; includeArchived?: boolean; skip?: number; take?: number } = {}) {
  const scope = await documentScope(actor);
  const query = filters.query?.trim().slice(0, 200);
  const skip = Math.max(0, Math.trunc(filters.skip ?? 0));
  const take = Math.min(100, Math.max(1, Math.trunc(filters.take ?? 100)));
  const scanLimit = skip + take;
  const documents = await prisma.document.findMany({
    where: {
      AND: [
        scope,
        { OR: [{ orderId: null }, { order: { deletedAt: null } }, { status: { not: DocumentStatus.DRAFT } }] },
      ],
      ...(filters.orderId ? { orderId: filters.orderId } : {}),
      ...(filters.clientId ? { clientId: filters.clientId } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.status ? { status: filters.status } : filters.includeArchived ? {} : { status: { not: DocumentStatus.ARCHIVED } }),
      ...(filters.authorId ? { authorId: filters.authorId } : {}),
      ...(filters.from || filters.to ? { documentDate: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lt: filters.to } : {}) } } : {}),
      ...(query ? { OR: [{ number: { contains: query, mode: "insensitive" } }, { title: { contains: query, mode: "insensitive" } }, { client: { name: { contains: query, mode: "insensitive" } } }, { client: { phone: { contains: query } } }, { order: { number: { contains: query, mode: "insensitive" } } }] } : {}),
    },
    select: listSelect(),
    orderBy: [{ documentDate: "desc" }, { id: "desc" }],
    take: scanLimit,
  });
  const linked = await getLinkedDocuments(actor, filters, scanLimit);
  return [...documents.map((item) => ({ ...item, recordKind: "DOCUMENT" as const, openHref: `/documents/${item.id}` })), ...linked]
    .sort((a, b) => new Date(String(b.documentDate)).getTime() - new Date(String(a.documentDate)).getTime())
    .slice(skip, skip + take);
}

export async function getDocumentOptions(actor: DocumentActor) {
  const scope = await entityScope(actor);
  const [clients, orders, payments, authorRows] = await Promise.all([
    prisma.client.findMany({ where: { active: true, deletedAt: null, AND: [scope.client] }, select: { id: true, name: true, phone: true }, orderBy: { name: "asc" }, take: 1000 }),
    prisma.order.findMany({ where: { deletedAt: null, AND: [scope.order] }, select: { id: true, number: true, client: { select: { id: true, name: true, phone: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 }),
    prisma.payment.findMany({ where: { orderId: { not: null }, type: { in: ["CLIENT_PAYMENT", "payment", "PREPAYMENT", "ADDITIONAL_PAYMENT"] }, order: { deletedAt: null, AND: [scope.order] } }, select: { id: true, orderId: true, amount: true, method: true, operationDate: true, comment: true }, orderBy: { operationDate: "desc" }, take: 1000 }),
    prisma.document.findMany({ where: { AND: [await documentScope(actor)], authorId: { not: null } }, select: { author: { select: { id: true, name: true } } }, distinct: ["authorId"], take: 500 }),
  ]);
  return { clients, orders, payments, authors: authorRows.map((row) => row.author).filter((value): value is { id: number; name: string } => Boolean(value)), allowedTypes: allowedDocumentTypes(actor) };
}

async function getLinkedDocuments(actor: DocumentActor, filters: { orderId?: number; clientId?: number; type?: DocumentType; status?: DocumentStatus; query?: string; from?: Date; to?: Date }, take = 100) {
  if (filters.status && filters.status !== DocumentStatus.READY) return [];
  const allowed = allowedDocumentTypes(actor), scope = await entityScope(actor), rows: Array<Record<string, unknown>> = [];
  const dateWhere = filters.from || filters.to ? { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lt: filters.to } : {}) } : undefined;
  if ((actor.role === Role.DIRECTOR || actor.role === Role.MANAGER) && allowed.includes(DocumentType.OFFER) && (!filters.type || filters.type === DocumentType.OFFER)) {
    const proposals = await prisma.commercialProposal.findMany({ where: { ...(filters.clientId ? { clientId: filters.clientId } : {}), ...(dateWhere ? { createdAt: dateWhere } : {}), client: scope.client }, select: { id: true, number: true, createdAt: true, createdById: true, createdByName: true, client: { select: { id: true, name: true, phone: true } } }, orderBy: { createdAt: "desc" }, take });
    for (const item of proposals) {
      if (filters.orderId) continue;
      rows.push({ id: `proposal-${item.id}`, recordKind: "PROPOSAL", type: DocumentType.OFFER, number: item.number, title: "Коммерческое предложение", documentDate: item.createdAt, status: DocumentStatus.READY, source: "GENERATED_PROPOSAL", currentVersion: 1, createdAt: item.createdAt, client: { id: item.client.id, name: item.client.name, phone: item.client.phone }, order: null, author: item.createdById ? { id: item.createdById, name: item.createdByName } : null, openHref: `/api/proposals/${item.id}/pdf` });
    }
  }
  if (allowed.some((type) => measurableTypes.includes(type)) && (!filters.type || measurableTypes.includes(filters.type))) {
    const attachments = await prisma.measurementAttachment.findMany({ where: { ...(dateWhere ? { createdAt: dateWhere } : {}), measurement: { ...(filters.clientId ? { clientId: filters.clientId } : {}), ...(filters.orderId ? { orderId: filters.orderId } : {}), OR: [{ order: scope.order }, { orderId: null, client: scope.client }] } }, select: { id: true, type: true, fileName: true, contentType: true, createdAt: true, uploadedBy: { select: { id: true, name: true } }, measurement: { select: { client: { select: { id: true, name: true, phone: true } }, order: { select: { id: true, number: true } } } } }, orderBy: { createdAt: "desc" }, take });
    for (const item of attachments) {
      const type = item.type === MeasurementPhotoType.SHEET ? DocumentType.MEASUREMENT_SHEET : DocumentType.PHOTO;
      if (filters.type && filters.type !== type) continue;
      rows.push({ id: `measurement-${item.id}`, recordKind: "MEASUREMENT_ATTACHMENT", type, number: "", title: item.type === MeasurementPhotoType.SHEET ? "Замерный лист" : item.fileName, documentDate: item.createdAt, status: DocumentStatus.READY, source: "MEASUREMENT_ATTACHMENT", currentVersion: 1, createdAt: item.createdAt, client: item.measurement.client, order: item.measurement.order, author: item.uploadedBy, openHref: `/api/document-links/measurement/${item.id}` });
    }
  }
  if (allowed.some((type) => type === DocumentType.OTHER || type === DocumentType.PHOTO) && (!filters.type || filters.type === DocumentType.OTHER || filters.type === DocumentType.PHOTO)) {
    const attachments = await prisma.attachment.findMany({ where: { ...(dateWhere ? { createdAt: dateWhere } : {}), ...(filters.orderId ? { orderId: filters.orderId } : {}), order: { ...scope.order, deletedAt: null, ...(filters.clientId ? { clientId: filters.clientId } : {}) } }, select: { id: true, fileName: true, contentType: true, createdAt: true, uploadedBy: { select: { id: true, name: true } }, order: { select: { id: true, number: true, client: { select: { id: true, name: true, phone: true } } } } }, orderBy: { createdAt: "desc" }, take });
    for (const item of attachments) {
      const type = item.contentType.startsWith("image/") ? DocumentType.PHOTO : DocumentType.OTHER;
      if (!allowed.includes(type) || (filters.type && filters.type !== type)) continue;
      rows.push({ id: `order-attachment-${item.id}`, recordKind: "ORDER_ATTACHMENT", type, number: "", title: item.fileName, documentDate: item.createdAt, status: DocumentStatus.READY, source: "ORDER_ATTACHMENT", currentVersion: 1, createdAt: item.createdAt, client: item.order.client, order: { id: item.order.id, number: item.order.number }, author: item.uploadedBy, openHref: `/api/attachments/${item.id}?disposition=inline` });
    }
  }
  const query = filters.query?.trim().toLocaleLowerCase("ru");
  return query ? rows.filter((row) => [row.number, row.title, (row.client as { name?: string; phone?: string } | null)?.name, (row.client as { phone?: string } | null)?.phone, (row.order as { number?: string } | null)?.number].some((value) => String(value ?? "").toLocaleLowerCase("ru").includes(query))) : rows;
}

function safeFileName(value: string) {
  return value.normalize("NFKC").replace(/[\u0000-\u001f\u007f/\\]/g, "_").replace(/\s+/g, " ").trim().slice(0, 180) || "file";
}
function hasPrefix(bytes: Buffer, signature: number[]) { return signature.every((value, index) => bytes[index] === value); }
function validFileContent(fileName: string, contentType: string, bytes: Buffer) {
  const extension = fileName.toLocaleLowerCase("en").split(".").pop();
  if (contentType === "application/pdf") return extension === "pdf" && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (contentType === "image/jpeg") return ["jpg", "jpeg"].includes(extension ?? "") && hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (contentType === "image/png") return extension === "png" && hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (contentType === "image/webp") return extension === "webp" && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  const zip = hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]);
  if (contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return extension === "docx" && zip;
  if (contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return extension === "xlsx" && zip;
  const ole = hasPrefix(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (contentType === "application/msword") return extension === "doc" && ole;
  if (contentType === "application/vnd.ms-excel") return extension === "xls" && ole;
  return false;
}

async function readFile(file: File) {
  if (file.size <= 0 || file.size > MAX_DOCUMENT_SIZE || !DOCUMENT_CONTENT_TYPES.has(file.type)) throw new Error("INVALID_FILE_TYPE");
  const fileName = safeFileName(file.name), bytes = Buffer.from(await file.arrayBuffer());
  if (!validFileContent(fileName, file.type, bytes)) throw new Error("INVALID_FILE_TYPE");
  return { fileName, bytes, checksum: createHash("sha256").update(bytes).digest("hex") };
}

const numberPrefixes: Record<DocumentType, string> = { OFFER: "KP", CONTRACT: "DOG", CUSTOMER_MEMO: "MEMO", PREPAYMENT_CONFIRMATION: "LEGACY-PREPAY", CLOSING_ACT: "LEGACY-CLOSE", WARRANTY: "LEGACY-WARRANTY", FINAL_PAYMENT_CONFIRMATION: "LEGACY-FINAL", ESTIMATE: "SM", PROJECT: "PRJ", MEASUREMENT_SHEET: "ZM", ACT: "ACT", INVOICE: "SCH", PAYMENT_RECEIPT: "PAY", PHOTO: "PHOTO", OTHER: "DOC" };

function canCreate(actor: DocumentActor, type: DocumentType) {
  if (legacyReadOnlyTypes.has(type)) return false;
  if (!allowedDocumentTypes(actor).includes(type)) return false;
  return actor.role === Role.DIRECTOR || actor.role === Role.MANAGER || (actor.role === Role.ACCOUNTANT && financialTypes.includes(type));
}

export async function createDocument(input: { clientId?: number | null; orderId?: number | null; paymentId?: number | null; paymentSnapshot?: Prisma.InputJsonObject | null; type: DocumentType; title?: string; number?: string; documentDate: Date; comment?: string; file?: File; source?: DocumentSource; idempotencyKey: string; requestHash: string; actor: DocumentActor }) {
  if (!canCreate(input.actor, input.type)) throw new Error("FORBIDDEN");
  const repeated = await prisma.document.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: documentInclude });
  if (repeated) {
    if (!compareRequestHash(repeated.requestHash, input.requestHash)) throw new Error("IDEMPOTENCY_CONFLICT");
    return { document: repeated, created: false };
  }
  const entities = await canUseEntities(input.actor, input.clientId, input.orderId);
  if (!entities) return null;
  let paymentSnapshot = input.paymentSnapshot ?? null;
  if (input.paymentId && input.type !== DocumentType.PAYMENT_RECEIPT) throw new Error("ENTITY_MISMATCH");
  if (input.paymentId) {
    const scope = await entityScope(input.actor);
    const payment = await prisma.payment.findFirst({ where: { id: input.paymentId, orderId: entities.orderId ?? -1, order: scope.order }, select: { id: true, amount: true, method: true, operationDate: true, type: true, comment: true } });
    if (!payment) throw new Error("PAYMENT_NOT_FOUND");
    paymentSnapshot = { paymentId: payment.id, amount: Number(payment.amount), method: payment.method, operationDate: payment.operationDate.toISOString(), type: payment.type, comment: payment.comment ?? "" };
  }
  const prepared = input.file ? await readFile(input.file) : null;
  let blobPath: string | null = null;
  if (prepared) {
    const pathname = `documents/${new Date().getUTCFullYear()}/${randomUUID()}-${prepared.fileName}`;
    const blob = await put(pathname, prepared.bytes, { access: "private", contentType: input.file!.type, addRandomSuffix: false, allowOverwrite: false, maximumSizeInBytes: MAX_DOCUMENT_SIZE });
    blobPath = blob.pathname;
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const companyId = requireTenantIdentity().companyId;
      const settings = await tx.systemSettings.upsert({ where: { companyId }, create: {}, update: {}, select: { nextDocumentNumber: true } });
      const number = input.number?.trim().slice(0, 80) || `${numberPrefixes[input.type]}-${String(settings.nextDocumentNumber).padStart(6, "0")}`;
      if (!input.number) await tx.systemSettings.update({ where: { companyId }, data: { nextDocumentNumber: { increment: 1 } } });
      const document = await tx.document.create({ data: { clientId: entities.clientId, orderId: entities.orderId, paymentId: input.paymentId || null, type: input.type, title: input.title?.trim().slice(0, 200) || numberPrefixes[input.type], number, documentDate: input.documentDate, comment: input.comment?.trim().slice(0, 2000) || null, snapshot: paymentSnapshot ?? undefined, authorId: input.actor.userId, source: input.source ?? (prepared ? DocumentSource.UPLOADED : DocumentSource.GENERATED_ORDER), currentVersion: prepared ? 1 : 0, idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, ...(prepared && blobPath ? { versions: { create: { version: 1, uploadedById: input.actor.userId, comment: input.comment?.trim().slice(0, 1000) || null, fileName: prepared.fileName, pathname: blobPath, contentType: input.file!.type, size: prepared.bytes.byteLength, checksum: prepared.checksum } } } : {}), auditEvents: { create: { action: "CREATED", actorId: input.actor.userId, after: { type: input.type, number, currentVersion: prepared ? 1 : 0, paymentId: input.paymentId || null } } } }, include: documentInclude });
      return document;
    });
    return { document: result, created: true };
  } catch (error) {
    if (blobPath) await del(blobPath).catch(() => undefined);
    if (!isPrismaUniqueConflict(error)) throw error;
    const afterRace = await prisma.document.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: documentInclude });
    if (afterRace && compareRequestHash(afterRace.requestHash, input.requestHash)) return { document: afterRace, created: false };
    throw new Error("DOCUMENT_CONFLICT");
  }
}

export async function getDocument(id: number, actor: DocumentActor) {
  return prisma.document.findFirst({ where: { id, AND: [await documentScope(actor)] }, include: documentInclude });
}

export async function addDocumentVersion(id: number, actor: DocumentActor, file: File, comment?: string) {
  const document = await getDocument(id, actor);
  if (!document) return null;
  if (!canCreate(actor, document.type) || document.status === DocumentStatus.ARCHIVED || document.source !== DocumentSource.UPLOADED) throw new Error("FORBIDDEN");
  const prepared = await readFile(file), version = document.currentVersion + 1;
  const blob = await put(`documents/${new Date().getUTCFullYear()}/${randomUUID()}-${prepared.fileName}`, prepared.bytes, { access: "private", contentType: file.type, addRandomSuffix: false, allowOverwrite: false, maximumSizeInBytes: MAX_DOCUMENT_SIZE });
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.documentVersion.create({ data: { documentId: id, version, uploadedById: actor.userId, comment: comment?.trim().slice(0, 1000) || null, fileName: prepared.fileName, pathname: blob.pathname, contentType: file.type, size: prepared.bytes.byteLength, checksum: prepared.checksum } });
      await tx.document.update({ where: { id }, data: { currentVersion: version } });
      await tx.documentAudit.create({ data: { documentId: id, action: "VERSION_UPLOADED", actorId: actor.userId, before: { version: document.currentVersion }, after: { version }, comment: comment?.trim().slice(0, 1000) || null } });
      return row;
    });
  } catch (error) { await del(blob.pathname).catch(() => undefined); throw error; }
}

export async function updateDocument(id: number, actor: DocumentActor, input: { status?: DocumentStatus; signedAt?: Date | null; signedComment?: string | null; comment?: string | null }) {
  const document = await getDocument(id, actor);
  if (!document) return null;
  if (!canCreate(actor, document.type)) throw new Error("FORBIDDEN");
  if ((input.status === DocumentStatus.ARCHIVED || input.status === DocumentStatus.CANCELLED) && actor.role !== Role.DIRECTOR) throw new Error("FORBIDDEN");
  if (input.status === DocumentStatus.SIGNED && document.type === DocumentType.CONTRACT && document.source === DocumentSource.GENERATED_ORDER && !document.signedPathname) throw new Error("SIGNED_FILE_REQUIRED");
  const nextStatus = input.status ?? document.status;
  const data = { status: nextStatus, ...(input.comment !== undefined ? { comment: input.comment?.trim().slice(0, 2000) || null } : {}), ...(nextStatus === DocumentStatus.SIGNED ? { signedAt: input.signedAt ?? new Date(), signedComment: input.signedComment?.trim().slice(0, 1000) || null } : {}), ...(nextStatus === DocumentStatus.ARCHIVED ? { archivedAt: new Date(), archivedById: actor.userId } : {}) };
  return prisma.$transaction(async (tx) => {
    const result = await tx.document.update({ where: { id }, data, include: documentInclude });
    await tx.documentAudit.create({ data: { documentId: id, action: nextStatus === DocumentStatus.ARCHIVED ? "ARCHIVED" : "STATUS_CHANGED", actorId: actor.userId, before: { status: document.status }, after: { status: nextStatus }, comment: input.signedComment?.trim().slice(0, 1000) || null } });
    return result;
  });
}

export async function getDocumentVersionContent(id: number, actor: DocumentActor, representation: "source" | "pdf" = "source") {
  const row = await prisma.documentVersion.findFirst({ where: { id, document: { AND: [await documentScope(actor)] } }, select: { id: true, pathname: true, fileName: true, contentType: true, size: true, pdfPathname: true, pdfFileName: true, pdfContentType: true, pdfSize: true, pdfStatus: true } });
  if (!row) return null;
  const version = representation === "pdf"
    ? row.pdfStatus === "READY" && row.pdfPathname && row.pdfFileName && row.pdfContentType && row.pdfSize
      ? { id: row.id, pathname: row.pdfPathname, fileName: row.pdfFileName, contentType: row.pdfContentType, size: row.pdfSize }
      : null
    : { id: row.id, pathname: row.pathname, fileName: row.fileName, contentType: row.contentType, size: row.size };
  if (!version) return null;
  const blob = await get(version.pathname, { access: "private" });
  return blob?.statusCode === 200 ? { version, blob } : null;
}

export async function getLinkedMeasurementContent(id: number, actor: DocumentActor) {
  const scope = await entityScope(actor);
  const item = await prisma.measurementAttachment.findFirst({
    where: { id, measurement: { OR: [{ order: scope.order }, { orderId: null, client: scope.client }] } },
    select: { id: true, type: true, pathname: true, fileName: true, contentType: true, size: true },
  });
  if (!item) return null;
  const type = item.type === MeasurementPhotoType.SHEET ? DocumentType.MEASUREMENT_SHEET : DocumentType.PHOTO;
  if (!allowedDocumentTypes(actor).includes(type)) return null;
  const blob = await get(item.pathname, { access: "private" });
  return blob?.statusCode === 200 ? { file: item, blob } : null;
}

export async function getDocumentOrder(id: number, actor: DocumentActor) {
  if (!Number.isInteger(id) || id <= 0) return null;
  const scope = await entityScope(actor);
  const owned = await prisma.order.findFirst({ where: { id, AND: [scope.order] }, select: { id: true } });
  if (!owned) return null;
  const [order, company] = await Promise.all([getOrder(id), prisma.companySettings.findUnique({ where: { companyId: requireTenantIdentity().companyId } })]);
  return order ? { ...order, company } : null;
}
