import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  createFinanceCategory,
  type FinanceDirection,
  updateFinanceCategory,
} from "@/lib/services/finance-journal.service";
import { requirePermission } from "@/lib/server-auth";

function asDirection(value: unknown): FinanceDirection | null {
  return value === "INCOME" || value === "EXPENSE" ? value : null;
}

export async function POST(request: Request) {
  const auth = await requirePermission("finance");
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const direction = asDirection(body.direction);
    if (!direction || typeof body.name !== "string")
      return NextResponse.json(
        { error: "Некорректная категория" },
        { status: 400 },
      );
    return NextResponse.json(
      await createFinanceCategory(body.name, direction),
      { status: 201 },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return NextResponse.json(
      {
        error:
          code === "CATEGORY_EXISTS"
            ? "Категория уже существует"
            : "Не удалось создать категорию",
      },
      { status: code === "CATEGORY_EXISTS" ? 409 : 400 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requirePermission("finance");
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = Number(body.id);
    if (
      !Number.isInteger(id) ||
      id <= 0 ||
      (body.name !== undefined && typeof body.name !== "string") ||
      (body.active !== undefined && typeof body.active !== "boolean")
    )
      return NextResponse.json(
        { error: "Некорректная категория" },
        { status: 400 },
      );
    return NextResponse.json(
      await updateFinanceCategory(id, {
        name: body.name as string | undefined,
        active: body.active as boolean | undefined,
      }),
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status =
      code === "CATEGORY_NOT_FOUND"
        ? 404
        : code === "CATEGORY_EXISTS" || code === "SYSTEM_CATEGORY_IMMUTABLE"
          ? 409
          : 400;
    return NextResponse.json(
      {
        error:
          code === "SYSTEM_CATEGORY_IMMUTABLE"
            ? "Базовую категорию нельзя изменить"
            : "Не удалось изменить категорию",
      },
      { status },
    );
  }
}
