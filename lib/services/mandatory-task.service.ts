import { randomUUID } from "node:crypto";
import { CalendarTaskStatus, CalendarTaskWorkflow, Role } from "@prisma/client";

import { get, put, del } from "@/lib/private-blob";
import { prisma } from "@/lib/prisma";
import type { CalendarActor } from "@/lib/services/calendar.service";

export const MAX_TASK_RESULT_SIZE = 25 * 1024 * 1024;
const allowedTypes = new Set([
  "image/jpeg", "image/png", "image/webp", "application/pdf",
  "video/mp4", "video/webm",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const select = {
  id: true, title: true, description: true, dueAt: true, priority: true, status: true,
  workflow: true, expectedAmount: true,
  acknowledgedAt: true, acknowledgementComment: true, plannedCompletionAt: true,
  resultText: true, resultSubmittedAt: true,
  creator: { select: { id: true, name: true } },
  client: { select: { id: true, name: true, phone: true } },
  order: { select: { id: true, number: true, client: { select: { name: true, phone: true } } } },
  resultAttachments: { select: { id: true, fileName: true, contentType: true, size: true, createdAt: true }, orderBy: { createdAt: "asc" as const } },
} as const;

function safeName(value: string) {
  return value.normalize("NFKC").replace(/[\u0000-\u001f\u007f/\\]/g, "_").replace(/\s+/g, " ").trim().slice(0, 180) || "result";
}

export async function getMandatoryTask(actor: CalendarActor) {
  const now = new Date();
  const task = await prisma.calendarTask.findFirst({
    where: {
      assigneeId: actor.userId,
      acknowledgementRequired: true,
      status: { notIn: [CalendarTaskStatus.CANCELLED, CalendarTaskStatus.COMPLETED] },
      AND: [
        {
          OR: [
            { workflow: null },
            { workflow: { not: CalendarTaskWorkflow.PAYMENT_COLLECTION } },
            { dueAt: { lte: now } },
          ],
        },
        {
          OR: [
            { acknowledgedAt: null },
            { controlKey: null, acknowledgedAt: { not: null }, plannedCompletionAt: { lte: now }, resultSubmittedAt: null },
          ],
        },
      ],
    },
    select,
    orderBy: [{ acknowledgedAt: "asc" }, { createdAt: "asc" }],
  });
  return task ? { phase: task.acknowledgedAt ? "RESULT" as const : "ACKNOWLEDGE" as const, task } : null;
}

export async function acknowledgeMandatoryTask(actor: CalendarActor, taskId: number, plannedCompletionAt: Date, comment: string) {
  if (Number.isNaN(plannedCompletionAt.getTime()) || plannedCompletionAt.getTime() < Date.now() - 5 * 60_000 || plannedCompletionAt.getTime() > Date.now() + 366 * 86400_000)
    throw new Error("INVALID_COMPLETION_DATE");
  return prisma.$transaction(async (tx) => {
    const task = await tx.calendarTask.findFirst({ where: { id: taskId, assigneeId: actor.userId, acknowledgementRequired: true, acknowledgedAt: null, status: { notIn: [CalendarTaskStatus.COMPLETED, CalendarTaskStatus.CANCELLED] } }, select: { id: true, status: true, workflow: true } });
    if (!task) throw new Error("TASK_NOT_FOUND");
    const now = new Date();
    if (task.workflow === CalendarTaskWorkflow.PAYMENT_COLLECTION && plannedCompletionAt.getTime() > now.getTime() + 24 * 60 * 60_000)
      throw new Error("PAYMENT_FOLLOW_UP_COMPLETION_TOO_LATE");
    const updated = await tx.calendarTask.update({
      where: { id: taskId },
      data: { acknowledgedAt: now, acknowledgementComment: comment.slice(0, 1000) || "Ознакомился и понял", plannedCompletionAt, status: CalendarTaskStatus.IN_PROGRESS },
      select,
    });
    await tx.calendarTaskAudit.create({ data: { taskId, action: "ACKNOWLEDGED", actorId: actor.userId, before: { status: task.status }, after: { status: CalendarTaskStatus.IN_PROGRESS, plannedCompletionAt, comment: comment.slice(0, 1000) } } });
    return updated;
  });
}

export async function submitMandatoryTaskResult(actor: CalendarActor, taskId: number, resultText: string, file?: File | null) {
  const normalizedText = resultText.trim().slice(0, 8000);
  if (!normalizedText && (!file || file.size === 0)) throw new Error("RESULT_REQUIRED");
  let uploaded: { pathname: string; fileName: string; contentType: string; size: number } | null = null;
  if (file && file.size > 0) {
    const fileName = safeName(file.name);
    if (!allowedTypes.has(file.type) || file.size > MAX_TASK_RESULT_SIZE) throw new Error("INVALID_RESULT_FILE");
    const bytes = Buffer.from(await file.arrayBuffer());
    const blob = await put(`task-results/${taskId}/${randomUUID()}-${fileName}`, bytes, { access: "private", contentType: file.type, addRandomSuffix: false, allowOverwrite: false, maximumSizeInBytes: MAX_TASK_RESULT_SIZE });
    uploaded = { pathname: blob.pathname, fileName, contentType: file.type, size: bytes.byteLength };
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const task = await tx.calendarTask.findFirst({ where: { id: taskId, assigneeId: actor.userId, acknowledgementRequired: true, acknowledgedAt: { not: null }, resultSubmittedAt: null, status: { not: CalendarTaskStatus.CANCELLED } }, select: { id: true, status: true } });
      if (!task) throw new Error("TASK_NOT_FOUND");
      const now = new Date();
      if (uploaded) await tx.calendarTaskResultAttachment.create({ data: { taskId, uploadedById: actor.userId, ...uploaded } });
      const updated = await tx.calendarTask.update({ where: { id: taskId }, data: { resultText: normalizedText || null, resultSubmittedAt: now, completedAt: now, completedById: actor.userId, status: CalendarTaskStatus.COMPLETED }, select });
      await tx.calendarTaskAudit.create({ data: { taskId, action: "RESULT_SUBMITTED", actorId: actor.userId, before: { status: task.status }, after: { status: CalendarTaskStatus.COMPLETED, resultText: normalizedText || null, attachment: uploaded?.fileName ?? null } } });
      return updated;
    });
  } catch (error) {
    if (uploaded) await del(uploaded.pathname).catch(() => undefined);
    throw error;
  }
}

export async function getTaskResultAttachment(actor: CalendarActor, id: number) {
  const attachment = await prisma.calendarTaskResultAttachment.findFirst({
    where: {
      id,
      ...(actor.role === Role.DIRECTOR ? {} : { task: { OR: [{ assigneeId: actor.userId }, { creatorId: actor.userId }] } }),
    },
    select: { pathname: true, fileName: true, contentType: true, size: true },
  });
  if (!attachment) return null;
  const blob = await get(attachment.pathname, { access: "private" });
  return blob?.statusCode === 200 ? { attachment, blob } : null;
}
