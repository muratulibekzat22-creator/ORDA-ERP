import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { isAttachmentPurpose, type AttachmentPurpose } from "@/lib/orders/design-brief";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import { canUseEntities } from "@/lib/services/document.service";
import {
  attachmentSizeLimit,
  registerClientUploadedVideo,
  safeAttachmentFileName,
  type AttachmentActor,
} from "@/lib/services/attachment.service";

type UploadPayload = {
  orderId: number;
  documentId?: number;
  purpose: AttachmentPurpose;
  fileName: string;
  contentType: string;
  size: number;
  idempotencyKey: string;
};

function parsePayload(value: string | null): UploadPayload | null {
  try {
    const data = JSON.parse(value ?? "null") as Partial<UploadPayload> | null;
    if (
      !data ||
      !Number.isInteger(data.orderId) ||
      Number(data.orderId) <= 0 ||
      (data.documentId !== undefined && (!Number.isInteger(data.documentId) || Number(data.documentId) <= 0)) ||
      !isAttachmentPurpose(data.purpose) ||
      typeof data.fileName !== "string" ||
      safeAttachmentFileName(data.fileName) !== data.fileName ||
      !["video/mp4", "video/quicktime"].includes(data.contentType ?? "") ||
      !Number.isFinite(data.size) ||
      Number(data.size) <= 0 ||
      Number(data.size) > attachmentSizeLimit(data.contentType ?? "") ||
      typeof data.idempotencyKey !== "string" ||
      data.idempotencyKey.length < 16 ||
      data.idempotencyKey.length > 200
    ) return null;
    return data as UploadPayload;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const response = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const auth = await requirePermission("documents");
        if (auth.response || !auth.session) throw new Error("UNAUTHORIZED");
        const role = auth.session.user.role as Role;
        if (!new Set<Role>([Role.DIRECTOR, Role.OPERATIONS_DIRECTOR, Role.MANAGER]).has(role))
          throw new Error("FORBIDDEN");
        const payload = parsePayload(clientPayload);
        if (!payload || !pathname.startsWith(`orders/${payload.orderId}/client-`) || pathname.includes(".."))
          throw new Error("INVALID_UPLOAD");
        const actor: AttachmentActor = {
          userId: Number(auth.session.user.id),
          role,
          name: auth.session.user.name ?? "",
        };
        if (!(await canUseEntities(actor, undefined, payload.orderId))) throw new Error("FORBIDDEN");
        if (payload.documentId && !(await prisma.document.findFirst({
          where: { id: payload.documentId, orderId: payload.orderId },
          select: { id: true },
        }))) throw new Error("INVALID_DOCUMENT");
        return {
          allowedContentTypes: [payload.contentType],
          maximumSizeInBytes: attachmentSizeLimit(payload.contentType),
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({ ...payload, pathname, actor }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const signed = JSON.parse(tokenPayload ?? "null") as (UploadPayload & { pathname: string; actor: AttachmentActor }) | null;
        if (!signed || signed.pathname !== blob.pathname || signed.contentType !== blob.contentType)
          throw new Error("INVALID_UPLOAD_CALLBACK");
        await registerClientUploadedVideo({ ...signed });
      },
    });
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UPLOAD_FAILED";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: "Не удалось загрузить видео" }, { status });
  }
}
