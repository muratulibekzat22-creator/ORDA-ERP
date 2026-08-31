import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/server-auth";
import { OperationsError, updateOperationalWorkItem } from "@/lib/services/operations.service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperationsAccess();
  if (auth.response) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "Некорректная задача" }, { status: 400 });
  try {
    const body = await request.json() as Record<string, unknown>;
    return NextResponse.json(await updateOperationalWorkItem({
      userId: Number(auth.session!.user.id),
      role: auth.session!.user.role as Role,
      name: auth.session!.user.name ?? "Сотрудник",
      ordaProjectOperationsEnabled: auth.session!.user.ordaProjectOperationsEnabled,
      companyOperationsEnabled: auth.session!.user.companyOperationsEnabled,
    }, id, body));
  } catch (error) {
    const code = error instanceof OperationsError ? error.message : error instanceof SyntaxError ? "INVALID_JSON" : "WORK_ITEM_UPDATE_FAILED";
    const status = code === "FORBIDDEN" || code === "SCOPE_DISABLED" || code === "LIVE_COMPANY_REQUIRED" ? 403 : code === "WORK_ITEM_NOT_FOUND" ? 404 : code === "WORK_ITEM_UPDATE_FAILED" ? 500 : 400;
    return NextResponse.json({ error: "Не удалось обновить операционную задачу", code }, { status });
  }
}
