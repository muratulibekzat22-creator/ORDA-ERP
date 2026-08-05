import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { isProductionStage } from "@/lib/production/stage-policy";
import { requirePermission } from "@/lib/server-auth";
import {
  createProductionCommand,
  getProductions,
  ProductionServiceError,
  type ProductionActor,
  type ProductionWriteData,
  updateProductionCommand,
} from "@/lib/services/production.service";

function actorFromSession(session: { user: { id: string; role: string; name?: string | null } }): ProductionActor {
  return { role: session.user.role as Role, userId: Number(session.user.id), name: session.user.name ?? null };
}

function parseDate(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseWriteData(values: Record<string, unknown>): ProductionWriteData | null {
  const data: ProductionWriteData = {};
  if (values.stage !== undefined) {
    if (!isProductionStage(values.stage)) return null;
    data.stage = values.stage;
  }
  if (values.percent !== undefined) {
    const percent = Number(values.percent);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) return null;
    data.percent = percent;
  }
  if (values.masterUserId !== undefined) {
    const masterUserId = Number(values.masterUserId);
    if (!Number.isInteger(masterUserId) || masterUserId <= 0) return null;
    data.masterUserId = masterUserId;
  }
  if (values.priority !== undefined) {
    const priority = Number(values.priority);
    if (!Number.isInteger(priority) || priority < 0 || priority > 999) return null;
    data.priority = priority;
  }
  if (values.comment !== undefined) {
    if (typeof values.comment !== "string" || values.comment.length > 2000) return null;
    data.comment = values.comment.trim();
  }
  for (const field of ["startDate", "finishDate", "plannedStartAt", "plannedEndAt"] as const) {
    if (values[field] === undefined) continue;
    const date = parseDate(values[field]);
    if (date === undefined) return null;
    data[field] = date;
  }
  if (data.plannedStartAt && data.plannedEndAt && data.plannedEndAt < data.plannedStartAt) return null;
  return data;
}

function serviceError(error: unknown) {
  if (!(error instanceof ProductionServiceError)) return null;
  if (error.code === "FORBIDDEN") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  if (error.code === "INVALID_ASSIGNEE") return NextResponse.json({ error: "Пользователь не может быть назначен на этот этап" }, { status: 409 });
  if (error.code === "INVALID_STAGE") return NextResponse.json({ error: "Недопустимый переход этапа" }, { status: 409 });
  return NextResponse.json({ error: "Idempotency-Key уже использован с другим payload" }, { status: 409 });
}

export async function GET() {
  const auth = await requirePermission("production");
  if (auth.response) return auth.response;
  try {
    return NextResponse.json(await getProductions(actorFromSession(auth.session!)));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Ошибка загрузки производства" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission("production");
  if (auth.response) return auth.response;
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Некорректные данные производства" }, { status: 400 });
    const values = body as Record<string, unknown>;
    const orderId = Number(values.orderId);
    const data = parseWriteData(values);
    if (!Number.isInteger(orderId) || orderId <= 0 || !data?.stage || data.percent === undefined || !data.masterUserId) {
      return NextResponse.json({ error: "Некорректные данные производства" }, { status: 400 });
    }
    const result = await createProductionCommand({
      orderId,
      data: { ...data, stage: data.stage, percent: data.percent, masterUserId: data.masterUserId },
      actor: actorFromSession(auth.session!),
      idempotencyKey: idempotency.key,
      requestHash: createRequestHash(body),
    });
    if (!result) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    return NextResponse.json(result.production, { status: result.created ? 201 : 200 });
  } catch (error) {
    const response = serviceError(error);
    if (response) return response;
    console.error(error);
    return NextResponse.json({ error: "Ошибка создания производства" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requirePermission("production");
  if (auth.response) return auth.response;
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Некорректные данные производства" }, { status: 400 });
    const values = body as Record<string, unknown>;
    const id = Number(values.id);
    const data = parseWriteData(values);
    if (!Number.isInteger(id) || id <= 0 || !data || Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Некорректные данные производства" }, { status: 400 });
    }
    const production = await updateProductionCommand({
      id,
      data,
      actor: actorFromSession(auth.session!),
      idempotencyKey: idempotency.key,
      requestHash: createRequestHash(body),
    });
    if (!production) return NextResponse.json({ error: "Производство не найдено" }, { status: 404 });
    return NextResponse.json(production);
  } catch (error) {
    const response = serviceError(error);
    if (response) return response;
    console.error(error);
    return NextResponse.json({ error: "Ошибка обновления производства" }, { status: 500 });
  }
}
