import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import type { Order360Actor } from "@/lib/services/order360.service";

export async function requireOrder360Actor(): Promise<{ actor?: Order360Actor; response?: NextResponse }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { response: NextResponse.json({ error: "Требуется авторизация" }, { status: 401 }) };
  const role = session.user.role as Role;
  if (!Object.values(Role).includes(role)) return { response: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) };
  return { actor: { userId: Number(session.user.id), role, name: session.user.name ?? "Система" } };
}
