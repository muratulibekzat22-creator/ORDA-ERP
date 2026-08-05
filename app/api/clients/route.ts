import { Prisma, Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

const amount = (value: unknown) => { if (typeof value === "string" && !value.trim()) return null; const result = Number(value); return Number.isFinite(result) && result >= 0 ? result : null; };
const text = (value: unknown, required = false) => typeof value === "string" && (!required || value.trim()) ? value.trim() : null;

export async function GET(request: Request) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams, search = params.get("search")?.trim(), city = params.get("city")?.trim(), manager = params.get("manager")?.trim();
  const where: Prisma.ClientWhereInput = { ...(params.get("active") === "false" ? { active: false } : { active: true }), ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { phone: { contains: search } }] } : {}), ...(city ? { city } : {}), ...(manager ? { manager } : {}) };
  const [data, total, cities, managers] = await Promise.all([prisma.client.findMany({ where, include: { _count: { select: { orders: true } } }, orderBy: { createdAt: "desc" } }), prisma.client.count({ where }), prisma.client.findMany({ distinct: ["city"], select: { city: true }, orderBy: { city: "asc" } }), prisma.client.findMany({ distinct: ["manager"], select: { manager: true }, orderBy: { manager: "asc" } })]);
  return NextResponse.json({ data, pagination: { total }, filters: { cities: cities.map((item) => item.city), managers: managers.map((item) => item.manager) } });
}

export async function POST(request: Request) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response; if (auth.session!.user.role === Role.PARTNER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try { const body = await request.json() as Record<string, unknown>; const name = text(body.name, true), phone = text(body.phone, true), city = text(body.city, true), manager = text(body.manager, true), estimatedAmount = amount(body.estimatedAmount ?? body.amount ?? 0); if (!name || !phone || !city || !manager || estimatedAmount === null) return NextResponse.json({ error: "Некорректные данные клиента" }, { status: 400 }); const client = await prisma.client.create({ data: { name, phone, city, manager, amount: String(estimatedAmount), estimatedAmount: String(estimatedAmount), estimateNotes: text(body.estimateNotes) ?? "", source: text(body.source) ?? "", comment: text(body.comment) ?? "", status: "Новый" } }); return NextResponse.json(client, { status: 201 }); } catch (error) { if (error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 }); return NextResponse.json({ error: "Ошибка создания клиента" }, { status: 500 }); }
}
