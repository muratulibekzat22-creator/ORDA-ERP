import bcrypt from "bcrypt";
import { Prisma, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

const select = { id: true, name: true, email: true, phone: true, role: true, active: true, createdAt: true, lastLogin: true, mustChangePassword: true, lockedUntil: true, partnerProfile: { select: { id: true, name: true } } } as const;

export async function GET(request: Request) {
  const auth = await requirePermission("employees");
  if (auth.response) return auth.response;
  const status = new URL(request.url).searchParams.get("status") ?? "active";
  if (!(["active", "inactive", "all"] as const).includes(status as "active" | "inactive" | "all")) {
    return NextResponse.json({ error: "Некорректный фильтр статуса" }, { status: 400 });
  }
  const active = status === "all" ? undefined : status === "active";
  return NextResponse.json(
    await prisma.user.findMany({ where: active === undefined ? undefined : { active }, select, orderBy: { createdAt: "desc" } }),
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}

export async function POST(request: Request) {
  const auth = await requirePermission("employees");
  if (auth.response) return auth.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const role = body.role as Role;
    const partnerId = Number(body.partnerId);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!name || !email || !email.includes("@") || password.length < 12 || !Object.values(Role).includes(role) || (body.active !== undefined && typeof body.active !== "boolean") || (role === Role.PARTNER && (!Number.isInteger(partnerId) || partnerId <= 0))) return NextResponse.json({ error: "Проверьте обязательные поля. Пароль должен содержать не менее 12 символов" }, { status: 400 });
    const user = await prisma.$transaction(async (tx) => {
      if (role === Role.PARTNER) {
        const partner = await tx.partner.findUnique({ where: { id: partnerId }, select: { userId: true } });
        if (!partner) throw new Error("PARTNER_NOT_FOUND");
        if (partner.userId) throw new Error("PARTNER_ALREADY_LINKED");
      }
      return tx.user.create({ data: { name, email, password: await bcrypt.hash(password, 12), passwordChangedAt: new Date(), mustChangePassword: false, phone: typeof body.phone === "string" ? body.phone.trim() || null : null, role, active: typeof body.active === "boolean" ? body.active : true, partnerProfile: role === Role.PARTNER ? { connect: { id: partnerId } } : undefined }, select });
    });
    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "PARTNER_NOT_FOUND") return NextResponse.json({ error: "Партнёр не найден" }, { status: 404 });
    if (code === "PARTNER_ALREADY_LINKED" || error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "Пользователь или партнёр уже существует" }, { status: 409 });
    return NextResponse.json({ error: "Не удалось создать сотрудника" }, { status: 500 });
  }
}
