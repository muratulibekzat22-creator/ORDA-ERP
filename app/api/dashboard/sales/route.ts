import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getDashboardSummary } from "@/lib/services/dashboard.service";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user)
    return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  const role = session.user.role as Role;
  const allowed: Role[] = [Role.DIRECTOR, Role.MANAGER, Role.ACCOUNTANT, Role.PRODUCTION, Role.INSTALLER];
  if (!allowed.includes(role))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const period = new URL(request.url).searchParams.get("period") ?? "month";
  if (!["today", "week", "month"].includes(period))
    return NextResponse.json({ error: "Некорректный период" }, { status: 400 });
  try {
    return NextResponse.json(await getDashboardSummary({ role, userId: Number(session.user.id), period }));
  } catch {
    return NextResponse.json({ error: "Не удалось загрузить показатели" }, { status: 500 });
  }
}
