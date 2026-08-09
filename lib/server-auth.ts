import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { type Permission } from "./permissions";
import { hasPermission } from "./services/permission.service";
import { Role } from "./roles";

export async function requirePermission(permission: Permission) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.invalid || !session.user.role) {
    return {
      response: NextResponse.json(
        { error: "Сессия завершена", code: "SESSION_INVALID" },
        { status: 401 },
      ),
    };
  }

  const role = session.user.role as Role;
  if (
    !Object.values(Role).includes(role) ||
    !(await hasPermission(role, permission))
  ) {
    return {
      response: NextResponse.json(
        { error: "Недостаточно прав" },
        { status: 403 },
      ),
    };
  }

  return { session };
}
