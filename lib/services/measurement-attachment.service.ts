import { randomUUID } from "crypto";
import { del, get, put } from "@vercel/blob";
import { MeasurementPhotoType, MeasurementStatus, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { measurementScope, type MeasurementActor } from "@/lib/services/measurement.service";

export const MAX_MEASUREMENT_PHOTO_SIZE = 15 * 1024 * 1024;
export const MEASUREMENT_PHOTO_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EDITABLE_STATUSES: MeasurementStatus[] = [MeasurementStatus.ASSIGNED, MeasurementStatus.IN_PROGRESS];

function safeName(value: string) {
  return value.normalize("NFKC").replace(/[\u0000-\u001f\u007f/\\]/g, "_").replace(/\s+/g, " ").trim().slice(0, 180) || "photo";
}

function hasPrefix(bytes: Buffer, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function validImage(fileName: string, type: string, bytes: Buffer) {
  const extension = fileName.toLowerCase().split(".").pop();
  if (type === "image/jpeg") return ["jpg", "jpeg"].includes(extension ?? "") && hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (type === "image/png") return extension === "png" && hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47]);
  if (type === "image/webp") return extension === "webp" && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

export async function listMeasurementAttachments(actor: MeasurementActor, measurementId: number) {
  const measurement = await prisma.measurement.findFirst({ where: { id: measurementId, AND: [measurementScope(actor)] }, select: { id: true } });
  if (!measurement) return null;
  return prisma.measurementAttachment.findMany({ where: { measurementId }, select: { id: true, measurementId: true, type: true, fileName: true, contentType: true, size: true, createdAt: true }, orderBy: { createdAt: "desc" } });
}

export async function uploadMeasurementAttachment(input: { actor: MeasurementActor; measurementId: number; type: MeasurementPhotoType; file: File }) {
  if (input.actor.role !== Role.MEASURER && input.actor.role !== Role.DIRECTOR) throw new Error("FORBIDDEN");
  const measurement = await prisma.measurement.findFirst({ where: { id: input.measurementId, AND: [measurementScope(input.actor)] }, select: { id: true, status: true } });
  if (!measurement) return null;
  if (!EDITABLE_STATUSES.includes(measurement.status)) throw new Error("IMMUTABLE_MEASUREMENT");
  const fileName = safeName(input.file.name), bytes = Buffer.from(await input.file.arrayBuffer());
  if (!validImage(fileName, input.file.type, bytes)) throw new Error("INVALID_FILE_TYPE");
  const pathname = `measurements/${input.measurementId}/${randomUUID()}-${fileName}`;
  const blob = await put(pathname, bytes, { access: "private", contentType: input.file.type, addRandomSuffix: false, allowOverwrite: false, maximumSizeInBytes: MAX_MEASUREMENT_PHOTO_SIZE });
  try {
    return await prisma.$transaction(async (tx) => {
      const attachment = await tx.measurementAttachment.create({ data: { measurementId: input.measurementId, type: input.type, uploadedById: input.actor.userId, fileName, pathname: blob.pathname, contentType: input.file.type, size: bytes.byteLength }, select: { id: true, measurementId: true, type: true, fileName: true, contentType: true, size: true, createdAt: true } });
      await tx.measurementAudit.create({ data: { measurementId: input.measurementId, action: "PHOTO_UPLOADED", actorId: input.actor.userId, after: { attachmentId: attachment.id, type: attachment.type, fileName: attachment.fileName } } });
      return attachment;
    });
  } catch (error) {
    await del(blob.pathname).catch(() => undefined);
    throw error;
  }
}

export async function getMeasurementAttachment(actor: MeasurementActor, id: number) {
  const attachment = await prisma.measurementAttachment.findFirst({ where: { id, measurement: { AND: [measurementScope(actor)] } }, select: { id: true, pathname: true, fileName: true, contentType: true, size: true } });
  if (!attachment) return null;
  const blob = await get(attachment.pathname, { access: "private" });
  return blob?.statusCode === 200 ? { attachment, blob } : null;
}

export async function deleteMeasurementAttachment(actor: MeasurementActor, id: number) {
  const attachment = await prisma.measurementAttachment.findFirst({ where: { id, measurement: { AND: [measurementScope(actor)] } }, include: { measurement: { select: { id: true, status: true, measurerUserId: true } } } });
  if (!attachment) return null;
  if (actor.role !== Role.DIRECTOR && (actor.role !== Role.MEASURER || attachment.measurement.measurerUserId !== actor.userId)) throw new Error("FORBIDDEN");
  if (!EDITABLE_STATUSES.includes(attachment.measurement.status)) throw new Error("IMMUTABLE_MEASUREMENT");
  await del(attachment.pathname);
  await prisma.$transaction(async (tx) => {
    await tx.measurementAttachment.delete({ where: { id } });
    await tx.measurementAudit.create({ data: { measurementId: attachment.measurement.id, action: "PHOTO_DELETED", actorId: actor.userId, before: { attachmentId: attachment.id, type: attachment.type, fileName: attachment.fileName } } });
  });
  return { id };
}
