import { Prisma, Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { canAccessLead, normalizeLeadSource } from "@/lib/leads/domain";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import {
  ClientLifecycleError,
  deleteClientFromWork,
} from "@/lib/services/client-lifecycle.service";

type Context = { params: Promise<{ id: string }> };
const idOf = (value: string) => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; };

export async function GET(_: Request, { params }: Context) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  const id = idOf((await params).id); if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const client = await prisma.client.findUnique({ where: { id }, include: { orders: { include: { payments: { select: { amount: true } } }, orderBy: { createdAt: "desc" } }, interactions: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } }, attachments: { select: { id: true, clientId: true, fileName: true, contentType: true, size: true, createdAt: true, uploadedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } }, leadStatusHistory: { orderBy: { createdAt: "desc" } }, nextActions: { orderBy: { createdAt: "desc" } }, managerUser: { select: { id: true, name: true } }, deletedBy: { select: { id: true, name: true } } } });
  const role = auth.session!.user.role as Role;
  if (!client || !canAccessLead(role, Number(auth.session!.user.id), client) || (client.deletedAt && role !== Role.DIRECTOR)) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
  return NextResponse.json(client);
}

export async function PATCH(request: Request, { params }: Context) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  const id = idOf((await params).id); if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const body = await request.json() as Record<string, unknown>, existing = await prisma.client.findUnique({ where: { id }, select: { managerUserId: true, deletedAt: true } });
    if (!existing || existing.deletedAt || !canAccessLead(auth.session!.user.role as Role, Number(auth.session!.user.id), existing)) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
    if (["stage", "status", "manager", "managerUserId", "lostReason", "lostByUserId", "lostAt"].some((key) => key in body)) return NextResponse.json({ error: "Используйте специализированный workflow endpoint", code: "MASS_ASSIGNMENT_BLOCKED" }, { status: 400 });
    const data: Prisma.ClientUpdateInput = {};
    for (const key of ["name", "phone", "whatsapp", "city", "address", "iin", "estimateNotes", "comment"] as const) if (typeof body[key] === "string") data[key] = body[key].trim();
    if (["name", "phone", "city"].some((key) => key in body && !String(body[key]).trim())) return NextResponse.json({ error: "Обязательные поля не могут быть пустыми" }, { status: 400 });
    if ("sourceCode" in body || "source" in body) { const source = normalizeLeadSource(body.sourceCode ?? body.source); if (!source) return NextResponse.json({ error: "Некорректный источник" }, { status: 400 }); data.sourceCode = source; data.source = source; }
    if ("estimatedAmount" in body) { const value = Number(body.estimatedAmount); if (!Number.isFinite(value) || value < 0) return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 }); data.estimatedAmount = String(value); data.amount = String(value); }
    return NextResponse.json(await prisma.client.update({ where: { id }, data }));
  } catch (error) { return error instanceof SyntaxError ? NextResponse.json({ error: "Некорректный JSON" }, { status: 400 }) : NextResponse.json({ error: "Ошибка обновления заявки" }, { status: 500 }); }
}

export async function DELETE(request: Request, { params }: Context) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const id = idOf((await params).id); if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const result = await deleteClientFromWork(
      { userId: Number(auth.session!.user.id), role, name: auth.session!.user.name ?? "Сотрудник" },
      id,
      typeof body.reason === "string" ? body.reason : undefined,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ClientLifecycleError && error.message === "NOT_FOUND") return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
    return NextResponse.json({ error: "Не удалось удалить заявку из рабочего списка" }, { status: 500 });
  }
}
