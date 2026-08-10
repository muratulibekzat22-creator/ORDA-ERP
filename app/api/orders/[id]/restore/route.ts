import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import {
  OrderDeletionError,
  restoreOrder,
} from "@/lib/services/order-deletion.service";

type Context = { params: Promise<{ id: string }> };

export async function POST(_: Request, { params }: Context) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });

  try {
    return NextResponse.json(
      await restoreOrder(
        {
          userId: Number(auth.session!.user.id),
          role: auth.session!.user.role as Role,
          name: auth.session!.user.name ?? "Сотрудник",
        },
        id,
      ),
    );
  } catch (error) {
    if (error instanceof OrderDeletionError) {
      if (error.message === "FORBIDDEN")
        return NextResponse.json(
          { error: "Недостаточно прав" },
          { status: 403 },
        );
      if (error.message === "NOT_FOUND")
        return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Не удалось восстановить заказ" },
      { status: 500 },
    );
  }
}
