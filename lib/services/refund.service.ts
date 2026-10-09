import { createHash } from "node:crypto";

import { DocumentSource, DocumentStatus, DocumentType, Prisma, Role } from "@prisma/client";

import { companyDisplayPhones } from "@/lib/company-contacts";
import { buildRefundConfirmationPdf, REFUND_CONFIRMATION_TEMPLATE_VERSION, type RefundConfirmationSnapshot } from "@/lib/documents/refund-confirmation-pdf";
import { countPdfPages } from "@/lib/documents/pdf-utils";
import { compareRequestHash, isPrismaUniqueConflict } from "@/lib/idempotency";
import { put } from "@/lib/private-blob";
import { prisma } from "@/lib/prisma";
import { nextBusinessDocumentNumber } from "@/lib/services/business-document-number.service";
import { paymentMethodLabel } from "@/lib/services/payment-receipt.service";
import { requireTenantIdentity } from "@/lib/tenant-context";

type RefundActor = { userId: number; role: Role; name: string };

function paymentParts(amount: number, parts: Array<{ method: string; amount: number; reference?: string }>) {
  const total = new Prisma.Decimal(amount);
  if (!total.isPositive() || total.decimalPlaces() > 2 || !parts.length) throw new Error("INVALID_REFUND");
  const normalized = parts.map((part) => ({ method: part.method.trim(), amount: new Prisma.Decimal(part.amount), reference: part.reference?.trim() || undefined }));
  if (normalized.some((part) => !part.method || !part.amount.isPositive() || part.amount.decimalPlaces() > 2)) throw new Error("INVALID_REFUND");
  if (!normalized.reduce((sum, part) => sum.add(part.amount), new Prisma.Decimal(0)).equals(total)) throw new Error("REFUND_PARTS_MISMATCH");
  return { total, parts: normalized, method: normalized.length > 1 ? "MIXED" : normalized[0].method };
}

export async function ensureRefundConfirmationPdf(documentId: number) {
  const document = await prisma.document.findUnique({ where: { id: documentId }, include: { versions: true } });
  if (!document || document.type !== DocumentType.REFUND_CONFIRMATION) throw new Error("REFUND_DOCUMENT_NOT_FOUND");
  const existing = document.versions.find((item) => item.version === document.currentVersion);
  if (existing) return existing;
  const snapshot = document.snapshot as unknown as RefundConfirmationSnapshot;
  const bytes = await buildRefundConfirmationPdf(snapshot);
  if (countPdfPages(bytes) !== 1) throw new Error("REFUND_PDF_INVALID");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const blob = await put(`documents/refunds/${document.id}/confirmation.pdf`, bytes, { access: "private", contentType: "application/pdf", addRandomSuffix: false, allowOverwrite: true, maximumSizeInBytes: 5 * 1024 * 1024 });
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${1_700_000_000 + document.id})`;
    const current = await tx.document.findUniqueOrThrow({ where: { id: document.id }, select: { currentVersion: true } });
    if (current.currentVersion > 0) return tx.documentVersion.findUniqueOrThrow({ where: { documentId_version: { documentId: document.id, version: current.currentVersion } } });
    const version = await tx.documentVersion.create({ data: { documentId: document.id, version: 1, uploadedById: snapshot.processedBy.userId, comment: "Автоматически сформированное подтверждение возврата", fileName: `Подтверждение-возврата-${snapshot.number}.pdf`, pathname: blob.pathname, contentType: "application/pdf", size: bytes.length, checksum, templateVersion: REFUND_CONFIRMATION_TEMPLATE_VERSION, snapshot: snapshot as unknown as Prisma.InputJsonValue, idempotencyKey: `refund-confirmation-pdf:${document.id}` } });
    await tx.document.update({ where: { id: document.id }, data: { currentVersion: 1, status: DocumentStatus.READY } });
    return version;
  });
}

export async function createPaymentRefund(input: {
  originalPaymentId: number;
  amount: number;
  parts: Array<{ method: string; amount: number; reference?: string }>;
  reason: string;
  key: string;
  requestHash: string;
  actor: RefundActor;
}) {
  if (input.actor.role !== Role.DIRECTOR && input.actor.role !== Role.OPERATIONS_DIRECTOR) throw new Error("FORBIDDEN");
  if (!input.reason.trim()) throw new Error("REFUND_REASON_REQUIRED");
  const normalized = paymentParts(input.amount, input.parts);
  const { companyId } = requireTenantIdentity();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const replay = await tx.payment.findUnique({ where: { idempotencyKey: input.key } });
        if (replay) {
          if (!compareRequestHash(replay.requestHash, input.requestHash) || !replay.refundOfId) throw new Error("IDEMPOTENCY_CONFLICT");
          const document = await tx.document.findFirstOrThrow({ where: { paymentId: replay.id, type: DocumentType.REFUND_CONFIRMATION }, select: { id: true, number: true } });
          return { payment: replay, document, created: false };
        }
        const original = await tx.payment.findUnique({ where: { id: input.originalPaymentId }, include: { order: { include: { client: true } }, receipt: { select: { displayNumber: true } } } });
        if (!original?.order || !["CLIENT_PAYMENT", "payment", "PREPAYMENT", "ADDITIONAL_PAYMENT"].includes(original.type)) throw new Error("PAYMENT_NOT_FOUND");
        await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${original.order.id})`;
        const existingRefunds = await tx.payment.aggregate({ where: { refundOfId: original.id, type: "REFUND" }, _sum: { amount: true } });
        const refundable = original.amount.sub(existingRefunds._sum.amount ?? 0);
        if (normalized.total.gt(refundable) || normalized.total.gt(original.order.prepayment)) throw new Error("REFUND_EXCEEDS_PAID");
        const refundedAt = new Date();
        const refund = await tx.payment.create({ data: { orderId: original.order.id, amount: normalized.total, type: "REFUND", method: normalized.method, comment: input.reason.trim(), operationDate: refundedAt, author: input.actor.name, registeredByUserId: input.actor.userId, refundOfId: original.id, idempotencyKey: input.key, requestHash: input.requestHash, parts: { create: normalized.parts.map((part) => ({ companyId, method: part.method, amount: part.amount, reference: part.reference })) } } });
        const paidAfter = original.order.prepayment.sub(normalized.total);
        const balance = Prisma.Decimal.max(0, original.order.amount.sub(paidAfter));
        await tx.order.update({ where: { id: original.order.id }, data: { prepayment: paidAfter, balance } });
        const number = await nextBusinessDocumentNumber(tx, "REF", refundedAt);
        const settings = await tx.companySettings.upsert({ where: { companyId }, create: {}, update: {} });
        const snapshot: RefundConfirmationSnapshot = {
          templateVersion: REFUND_CONFIRMATION_TEMPLATE_VERSION,
          number,
          createdAt: new Date().toISOString(),
          company: { name: settings.name, bin: settings.bin, address: settings.actualAddress || settings.legalAddress, phones: companyDisplayPhones(settings) },
          client: { name: original.order.client.name },
          order: { id: original.order.id, number: original.order.number },
          originalPayment: { id: original.id, receiptNumber: original.receipt?.displayNumber, paidAt: original.operationDate.toISOString(), amount: original.amount.toNumber() },
          refund: { id: refund.id, amount: normalized.total.toNumber(), method: normalized.method, parts: normalized.parts.map((part) => ({ method: paymentMethodLabel(part.method), amount: part.amount.toNumber() })), reason: input.reason.trim(), refundedAt: refundedAt.toISOString() },
          processedBy: { userId: input.actor.userId, name: input.actor.name },
        };
        const document = await tx.document.create({ data: { orderId: original.order.id, clientId: original.order.clientId, paymentId: refund.id, type: DocumentType.REFUND_CONFIRMATION, number, title: `Подтверждение возврата ${number}`, documentDate: refundedAt, status: DocumentStatus.DRAFT, source: DocumentSource.GENERATED_ORDER, authorId: input.actor.userId, templateVersion: REFUND_CONFIRMATION_TEMPLATE_VERSION, snapshot: snapshot as unknown as Prisma.InputJsonValue, idempotencyKey: `refund-document:${input.key}`, requestHash: input.requestHash } });
        await tx.financeAuditEvent.create({ data: { orderId: original.order.id, action: "CLIENT_PAYMENT_REFUND", entityType: "Payment", entityId: refund.id, before: { originalPaymentId: original.id, paid: original.order.prepayment.toString() }, after: { refundAmount: normalized.total.toString(), paid: paidAfter.toString(), documentNumber: number }, reason: input.reason.trim(), authorId: input.actor.userId } });
        await tx.orderEvent.create({ data: { orderId: original.order.id, title: "Возврат денег", description: `${number} · ${normalized.total.toFixed(2)} ₸`, user: input.actor.name, idempotencyKey: `refund-event:${input.key}`, requestHash: input.requestHash } });
        return { payment: refund, document: { id: document.id, number }, created: true };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 20_000 });
      let pdfStatus: "READY" | "FAILED" = "READY";
      try { await ensureRefundConfirmationPdf(result.document.id); } catch { pdfStatus = "FAILED"; }
      return { ...result, pdfStatus };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 4) continue;
      if (isPrismaUniqueConflict(error)) {
        const replay = await prisma.payment.findUnique({ where: { idempotencyKey: input.key } });
        if (replay && replay.refundOfId && compareRequestHash(replay.requestHash, input.requestHash)) {
          const document = await prisma.document.findFirstOrThrow({ where: { paymentId: replay.id, type: DocumentType.REFUND_CONFIRMATION }, select: { id: true, number: true } });
          try { await ensureRefundConfirmationPdf(document.id); } catch { /* retryable */ }
          return { payment: replay, document, created: false, pdfStatus: "READY" as const };
        }
      }
      throw error;
    }
  }
  throw new Error("FINANCE_CONCURRENCY_RETRY_EXHAUSTED");
}
