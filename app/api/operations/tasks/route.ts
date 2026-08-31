import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/server-auth";
import { createOperationalWorkItem, OperationsError } from "@/lib/services/operations.service";

export async function POST(request: Request) {
  const auth = await requireOperationsAccess();
  if (auth.response) return auth.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    return NextResponse.json(await createOperationalWorkItem({
      userId: Number(auth.session!.user.id),
      role: auth.session!.user.role as Role,
      name: auth.session!.user.name ?? "Сотрудник",
      ordaProjectOperationsEnabled: auth.session!.user.ordaProjectOperationsEnabled,
      companyOperationsEnabled: auth.session!.user.companyOperationsEnabled,
    }, body), { status: 201 });
  } catch (error) {
    const code = error instanceof OperationsError ? error.message : error instanceof SyntaxError ? "INVALID_JSON" : "WORK_ITEM_CREATE_FAILED";
    const status = code === "FORBIDDEN" || code === "SCOPE_DISABLED" || code === "LIVE_COMPANY_REQUIRED" ? 403 : code === "WORK_ITEM_CREATE_FAILED" ? 500 : 400;
    return NextResponse.json({ error: "Не удалось создать операционную задачу", code }, { status });
  }
}
