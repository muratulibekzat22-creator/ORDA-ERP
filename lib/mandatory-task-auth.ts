import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { enterTenantFromSession } from "@/lib/tenant-context";

export async function requireMandatoryTaskSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !enterTenantFromSession(session))
    return { response: NextResponse.json({ error: "Сессия завершена" }, { status: 401 }) };
  const activate = () => {
    if (!enterTenantFromSession(session)) throw new Error("TENANT_CONTEXT_REQUIRED");
  };
  return {
    get response(): undefined { activate(); return undefined; },
    get session() { activate(); return session; },
  };
}
