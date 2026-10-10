import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import { getWarehouseItem } from "@/lib/services/warehouse.service";
import { warehouseActorFromSession } from "@/lib/warehouse-access";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("warehouse"); if (auth.response) return auth.response;
  const id = Number((await context.params).id); if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const item = await getWarehouseItem(id, warehouseActorFromSession(auth.session!)); return item ? NextResponse.json(item) : NextResponse.json({ error: "Товар не найден" }, { status: 404 });
}
