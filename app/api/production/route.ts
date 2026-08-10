import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { logRequestFailure } from "@/lib/observability";
import { isProductionStage } from "@/lib/production/stage-policy";
import { requirePermission } from "@/lib/server-auth";
import {
  createProductionCommand,
  countProductions,
  deleteProductionCommand,
  getProduction,
  getProductionCounters,
  getProductionOptions,
  getProductions,
  ProductionServiceError,
  type ProductionActor,
  type ProductionListFilters,
  type ProductionWriteData,
  updateProductionCommand,
} from "@/lib/services/production.service";

const WRITE_FIELDS = new Set(["stage", "percent", "masterUserId", "priority", "comment", "startDate", "finishDate", "plannedStartAt", "plannedEndAt"]);

function hasOnlyFields(values: Record<string, unknown>, fields: Set<string>) {
  return Object.keys(values).every((field) => fields.has(field));
}

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
  if (error.code === "INVALID_STAGE") return NextResponse.json({ error: "Недопустимый переход этапа" }, { status: 400 });
  if (error.code === "INVALID_DATES") return NextResponse.json({ error: "Дата окончания не может быть раньше даты начала" }, { status: 400 });
  return NextResponse.json({ error: "Idempotency-Key уже использован с другим payload" }, { status: 409 });
}

export async function GET(request: Request) {
  const auth = await requirePermission("production");
  if (auth.response) return auth.response;
  try {
    const actor = actorFromSession(auth.session!);
    const params = new URL(request.url).searchParams;
    if (params.get("view") === "options") {
      return NextResponse.json(await getProductionOptions(actor));
    }
    if (params.has("id")) {
      const id = Number(params.get("id"));
      if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
      const production = await getProduction(id, actor);
      if (!production) return NextResponse.json({ error: "Производство не найдено" }, { status: 404 });
      return NextResponse.json(production);
    }
    const page = params.has("page") ? Number(params.get("page")) : null;
    const limit = params.has("limit") ? Number(params.get("limit")) : 50;
    if ((page !== null && (!Number.isInteger(page) || page < 1)) || !Number.isInteger(limit) || limit < 1 || limit > 100)
      return NextResponse.json({ error: "Invalid pagination" }, { status: 400 });
    const positiveId = (value: string | null) => { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined; };
    const stageValue = params.get("stage");
    const priorityValue = params.get("priority");
    const from = params.get("from") ? new Date(params.get("from")!) : undefined;
    const to = params.get("to") ? new Date(params.get("to")!) : undefined;
    if ((stageValue && !isProductionStage(stageValue)) ||
        (params.has("assigneeId") && !positiveId(params.get("assigneeId"))) ||
        (params.has("partnerId") && !positiveId(params.get("partnerId"))) ||
        (priorityValue && (!Number.isInteger(Number(priorityValue)) || Number(priorityValue) < 0 || Number(priorityValue) > 999)) ||
        (from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from >= to))
      return NextResponse.json({ error: "Некорректные фильтры" }, { status: 400 });
    const filters: ProductionListFilters = {
      query: params.get("query")?.trim().slice(0, 120) || undefined,
      stage: stageValue && isProductionStage(stageValue) ? stageValue : undefined,
      assigneeId: positiveId(params.get("assigneeId")),
      partnerId: positiveId(params.get("partnerId")),
      priority: priorityValue ? Number(priorityValue) : undefined,
      overdueOnly: params.get("overdue") === "1",
      from,
      to,
    };
    const [items, total, counters] = await Promise.all([
      getProductions(actor, { skip: page === null ? 0 : (page - 1) * limit, take: page === null ? 100 : limit, filters }),
      page === null ? Promise.resolve(null) : countProductions(actor, filters),
      getProductionCounters(actor, filters),
    ]);
    return NextResponse.json(page === null ? items : { data: items, counters, pagination: { page, limit, total, totalPages: Math.ceil((total ?? 0) / limit) } });
  } catch (error) {
    logRequestFailure("production.list.failed", request, error);
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
    if (!hasOnlyFields(values, new Set(["orderId", ...WRITE_FIELDS]))) return NextResponse.json({ error: "Недопустимые поля запроса" }, { status: 400 });
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
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    const response = serviceError(error);
    if (response) return response;
    logRequestFailure("production.create.failed", request, error);
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
    if (!hasOnlyFields(values, new Set(["id", ...WRITE_FIELDS]))) return NextResponse.json({ error: "Недопустимые поля запроса" }, { status: 400 });
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
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    const response = serviceError(error);
    if (response) return response;
    logRequestFailure("production.update.failed", request, error);
    return NextResponse.json({ error: "Ошибка обновления производства" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requirePermission("production");
  if (auth.response) return auth.response;
  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
    const deleted = await deleteProductionCommand(id, actorFromSession(auth.session!));
    if (!deleted) return NextResponse.json({ error: "Производство не найдено" }, { status: 404 });
    return NextResponse.json(deleted);
  } catch (error) {
    const response = serviceError(error);
    if (response) return response;
    logRequestFailure("production.delete.failed", request, error);
    return NextResponse.json({ error: "Ошибка удаления производства" }, { status: 500 });
  }
}
