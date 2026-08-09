import { createHash, randomUUID } from "node:crypto";
import { del, get, put } from "@vercel/blob";
import { DocumentSource, DocumentStatus, DocumentType, Prisma, Role } from "@prisma/client";

import { almatyDateParts, amountToRussianWords, calculatePayment, CONTRACT_TEMPLATE_VERSION, formatMoney, type ContractPaymentInput, type ContractSnapshot, warrantyLabel } from "@/lib/contracts/domain";
import { generateContractDocx } from "@/lib/contracts/docx";
import { prisma } from "@/lib/prisma";
import { canAccessOrder360 } from "@/lib/services/order360.service";
import { getDocument, type DocumentActor } from "@/lib/services/document.service";

export type ContractActor = { userId: number; role: Role; name: string };
export type ContractInput = {
  clientFullName?: string;
  clientIin?: string;
  clientPhone?: string;
  clientAddress?: string;
  installationAddress?: string;
  stairMaterial?: string;
  balusterType?: string;
  contractAmount?: number;
  payment?: ContractPaymentInput;
  prepaymentDueText?: string;
  balanceDueText?: string;
  fullPaymentDueText?: string;
  termCalendarDays?: number;
  termStartCondition?: string;
  warrantyMonths?: number;
  productionContactName?: string;
  productionContactPhone?: string;
};

const BALANCE_TERMS = new Set(["после завершения монтажа", "в день приёмки", "до монтажа", "по индивидуальному утверждённому графику"]);
const START_TERMS = new Set(["с даты внесения первого платежа", "с даты подписания Договора"]);
const PREPAYMENT_DUE = "в день подписания настоящего Договора";
const FULL_PAYMENT_DUE = "в день подписания настоящего Договора";

function clean(value: string | undefined, fallback = "") { return (value?.trim() || fallback).slice(0, 500); }
function integer(value: number | undefined, fallback: number) { return Number.isInteger(value) && value! > 0 ? value! : fallback; }
function addDays(date: Date, days: number) { const next = new Date(date); next.setUTCDate(next.getUTCDate() + days); return new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty" }).format(next); }

async function source(orderId: number, actor: ContractActor) {
  if (actor.role !== Role.DIRECTOR && actor.role !== Role.MANAGER) throw new Error("FORBIDDEN");
  if (!await canAccessOrder360(orderId, actor)) throw new Error("NOT_FOUND");
  const [order, company, system] = await Promise.all([
    prisma.order.findUnique({ where: { id: orderId }, include: { client: true, measurements: { orderBy: { visitDate: "desc" }, take: 1 }, productions: { orderBy: { createdAt: "desc" }, take: 1 } } }),
    prisma.companySettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
    prisma.systemSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
  ]);
  if (!order) throw new Error("NOT_FOUND");
  const material = await prisma.material.findFirst({ where: { name: { equals: order.material, mode: "insensitive" }, active: true }, select: { name: true, warrantyMonths: true } });
  return { order, company, system, material };
}

export async function getContractDefaults(orderId: number, actor: ContractActor) {
  const { order, company, system, material } = await source(orderId, actor);
  const measurement = order.measurements[0];
  return {
    clientFullName: order.client.name,
    clientIin: order.client.iin,
    clientPhone: order.client.phone,
    clientAddress: order.client.address,
    installationAddress: measurement?.address || order.address,
    stairMaterial: order.material,
    balusterType: order.staircase,
    contractAmount: Number(order.amount),
    payment: Number(order.prepayment) > 0
      ? { mode: "AMOUNT", prepaymentAmount: Math.min(Number(order.prepayment), Number(order.amount)) } as ContractPaymentInput
      : { mode: "PERCENT", prepaymentPercent: 70 } as ContractPaymentInput,
    prepaymentDueText: PREPAYMENT_DUE,
    balanceDueText: "после завершения монтажа",
    fullPaymentDueText: FULL_PAYMENT_DUE,
    termCalendarDays: system.productionLeadDays || 45,
    termStartCondition: "с даты внесения первого платежа",
    warrantyMonths: material?.warrantyMonths ?? null,
    productionContactName: order.productions[0]?.master || order.manager,
    productionContactPhone: company.phone,
    directorFullName: company.directorFullName || company.directorName,
    contractCity: "Алматы",
  };
}

export async function buildContractSnapshot(orderId: number, actor: ContractActor, input: ContractInput, contractNumber = "будет присвоен", now = new Date()): Promise<ContractSnapshot> {
  const { order, company, system, material } = await source(orderId, actor);
  const measurement = order.measurements[0];
  const clientFullName = clean(input.clientFullName, order.client.name);
  const clientIin = clean(input.clientIin, order.client.iin);
  if (!clientFullName) throw new Error("CLIENT_NAME_REQUIRED");
  if (!/^\d{12}$/.test(clientIin)) throw new Error("CLIENT_IIN_REQUIRED");
  const amount = integer(input.contractAmount, Number(order.amount));
  const payment = calculatePayment(amount, input.payment ?? { mode: "PERCENT", prepaymentPercent: 70 });
  const term = integer(input.termCalendarDays, system.productionLeadDays || 45);
  if (term > 730) throw new Error("INVALID_TERM");
  const warrantyMonths = integer(input.warrantyMonths, material?.warrantyMonths ?? 0);
  if (!warrantyMonths) throw new Error("WARRANTY_REQUIRED");
  const balanceDueText = clean(input.balanceDueText, "после завершения монтажа");
  const termStartCondition = clean(input.termStartCondition, "с даты внесения первого платежа");
  if (!BALANCE_TERMS.has(balanceDueText) || !START_TERMS.has(termStartCondition)) throw new Error("INVALID_CONDITION");
  const directorFullName = clean(undefined, company.directorFullName || company.directorName);
  if (!directorFullName) throw new Error("DIRECTOR_REQUIRED");
  const parts = almatyDateParts(now);
  return {
    contractNumber, contractDateIso: now.toISOString(), contractTime: parts.time, contractDay: parts.day, contractMonth: parts.month, contractYear: parts.year, contractCity: "Алматы",
    clientFullName, clientIin, clientPhone: clean(input.clientPhone, order.client.phone), clientAddress: clean(input.clientAddress, order.client.address),
    installationAddress: clean(input.installationAddress, measurement?.address || order.address), stairMaterial: clean(input.stairMaterial, order.material), balusterType: clean(input.balusterType, order.staircase),
    contractAmount: formatMoney(amount), contractAmountWords: amountToRussianWords(amount), contractAmountNumeric: amount,
    prepaymentPercent: payment.prepaymentPercent, prepaymentAmount: formatMoney(payment.prepaymentAmount), prepaymentAmountWords: amountToRussianWords(payment.prepaymentAmount), prepaymentAmountNumeric: payment.prepaymentAmount,
    balancePercent: payment.balancePercent, balanceAmount: formatMoney(payment.balanceAmount), balanceAmountWords: amountToRussianWords(payment.balanceAmount), balanceAmountNumeric: payment.balanceAmount, isFullPayment: payment.isFullPayment,
    prepaymentDueText: clean(input.prepaymentDueText, PREPAYMENT_DUE), balanceDueText, fullPaymentDueText: clean(input.fullPaymentDueText, FULL_PAYMENT_DUE),
    termCalendarDays: String(term), termStartCondition, plannedCompletionDate: addDays(now, term), warrantyText: warrantyLabel(warrantyMonths), directorFullName,
    productionContactName: clean(input.productionContactName, order.productions[0]?.master || order.manager), productionContactPhone: clean(input.productionContactPhone, company.phone),
    companyName: company.name, companyBin: company.bin, companyIik: company.iik, companyBank: company.bank, companyBik: company.bik, companyPhone: company.phone, companyAddress: company.actualAddress || company.legalAddress,
  };
}

export async function generateContract(orderId: number, actor: ContractActor, input: ContractInput, idempotencyKey: string) {
  const existing = await prisma.document.findUnique({ where: { idempotencyKey }, include: { versions: true } });
  if (existing) return existing;
  const active = await prisma.document.findFirst({ where: { orderId, type: DocumentType.CONTRACT, source: DocumentSource.GENERATED_ORDER, status: { in: [DocumentStatus.DRAFT, DocumentStatus.READY] } }, orderBy: { createdAt: "desc" } });
  if (active) return reviseContract(active.id, actor, input, idempotencyKey);
  const baseSnapshot = await buildContractSnapshot(orderId, actor, input);
  const draft = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ value: number }>>`UPDATE "SystemSettings" SET "nextContractNumber" = "nextContractNumber" + 1, "updatedAt" = NOW() WHERE id = 1 RETURNING "nextContractNumber" - 1 AS value`;
    if (!rows[0]) throw new Error("SETTINGS_REQUIRED");
    const settings = await tx.systemSettings.findUniqueOrThrow({ where: { id: 1 }, select: { contractPrefix: true } });
    const number = `${settings.contractPrefix}-${String(rows[0].value).padStart(6, "0")}`;
    const snapshot = { ...baseSnapshot, contractNumber: number };
    return tx.document.create({ data: { orderId, clientId: (await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { clientId: true } })).clientId, type: DocumentType.CONTRACT, number, title: `Договор №${number}`, documentDate: new Date(snapshot.contractDateIso), status: DocumentStatus.DRAFT, source: DocumentSource.GENERATED_ORDER, authorId: actor.userId, templateVersion: CONTRACT_TEMPLATE_VERSION, snapshot: snapshot as unknown as Prisma.InputJsonValue, idempotencyKey, requestHash: createHash("sha256").update(JSON.stringify({ orderId, input })).digest("hex"), auditEvents: { create: { action: "CONTRACT_NUMBER_ASSIGNED", actorId: actor.userId, after: { number, templateVersion: CONTRACT_TEMPLATE_VERSION } } } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  const snapshot = draft.snapshot as unknown as ContractSnapshot;
  const bytes = await generateContractDocx(snapshot);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const fileName = `Договор-${draft.number}-v1.docx`;
  const pathname = `documents/contracts/${new Date().getUTCFullYear()}/${draft.id}/${randomUUID()}-${fileName}`;
  const blob = await put(pathname, bytes, { access: "private", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", addRandomSuffix: false, allowOverwrite: false, maximumSizeInBytes: 15 * 1024 * 1024 });
  return prisma.$transaction(async (tx) => {
    await tx.documentVersion.create({ data: { documentId: draft.id, version: 1, uploadedById: actor.userId, fileName, pathname: blob.pathname, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: bytes.length, checksum, comment: "Автоматически сформирован из утверждённого шаблона", templateVersion: CONTRACT_TEMPLATE_VERSION, snapshot: snapshot as unknown as Prisma.InputJsonValue, idempotencyKey } });
    await tx.documentAudit.create({ data: { documentId: draft.id, action: "CONTRACT_GENERATED", actorId: actor.userId, before: { status: "DRAFT" }, after: { status: "READY", version: 1, checksum } } });
    return tx.document.update({ where: { id: draft.id }, data: { status: DocumentStatus.READY, currentVersion: 1 }, include: { versions: true } });
  });
}

async function reviseContract(documentId: number, actor: ContractActor, input: ContractInput, idempotencyKey: string) {
  const repeated = await prisma.documentVersion.findUnique({ where: { idempotencyKey }, include: { document: { include: { versions: true } } } });
  if (repeated) return repeated.document;
  const document = await getDocument(documentId, actor as DocumentActor);
  if (!document || document.type !== DocumentType.CONTRACT) throw new Error("NOT_FOUND");
  if (document.status === DocumentStatus.SIGNED || document.status === DocumentStatus.CANCELLED || document.status === DocumentStatus.ARCHIVED) throw new Error("CONTRACT_IMMUTABLE");
  if (!document.orderId) throw new Error("NOT_FOUND");
  const snapshot = await buildContractSnapshot(document.orderId, actor, input, document.number);
  const bytes = await generateContractDocx(snapshot);
  const version = document.currentVersion + 1;
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const fileName = `Договор-${document.number}-v${version}.docx`;
  const pathname = `documents/contracts/${new Date().getUTCFullYear()}/${document.id}/${randomUUID()}-${fileName}`;
  const blob = await put(pathname, bytes, { access: "private", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", addRandomSuffix: false, allowOverwrite: false, maximumSizeInBytes: 15 * 1024 * 1024 });
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.documentVersion.create({ data: { documentId, version, uploadedById: actor.userId, fileName, pathname: blob.pathname, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: bytes.length, checksum, comment: "Исправленная версия до подписания", templateVersion: CONTRACT_TEMPLATE_VERSION, snapshot: snapshot as unknown as Prisma.InputJsonValue, idempotencyKey } });
      await tx.documentAudit.create({ data: { documentId, action: "CONTRACT_REVISED", actorId: actor.userId, before: { version: document.currentVersion }, after: { version, checksum } } });
      return tx.document.update({ where: { id: documentId }, data: { currentVersion: version, snapshot: snapshot as unknown as Prisma.InputJsonValue, templateVersion: CONTRACT_TEMPLATE_VERSION, status: DocumentStatus.READY }, include: { versions: true } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) { await del(blob.pathname).catch(() => undefined); throw error; }
}

export async function uploadSignedContract(documentId: number, actor: ContractActor, file: File, comment?: string) {
  if (actor.role !== Role.DIRECTOR && actor.role !== Role.MANAGER) throw new Error("FORBIDDEN");
  const document = await getDocument(documentId, actor as DocumentActor);
  if (!document || document.type !== DocumentType.CONTRACT) throw new Error("NOT_FOUND");
  if (file.size <= 0 || file.size > 15 * 1024 * 1024 || !["application/pdf", "image/jpeg", "image/png"].includes(file.type)) throw new Error("INVALID_FILE_TYPE");
  const bytes = Buffer.from(await file.arrayBuffer());
  const valid = file.type === "application/pdf" ? bytes.subarray(0, 5).toString("ascii") === "%PDF-" : file.type === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!valid) throw new Error("INVALID_FILE_TYPE");
  const extension = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg";
  const pathname = `documents/contracts/${documentId}/signed/${randomUUID()}.${extension}`;
  const blob = await put(pathname, bytes, { access: "private", contentType: file.type, addRandomSuffix: false, allowOverwrite: false, maximumSizeInBytes: 15 * 1024 * 1024 });
  const checksum = createHash("sha256").update(bytes).digest("hex");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.document.update({ where: { id: documentId }, data: { status: DocumentStatus.SIGNED, signedAt: new Date(), signedComment: clean(comment), signedFileName: file.name.slice(0, 200), signedPathname: blob.pathname, signedContentType: file.type, signedSize: bytes.length, signedChecksum: checksum } });
    await tx.documentAudit.create({ data: { documentId, actorId: actor.userId, action: "SIGNED_COPY_UPLOADED", before: { status: document.status }, after: { status: "SIGNED", checksum }, comment: clean(comment) } });
    return updated;
  });
}

export async function getSignedContractContent(documentId: number, actor: ContractActor) {
  const document = await getDocument(documentId, actor as DocumentActor);
  if (!document?.signedPathname || !document.signedFileName || !document.signedContentType || !document.signedSize) return null;
  const blob = await get(document.signedPathname, { access: "private" });
  return blob?.statusCode === 200 ? { document, blob } : null;
}
