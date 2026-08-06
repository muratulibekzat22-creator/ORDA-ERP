import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.MANAGER && auth.session!.user.role !== Role.DIRECTOR) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const clientId = Number((await params).id);
  try {
    const body = await request.json() as Record<string, unknown>;
    const oldPrice = Number(body.oldPrice), proposedPrice = Number(body.proposedPrice), standardPrice = Number(body.standardPrice), nextActionAt = new Date(String(body.nextActionAt));
    if (![oldPrice, proposedPrice, standardPrice].every((v) => Number.isFinite(v) && v > 0) || Number.isNaN(nextActionAt.getTime())) return NextResponse.json({ error: "Проверьте цену и дату контакта" }, { status: 400 });
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client || (auth.session!.user.role === Role.MANAGER && client.manager !== auth.session!.user.name)) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
    const followUp = await prisma.$transaction(async (tx) => {
      const created = await tx.leadFollowUp.create({ data: { clientId, calculationId: body.calculationId ? Number(body.calculationId) : null, proposalId: body.proposalId ? Number(body.proposalId) : null, oldPrice, proposedPrice, standardPrice, discount: standardPrice - proposedPrice, reason: String(body.reason ?? "Клиент сказал: дорого").slice(0, 300), comment: String(body.comment ?? "").slice(0, 1000) || null, channel: ["WhatsApp", "Звонок"].includes(String(body.channel)) ? String(body.channel) : "WhatsApp", managerUserId: Number(auth.session!.user.id), managerName: auth.session!.user.name ?? client.manager, nextActionAt } });
      await tx.client.update({ where: { id: clientId }, data: { status: "Дорого — повторный контакт", nextContactAt: nextActionAt } });
      await tx.leadActivity.create({ data: { clientId, type: "PRICE_OBJECTION", comment: `Клиент сказал: дорого. Предложено ${proposedPrice}. Повторный контакт ${nextActionAt.toISOString()}`, authorId: Number(auth.session!.user.id), authorName: auth.session!.user.name ?? client.manager } });
      await tx.leadStatusHistory.create({ data: { clientId, fromStatus: client.status, toStatus: "Дорого — повторный контакт", authorId: Number(auth.session!.user.id), authorName: auth.session!.user.name ?? client.manager } });
      return created;
    });
    return NextResponse.json(followUp, { status: 201 });
  } catch { return NextResponse.json({ error: "Не удалось поставить повторный контакт" }, { status: 400 }); }
}
