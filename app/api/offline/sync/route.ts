import { createHash } from "node:crypto";
import { CalendarTaskPriority, CalendarTaskType, MeasurementPhotoType, Prisma, Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { canAccessLead } from "@/lib/leads/domain";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import { uploadMeasurementAttachment } from "@/lib/services/measurement-attachment.service";

const schema = z.object({
  tenantId: z.number().int().positive(),
  userId: z.number().int().positive(),
  kind: z.enum(["MEASUREMENT_NOTE", "WORK_COMMENT", "TASK_CREATE", "TASK_UPDATE", "PRODUCTION_NOTE", "MEASUREMENT_PHOTO"]),
  payload: z.record(z.string(), z.unknown()),
  createdAtLocal: z.iso.datetime(),
}).strict();

const permissionByKind = {
  MEASUREMENT_NOTE: "measurements",
  MEASUREMENT_PHOTO: "measurements",
  WORK_COMMENT: "clients",
  TASK_CREATE: "calendar",
  TASK_UPDATE: "calendar",
  PRODUCTION_NOTE: "production",
} as const;

function serializable(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Некорректная offline mutation" }, { status: 400 });
  const key = request.headers.get("idempotency-key") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key))
    return NextResponse.json({ error: "Требуется UUID Idempotency-Key" }, { status: 400 });
  const auth = await requirePermission(permissionByKind[parsed.data.kind]);
  if (auth.response) return auth.response;
  const session = auth.session!.user;
  if (parsed.data.tenantId !== session.companyId || parsed.data.userId !== Number(session.id))
    return NextResponse.json({ error: "Контекст сессии не совпадает", code: "TENANT_OR_USER_MISMATCH" }, { status: 403 });
  const scope = `offline:${parsed.data.kind}`;
  const requestHash = createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");
  const existing = await prisma.idempotencyRecord.findUnique({ where: { companyId_actorUserId_scope_key: { companyId: session.companyId, actorUserId: Number(session.id), scope, key } } });
  if (existing) {
    if (existing.requestHash !== requestHash) return NextResponse.json({ error: "Idempotency-Key уже использован с другим payload" }, { status: 409 });
    return NextResponse.json(existing.responseBody, { status: existing.statusCode });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${session.companyId}:${session.id}:${scope}:${key}`}))`);
      const replay = await tx.idempotencyRecord.findUnique({ where: { companyId_actorUserId_scope_key: { companyId: session.companyId, actorUserId: Number(session.id), scope, key } } });
      if (replay) return { statusCode: replay.statusCode, responseBody: replay.responseBody };

      const payload = parsed.data.payload;
      let response: unknown;
      if (parsed.data.kind === "MEASUREMENT_NOTE") {
        const values = z.object({ id: z.number().int().positive(), version: z.number().int().positive(), comment: z.string().trim().min(1).max(8000) }).strict().parse(payload);
        const updated = await tx.measurement.updateMany({ where: { id: values.id, version: values.version, deletedAt: null }, data: { comment: values.comment, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("OFFLINE_CONFLICT");
        response = { id: values.id, version: values.version + 1 };
      } else if (parsed.data.kind === "PRODUCTION_NOTE") {
        const values = z.object({ id: z.number().int().positive(), version: z.number().int().positive(), comment: z.string().trim().min(1).max(8000) }).strict().parse(payload);
        const updated = await tx.production.updateMany({ where: { id: values.id, version: values.version, deletedAt: null }, data: { comment: values.comment, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("OFFLINE_CONFLICT");
        response = { id: values.id, version: values.version + 1 };
      } else if (parsed.data.kind === "TASK_UPDATE") {
        const values = z.object({ id: z.number().int().positive(), version: z.number().int().positive(), resultText: z.string().trim().min(1).max(8000) }).strict().parse(payload);
        const updated = await tx.calendarTask.updateMany({ where: { id: values.id, version: values.version, deletedAt: null, OR: [{ assigneeId: Number(session.id) }, { creatorId: Number(session.id) }] }, data: { resultText: values.resultText, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("OFFLINE_CONFLICT");
        response = { id: values.id, version: values.version + 1 };
      } else if (parsed.data.kind === "TASK_CREATE") {
        const values = z.object({ title: z.string().trim().min(1).max(200), description: z.string().trim().max(4000).optional(), dueAt: z.iso.datetime(), priority: z.nativeEnum(CalendarTaskPriority).optional() }).strict().parse(payload);
        const task = await tx.calendarTask.create({ data: { title: values.title, description: values.description, dueAt: new Date(values.dueAt), priority: values.priority ?? CalendarTaskPriority.NORMAL, type: CalendarTaskType.TASK, assigneeId: Number(session.id), creatorId: Number(session.id) }, select: { id: true, version: true } });
        response = task;
      } else if (parsed.data.kind === "WORK_COMMENT") {
        const values = z.object({ clientId: z.number().int().positive(), comment: z.string().trim().min(1).max(4000) }).strict().parse(payload);
        const client = await tx.client.findUnique({ where: { id: values.clientId }, select: { id: true, managerUserId: true } });
        if (!client || !canAccessLead(session.accountRole as Role, Number(session.id), client)) throw new Error("NOT_FOUND");
        const interaction = await tx.clientInteraction.create({ data: { clientId: values.clientId, comment: values.comment, authorId: Number(session.id), authorName: session.name ?? "Сотрудник" }, select: { id: true } });
        response = interaction;
      } else {
        throw new Error("PHOTO_OUTSIDE_TRANSACTION");
      }

      const responseBody = serializable({ acknowledgement: key, result: response });
      await tx.idempotencyRecord.create({ data: { actorUserId: Number(session.id), scope, key, requestHash, statusCode: 200, responseBody, expiresAt: new Date(Date.now() + 30 * 86_400_000) } });
      return { statusCode: 200, responseBody };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(result.responseBody, { status: result.statusCode });
  } catch (error) {
    if (error instanceof Error && error.message === "PHOTO_OUTSIDE_TRANSACTION") {
      try {
        const values = z.object({ measurementId: z.number().int().positive(), type: z.nativeEnum(MeasurementPhotoType), fileName: z.string().trim().min(1).max(180), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), base64: z.string().max(4_200_000) }).strict().parse(parsed.data.payload);
        const bytes = Buffer.from(values.base64, "base64");
        if (bytes.length === 0 || bytes.length > 3 * 1024 * 1024) throw new Error("INVALID_FILE_SIZE");
        const file = new File([bytes], values.fileName, { type: values.contentType });
        const attachment = await uploadMeasurementAttachment({ actor: { userId: Number(session.id), role: session.accountRole as Role, name: session.name ?? "Сотрудник" }, measurementId: values.measurementId, type: values.type, file });
        if (!attachment) return NextResponse.json({ error: "Замер не найден" }, { status: 404 });
        const responseBody = serializable({ acknowledgement: key, result: attachment });
        await prisma.idempotencyRecord.create({ data: { actorUserId: Number(session.id), scope, key, requestHash, statusCode: 200, responseBody, expiresAt: new Date(Date.now() + 30 * 86_400_000) } });
        return NextResponse.json(responseBody);
      } catch (photoError) {
        if (photoError instanceof Prisma.PrismaClientKnownRequestError && photoError.code === "P2002") {
          const replay = await prisma.idempotencyRecord.findUnique({ where: { companyId_actorUserId_scope_key: { companyId: session.companyId, actorUserId: Number(session.id), scope, key } } });
          if (replay?.requestHash === requestHash) return NextResponse.json(replay.responseBody, { status: replay.statusCode });
        }
        return NextResponse.json({ error: "Не удалось синхронизировать фото замера" }, { status: 400 });
      }
    }
    if (error instanceof Error && error.message === "OFFLINE_CONFLICT")
      return NextResponse.json({ error: "На сервере уже есть более свежая версия", code: "VERSION_CONFLICT" }, { status: 409 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Некорректные offline-данные" }, { status: 400 });
    return NextResponse.json({ error: "Не удалось синхронизировать запись", requestId: request.headers.get("x-request-id") }, { status: 500 });
  }
}
