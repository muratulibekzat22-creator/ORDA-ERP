import { EmployeeKpiKind, EmployeeKpiUnit, Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import {
  deleteEmployeeKpiTarget,
  getEmployeeKpi,
  requestEmployeeKpi,
  saveEmployeeKpiTarget,
} from "@/lib/services/employee-kpi.service";
import { enterTenantFromSession, runWithTenant } from "@/lib/tenant-context";
import { csvDocument } from "@/lib/csv";

async function context() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !enterTenantFromSession(session)) return null;
  const role = (session.user.accountRole || session.user.role) as Role;
  if (!Object.values(Role).includes(role) || role === Role.PARTNER) return null;
  return {
    actor: { userId: Number(session.user.id), role },
    tenant: {
      companyId: Number(session.user.companyId),
      companySlug: String(session.user.companySlug),
      companyName: String(session.user.companyName),
      isDemo: session.user.isDemo === true,
    },
  };
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const invalid = ["INVALID_MONTH", "INVALID_EMPLOYEE", "INVALID_TARGET", "INVALID_METRIC", "INVALID_ACTUAL", "MANAGER_PLAN_IN_SALES"].includes(code);
  const forbidden = code === "FORBIDDEN";
  return NextResponse.json({
    error: forbidden ? "Недостаточно прав" : code === "PLAN_EXISTS" ? "План уже назначен директором" : code === "MANAGER_PLAN_IN_SALES" ? "Цель менеджера по продажам назначается в плане продаж" : invalid ? "Проверьте данные KPI" : "Не удалось сохранить KPI",
  }, { status: forbidden ? 403 : invalid ? 400 : code === "PLAN_EXISTS" ? 409 : 500 });
}

export async function GET(request: Request) {
  const auth = await context();
  if (!auth) return NextResponse.json({ error: "Сессия завершена" }, { status: 401 });
  try {
    const params = new URL(request.url).searchParams;
    const month = params.get("month") ?? undefined;
    const data = await runWithTenant(auth.tenant, () => getEmployeeKpi(month, auth.actor));
    if (params.get("export") === "csv") {
      const rows = [
        ["Период", "Сотрудник", "Должность", "Показатель", "Единица", "План", "Факт", "Выполнение, %", "Источник"],
        ...data.rows.flatMap((row) => row.metrics.map((metric) => [data.month, row.name, row.position, metric.title, metric.unit, metric.target, metric.actual, metric.completionPercent, metric.source])),
      ];
      return new NextResponse(csvDocument(rows), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="employee-kpi-${data.month}.csv"` },
      });
    }
    return NextResponse.json(data);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const auth = await context();
  if (!auth) return NextResponse.json({ error: "Сессия завершена" }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const kind = body.kind as EmployeeKpiKind;
    const unit = body.unit as EmployeeKpiUnit;
    if (!Object.values(EmployeeKpiKind).includes(kind) || !Object.values(EmployeeKpiUnit).includes(unit)) throw new Error("INVALID_METRIC");
    return NextResponse.json(await runWithTenant(auth.tenant, () => saveEmployeeKpiTarget({
      month: String(body.month ?? ""),
      employeeId: Number(body.employeeId),
      code: String(body.code ?? ""),
      title: String(body.title ?? ""),
      kind,
      unit,
      target: Number(body.target),
      actual: body.actual === null || body.actual === "" || body.actual === undefined ? null : Number(body.actual),
      evidence: String(body.evidence ?? ""),
    }, auth.actor)));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await context();
  if (!auth) return NextResponse.json({ error: "Сессия завершена" }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    return NextResponse.json(await runWithTenant(auth.tenant, () => requestEmployeeKpi(
      String(body.month ?? ""), Number(body.employeeId), String(body.note ?? ""), auth.actor,
    )));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const auth = await context();
  if (!auth) return NextResponse.json({ error: "Сессия завершена" }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    return NextResponse.json(await runWithTenant(auth.tenant, () => deleteEmployeeKpiTarget({
      month: String(body.month ?? ""), employeeId: Number(body.employeeId), code: String(body.code ?? ""),
    }, auth.actor)));
  } catch (error) {
    return errorResponse(error);
  }
}
