import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { Role } from "@/lib/roles";
import { enterTenantFromSession } from "@/lib/tenant-context";

export async function requireWorkScheduleLeadership() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !session.user.role || !enterTenantFromSession(session))
    return { response: NextResponse.json({ error: "Сессия завершена", code: "SESSION_INVALID" }, { status: 401 }) };
  const role = (session.user.accountRole || session.user.role) as Role;
  if (role !== Role.DIRECTOR && role !== Role.OPERATIONS_DIRECTOR)
    return { response: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) };
  return { response: undefined, session, role };
}
