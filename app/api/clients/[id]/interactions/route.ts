import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

type Context = { params: Promise<{ id: string }> };
const idOf = (value: string) => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; };

export async function POST(request: Request, { params }: Context) {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  const clientId = idOf((await params).id);
  if (!clientId) return NextResponse.json({ error: "Некорректный клиент" }, { status: 400 });
  try {
    const body = await request.json() as { comment?: unknown };
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (!comment || comment.length > 2000) return NextResponse.json({ error: "Введите комментарий до 2000 символов" }, { status: 400 });
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { managerUserId: true } });
    if (!client || (auth.session!.user.role === Role.MANAGER && client.managerUserId !== Number(auth.session!.user.id)) || (auth.session!.user.role !== Role.DIRECTOR && auth.session!.user.role !== Role.MANAGER)) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 });
    const interaction = await prisma.clientInteraction.create({ data: { clientId, authorId: Number(auth.session!.user.id), authorName: auth.session!.user.name ?? "Сотрудник", comment }, include: { author: { select: { id: true, name: true } } } });
    return NextResponse.json(interaction, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    return NextResponse.json({ error: "Не удалось сохранить запись" }, { status: 500 });
  }
}
