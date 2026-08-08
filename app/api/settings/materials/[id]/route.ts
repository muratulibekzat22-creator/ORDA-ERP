import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireSettingsDirector } from "@/lib/settings-access";

function idFrom(value: string) { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; }

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSettingsDirector();
  if (auth.response) return auth.response;
  const id = idFrom((await params).id);
  if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const field of ["name", "category", "unit"] as const) {
      if (field in body) {
        if (typeof body[field] !== "string" || !body[field].trim()) return NextResponse.json({ error: "Некорректные данные материала" }, { status: 400 });
        data[field] = body[field].trim();
      }
    }
    if ("purchasePrice" in body) { const value = Number(body.purchasePrice); if (!Number.isFinite(value) || value < 0) return NextResponse.json({ error: "Некорректная цена" }, { status: 400 }); data.purchasePrice = String(value); }
    if ("warrantyMonths" in body) { const value = Number(body.warrantyMonths); if (!Number.isInteger(value) || value <= 0 || value > 120) return NextResponse.json({ error: "Гарантия должна быть от 1 до 120 месяцев" }, { status: 400 }); data.warrantyMonths = value; }
    if ("active" in body) { if (typeof body.active !== "boolean") return NextResponse.json({ error: "Некорректный статус" }, { status: 400 }); data.active = body.active; }
    if (!Object.keys(data).length) return NextResponse.json({ error: "Нет полей для обновления" }, { status: 400 });
    const material = await prisma.material.update({ where: { id }, data });
    return NextResponse.json(material);
  } catch { return NextResponse.json({ error: "Материал не найден или не удалось обновить" }, { status: 404 }); }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSettingsDirector();
  if (auth.response) return auth.response;
  const id = idFrom((await params).id);
  if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const material = await prisma.material.findUnique({ where: { id }, select: { _count: { select: { movements: true } } } });
  if (!material) return NextResponse.json({ error: "Материал не найден" }, { status: 404 });
  if (material._count.movements) return NextResponse.json({ error: "Нельзя удалить использованный материал" }, { status: 409 });
  await prisma.material.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
