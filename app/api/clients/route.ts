import { Prisma, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

const amount = (value: unknown) => { if (typeof value === "string" && !value.trim()) return 0; const result = Number(value); return Number.isFinite(result) && result >= 0 ? result : null; };
const text = (value: unknown, required = false) => typeof value === "string" && (!required || value.trim()) ? value.trim() : null;

export async function GET(request: Request) {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  const search = params.get("search")?.trim();
  const city = params.get("city")?.trim();
  const manager = params.get("manager")?.trim();
  const status = params.get("status")?.trim();
  const source = params.get("source")?.trim();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(params.get("limit")) || 20));
  const where: Prisma.ClientWhereInput = {
    ...(params.get("active") === "false" ? { active: false } : { active: true }),
    ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { phone: { contains: search } }, { whatsapp: { contains: search } }, { city: { contains: search, mode: "insensitive" } }, { address: { contains: search, mode: "insensitive" } }] } : {}),
    ...(city ? { city } : {}), ...(manager ? { manager } : {}), ...(status ? { status } : {}), ...(source ? { source } : {}),
  };
  const [data, total, cities, managers, statuses, sources] = await Promise.all([
    prisma.client.findMany({ where, include: { _count: { select: { orders: true, interactions: true } }, interactions: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.client.count({ where }),
    prisma.client.findMany({ where: { active: true, city: { not: "" } }, distinct: ["city"], select: { city: true }, orderBy: { city: "asc" } }),
    prisma.client.findMany({ where: { active: true, manager: { not: "" } }, distinct: ["manager"], select: { manager: true }, orderBy: { manager: "asc" } }),
    prisma.client.findMany({ where: { active: true, status: { not: "" } }, distinct: ["status"], select: { status: true }, orderBy: { status: "asc" } }),
    prisma.client.findMany({ where: { active: true, source: { not: "" } }, distinct: ["source"], select: { source: true }, orderBy: { source: "asc" } }),
  ]);
  return NextResponse.json({ data, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }, filters: { cities: cities.map(({ city: value }) => value), managers: managers.map(({ manager: value }) => value), statuses: statuses.map(({ status: value }) => value), sources: sources.map(({ source: value }) => value) } });
}

export async function POST(request: Request) {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  if (auth.session!.user.role === Role.PARTNER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const name = text(body.name, true), phone = text(body.phone, true), city = text(body.city, true), manager = text(body.manager, true), estimatedAmount = amount(body.estimatedAmount ?? body.amount ?? 0);
    if (!name || !phone || !city || !manager || estimatedAmount === null) return NextResponse.json({ error: "Заполните ФИО, телефон, город и менеджера" }, { status: 400 });
    const client = await prisma.client.create({ data: { name, phone, whatsapp: text(body.whatsapp) ?? phone, city, address: text(body.address) ?? "", manager, amount: String(estimatedAmount), estimatedAmount: String(estimatedAmount), estimateNotes: text(body.estimateNotes) ?? "", source: text(body.source) ?? "Не указан", comment: text(body.comment) ?? "", status: text(body.status) ?? "Новый" } });
    return NextResponse.json(client, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    return NextResponse.json({ error: "Ошибка создания клиента" }, { status: 500 });
  }
}
