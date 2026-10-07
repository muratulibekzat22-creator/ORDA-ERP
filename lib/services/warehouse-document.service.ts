import { createHash } from "node:crypto";

import { DocumentStatus, Prisma } from "@prisma/client";

import { buildWarehouseShipmentPdf, WAREHOUSE_SHIPMENT_TEMPLATE_VERSION, type WarehouseShipmentSnapshot } from "@/lib/documents/warehouse-shipment-pdf";
import { countPdfPages } from "@/lib/documents/pdf-utils";
import { put } from "@/lib/private-blob";
import { prisma } from "@/lib/prisma";

export async function ensureWarehouseShipmentPdf(shipmentId: number) {
  const shipment = await prisma.warehouseShipment.findUnique({
    where: { id: shipmentId },
    include: { document: { include: { versions: true } } },
  });
  if (!shipment) throw new Error("SHIPMENT_NOT_FOUND");
  const existing = shipment.document.versions.find((item) => item.version === shipment.document.currentVersion);
  if (existing) return existing;
  const snapshot = shipment.snapshot as unknown as WarehouseShipmentSnapshot;
  const bytes = await buildWarehouseShipmentPdf(snapshot);
  const pages = countPdfPages(bytes);
  if (pages < 1) throw new Error("OUTGOING_INVOICE_PDF_INVALID");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const fileName = `Расходная-накладная-${shipment.number}.pdf`;
  const blob = await put(`documents/warehouse-shipments/${shipment.id}/outgoing-invoice.pdf`, bytes, {
    access: "private",
    contentType: "application/pdf",
    addRandomSuffix: false,
    allowOverwrite: true,
    maximumSizeInBytes: 10 * 1024 * 1024,
  });
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${1_800_000_000 + shipment.id})`;
    const document = await tx.document.findUniqueOrThrow({ where: { id: shipment.documentId }, select: { currentVersion: true } });
    if (document.currentVersion > 0)
      return tx.documentVersion.findUniqueOrThrow({ where: { documentId_version: { documentId: shipment.documentId, version: document.currentVersion } } });
    const version = await tx.documentVersion.create({
      data: {
        documentId: shipment.documentId,
        version: 1,
        uploadedById: snapshot.issuedBy.userId,
        comment: "Автоматически сформированная расходная накладная",
        fileName,
        pathname: blob.pathname,
        contentType: "application/pdf",
        size: bytes.length,
        checksum,
        templateVersion: WAREHOUSE_SHIPMENT_TEMPLATE_VERSION,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        idempotencyKey: `warehouse-shipment-pdf:${shipment.id}`,
      },
    });
    await tx.document.update({ where: { id: shipment.documentId }, data: { currentVersion: 1, status: DocumentStatus.READY } });
    await tx.documentAudit.create({
      data: {
        documentId: shipment.documentId,
        actorId: snapshot.issuedBy.userId,
        action: "OUTGOING_INVOICE_PDF_GENERATED",
        after: { shipmentId: shipment.id, number: shipment.number, pages, checksum },
      },
    });
    return version;
  });
}
