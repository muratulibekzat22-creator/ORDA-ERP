import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import { getWarehouseLocations } from "@/lib/services/warehouse-retail.service";
import { WarehouseError } from "@/lib/services/warehouse.service";
import { warehouseActorFromSession } from "@/lib/warehouse-access";

export async function GET() {
  const auth = await requirePermission("warehouse");
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({ locations: await getWarehouseLocations(warehouseActorFromSession(auth.session!)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof WarehouseError && error.code === "FORBIDDEN" ? "Недостаточно прав" : "Не удалось получить места хранения" }, { status: error instanceof WarehouseError && error.code === "FORBIDDEN" ? 403 : 500 });
  }
}
