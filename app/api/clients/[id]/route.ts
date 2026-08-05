import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

type Context = { params: Promise<{ id: string }> };
const idOf = (value: string) => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; };

export async function GET(_: Request, { params }: Context) {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  const id = idOf((await params).id);
  if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const client = await prisma.client.findUnique({ where: { id }, include: { orders: { include: { payments: { select: { amount: true } } }, orderBy: { createdAt: "desc" } }, interactions: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } }, attachments: { select: { id: true, clientId: true, fileName: true, contentType: true, size: true, createdAt: true, uploadedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } } } });
  return client ? NextResponse.json(client) : NextResponse.json({ error: "Клиент не найден" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: Context) {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  const id = idOf((await params).id);
  if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const data: Prisma.ClientUpdateInput = {};
    for (const key of ["name", "phone", "whatsapp", "city", "address", "manager", "estimateNotes", "source", "comment", "status"] as const) if (typeof body[key] === "string") data[key] = body[key].trim();
    if (["name", "phone", "city", "manager"].some((key) => key in body && !String(body[key]).trim())) return NextResponse.json({ error: "Обязательные поля не могут быть пустыми" }, { status: 400 });
    if ("estimatedAmount" in body) { const value = Number(body.estimatedAmount); if (!Number.isFinite(value) || value < 0) return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 }); data.estimatedAmount = String(value); data.amount = String(value); }
    const client = await prisma.client.update({ where: { id }, data });
    return NextResponse.json(client);
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    return NextResponse.json({ error: "Клиент не найден или данные некорректны" }, { status: 404 });
  }
}

export async function DELETE(_: Request, { params }: Context) {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  const id = idOf((await params).id);
  if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const client = await prisma.client.findUnique({ where: { id }, select: { _count: { select: { orders: true, attachments: true } } } });
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 });
  if (client._count.orders || client._count.attachments) return NextResponse.json({ error: "Нельзя удалить клиента с заказами или файлами" }, { status: 409 });
  await prisma.client.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
