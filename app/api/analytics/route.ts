import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { getAnalytics } from "@/lib/services/analytics.service";
import { requirePermission } from "@/lib/server-auth";

export async function GET(request: Request) {
  const auth = await requirePermission("reports"); if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const p = new URL(request.url).searchParams;
  const from = p.get("from") ? new Date(p.get("from")!) : undefined, to = p.get("to") ? new Date(p.get("to")!) : undefined;
  if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime()))) return NextResponse.json({ error: "Некорректный период" }, { status: 400 });
  try { return NextResponse.json(await getAnalytics({ period: p.get("period") ?? "month", from, to, manager: role === Role.DIRECTOR ? p.get("manager") || undefined : undefined, city: p.get("city") || undefined, status: p.get("status") || undefined, role, managerUserId: Number(auth.session!.user.id) })); }
  catch (error) { console.error(error); return NextResponse.json({ error: "Ошибка аналитики" }, { status: 500 }); }
}
