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
  const yearValue = params.get("year");
  const monthValue = params.get("month");
  const year = yearValue === null ? null : Number(yearValue);
  const month = monthValue === null ? null : Number(monthValue);
  if (
    (year === null) !== (month === null) ||
    (year !== null && (!Number.isInteger(year) || !Number.isInteger(month) || month! < 1 || month! > 12))
  )
    return NextResponse.json({ error: "Некорректный месяц" }, { status: 400 });
  const items = await searchOrderOptions({
    role: auth.session!.user.role as Role,
    userId,
    name: auth.session!.user.name ?? "",
  }, params.get("q") ?? "", limit, year === null ? undefined : { year, month: month! });
  return NextResponse.json({ items });
}
