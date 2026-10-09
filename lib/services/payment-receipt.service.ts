import { createHash, randomBytes } from "node:crypto";

import {
  CashShiftStatus,
  DocumentSource,
  DocumentStatus,
  DocumentType,
  PaymentReceiptStatus,
  Prisma,
  Role,
} from "@prisma/client";

import { companyDisplayPhones } from "@/lib/company-contacts";
import type { ContractSnapshot } from "@/lib/contracts/domain";
import {
  buildPaymentReceiptPdf,
  PAYMENT_RECEIPT_TEMPLATE_VERSION,
  type PaymentReceiptSnapshot,
} from "@/lib/documents/payment-receipt-pdf";
import { countPdfPages } from "@/lib/documents/pdf-utils";
import { ensureEmployeeCode } from "@/lib/employee-code";
import { get, put } from "@/lib/private-blob";
import { prisma } from "@/lib/prisma";
import { nextBusinessDocumentNumber } from "@/lib/services/business-document-number.service";
import type { DocumentActor } from "@/lib/services/document.service";
import { requireTenantIdentity } from "@/lib/tenant-context";

const CLIENT_PAYMENT_TYPES = new Set([
  "CLIENT_PAYMENT",
  "payment",
  "PREPAYMENT",
  "ADDITIONAL_PAYMENT",
]);
const REFUND_TYPES = new Set(["REFUND"]);

export function paymentMethodLabel(value: string) {
  const normalized = value.trim().toUpperCase().replace(/[\s/-]+/g, "_");
  const labels: Record<string, string> = {
    CASH: "Наличные",
    "НАЛИЧНЫЕ": "Наличные",
    KASPI: "Kaspi перевод",
    KASPI_TRANSFER: "Kaspi перевод",
    "KASPI_ПЕРЕВОД": "Kaspi перевод",
    KASPI_INSTALLMENT: "Kaspi рассрочка",
    INSTALLMENT: "Kaspi рассрочка",
    "KASPI_РАССРОЧКА": "Kaspi рассрочка",
    BANK_TRANSFER: "Банковский перевод",
    "БАНКОВСКИЙ_ПЕРЕВОД": "Банковский перевод",
    CARD: "Банковская карта",
    BANK_CARD: "Банковская карта",
    "КАРТА": "Банковская карта",
    "БАНКОВСКАЯ_КАРТА": "Банковская карта",
    OTHER: "Другое",
    "ДРУГОЕ": "Другое",
  };
  return labels[normalized] ?? (value.trim() || "Другое");
}

function almatyBusinessDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  const iso = `${get("year")}-${get("month")}-${get("day")}`;
  return { iso, date: new Date(`${iso}T00:00:00.000Z`) };
}

function maskedClientName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 3);
  return parts.length
    ? parts.map((part) => `${part.slice(0, 1).toUpperCase()}***`).join(" ")
    : "Не указано";
}

function receiptItems(
  order: {
    material: string;
    staircase: string;
    railingType: string;
    lighting: boolean;
    lightingDetails: string;
    cladding: boolean;
    claddingDetails: string;
    additionalDetails: string;
    items: Array<{
      skuSnapshot: string;
      nameSnapshot: string;
      variantSnapshot: string | null;
      unitSnapshot: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      discount: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
    }>;
    calculations: Array<{
      lines: Array<{
        code: string | null;
        name: string;
        quantity: Prisma.Decimal;
        unit: string;
        unitSale: Prisma.Decimal;
        totalSale: Prisma.Decimal;
      }>;
    }>;
  },
  contractSnapshot: ContractSnapshot | null,
  total: number,
) {
  if (order.items.length) return order.items.map((item) => ({
    sku: item.skuSnapshot,
    name: item.nameSnapshot,
    variant: item.variantSnapshot,
    unit: item.unitSnapshot,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
    discount: Number(item.discount),
    total: Number(item.lineTotal),
  }));
  const calculationLines = order.calculations[0]?.lines ?? [];
  if (calculationLines.length) return calculationLines.map((item) => ({
    sku: item.code,
    name: item.name,
    variant: null,
    unit: item.unit,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitSale),
    discount: 0,
    total: Number(item.totalSale),
  }));
  const material = contractSnapshot?.stairMaterial || order.material;
  const detail = [
    material ? `материал: ${material}` : "",
    order.staircase ? `каркас: ${order.staircase}` : "",
    order.railingType ? `ограждение: ${order.railingType}` : "",
  ].filter(Boolean).join("; ");
  return [{
    sku: null,
    name: `Лестница под заказ${detail ? ` по договору, ${detail}` : " по договору"}`.slice(0, 500),
    variant: null,
    unit: "компл.",
    quantity: 1,
    unitPrice: total,
    discount: 0,
    total,
  }];
}

function paymentBasis(input: {
  paidBefore: number;
  paidAfter: number;
  total: number;
  contractNumber: string | null;
}) {
  const suffix = input.contractNumber
    ? ` по договору №${input.contractNumber}`
    : " по заказу";
  if (input.paidBefore >= input.total) return `Доплата${suffix}`;
  if (input.paidBefore <= 0 && input.paidAfter >= input.total)
    return `Полная оплата${suffix}`;
  if (input.paidAfter >= input.total) return `Окончательный платёж${suffix}`;
  if (input.paidBefore <= 0) return `Авансовый платёж${suffix}`;
  return `Промежуточный платёж${suffix}`;
}

async function nextReceiptNumber(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<Array<{ value: number }>>`
    SELECT nextval('"PaymentReceipt_receiptNumber_seq"')::integer AS value
  `;
  if (!rows[0]) throw new Error("RECEIPT_SEQUENCE_UNAVAILABLE");
  return rows[0].value;
}

async function currentShift(
  tx: Prisma.TransactionClient,
  responsibleManagerId: number,
  operationDate: Date,
) {
  await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${1_500_000_000 + responsibleManagerId})`;
  const businessDate = almatyBusinessDate(operationDate);
  const today = almatyBusinessDate(new Date());
  if (businessDate.iso !== today.iso) {
    const historical = await tx.cashShift.findFirst({
      where: { responsibleManagerId, businessDate: businessDate.date },
      orderBy: { id: "asc" },
    });
    if (historical) return historical;
    return tx.cashShift.create({
      data: {
        businessDate: businessDate.date,
        responsibleManagerId,
        openedAt: operationDate,
        closedAt: operationDate,
        status: CashShiftStatus.CLOSED,
      },
    });
  }
  const opened = await tx.cashShift.findFirst({
    where: { responsibleManagerId, status: CashShiftStatus.OPEN },
    orderBy: { openedAt: "desc" },
  });
  if (opened && opened.businessDate.toISOString().slice(0, 10) === businessDate.iso)
    return opened;
  if (opened) {
    await tx.cashShift.update({
      where: { id: opened.id },
      data: {
        status: CashShiftStatus.CLOSED,
        closedAt: operationDate,
      },
    });
  }
  return tx.cashShift.create({
    data: {
      businessDate: businessDate.date,
      responsibleManagerId,
      openedAt: operationDate,
    },
  });
}

export async function createPaymentReceiptRecord(
  tx: Prisma.TransactionClient,
  paymentId: number,
  registeredByUserId?: number,
) {
  const existing = await tx.paymentReceipt.findUnique({ where: { paymentId } });
  if (existing) return existing;
  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
    include: {
      order: {
        include: {
          client: true,
          managerUser: { select: { id: true, name: true, role: true, active: true } },
          items: { orderBy: [{ position: "asc" }, { id: "asc" }] },
          calculations: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { lines: { where: { enabled: true }, orderBy: [{ position: "asc" }, { id: "asc" }] } },
          },
        },
      },
      parts: { orderBy: { id: "asc" } },
    },
  });
  if (
    !payment ||
    !payment.order ||
    !CLIENT_PAYMENT_TYPES.has(payment.type)
  )
    throw new Error("CONFIRMED_CLIENT_PAYMENT_REQUIRED");
  const order = payment.order;
  const manager = order.managerUser;
  const actualRegisteredById = registeredByUserId ?? manager?.id;
  if (!actualRegisteredById) throw new Error("REGISTERED_BY_USER_REQUIRED");
  const registeredBy = await tx.user.findUnique({
    where: { id: actualRegisteredById },
    select: { id: true, name: true, role: true, active: true },
  });
  if (!registeredBy?.active) throw new Error("REGISTERED_BY_USER_REQUIRED");
  const responsibleUser = manager?.active ? manager : registeredBy;
  const employeeCode = await ensureEmployeeCode(tx, responsibleUser.id);
  const shift = await currentShift(tx, responsibleUser.id, payment.operationDate);
  const receiptNumber = await nextReceiptNumber(tx);
  const displayNumber = await nextBusinessDocumentNumber(tx, "PAY", payment.operationDate);
  const contract = await tx.document.findFirst({
    where: {
      orderId: order.id,
      type: DocumentType.CONTRACT,
      status: { in: [DocumentStatus.READY, DocumentStatus.SIGNED] },
    },
    select: { id: true, number: true, snapshot: true },
    orderBy: [{ documentDate: "desc" }, { id: "desc" }],
  });
  const contractSnapshot = contract?.snapshot as unknown as ContractSnapshot | null;
  const operations = await tx.payment.findMany({
    where: { orderId: order.id, operationDate: { lte: payment.operationDate } },
    select: { id: true, amount: true, type: true, operationDate: true },
    orderBy: [{ operationDate: "asc" }, { id: "asc" }],
  });
  let paidBefore = 0;
  for (const operation of operations) {
    if (operation.id === payment.id) break;
    if (CLIENT_PAYMENT_TYPES.has(operation.type)) paidBefore += Number(operation.amount);
    if (REFUND_TYPES.has(operation.type)) paidBefore -= Number(operation.amount);
  }
  paidBefore = Math.max(paidBefore, 0);
  const total = contractSnapshot?.contractAmountNumeric ?? Number(order.amount);
  const currentPayment = Number(payment.amount);
  const paidAfter = paidBefore + currentPayment;
  const remaining = Math.max(total - paidAfter, 0);
  const overpayment = Math.max(paidAfter - total, 0);
  const verificationToken = randomBytes(32).toString("base64url");
  const company = await tx.companySettings.upsert({
    where: { companyId: requireTenantIdentity().companyId },
    create: {},
    update: {},
  });
  const snapshot: PaymentReceiptSnapshot = {
    templateVersion: PAYMENT_RECEIPT_TEMPLATE_VERSION,
    receiptNumber,
    displayNumber,
    shiftNumber: shift.shiftNumber,
    createdAt: new Date().toISOString(),
    businessDate: almatyBusinessDate(payment.operationDate).iso,
    company: {
      name: company.name,
      bin: company.bin,
      address: company.actualAddress || company.legalAddress,
      phones: companyDisplayPhones(company),
    },
    client: {
      name: order.client.name || "Не указано",
      maskedName: maskedClientName(order.client.name),
      city: order.client.city || "Не указано",
    },
    order: { id: order.id, number: order.number },
    contract: { number: contract?.number ?? null, total },
    responsibleManager: { name: manager?.name || order.manager || registeredBy.name, employeeCode },
    registeredBy: { userId: registeredBy.id, name: registeredBy.name },
    payment: {
      id: payment.id,
      amount: currentPayment,
      method: payment.method,
      methodLabel: paymentMethodLabel(payment.method),
      parts: (payment.parts.length ? payment.parts : [{ method: payment.method, amount: payment.amount, reference: null }]).map((part) => ({
        method: part.method,
        methodLabel: paymentMethodLabel(part.method),
        amount: Number(part.amount),
        reference: part.reference,
      })),
      basis: paymentBasis({
        paidBefore,
        paidAfter,
        total,
        contractNumber: contract?.number ?? null,
      }),
      operationDate: payment.operationDate.toISOString(),
    },
    totals: { paidBefore, paidAfter, remaining, overpayment },
    items: receiptItems(order, contractSnapshot, total),
    verificationPath: `/verify/payment-receipt/${verificationToken}`,
  };
  const snapshotChecksum = createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex");
  const document = await tx.document.create({
    data: {
      orderId: order.id,
      clientId: order.clientId,
      paymentId: payment.id,
      type: DocumentType.PAYMENT_RECEIPT,
      number: displayNumber,
      title: `Квитанция об оплате ${displayNumber}`,
      documentDate: payment.operationDate,
      status: DocumentStatus.DRAFT,
      source: DocumentSource.GENERATED_ORDER,
      authorId: registeredBy.id,
      templateVersion: PAYMENT_RECEIPT_TEMPLATE_VERSION,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      idempotencyKey: `payment-receipt:${payment.id}`,
      requestHash: snapshotChecksum,
    },
  });
  const receipt = await tx.paymentReceipt.create({
    data: {
      receiptNumber,
      displayNumber,
      paymentId: payment.id,
      documentId: document.id,
      orderId: order.id,
      contractDocumentId: contract?.id ?? null,
      cashShiftId: shift.id,
      verificationToken,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      snapshotChecksum,
    },
  });
  await tx.payment.update({
    where: { id: payment.id },
    data: { cashShiftId: shift.id, registeredByUserId: registeredBy.id },
  });
  await tx.documentAudit.create({
    data: {
      documentId: document.id,
      actorId: registeredBy.id,
      action: "PAYMENT_RECEIPT_ASSIGNED",
      after: {
        receiptNumber,
        shiftNumber: shift.shiftNumber,
        displayNumber,
        responsibleManagerId: responsibleUser.id,
        registeredByUserId: registeredBy.id,
        paymentId: payment.id,
      },
    },
  });
  await tx.financeAuditEvent.create({
    data: {
      orderId: order.id,
      action: "PAYMENT_RECEIPT_CREATED",
      entityType: "PaymentReceipt",
      entityId: receipt.id,
      before: Prisma.JsonNull,
      after: {
        receiptNumber,
        shiftNumber: shift.shiftNumber,
        displayNumber,
        responsibleManagerId: responsibleUser.id,
        registeredByUserId: registeredBy.id,
      },
      reason: "Квитанция создана после зарегистрированной оплаты",
      authorId: registeredBy.id,
    },
  });
  return receipt;
}

function publicBaseUrl() {
  const value = process.env.NEXTAUTH_URL?.trim();
  if (!value) throw new Error("PUBLIC_APP_URL_NOT_CONFIGURED");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("PUBLIC_APP_URL_INVALID");
  return url.toString().replace(/\/+$/, "");
}

export async function ensurePaymentReceiptPdf(paymentId: number) {
  const receipt = await prisma.paymentReceipt.findUnique({
    where: { paymentId },
    include: { document: { include: { versions: true } } },
  });
  if (!receipt) throw new Error("PAYMENT_RECEIPT_NOT_FOUND");
  if (receipt.document.currentVersion > 0 && receipt.document.versions[0])
    return receipt.document.versions[0];
  const snapshot = receipt.snapshot as unknown as PaymentReceiptSnapshot;
  const bytes = await buildPaymentReceiptPdf(snapshot, publicBaseUrl());
  if (countPdfPages(bytes) !== 1) throw new Error("RECEIPT_PDF_NOT_ONE_PAGE");
  const fileName = `Квитанция-${receipt.displayNumber}.pdf`;
  const pathname = `documents/payment-receipts/${receipt.id}/receipt-80mm.pdf`;
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const blob = await put(pathname, bytes, {
    access: "private",
    contentType: "application/pdf",
    addRandomSuffix: false,
    allowOverwrite: true,
    maximumSizeInBytes: 5 * 1024 * 1024,
  });
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${2_000_000_000 + receipt.id})`;
    const document = await tx.document.findUniqueOrThrow({
      where: { id: receipt.documentId },
      select: { currentVersion: true },
    });
    if (document.currentVersion > 0)
      return tx.documentVersion.findUniqueOrThrow({
        where: {
          documentId_version: {
            documentId: receipt.documentId,
            version: document.currentVersion,
          },
        },
      });
    const version = await tx.documentVersion.create({
      data: {
        documentId: receipt.documentId,
        version: 1,
        uploadedById: snapshot.registeredBy.userId,
        comment: "Автоматически сформированная квитанция об оплате",
        fileName,
        pathname: blob.pathname,
        contentType: "application/pdf",
        size: bytes.length,
        checksum,
        templateVersion: PAYMENT_RECEIPT_TEMPLATE_VERSION,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        idempotencyKey: `payment-receipt-pdf:${receipt.id}`,
      },
    });
    await tx.document.update({
      where: { id: receipt.documentId },
      data: { currentVersion: 1, status: DocumentStatus.READY },
    });
    await tx.documentAudit.create({
      data: {
        documentId: receipt.documentId,
        actorId: snapshot.registeredBy.userId,
        action: "PAYMENT_RECEIPT_PDF_GENERATED",
        after: { receiptNumber: receipt.displayNumber, pages: 1, checksum },
      },
    });
    return version;
  });
}

export async function voidPaymentReceipt(
  tx: Prisma.TransactionClient,
  originalPaymentId: number,
  reversalPaymentId: number,
  actorId: number,
  reason: string,
) {
  const receipt = await tx.paymentReceipt.findUnique({
    where: { paymentId: originalPaymentId },
  });
  if (!receipt) return null;
  const voidedAt = new Date();
  const updated = await tx.paymentReceipt.update({
    where: { id: receipt.id },
    data: {
      status: PaymentReceiptStatus.VOID,
      voidedAt,
      voidReason: reason.slice(0, 1000),
      voidedByPaymentId: reversalPaymentId,
    },
  });
  await tx.document.update({
    where: { id: receipt.documentId },
    data: { status: DocumentStatus.CANCELLED },
  });
  await tx.documentAudit.create({
    data: {
      documentId: receipt.documentId,
      actorId,
      action: "PAYMENT_RECEIPT_VOIDED",
      before: { status: PaymentReceiptStatus.ACTIVE },
      after: {
        status: PaymentReceiptStatus.VOID,
        reversalPaymentId,
        voidedAt: voidedAt.toISOString(),
      },
      comment: reason.slice(0, 1000),
    },
  });
  return updated;
}

export async function closeCashShift(shiftId: number, actor: DocumentActor) {
  if (actor.role !== Role.DIRECTOR && actor.role !== Role.OPERATIONS_DIRECTOR)
    throw new Error("FORBIDDEN");
  const shift = await prisma.cashShift.findUnique({ where: { id: shiftId } });
  if (!shift) throw new Error("NOT_FOUND");
  if (shift.status === CashShiftStatus.CLOSED) return shift;
  return prisma.cashShift.update({
    where: { id: shift.id },
    data: {
      status: CashShiftStatus.CLOSED,
      closedAt: new Date(),
      closedById: actor.userId,
    },
  });
}

export async function paymentReceiptPublicProjection(token: string) {
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) return null;
  const receipt = await prisma.paymentReceipt.findUnique({
    where: { verificationToken: token },
    select: {
      receiptNumber: true,
      displayNumber: true,
      status: true,
      snapshot: true,
      publicAccessEnabled: true,
      voidedAt: true,
    },
  });
  if (!receipt || !receipt.publicAccessEnabled) return null;
  const snapshot = receipt.snapshot as unknown as PaymentReceiptSnapshot;
  return {
    company: snapshot.company,
    receiptNumber: receipt.displayNumber,
    status: receipt.status === PaymentReceiptStatus.VOID ? "VOID" : "VALID",
    dateTime: snapshot.payment.operationDate,
    generatedAt: snapshot.createdAt,
    orderNumber: snapshot.order.number,
    contractNumber: snapshot.contract.number,
    paymentAmount: snapshot.payment.amount,
    paymentMethod: snapshot.payment.methodLabel,
    paymentParts: snapshot.payment.parts ?? [],
    items: snapshot.items,
    totals: snapshot.totals,
    responsibleManager: snapshot.responsibleManager.name,
    registeredBy: snapshot.registeredBy.name,
    maskedClientName: snapshot.client.maskedName,
    voidedAt: receipt.voidedAt?.toISOString() ?? null,
  };
}

export async function ensurePaymentReceiptForExistingPayment(
  paymentId: number,
  actor: DocumentActor,
) {
  const payment = await prisma.payment.findFirst({
    where: {
      id: paymentId,
      type: { in: [...CLIENT_PAYMENT_TYPES] },
      order: {
        deletedAt: null,
        ...(actor.role === Role.MANAGER ? { managerUserId: actor.userId } : {}),
      },
    },
    select: { id: true },
  });
  if (!payment) throw new Error("NOT_FOUND");
  if (!(new Set<Role>([Role.DIRECTOR, Role.OPERATIONS_DIRECTOR, Role.ACCOUNTANT, Role.MANAGER])).has(actor.role))
    throw new Error("FORBIDDEN");
  await prisma.$transaction(
    (tx) => createPaymentReceiptRecord(tx, payment.id, actor.userId),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 20_000 },
  );
  await ensurePaymentReceiptPdf(payment.id);
  return prisma.paymentReceipt.findUniqueOrThrow({
    where: { paymentId: payment.id },
    select: { id: true, displayNumber: true, documentId: true, verificationToken: true, createdAt: true },
  });
}

export async function setPaymentReceiptPublicAccess(
  receiptId: number,
  enabled: boolean,
  actor: DocumentActor,
) {
  if (actor.role !== Role.DIRECTOR && actor.role !== Role.OPERATIONS_DIRECTOR)
    throw new Error("FORBIDDEN");
  const receipt = await prisma.paymentReceipt.findUnique({ where: { id: receiptId } });
  if (!receipt) throw new Error("NOT_FOUND");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.paymentReceipt.update({
      where: { id: receipt.id },
      data: { publicAccessEnabled: enabled },
    });
    await tx.documentAudit.create({
      data: {
        documentId: receipt.documentId,
        actorId: actor.userId,
        action: enabled ? "CLIENT_LINK_ENABLED" : "CLIENT_LINK_DISABLED",
        after: { publicAccessEnabled: enabled },
      },
    });
    return updated;
  });
}

export async function getPaymentReceiptPdf(
  documentId: number,
  actor: DocumentActor,
) {
  const receipt = await prisma.paymentReceipt.findFirst({
    where: {
      documentId,
      document: {
        id: documentId,
        type: DocumentType.PAYMENT_RECEIPT,
      },
    },
    include: { document: { include: { versions: true } } },
  });
  if (!receipt) return null;
  const allowed =
    actor.role === Role.DIRECTOR ||
    actor.role === Role.OPERATIONS_DIRECTOR ||
    actor.role === Role.ACCOUNTANT ||
    (actor.role === Role.MANAGER &&
      (await prisma.order.count({
        where: { id: receipt.orderId, managerUserId: actor.userId, deletedAt: null },
      })) === 1);
  if (!allowed) return null;
  const version = receipt.document.versions.find(
    (item) => item.version === receipt.document.currentVersion,
  );
  if (!version) return null;
  const blob = await get(version.pathname, { access: "private" });
  return blob?.statusCode === 200 ? { receipt, version, blob } : null;
}
