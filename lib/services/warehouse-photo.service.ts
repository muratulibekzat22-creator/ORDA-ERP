import { del, get, put } from "@/lib/private-blob";
import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";

export const MAX_WAREHOUSE_PHOTO_SIZE = 8 * 1024 * 1024;
export const WAREHOUSE_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function safeName(name: string) {
  return name.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "photo";
}

export async function uploadWarehousePhoto(materialId: number, file: File, idempotencyKey: string) {
  const material = await prisma.material.findUnique({ where: { id: materialId }, select: { id: true, mainImagePath: true } });
  if (!material) return null;
  const bytes = Buffer.from(await file.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  const pathname = `warehouse/material-${materialId}/${digest}-${safeName(file.name)}`;
  if (material.mainImagePath === pathname) return { id: materialId, photoUrl: `/api/warehouse/${materialId}/photo`, replayed: true };
  const blob = await put(pathname, bytes, { access: "private", contentType: file.type, addRandomSuffix: false, allowOverwrite: false, maximumSizeInBytes: MAX_WAREHOUSE_PHOTO_SIZE });
  try {
    await prisma.material.update({ where: { id: materialId }, data: { mainImagePath: blob.pathname, mainImageName: file.name, mainImageType: file.type, mainImageSize: bytes.length } });
  } catch (error) {
    await del(blob.pathname).catch(() => undefined);
    throw error;
  }
  if (material.mainImagePath) await del(material.mainImagePath).catch(() => undefined);
  return { id: materialId, photoUrl: `/api/warehouse/${materialId}/photo`, idempotencyKey, replayed: false };
}

export async function getWarehousePhoto(materialId: number) {
  const material = await prisma.material.findUnique({ where: { id: materialId }, select: { mainImagePath: true, mainImageName: true, mainImageType: true, mainImageSize: true } });
  if (!material?.mainImagePath || !material.mainImageType || !material.mainImageName || !material.mainImageSize) return null;
  const blob = await get(material.mainImagePath, { access: "private" });
  return blob?.statusCode === 200 ? { material, blob } : null;
}
