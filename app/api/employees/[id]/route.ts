import { Prisma, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

const select = { id: true, name: true, email: true, phone: true, role: true, active: true, createdAt: true, lastLogin: true, mustChangePassword: true, lockedUntil: true, partnerProfile: { select: { id: true, name: true } } } as const;
const idFrom = (value: string) => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; };

async function ensureDirectorRemains(activeDirector: boolean, tx: Prisma.TransactionClient) {
  if (!activeDirector) return;
  const count = await tx.user.count({ where: { role: Role.DIRECTOR, active: true } });
  if (count <= 1) throw new Error("LAST_DIRECTOR");
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("employees");
  if (auth.response) return auth.response;
  const id = idFrom((await params).id);
  if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const body = await request.json() as Record<string, unknown>;
    if ("password" in body) return NextResponse.json({ error: "Используйте защищённое действие изменения пароля" }, { status: auth.session!.user.role === Role.DIRECTOR ? 400 : 403 });
    const role = body.role === undefined ? undefined : Object.values(Role).includes(body.role as Role) ? body.role as Role : null;
    if (role === null) return NextResponse.json({ error: "Некорректная роль" }, { status: 400 });
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
    const partnerId = Number(body.partnerId);
    const updated = await prisma.$transaction(async (tx) => {
      await ensureDirectorRemains(user.role === Role.DIRECTOR && user.active && (role !== undefined && role !== Role.DIRECTOR || body.active === false), tx);
      if (role === Role.PARTNER) {
        if (!Number.isInteger(partnerId) || partnerId <= 0) throw new Error("PARTNER_REQUIRED");
        const partner = await tx.partner.findUnique({ where: { id: partnerId }, select: { userId: true } });
        if (!partner) throw new Error("PARTNER_NOT_FOUND");
        if (partner.userId && partner.userId !== id) throw new Error("PARTNER_ALREADY_LINKED");
        await tx.partner.updateMany({ where: { userId: id, id: { not: partnerId } }, data: { userId: null } });
        await tx.partner.update({ where: { id: partnerId }, data: { userId: id } });
      } else if (role && user.role === Role.PARTNER) await tx.partner.updateMany({ where: { userId: id }, data: { userId: null } });
      const accessChanged = (typeof body.active === "boolean" && body.active !== user.active) || (role !== undefined && role !== user.role);
      return tx.user.update({ where: { id }, data: { ...(typeof body.name === "string" && body.name.trim() ? { name: body.name.trim() } : {}), ...(typeof body.phone === "string" ? { phone: body.phone.trim() || null } : {}), ...(typeof body.active === "boolean" ? { active: body.active } : {}), ...(role ? { role } : {}), ...(accessChanged ? { sessionVersion: { increment: 1 } } : {}) }, select });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json(updated);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const message = code === "LAST_DIRECTOR" ? "Нельзя отключить или изменить последнего активного директора" : code === "PARTNER_REQUIRED" ? "Для роли PARTNER требуется partnerId" : code === "PARTNER_NOT_FOUND" ? "Партнёр не найден" : code === "PARTNER_ALREADY_LINKED" ? "Партнёр уже связан с пользователем" : "Не удалось обновить сотрудника";
    return NextResponse.json({ error: message }, { status: code === "LAST_DIRECTOR" || code === "PARTNER_ALREADY_LINKED" || error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" ? 409 : code.startsWith("PARTNER_") ? 400 : 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("employees");
  if (auth.response) return auth.response;
  const id = idFrom((await params).id);
  if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  if (Number(auth.session!.user.id) === id) return NextResponse.json({ error: "Нельзя удалить текущего пользователя" }, { status: 409 });
  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) throw new Error("NOT_FOUND");
      if (await tx.employeePayrollProfile.count({ where: { userId: id } })) throw new Error("PAYROLL_HISTORY");
      await ensureDirectorRemains(user.role === Role.DIRECTOR && user.active, tx);
      await tx.user.delete({ where: { id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return NextResponse.json({ error: code === "LAST_DIRECTOR" ? "Нельзя удалить последнего активного директора" : code === "PAYROLL_HISTORY" ? "Сотрудника с историей зарплаты можно только отключить" : "Сотрудник не найден" }, { status: code === "LAST_DIRECTOR" || code === "PAYROLL_HISTORY" ? 409 : 404 });
  }
}
