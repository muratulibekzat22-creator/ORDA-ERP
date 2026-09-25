import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getDashboardSummary } from "@/lib/services/dashboard.service";
import { enterTenantFromSession } from "@/lib/tenant-context";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !enterTenantFromSession(session))
    return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  const role = session.user.role as Role;
  const allowed: Role[] = [Role.DIRECTOR, Role.MANAGER, Role.ACCOUNTANT, Role.PRODUCTION, Role.INSTALLER];
  if (!allowed.includes(role))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const period = params.get("period") ?? "month";
  const month = params.get("month") ?? undefined;
  if (month && !/^\d{4}-\d{2}$/.test(month))
    return NextResponse.json({ error: "Некорректный месяц" }, { status: 400 });
  try {
    return NextResponse.json(await getDashboardSummary({ role, userId: Number(session.user.id), period, month }));
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_MONTH")
      return NextResponse.json({ error: "Некорректный месяц" }, { status: 400 });
    return NextResponse.json({ error: "Не удалось загрузить показатели" }, { status: 500 });
  }
}
