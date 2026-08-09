import bcrypt from "bcrypt";
import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const auth = await requirePermission("employees");
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
    if (newPassword.length < 10 || newPassword.length > 128 || newPassword !== confirmPassword)
      return NextResponse.json({ error: "Пароли должны совпадать и содержать от 10 до 128 символов" }, { status: 400 });
    const existing = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
    await prisma.user.update({
      where: { id },
      data: {
        password: await bcrypt.hash(newPassword, 12),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        sessionVersion: { increment: 1 },
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return error instanceof SyntaxError
      ? NextResponse.json({ error: "Некорректный JSON" }, { status: 400 })
      : NextResponse.json({ error: "Не удалось изменить пароль" }, { status: 500 });
  }
}
