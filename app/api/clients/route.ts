import { LeadSource, LeadStage, Prisma, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { normalizeLeadSource, normalizePhone } from "@/lib/leads/domain";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

const amount = (value: unknown) => { if (typeof value === "string" && !value.trim()) return 0; const result = Number(value); return Number.isFinite(result) && result >= 0 ? result : null; };
const text = (value: unknown, required = false) => typeof value === "string" && (!required || value.trim()) ? value.trim() : null;

export async function GET(request: Request) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams, role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const search = params.get("search")?.trim(), city = params.get("city")?.trim(), manager = params.get("manager")?.trim(), status = params.get("status")?.trim(), source = params.get("source")?.trim();
  const page = Math.max(1, Number(params.get("page")) || 1), limit = Math.min(100, Math.max(1, Number(params.get("limit")) || 20));
  const where: Prisma.ClientWhereInput = {
    ...(role === Role.MANAGER ? { managerUserId: Number(auth.session!.user.id) } : {}),
    ...(params.get("active") === "false" ? { active: false } : { active: true }),
    ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { phone: { contains: search } }, { whatsapp: { contains: search } }, { city: { contains: search, mode: "insensitive" } }] } : {}),
    ...(city ? { city } : {}), ...(manager ? { manager } : {}), ...(status ? { stage: status as LeadStage } : {}), ...(source ? { sourceCode: source as LeadSource } : {}),
  };
  const [data, total, cities, managers] = await Promise.all([
    prisma.client.findMany({ where, include: { _count: { select: { orders: true, interactions: true } }, nextActions: { where: { completedAt: null }, orderBy: { nextActionAt: "asc" }, take: 1 } }, orderBy: { updatedAt: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.client.count({ where }), prisma.client.findMany({ where: { active: true, city: { not: "" } }, distinct: ["city"], select: { city: true }, orderBy: { city: "asc" } }),
    prisma.client.findMany({ where: { active: true, manager: { not: "" } }, distinct: ["manager"], select: { manager: true }, orderBy: { manager: "asc" } }),
  ]);
  return NextResponse.json({ data, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }, filters: { cities: cities.map((x) => x.city), managers: managers.map((x) => x.manager), statuses: Object.values(LeadStage), sources: Object.values(LeadSource) } });
}

export async function POST(request: Request) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>, rawPhone = text(body.phone, true), city = text(body.city, true), requestText = text(body.comment) ?? text(body.estimateNotes) ?? "", estimatedAmount = amount(body.estimatedAmount ?? body.amount ?? 0);
    const normalized = rawPhone ? normalizePhone(rawPhone) : "";
    if (!normalized || !city || estimatedAmount === null) return NextResponse.json({ error: "Укажите корректный телефон WhatsApp и город" }, { status: 400 });
    const duplicate = await prisma.client.findFirst({ where: { active: true, OR: [{ phone: normalized }, { whatsapp: normalized }] }, select: { id: true, name: true, phone: true, stage: true } });
    if (duplicate && body.allowDuplicate !== true) return NextResponse.json({ error: "Клиент с таким телефоном уже существует", code: "DUPLICATE_PHONE", existingClient: duplicate }, { status: 409 });
    const managerUserId = role === Role.MANAGER ? Number(auth.session!.user.id) : Number(body.managerUserId ?? auth.session!.user.id);
    const managerUser = await prisma.user.findFirst({ where: { id: managerUserId, active: true, role: { in: [Role.MANAGER, Role.DIRECTOR] } }, select: { id: true, name: true } });
    if (!managerUser) return NextResponse.json({ error: "Некорректный ответственный менеджер" }, { status: 400 });
    const sourceCode = normalizeLeadSource(body.sourceCode ?? body.source) ?? LeadSource.WHATSAPP, name = text(body.clientName ?? body.name) ?? "";
    const client = await prisma.$transaction(async (tx) => {
      const created = await tx.client.create({ data: { name, phone: normalized, whatsapp: normalized, city, address: text(body.address) ?? "", manager: managerUser.name, managerUserId: managerUser.id, amount: String(estimatedAmount), estimatedAmount: String(estimatedAmount), estimateNotes: text(body.estimateNotes) ?? requestText, source: text(body.source) ?? sourceCode, sourceCode, comment: requestText, stage: LeadStage.NEW, status: LeadStage.NEW } });
      await tx.leadStatusHistory.create({ data: { clientId: created.id, toStatus: LeadStage.NEW, toStage: LeadStage.NEW, authorId: Number(auth.session!.user.id), authorName: auth.session!.user.name ?? managerUser.name, comment: "Обращение создано" } });
      const nextActionAt = body.nextActionAt ? new Date(String(body.nextActionAt)) : null;
      if (nextActionAt && !Number.isNaN(nextActionAt.getTime())) await tx.leadNextAction.create({ data: { clientId: created.id, nextActionType: "FOLLOW_UP", nextActionAt, createdByUserId: Number(auth.session!.user.id) } });
      return created;
    });
    return NextResponse.json(client, { status: 201 });
  } catch (error) { return error instanceof SyntaxError ? NextResponse.json({ error: "Некорректный JSON" }, { status: 400 }) : NextResponse.json({ error: "Ошибка создания заявки" }, { status: 500 }); }
}
