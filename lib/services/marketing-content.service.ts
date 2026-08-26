import { createHash, randomUUID } from "node:crypto";

import {
  MarketingContentAssetType,
  MarketingContentTaskStatus,
  Role,
} from "@prisma/client";

import { compareRequestHash, isPrismaUniqueConflict } from "@/lib/idempotency";
import { del, get, put } from "@/lib/private-blob";
import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";

export type MarketingContentActor = {
  userId: number;
  name: string;
  role: Role;
};

export class MarketingContentError extends Error {}

export const MAX_MARKETING_ASSET_SIZE = 20 * 1024 * 1024;
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const videoTypes = new Set(["video/mp4", "video/webm"]);

function assertActor(actor: MarketingContentActor) {
  if (actor.role !== Role.DIRECTOR && actor.role !== Role.MARKETER)
    throw new MarketingContentError("FORBIDDEN");
}

function assertAssetActor(actor: MarketingContentActor) {
  if (
    actor.role !== Role.DIRECTOR &&
    actor.role !== Role.MARKETER &&
    actor.role !== Role.MANAGER
  )
    throw new MarketingContentError("FORBIDDEN");
}

function taskScope(actor: MarketingContentActor) {
  return actor.role === Role.MARKETER
    ? { assignedMarketerId: actor.userId }
    : {};
}

function assetTaskScope(actor: MarketingContentActor) {
  if (actor.role === Role.MARKETER)
    return { assignedMarketerId: actor.userId };
  if (actor.role === Role.MANAGER)
    return {
      order: {
        OR: [
          { managerUserId: actor.userId },
          { managerUserId: null, manager: actor.name },
          { leadConversion: { managerId: actor.userId } },
        ],
      },
    };
  return {};
}

const clean = (value: unknown, max = 3000) =>
  typeof value === "string" ? value.trim().slice(0, max) || null : null;

function safeFileName(value: string) {
  return (
    value
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180) || "content"
  );
}

function validAsset(fileName: string, contentType: string, bytes: Buffer) {
  const extension = fileName.toLocaleLowerCase("en").split(".").pop();
  if (contentType === "image/jpeg")
    return ["jpg", "jpeg"].includes(extension ?? "") && bytes[0] === 0xff && bytes[1] === 0xd8;
  if (contentType === "image/png")
    return extension === "png" && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === "image/webp")
    return extension === "webp" && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (contentType === "video/mp4")
    return extension === "mp4" && bytes.subarray(4, 8).toString("ascii") === "ftyp";
  if (contentType === "video/webm")
    return extension === "webm" && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}

const taskInclude = {
  assignedMarketer: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  client: {
    select: {
      id: true,
      name: true,
      phone: true,
      whatsapp: true,
      city: true,
      address: true,
    },
  },
  order: {
    select: {
      id: true,
      number: true,
      address: true,
      staircase: true,
      material: true,
      completedAt: true,
      manager: true,
      managerUser: { select: { id: true, name: true } },
    },
  },
  assets: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      type: true,
      fileName: true,
      contentType: true,
      size: true,
      createdAt: true,
      uploadedBy: { select: { name: true } },
    },
  },
} as const;

export async function getMarketingContentTasks(actor: MarketingContentActor) {
  assertActor(actor);
  const tenant = requireTenantIdentity().companyId;
  const tasks = await prisma.marketingContentTask.findMany({
    where: { companyId: tenant, ...taskScope(actor) },
    include: taskInclude,
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    take: 500,
  });
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const active = tasks.filter(
    (task) =>
      task.status !== MarketingContentTaskStatus.PUBLISHED &&
      task.status !== MarketingContentTaskStatus.REFUSED,
  );
  return {
    tasks,
    metrics: {
      completedThisMonth: tasks.filter(
        (task) => task.order.completedAt && task.order.completedAt >= monthStart,
      ).length,
      newTasks: tasks.filter((task) => task.status === MarketingContentTaskStatus.NEW).length,
      needContact: active.filter((task) =>
        task.status === MarketingContentTaskStatus.NEW ||
        task.status === MarketingContentTaskStatus.NEED_CONTACT,
      ).length,
      overdueContact: active.filter(
        (task) => task.scheduledAt && task.scheduledAt < now,
      ).length,
      shootsScheduled: tasks.filter((task) => task.status === MarketingContentTaskStatus.SHOOT_SCHEDULED).length,
      waitingReview: active.filter((task) => !task.reviewText).length,
      waitingPhoto: active.filter((task) => !task.assets.some((asset) => asset.type === MarketingContentAssetType.PHOTO)).length,
      waitingVideo: active.filter((task) => !task.assets.some((asset) => asset.type === MarketingContentAssetType.VIDEO)).length,
      contentReady: tasks.filter((task) => task.status === MarketingContentTaskStatus.CONTENT_READY).length,
      published: tasks.filter((task) => task.status === MarketingContentTaskStatus.PUBLISHED).length,
      refused: tasks.filter((task) => task.status === MarketingContentTaskStatus.REFUSED).length,
      unassigned: active.filter((task) => !task.assignedMarketerId).length,
    },
  };
}

export async function updateMarketingContentTask(
  taskId: number,
  input: Record<string, unknown>,
  actor: MarketingContentActor,
) {
  assertActor(actor);
  const tenant = requireTenantIdentity().companyId;
  const task = await prisma.marketingContentTask.findFirst({
    where: { id: taskId, companyId: tenant, ...taskScope(actor) },
  });
  if (!task) throw new MarketingContentError("NOT_FOUND");
  const status = String(input.status ?? task.status) as MarketingContentTaskStatus;
  if (!Object.values(MarketingContentTaskStatus).includes(status))
    throw new MarketingContentError("INVALID");
  const scheduledAt = input.scheduledAt
    ? new Date(String(input.scheduledAt))
    : input.scheduledAt === null || input.scheduledAt === ""
      ? null
      : task.scheduledAt;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime()))
    throw new MarketingContentError("INVALID");
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.marketingContentTask.update({
      where: { id: task.id },
      data: {
        status,
        scheduledAt,
        comment: input.comment === undefined ? task.comment : clean(input.comment),
        reviewText: input.reviewText === undefined ? task.reviewText : clean(input.reviewText, 5000),
        publicationUrl: input.publicationUrl === undefined ? task.publicationUrl : clean(input.publicationUrl, 2000),
        contentReceivedAt:
          status === MarketingContentTaskStatus.CONTENT_READY ||
          status === MarketingContentTaskStatus.PUBLISHED
          ? task.contentReceivedAt ?? now
          : task.contentReceivedAt,
        publishedAt:
          status === MarketingContentTaskStatus.PUBLISHED
            ? task.publishedAt ?? now
            : null,
        completedAt:
          status === MarketingContentTaskStatus.PUBLISHED ||
          status === MarketingContentTaskStatus.REFUSED
          ? task.completedAt ?? now
          : null,
      },
      include: taskInclude,
    });
    await tx.marketingAuditLog.create({
      data: {
        companyId: tenant,
        action: "CONTENT_TASK_UPDATED",
        entityType: "MarketingContentTask",
        entityId: task.id,
        actorId: actor.userId,
        before: { status: task.status, scheduledAt: task.scheduledAt },
        after: { status: result.status, scheduledAt: result.scheduledAt },
        comment: result.comment,
      },
    });
    return result;
  });
  return updated;
}

export async function uploadMarketingContentAsset(
  input: {
    taskId?: number;
    orderId?: number;
    file: File;
    idempotencyKey: string;
    actor: MarketingContentActor;
  },
) {
  assertAssetActor(input.actor);
  const tenant = requireTenantIdentity().companyId;
  const task = await prisma.marketingContentTask.findFirst({
    where: {
      companyId: tenant,
      ...(input.taskId ? { id: input.taskId } : { orderId: input.orderId }),
      ...assetTaskScope(input.actor),
    },
    select: { id: true, orderId: true },
  });
  if (!task) throw new MarketingContentError("NOT_FOUND");
  const fileName = safeFileName(input.file.name);
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const assetType = imageTypes.has(input.file.type)
    ? MarketingContentAssetType.PHOTO
    : videoTypes.has(input.file.type)
      ? MarketingContentAssetType.VIDEO
      : null;
  if (!assetType || !validAsset(fileName, input.file.type, bytes))
    throw new MarketingContentError("INVALID_FILE");
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ taskId: task.id, fileName, type: input.file.type, size: bytes.byteLength }))
    .update(bytes)
    .digest("hex");
  const replay = await prisma.marketingContentAsset.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (replay) {
    if (!compareRequestHash(replay.requestHash, requestHash))
      throw new MarketingContentError("IDEMPOTENCY_CONFLICT");
    return { asset: replay, created: false };
  }
  const pathname = `marketing/content/${task.orderId}/${randomUUID()}-${fileName}`;
  const blob = await put(pathname, bytes, {
    access: "private",
    contentType: input.file.type,
    addRandomSuffix: false,
    allowOverwrite: false,
    maximumSizeInBytes: MAX_MARKETING_ASSET_SIZE,
  });
  try {
    const asset = await prisma.$transaction(async (tx) => {
      const created = await tx.marketingContentAsset.create({
        data: {
          companyId: tenant,
          taskId: task.id,
          type: assetType,
          fileName,
          pathname: blob.pathname,
          contentType: input.file.type,
          size: bytes.byteLength,
          uploadedById: input.actor.userId,
          idempotencyKey: input.idempotencyKey,
          requestHash,
        },
      });
      await tx.marketingContentTask.update({
        where: { id: task.id },
        data: {
          status:
            assetType === MarketingContentAssetType.PHOTO
              ? MarketingContentTaskStatus.PHOTOS_RECEIVED
              : MarketingContentTaskStatus.VIDEO_RECEIVED,
          contentReceivedAt: new Date(),
        },
      });
      return created;
    });
    return { asset, created: true };
  } catch (error) {
    await del(blob.pathname).catch(() => undefined);
    if (isPrismaUniqueConflict(error))
      throw new MarketingContentError("IDEMPOTENCY_CONFLICT");
    throw error;
  }
}

export async function getMarketingContentAsset(
  assetId: number,
  actor: MarketingContentActor,
) {
  assertActor(actor);
  const tenant = requireTenantIdentity().companyId;
  const asset = await prisma.marketingContentAsset.findFirst({
    where: {
      id: assetId,
      companyId: tenant,
      task: taskScope(actor),
    },
    select: {
      id: true,
      fileName: true,
      pathname: true,
      contentType: true,
      size: true,
    },
  });
  if (!asset) return null;
  const blob = await get(asset.pathname, { access: "private" });
  return blob?.statusCode === 200 ? { asset, blob } : null;
}
