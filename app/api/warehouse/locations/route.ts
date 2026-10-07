import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import { getWarehouseLocations } from "@/lib/services/warehouse-retail.service";
import { WarehouseError, type WarehouseActor } from "@/lib/services/warehouse.service";

export async function GET() {
  const auth = await requirePermission("warehouse");
  if (auth.response) return auth.response;
  const actor: WarehouseActor = { userId: Number(auth.session!.user.id), role: auth.session!.user.role as Role, name: auth.session!.user.name ?? null };
  try {
    return NextResponse.json({ locations: await getWarehouseLocations(actor) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof WarehouseError && error.code === "FORBIDDEN" ? "Недостаточно прав" : "Не удалось получить места хранения" }, { status: error instanceof WarehouseError && error.code === "FORBIDDEN" ? 403 : 500 });
  }
}
