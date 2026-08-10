import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  type FinanceDirection,
  type ManualFinanceInput,
  updateManualFinanceEntry,
} from "@/lib/services/finance-journal.service";
import { requirePermission } from "@/lib/server-auth";

function optionalId(value: unknown) {
  if (value == null || value === "") return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : Number.NaN;
}

function payload(body: Record<string, unknown>): ManualFinanceInput | null {
  const direction =
    body.direction === "INCOME" || body.direction === "EXPENSE"
      ? (body.direction as FinanceDirection)
      : null;
  const amount = Number(body.amount);
  const categoryId = Number(body.categoryId);
  const operationDate = new Date(String(body.operationDate));
  const method =
    typeof body.method === "string" ? body.method.trim().slice(0, 40) : "";
  const orderId = optionalId(body.orderId);
  const clientId = optionalId(body.clientId);
  const partnerId = optionalId(body.partnerId);
  const employeeId = optionalId(body.employeeId);
  if (
    !direction ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isInteger(categoryId) ||
    categoryId <= 0 ||
    Number.isNaN(operationDate.getTime()) ||
    !method ||
    [orderId, clientId, partnerId, employeeId].some(Number.isNaN)
  )
    return null;
  return {
    direction,
    amount,
    categoryId,
    operationDate,
    method,
    orderId,
    clientId,
    partnerId,
    employeeId,
    counterparty:
      typeof body.counterparty === "string"
        ? body.counterparty.trim().slice(0, 200) || null
        : null,
    comment:
      typeof body.comment === "string"
        ? body.comment.trim().slice(0, 2000) || null
        : null,
  };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("finance");
  if (auth.response) return auth.response;
  if (
    auth.session!.user.role !== Role.DIRECTOR &&
    auth.session!.user.role !== Role.ACCOUNTANT
  )
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const id = Number((await context.params).id);
    const body = (await request.json()) as Record<string, unknown>;
    const input = payload(body);
    if (!Number.isInteger(id) || id <= 0 || !input)
      return NextResponse.json(
        { error: "Некорректная операция" },
        { status: 400 },
      );
    return NextResponse.json(
      await updateManualFinanceEntry(id, {
        ...input,
        authorId: Number(auth.session!.user.id),
        reason: typeof body.reason === "string" ? body.reason : undefined,
      }),
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status =
      code === "ENTRY_NOT_FOUND"
        ? 404
        : ["SYSTEM_ENTRY_IMMUTABLE", "ENTRY_VOIDED"].includes(code)
          ? 409
          : 400;
    return NextResponse.json(
      {
        error:
          code === "SYSTEM_ENTRY_IMMUTABLE"
            ? "Системную операцию исправляют в исходном разделе"
            : "Не удалось изменить операцию",
      },
      { status },
    );
  }
}
