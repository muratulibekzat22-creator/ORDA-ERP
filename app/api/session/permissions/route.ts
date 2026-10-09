import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { permissionKeys } from "@/lib/permissions";
import { getRolePermissions } from "@/lib/services/permission.service";
import { enterTenantFromSession } from "@/lib/tenant-context";
import { Role } from "@/lib/roles";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !enterTenantFromSession(session))
    return NextResponse.json({ error: "Сессия завершена" }, { status: 401 });
  const role = (session.user.accountRole || session.user.role) as Role;
  if (!Object.values(Role).includes(role))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  return NextResponse.json({ role, permissions: await getRolePermissions(role), all: permissionKeys });
}
