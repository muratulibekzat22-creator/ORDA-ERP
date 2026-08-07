import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

export async function GET() {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const users = await prisma.user.findMany({ where: { active: true, role: { in: [Role.MANAGER, Role.DIRECTOR] } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
  return NextResponse.json({ users: role === Role.MANAGER ? users.filter((user) => user.id === Number(auth.session!.user.id)) : users, currentUserId: Number(auth.session!.user.id) });
}
