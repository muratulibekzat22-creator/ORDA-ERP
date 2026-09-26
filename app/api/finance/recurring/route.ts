import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import {
  createRecurringExpensePlan,
  getRecurringExpensePlans,
  postRecurringExpensePlan,
  updateRecurringExpensePlan,
} from "@/lib/services/recurring-expense.service";

function leadership(role: Role) {
  return role === Role.DIRECTOR || role === Role.OPERATIONS_DIRECTOR;
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, [string, number]> = {
    INVALID_PERIOD: ["Некорректный месяц", 400],
    INVALID_PLAN: ["Проверьте название, сумму, день и способ оплаты", 400],
    CATEGORY_NOT_FOUND: ["Категория расхода не найдена", 400],
    PLAN_NOT_FOUND: ["Постоянный расход не найден", 404],
    PLAN_EXISTS: ["Постоянный расход с таким названием уже существует", 409],
  };
  const mapped = messages[code] ?? ["Не удалось сохранить постоянный расход", 500];
  return NextResponse.json({ error: mapped[0] }, { status: mapped[1] });
}

export async function GET(request: Request) {
  const auth = await requirePermission("finance");
  if (auth.response) return auth.response;
  if (!leadership(auth.session!.user.role as Role) && auth.session!.user.role !== Role.ACCOUNTANT)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    return NextResponse.json(await getRecurringExpensePlans(new URL(request.url).searchParams.get("period") ?? ""));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission("finance");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "post") {
      if (!leadership(role) && role !== Role.ACCOUNTANT)
        return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
      return NextResponse.json(await postRecurringExpensePlan({
        planId: Number(body.planId),
        period: String(body.period ?? ""),
        authorId: Number(auth.session!.user.id),
      }));
    }
    if (!leadership(role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    return NextResponse.json(await createRecurringExpensePlan({
      name: String(body.name ?? ""),
      categoryId: Number(body.categoryId),
      amount: Number(body.amount),
      dayOfMonth: Number(body.dayOfMonth),
      method: String(body.method ?? ""),
      counterparty: typeof body.counterparty === "string" ? body.counterparty : null,
      comment: typeof body.comment === "string" ? body.comment : null,
    }), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const auth = await requirePermission("finance");
  if (auth.response) return auth.response;
  if (!leadership(auth.session!.user.role as Role))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("INVALID_PLAN");
    if (body.active !== undefined && typeof body.active !== "boolean")
      throw new Error("INVALID_PLAN");
    return NextResponse.json(await updateRecurringExpensePlan(id, {
      ...(body.name !== undefined ? { name: String(body.name) } : {}),
      ...(body.categoryId !== undefined ? { categoryId: Number(body.categoryId) } : {}),
      ...(body.amount !== undefined ? { amount: Number(body.amount) } : {}),
      ...(body.dayOfMonth !== undefined ? { dayOfMonth: Number(body.dayOfMonth) } : {}),
      ...(body.method !== undefined ? { method: String(body.method) } : {}),
      ...(body.counterparty !== undefined ? { counterparty: typeof body.counterparty === "string" ? body.counterparty : null } : {}),
      ...(body.comment !== undefined ? { comment: typeof body.comment === "string" ? body.comment : null } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
