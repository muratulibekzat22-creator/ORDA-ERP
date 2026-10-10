import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { type Permission } from "./permissions";
import { hasPermission } from "./services/permission.service";
import { Role } from "./roles";
import { enterTenantFromSession } from "./tenant-context";

export async function requireAuthenticatedSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !session.user.role || !enterTenantFromSession(session)) {
    return {
      response: NextResponse.json(
        { error: "Сессия завершена", code: "SESSION_INVALID" },
        { status: 401 },
      ),
    };
  }

  const role = (session.user.accountRole || session.user.role) as Role;
  if (!Object.values(Role).includes(role)) {
    return {
      response: NextResponse.json(
        { error: "Сессия завершена", code: "SESSION_INVALID" },
        { status: 401 },
      ),
    };
  }

  // `requirePermission` is awaited by route handlers. Re-enter the tenant from
  // a synchronous getter in the caller's async chain so Prisma and raw-query
  // helpers share the same request context after this helper returns.
  const activate = () => {
    if (!enterTenantFromSession(session)) throw new Error("TENANT_CONTEXT_REQUIRED");
  };
  return {
    get response(): undefined {
      activate();
      return undefined;
    },
    get session() {
      activate();
      return session;
    },
  };
}

export async function requireInternalEmployee() {
  const auth = await requireAuthenticatedSession();
  if (auth.response) return auth;
  const role = (auth.session!.user.accountRole || auth.session!.user.role) as Role;
  if (role === Role.PARTNER) {
    return {
      response: NextResponse.json(
        { error: "Недостаточно прав" },
        { status: 403 },
      ),
    };
  }
  return auth;
}

export async function requirePermission(permission: Permission) {
  const auth = await requireAuthenticatedSession();
  if (auth.response) return auth;
  const role = (auth.session!.user.accountRole || auth.session!.user.role) as Role;
  if (!(await hasPermission(role, permission))) {
    return {
      response: NextResponse.json(
        { error: "Недостаточно прав" },
        { status: 403 },
      ),
    };
  }
  return auth;
}
