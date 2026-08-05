import { NextResponse } from "next/server";

import { Role } from "@/lib/roles";
import { requirePermission } from "@/lib/server-auth";

export async function requireSettingsDirector() {
  const auth = await requirePermission("settings");
  if (auth.response) return auth;
  if (auth.session!.user.role !== Role.DIRECTOR) return { response: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) };
  return auth;
}
