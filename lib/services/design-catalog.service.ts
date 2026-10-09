import { randomUUID } from "crypto";
import {
  MeasurementPhotoType,
  MeasurementStatus,
  Prisma,
  Role,
} from "@prisma/client";

import { del, get, put } from "@/lib/private-blob";
import { prisma } from "@/lib/prisma";
import {
  measurementScope,
  type MeasurementActor,
} from "@/lib/services/measurement.service";

const CATALOG_PURPOSES = ["PAST_WORK", "DESIGN_RESULT"];
const editableStatuses: MeasurementStatus[] = [
  MeasurementStatus.ASSIGNED,
  MeasurementStatus.IN_PROGRESS,
];

const catalogWhere: Prisma.AttachmentWhereInput = {
  purpose: { in: CATALOG_PURPOSES },
  order: { deletedAt: null },
  OR: [
    { contentType: { startsWith: "image/" } },
    { contentType: { startsWith: "video/" } },
  ],
};

export async function listDesignCatalogItems() {
  return prisma.attachment.findMany({
    where: catalogWhere,
    select: {
      id: true,
      fileName: true,
      contentType: true,
      size: true,
      purpose: true,
      createdAt: true,
      order: { select: { number: true, staircase: true, material: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 80,
  });
}

export async function getDesignCatalogContent(id: number) {
  const attachment = await prisma.attachment.findFirst({
    where: { id, ...catalogWhere },
    select: {
      id: true,
      pathname: true,
      fileName: true,
      contentType: true,
      size: true,
    },
  });
  if (!attachment) return null;
  const blob = await get(attachment.pathname, { access: "private" });
  return blob?.statusCode === 200 ? { attachment, blob } : null;
}

export async function applyCatalogItemAsMeasurementReference(input: {
  actor: MeasurementActor;
  measurementId: number;
  catalogItemId: number;
}) {
  if (!(new Set<Role>([Role.MEASURER, Role.DIRECTOR])).has(input.actor.role))
    throw new Error("FORBIDDEN");
  const measurement = await prisma.measurement.findFirst({
    where: {
      id: input.measurementId,
      AND: [measurementScope(input.actor)],
    },
    select: { id: true, status: true },
  });
  if (!measurement) return null;
  if (!editableStatuses.includes(measurement.status))
    throw new Error("IMMUTABLE_MEASUREMENT");
  const source = await getDesignCatalogContent(input.catalogItemId);
  if (!source) throw new Error("CATALOG_ITEM_NOT_FOUND");
  if (!source.attachment.contentType.startsWith("image/"))
    throw new Error("CATALOG_REFERENCE_MUST_BE_IMAGE");
  const bytes = Buffer.from(await new Response(source.blob.stream).arrayBuffer());
  const pathname = `measurements/${measurement.id}/${randomUUID()}-reference-${source.attachment.fileName}`;
  const blob = await put(pathname, bytes, {
    access: "private",
    contentType: source.attachment.contentType,
    addRandomSuffix: false,
    allowOverwrite: false,
    maximumSizeInBytes: 15 * 1024 * 1024,
  });
  try {
    return await prisma.$transaction(async (tx) => {
      const attachment = await tx.measurementAttachment.create({
        data: {
          measurementId: measurement.id,
          type: MeasurementPhotoType.DESIGN_REFERENCE,
          uploadedById: input.actor.userId,
          fileName: source.attachment.fileName,
          pathname: blob.pathname,
          contentType: source.attachment.contentType,
          size: bytes.byteLength,
        },
        select: {
          id: true,
          type: true,
          fileName: true,
          contentType: true,
          size: true,
          createdAt: true,
        },
      });
      await tx.measurementAudit.create({
        data: {
          measurementId: measurement.id,
          action: "CATALOG_REFERENCE_SELECTED",
          actorId: input.actor.userId,
          after: {
            catalogItemId: input.catalogItemId,
            attachmentId: attachment.id,
            fileName: attachment.fileName,
          },
        },
      });
      return attachment;
    });
  } catch (error) {
    await del(blob.pathname).catch(() => undefined);
    throw error;
  }
}
