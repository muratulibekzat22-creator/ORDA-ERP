import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/server-auth";
import { getOperationsDashboard, OperationsError } from "@/lib/services/operations.service";

export async function GET() {
  const auth = await requireOperationsAccess();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json(await getOperationsDashboard({
      userId: Number(auth.session!.user.id),
      role: auth.session!.user.role as Role,
      name: auth.session!.user.name ?? "Сотрудник",
      ordaProjectOperationsEnabled: auth.session!.user.ordaProjectOperationsEnabled,
      companyOperationsEnabled: auth.session!.user.companyOperationsEnabled,
    }));
  } catch (error) {
    const code = error instanceof OperationsError ? error.message : "OPERATIONS_READ_FAILED";
    return NextResponse.json(
      { error: code === "LIVE_COMPANY_REQUIRED" ? "Операционный доступ разрешён только рабочей компании" : "Не удалось загрузить операционное управление", code },
      { status: code === "FORBIDDEN" || code === "LIVE_COMPANY_REQUIRED" ? 403 : 500 },
    );
  }
}
