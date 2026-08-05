import bcrypt from "bcrypt";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.invalid) return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (newPassword.length < 12 || newPassword.length > 128 || currentPassword === newPassword)
      return NextResponse.json({ error: "Новый пароль должен отличаться и содержать от 12 до 128 символов" }, { status: 400 });
    const user = await prisma.user.findUnique({ where: { id: Number(session.user.id) }, select: { id: true, password: true, active: true } });
    if (!user?.active || !await bcrypt.compare(currentPassword, user.password))
      return NextResponse.json({ error: "Текущий пароль указан неверно" }, { status: 400 });
    await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(newPassword, 12), passwordChangedAt: new Date(), mustChangePassword: false, sessionVersion: { increment: 1 }, failedLoginAttempts: 0, lockedUntil: null } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    return NextResponse.json({ error: "Не удалось изменить пароль" }, { status: 500 });
  }
}
