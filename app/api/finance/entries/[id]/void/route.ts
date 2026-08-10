import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { voidManualFinanceEntry } from "@/lib/services/finance-journal.service";
import { requirePermission } from "@/lib/server-auth";

export async function POST(
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
    const body = (await request.json()) as { reason?: unknown };
    if (
      !Number.isInteger(id) ||
      id <= 0 ||
      typeof body.reason !== "string" ||
      !body.reason.trim()
    )
      return NextResponse.json(
        { error: "Укажите причину отмены" },
        { status: 400 },
      );
    return NextResponse.json(
      await voidManualFinanceEntry(
        id,
        body.reason,
        Number(auth.session!.user.id),
      ),
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status =
      code === "ENTRY_NOT_FOUND"
        ? 404
        : code === "SYSTEM_ENTRY_IMMUTABLE"
          ? 409
          : 400;
    return NextResponse.json(
      {
        error:
          code === "SYSTEM_ENTRY_IMMUTABLE"
            ? "Системную операцию исправляют в исходном разделе"
            : "Не удалось отменить операцию",
      },
      { status },
    );
  }
}
