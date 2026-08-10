import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import { searchOrderOptions } from "@/lib/services/order.service";

export async function GET(request: Request) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  const limit = Number(params.get("limit") ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    return NextResponse.json({ error: "Некорректный limit" }, { status: 400 });
  const userId = Number(auth.session!.user.id);
  if (!Number.isInteger(userId) || userId <= 0)
    return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  const items = await searchOrderOptions({
    role: auth.session!.user.role as Role,
    userId,
    name: auth.session!.user.name ?? "",
  }, params.get("q") ?? "", limit);
  return NextResponse.json({ items });
}
