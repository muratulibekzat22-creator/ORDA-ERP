import { createHash, randomUUID } from "crypto";
import { del, get, put } from "@/lib/private-blob";
import { Role } from "@prisma/client";

import { compareRequestHash, isPrismaUniqueConflict } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { canUseEntities } from "@/lib/services/document.service";

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
export type AttachmentActor = { role: Role; userId: number; name: string };
const publicSelect = {
  id: true,
  orderId: true,
  documentId: true,
  fileName: true,
  contentType: true,
  size: true,
  createdAt: true,
  uploadedBy: { select: { id: true, name: true } },
} as const;

async function actorPartnerId(actor: AttachmentActor) {
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

export async function canReadOrderAttachments(
  orderId: number,
  actor: AttachmentActor,
) {
  if (actor.role === Role.DIRECTOR) {
    return Boolean(
      await prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true },
      }),
    );
  }
  if (actor.role === Role.PARTNER) {
    const partnerId = await actorPartnerId(actor);
    return Boolean(
      await prisma.order.findFirst({
        where: { id: orderId, partnerId, deletedAt: null },
        select: { id: true },
      }),
    );
  }
  return Boolean(await canUseEntities(actor, undefined, orderId));
}

export async function listAttachments(orderId: number, actor: AttachmentActor) {
  if (!(await canReadOrderAttachments(orderId, actor))) return null;
  return prisma.attachment.findMany({
    where: { orderId },
    select: publicSelect,
    orderBy: { createdAt: "desc" },
  });
}

function safeFileName(value: string) {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 180) || "file";
}

function hasPrefix(bytes: Buffer, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function validFileContent(
  fileName: string,
  contentType: string,
  bytes: Buffer,
) {
  const extension = fileName.toLocaleLowerCase("en").split(".").pop();
  if (contentType === "application/pdf")
    return (
      extension === "pdf" && bytes.subarray(0, 5).toString("ascii") === "%PDF-"
    );
  if (contentType === "image/jpeg")
    return (
      ["jpg", "jpeg"].includes(extension ?? "") &&
      hasPrefix(bytes, [0xff, 0xd8, 0xff])
    );
  if (contentType === "image/png")
    return (
      extension === "png" &&
      hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  if (contentType === "image/webp")
    return (
      extension === "webp" &&
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP"
    );
  const zip = hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]);
  if (
    contentType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return extension === "docx" && zip;
  if (
    contentType ===
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  )
    return extension === "xlsx" && zip;
  const ole = hasPrefix(
    bytes,
    [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  );
  if (contentType === "application/msword") return extension === "doc" && ole;
  if (contentType === "application/vnd.ms-excel")
    return extension === "xls" && ole;
  return false;
}

export async function uploadAttachment(input: {
  orderId: number;
  documentId?: number;
  file: File;
  idempotencyKey: string;
  actor: AttachmentActor;
}) {
  if (input.actor.role !== Role.DIRECTOR && input.actor.role !== Role.MANAGER)
    throw new Error("FORBIDDEN");
  const fileName = safeFileName(input.file.name);
  const bytes = Buffer.from(await input.file.arrayBuffer());
  if (!validFileContent(fileName, input.file.type, bytes))
    throw new Error("INVALID_FILE_TYPE");
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        orderId: input.orderId,
        documentId: input.documentId ?? null,
        fileName,
        contentType: input.file.type,
        size: bytes.byteLength,
      }),
    )
    .update(bytes)
    .digest("hex");
  const repeated = await prisma.attachment.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { ...publicSelect, requestHash: true },
  });
  if (repeated) {
    if (!compareRequestHash(repeated.requestHash, requestHash))
      throw new Error("IDEMPOTENCY_CONFLICT");
    const { requestHash: _, ...attachment } = repeated;
    void _;
    return { attachment, created: false };
  }
  if (!(await canUseEntities(input.actor, undefined, input.orderId)))
    return null;
  if (
    input.documentId &&
    !(await prisma.document.findFirst({
      where: { id: input.documentId, orderId: input.orderId },
      select: { id: true },
    }))
  )
    throw new Error("INVALID_DOCUMENT");
  const pathname = `orders/${input.orderId}/${randomUUID()}-${fileName}`;
  const blob = await put(pathname, bytes, {
    access: "private",
    contentType: input.file.type,
    addRandomSuffix: false,
    allowOverwrite: false,
    maximumSizeInBytes: MAX_ATTACHMENT_SIZE,
  });
  try {
    const attachment = await prisma.attachment.create({
      data: {
        orderId: input.orderId,
        documentId: input.documentId,
        uploadedById: input.actor.userId,
        fileName,
        pathname: blob.pathname,
        contentType: input.file.type,
        size: bytes.byteLength,
        idempotencyKey: input.idempotencyKey,
        requestHash,
      },
      select: publicSelect,
    });
    return { attachment, created: true };
  } catch (error) {
    await del(blob.pathname).catch(() => undefined);
    if (!isPrismaUniqueConflict(error)) throw error;
    throw new Error("IDEMPOTENCY_CONFLICT");
  }
}

export async function getAttachmentContent(id: number, actor: AttachmentActor) {
  const attachment = await prisma.attachment.findUnique({
    where: { id },
    select: {
      id: true,
      orderId: true,
      pathname: true,
      fileName: true,
      contentType: true,
      size: true,
    },
  });
  if (
    !attachment ||
    !(await canReadOrderAttachments(attachment.orderId, actor))
  )
    return null;
  const blob = await get(attachment.pathname, { access: "private" });
  return blob?.statusCode === 200 ? { attachment, blob } : null;
}

export async function deleteAttachment(id: number, actor: AttachmentActor) {
  const attachment = await prisma.attachment.findUnique({
    where: { id },
    select: {
      id: true,
      orderId: true,
      uploadedById: true,
      pathname: true,
      order: { select: { deletedAt: true } },
    },
  });
  if (!attachment) return null;
  if (attachment.order.deletedAt) return null;
  if (!(await canReadOrderAttachments(attachment.orderId, actor))) return null;
  const allowed =
    actor.role === Role.DIRECTOR ||
    actor.role === Role.MANAGER ||
    (actor.role !== Role.PARTNER && attachment.uploadedById === actor.userId);
  if (!allowed) throw new Error("FORBIDDEN");
  await del(attachment.pathname);
  await prisma.attachment.delete({ where: { id } });
  return { id };
}
