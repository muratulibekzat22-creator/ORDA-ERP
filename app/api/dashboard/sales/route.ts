import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import { getDashboardSummary } from "@/lib/services/dashboard.service";

export async function GET(request: Request) {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const period = new URL(request.url).searchParams.get("period") ?? "month";
  if (!["today", "week", "month"].includes(period))
    return NextResponse.json({ error: "Некорректный период" }, { status: 400 });
  try {
    return NextResponse.json(await getDashboardSummary({ role, userId: Number(auth.session!.user.id), period }));
  } catch {
    return NextResponse.json({ error: "Не удалось загрузить показатели" }, { status: 500 });
  }
}
