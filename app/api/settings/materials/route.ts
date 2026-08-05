import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireSettingsDirector } from "@/lib/settings-access";

function materialData(body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const unit = typeof body.unit === "string" ? body.unit.trim() : "";
  const price = Number(body.purchasePrice);
  if (!name || !category || !unit || name.length > 200 || category.length > 100 || unit.length > 30 || !Number.isFinite(price) || price < 0) return null;
  return { name, category, unit, lookupKey: `${name.toLocaleLowerCase("ru")}::${unit.toLocaleLowerCase("ru")}`, purchasePrice: String(price), active: typeof body.active === "boolean" ? body.active : true };
}

export async function POST(request: Request) {
  const auth = await requireSettingsDirector();
  if (auth.response) return auth.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const data = materialData(body);
    if (!data) return NextResponse.json({ error: "Некорректные данные материала" }, { status: 400 });
    const existing = await prisma.material.findFirst({ where: { name: { equals: data.name, mode: "insensitive" }, unit: data.unit }, select: { id: true } });
    if (existing) return NextResponse.json({ error: "Материал с таким названием и единицей уже существует" }, { status: 409 });
    return NextResponse.json(await prisma.material.create({ data }), { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "Материал уже существует" }, { status: 409 });
    return NextResponse.json({ error: "Не удалось создать материал" }, { status: 500 });
  }
}
