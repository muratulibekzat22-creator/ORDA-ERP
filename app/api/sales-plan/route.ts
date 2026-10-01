import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import {
  getSalesPlan,
  updateSalesPlan,
} from "@/lib/services/sales-plan.service";
import { enterTenantFromSession } from "@/lib/tenant-context";

async function authenticatedActor() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !enterTenantFromSession(session)) return null;
  const role = (session.user.accountRole || session.user.role) as Role;
  if (!([Role.DIRECTOR, Role.OPERATIONS_DIRECTOR, Role.MANAGER] as Role[]).includes(role))
    return null;
  return { userId: Number(session.user.id), role };
}

export async function GET(request: Request) {
  const actor = await authenticatedActor();
  if (!actor)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const month = new URL(request.url).searchParams.get("month") ?? undefined;
    return NextResponse.json(await getSalesPlan(month, actor));
  } catch (error) {
    const invalid = error instanceof Error && error.message === "INVALID_MONTH";
    return NextResponse.json(
      { error: invalid ? "Некорректный месяц" : "Не удалось загрузить план" },
      { status: invalid ? 400 : 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const actor = await authenticatedActor();
  if (!actor)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const month = String(body.month ?? "");
    const tiers = Array.isArray(body.tiers)
      ? (body.tiers as Array<Record<string, unknown>>).map((tier) => ({
          thresholdPercent: Number(tier.thresholdPercent),
          label: String(tier.label ?? ""),
          rewardAmount: Number(tier.rewardAmount ?? 0),
        }))
      : [];
    const managerTargets = Array.isArray(body.managerTargets)
      ? (body.managerTargets as Array<Record<string, unknown>>).map((target) => ({
          managerId: Number(target.managerId),
          revenueTarget: Number(target.revenueTarget),
          orderTarget: Number(target.orderTarget),
        }))
      : [];
    const result = await updateSalesPlan(
      month,
      {
        revenueTarget: Number(body.revenueTarget),
        orderTarget: Number(body.orderTarget),
        tiers,
        managerTargets,
      },
      actor,
    );
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    return NextResponse.json(
      {
        error:
          code === "FORBIDDEN"
            ? "Недостаточно прав"
            : code === "INVALID_MONTH" || code === "INVALID"
              ? "Проверьте значения плана"
              : "Не удалось сохранить план",
      },
      { status: code === "FORBIDDEN" ? 403 : code === "INVALID_MONTH" || code === "INVALID" ? 400 : 500 },
    );
  }
}
