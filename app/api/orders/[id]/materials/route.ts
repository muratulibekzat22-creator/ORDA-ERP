import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import { getOrderMaterials } from "@/lib/services/warehouse.service";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("warehouse"); if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role; if (role === Role.PARTNER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const id = Number((await params).id); if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  if (role === Role.PRODUCTION && !await prisma.production.findFirst({ where: { orderId: id, masterUserId: Number(auth.session!.user.id) }, select: { id: true } })) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  if (role === Role.INSTALLER && !await prisma.production.findFirst({ where: { orderId: id, masterUserId: Number(auth.session!.user.id), stage: "Монтаж" }, select: { id: true } })) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  if (!await prisma.order.findUnique({ where: { id }, select: { id: true } })) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  return NextResponse.json(await getOrderMaterials(id));
}
