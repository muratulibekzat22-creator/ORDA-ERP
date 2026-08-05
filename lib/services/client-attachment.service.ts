import { randomUUID } from "crypto";
import { del, get, put } from "@vercel/blob";
import { Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const MAX_CLIENT_ATTACHMENT_SIZE = 50 * 1024 * 1024;
export const CLIENT_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const publicSelect = {
  id: true,
  clientId: true,
  fileName: true,
  contentType: true,
  size: true,
  createdAt: true,
  uploadedBy: { select: { id: true, name: true } },
} as const;

function safeName(value: string) {
  return value.normalize("NFKC").replace(/[\u0000-\u001f\u007f/\\]/g, "_").replace(/\s+/g, " ").trim().slice(0, 180) || "file";
}

function hasPrefix(bytes: Buffer, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function validContent(fileName: string, type: string, bytes: Buffer) {
  const extension = fileName.toLocaleLowerCase("en").split(".").pop();
  if (type === "application/pdf") return extension === "pdf" && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (type === "image/jpeg") return ["jpg", "jpeg"].includes(extension ?? "") && hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (type === "image/png") return extension === "png" && hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47]);
  if (type === "image/webp") return extension === "webp" && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (type === "video/mp4" || type === "video/quicktime") return ["mp4", "mov"].includes(extension ?? "") && bytes.subarray(4, 12).toString("ascii").includes("ftyp");
  if (type === "video/webm") return extension === "webm" && hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
  const zip = hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]);
  if (type.includes("wordprocessingml")) return extension === "docx" && zip;
  if (type.includes("spreadsheetml")) return extension === "xlsx" && zip;
  const ole = hasPrefix(bytes, [0xd0, 0xcf, 0x11, 0xe0]);
  if (type === "application/msword") return extension === "doc" && ole;
  if (type === "application/vnd.ms-excel") return extension === "xls" && ole;
  return false;
}

export async function listClientAttachments(clientId: number) {
  if (!await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } })) return null;
  return prisma.clientAttachment.findMany({ where: { clientId }, select: publicSelect, orderBy: { createdAt: "desc" } });
}

export async function uploadClientAttachment(input: { clientId: number; userId: number; role: Role; file: File }) {
  if (input.role !== Role.DIRECTOR && input.role !== Role.MANAGER) throw new Error("FORBIDDEN");
  if (!await prisma.client.findUnique({ where: { id: input.clientId }, select: { id: true } })) return null;
  const fileName = safeName(input.file.name);
  const bytes = Buffer.from(await input.file.arrayBuffer());
  if (!validContent(fileName, input.file.type, bytes)) throw new Error("INVALID_FILE_TYPE");
  const pathname = `clients/${input.clientId}/${randomUUID()}-${fileName}`;
  const blob = await put(pathname, bytes, { access: "private", contentType: input.file.type, addRandomSuffix: false, allowOverwrite: false, maximumSizeInBytes: MAX_CLIENT_ATTACHMENT_SIZE });
  try {
    return await prisma.clientAttachment.create({ data: { clientId: input.clientId, uploadedById: input.userId, fileName, pathname: blob.pathname, contentType: input.file.type, size: bytes.byteLength }, select: publicSelect });
  } catch (error) {
    await del(blob.pathname).catch(() => undefined);
    throw error;
  }
}

export async function getClientAttachment(id: number) {
  const attachment = await prisma.clientAttachment.findUnique({ where: { id }, select: { id: true, pathname: true, fileName: true, contentType: true, size: true } });
  if (!attachment) return null;
  const blob = await get(attachment.pathname, { access: "private" });
  return blob?.statusCode === 200 ? { attachment, blob } : null;
}

export async function deleteClientAttachment(id: number, role: Role) {
  if (role !== Role.DIRECTOR && role !== Role.MANAGER) throw new Error("FORBIDDEN");
  const attachment = await prisma.clientAttachment.findUnique({ where: { id }, select: { id: true, pathname: true } });
  if (!attachment) return null;
  await del(attachment.pathname);
  await prisma.clientAttachment.delete({ where: { id } });
  return { id };
}
