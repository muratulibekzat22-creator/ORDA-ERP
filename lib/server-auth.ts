import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { type Permission } from "./permissions";
import { hasPermission } from "./services/permission.service";
import { Role } from "./roles";
import { enterTenantFromSession } from "./tenant-context";
import { OperationalScope } from "@prisma/client";

export async function requirePermission(permission: Permission) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !session.user.role || !enterTenantFromSession(session)) {
    return {
      response: NextResponse.json(
        { error: "Сессия завершена", code: session?.invalidReason ?? "SESSION_INVALID" },
        { status: 401 },
      ),
    };
  }

  const role = session.user.role as Role;
  if (
    role === Role.OPERATIONS_DIRECTOR &&
    permission !== "operations" &&
    session.user.companyOperationsEnabled !== true
  ) {
    return {
      response: NextResponse.json(
        {
          error: "Область операционного доступа отключена",
          code: "OPERATIONAL_SCOPE_DISABLED",
        },
        { status: 403 },
      ),
    };
  }
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

export async function requireOperationsAccess(scope?: OperationalScope) {
  const auth = await requirePermission("operations");
  if (auth.response) return auth;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.OPERATIONS_DIRECTOR)
    return {
      response: NextResponse.json(
        { error: "Недостаточно прав", code: "OPERATIONS_FORBIDDEN" },
        { status: 403 },
      ),
    };
  if (role === Role.OPERATIONS_DIRECTOR && scope) {
    const enabled = scope === OperationalScope.ORDA_PROJECT
      ? auth.session!.user.ordaProjectOperationsEnabled
      : auth.session!.user.companyOperationsEnabled;
    if (!enabled)
      return {
        response: NextResponse.json(
          { error: "Область операционного доступа отключена", code: "OPERATIONAL_SCOPE_DISABLED" },
          { status: 403 },
        ),
      };
  }
  return auth;
}
