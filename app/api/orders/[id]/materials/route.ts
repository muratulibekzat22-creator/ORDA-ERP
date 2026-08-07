import { NextResponse } from "next/server";

import { requireOrder360Actor } from "@/lib/order360-auth";
import { canAccessOrder360, Order360Error } from "@/lib/services/order360.service";
import { getOrderMaterials } from "@/lib/services/warehouse.service";
import { Role } from "@prisma/client";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOrder360Actor(); if (auth.response) return auth.response;
  const id = Number((await params).id); if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  if (auth.actor!.role === Role.PARTNER || auth.actor!.role === Role.MEASURER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    if (!await canAccessOrder360(id, auth.actor!)) throw new Order360Error("NOT_FOUND");
    return NextResponse.json(await getOrderMaterials(id, auth.actor!.role === Role.DIRECTOR || auth.actor!.role === Role.ACCOUNTANT));
  }
  catch (error) { return error instanceof Order360Error ? NextResponse.json({ error: error.message }, { status: error.message === "NOT_FOUND" ? 404 : 403 }) : NextResponse.json({ error: "ORDER_MATERIALS_FAILED" }, { status: 500 }); }
}
