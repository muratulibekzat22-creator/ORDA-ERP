import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { updateSalesPlanManagerTarget } from "@/lib/services/sales-plan.service";
import { enterTenantFromSession, runWithTenant } from "@/lib/tenant-context";

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !enterTenantFromSession(session))
    return NextResponse.json({ error: "Сессия завершена" }, { status: 401 });
  const role = (session.user.accountRole || session.user.role) as Role;
  if (role !== Role.DIRECTOR && role !== Role.OPERATIONS_DIRECTOR)
    return NextResponse.json({ error: "План назначает директор" }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const revenueTarget = body.revenueTarget === null || body.revenueTarget === "" ? null : Number(body.revenueTarget);
    const orderTarget = body.orderTarget === null || body.orderTarget === "" ? null : Number(body.orderTarget);
    const result = await runWithTenant({
      companyId: Number(session.user.companyId),
      companySlug: String(session.user.companySlug),
      companyName: String(session.user.companyName),
      isDemo: session.user.isDemo === true,
    }, () => updateSalesPlanManagerTarget(
      String(body.month ?? ""),
      { managerId: Number(body.managerId), revenueTarget, orderTarget },
      { userId: Number(session.user.id), role },
    ));
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const invalid = ["INVALID_MONTH", "INVALID_MANAGER", "INVALID_TARGET"].includes(code);
    return NextResponse.json({ error: invalid ? "Проверьте месяц, менеджера и оба значения плана" : "Не удалось сохранить план менеджера" }, { status: invalid ? 400 : 500 });
  }
}
