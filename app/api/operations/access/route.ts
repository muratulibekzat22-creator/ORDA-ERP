import { OperationalScope, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/server-auth";
import {
  extendOperationsDirectorAccess,
  grantOperationsDirectorAccess,
  OperationsError,
  revokeOperationsDirectorAccess,
  setOperationsScope,
} from "@/lib/services/operations.service";

export async function POST(request: Request) {
  const auth = await requireOperationsAccess();
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const actor = { userId: Number(auth.session!.user.id), role: Role.DIRECTOR, name: auth.session!.user.name ?? "Директор" };
    if (body.action === "grant")
      return NextResponse.json(await grantOperationsDirectorAccess(actor), { status: 201 });
    if (body.action === "extend")
      return NextResponse.json(await extendOperationsDirectorAccess(actor));
    if (body.action === "scope") {
      const scope = body.scope as OperationalScope;
      if (!Object.values(OperationalScope).includes(scope) || typeof body.enabled !== "boolean")
        return NextResponse.json({ error: "Некорректная область доступа" }, { status: 400 });
      return NextResponse.json(await setOperationsScope(actor, scope, body.enabled));
    }
    if (body.action === "revoke")
      return NextResponse.json(await revokeOperationsDirectorAccess(actor, typeof body.reason === "string" ? body.reason : ""));
    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    const code = error instanceof OperationsError ? error.message : error instanceof SyntaxError ? "INVALID_JSON" : "OPERATIONS_ACCESS_FAILED";
    const status = code === "FORBIDDEN" || code === "LIVE_COMPANY_REQUIRED" ? 403 : code === "OPERATOR_NOT_FOUND" ? 404 : code === "ACCOUNT_IN_OTHER_TENANT" ? 409 : code === "OPERATIONS_ACCESS_FAILED" ? 500 : 400;
    return NextResponse.json({ error: "Не удалось изменить операционный доступ", code }, { status });
  }
}
