import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { permissionKeys, type Permission } from "@/lib/permissions";
import { getRolePermissions, replaceRolePermissions } from "@/lib/services/permission.service";
import { enterTenantFromSession } from "@/lib/tenant-context";
import { Role } from "@/lib/roles";

const founderOnly = async () => {
  const session = await getServerSession(authOptions);
  return session?.user?.accountRole === Role.DIRECTOR && enterTenantFromSession(session)
    ? session
    : null;
};

export async function GET() {
  const session = await founderOnly();
  if (!session) return NextResponse.json({ error: "Доступ только основателю" }, { status: 403 });
  return NextResponse.json({ permissions: await getRolePermissions(Role.OPERATIONS_DIRECTOR) });
}

export async function PATCH(request: Request) {
  const session = await founderOnly();
  if (!session) return NextResponse.json({ error: "Доступ только основателю" }, { status: 403 });
  const body = await request.json().catch(() => null) as { permissions?: unknown } | null;
  if (!Array.isArray(body?.permissions) || !body.permissions.every((value) => typeof value === "string" && permissionKeys.includes(value as Permission)))
    return NextResponse.json({ error: "Некорректные права" }, { status: 400 });
  const permissions = (body.permissions as Permission[]).filter((permission) => permission !== "settings");
  return NextResponse.json({ permissions: await replaceRolePermissions(Role.OPERATIONS_DIRECTOR, permissions) });
}
