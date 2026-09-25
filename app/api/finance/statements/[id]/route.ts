import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { logRequestFailure } from "@/lib/observability";
import { requirePermission } from "@/lib/server-auth";
import { applyStatementDecisions, type StatementDecision } from "@/lib/services/bank-statement.service";

export const runtime = "nodejs";
export const maxDuration = 60;

function allowed(role: Role) {
  return role === Role.DIRECTOR || role === Role.OPERATIONS_DIRECTOR || role === Role.ACCOUNTANT;
}

function positiveId(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function optionalId(value: unknown) {
  return value === undefined || value === null || value === "" ? null : positiveId(value);
}

function decision(value: unknown): StatementDecision | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const transactionId = positiveId(item.transactionId);
  const action = item.action === "POST" || item.action === "SKIP" ? item.action : null;
  const kind = item.kind === "CLIENT_PAYMENT" || item.kind === "INCOME" || item.kind === "EXPENSE" ? item.kind : undefined;
  const orderId = optionalId(item.orderId);
  const clientId = optionalId(item.clientId);
  const categoryId = optionalId(item.categoryId);
  const recurringExpensePlanId = optionalId(item.recurringExpensePlanId);
  if (!transactionId || !action || [orderId, clientId, categoryId, recurringExpensePlanId].includes(null) && [item.orderId, item.clientId, item.categoryId, item.recurringExpensePlanId].some((raw, index) => raw != null && raw !== "" && [orderId, clientId, categoryId, recurringExpensePlanId][index] === null)) return null;
  if (action === "POST" && !kind) return null;
  return { transactionId, action, kind, orderId, clientId, categoryId, recurringExpensePlanId, rememberRule: item.rememberRule === true };
}

const errors: Record<string, string> = {
  INVALID_STATEMENT_DECISION: "Проверьте тип операции и обязательные поля.",
  ORDER_NOT_FOUND: "Заказ не найден или закрыт.",
  CLIENT_NOT_FOUND: "Клиент не найден.",
  CATEGORY_NOT_FOUND: "Категория не найдена или находится в архиве.",
  PAYMENT_EXCEEDS_BALANCE: "Поступление превышает текущий остаток по заказу.",
  RECURRING_PLAN_MISMATCH: "Сумма или категория не совпадает с постоянным расходом.",
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("finance");
  if (auth.response) return auth.response;
  if (!allowed(auth.session!.user.role as Role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const { id } = await context.params;
  const importId = positiveId(id);
  if (!importId) return NextResponse.json({ error: "Некорректный импорт" }, { status: 400 });
  try {
    const body = await request.json() as { decisions?: unknown[] };
    if (!Array.isArray(body.decisions) || body.decisions.length === 0 || body.decisions.length > 2_000)
      return NextResponse.json({ error: "Выберите от 1 до 2 000 операций" }, { status: 400 });
    const decisions = body.decisions.map(decision);
    if (decisions.some((item) => !item)) return NextResponse.json({ error: "Некорректное решение по операции" }, { status: 400 });
    const result = await applyStatementDecisions(importId, decisions as StatementDecision[], { userId: Number(auth.session!.user.id), name: auth.session!.user.name ?? "System" });
    return NextResponse.json({ ...result, results: result.results.map((item) => ({ ...item, error: item.error ? errors[item.error] ?? "Не удалось провести операцию" : undefined })) });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    if (error instanceof Error && error.message === "STATEMENT_IMPORT_NOT_FOUND") return NextResponse.json({ error: "Импорт не найден" }, { status: 404 });
    logRequestFailure("bank_statement.post_failed", request, error);
    return NextResponse.json({ error: "Не удалось провести операции выписки" }, { status: 500 });
  }
}
