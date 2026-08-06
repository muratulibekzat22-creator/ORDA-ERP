import crypto from "crypto";
import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

const hash = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function GET() {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const rows = await prisma.priceApprovalRequest.findMany({
    where: role === Role.MANAGER ? { managerUserId: Number(auth.session!.user.id) } : undefined,
    include: { client: { select: { id: true, name: true, phone: true } }, calculation: true }, orderBy: { createdAt: "desc" }, take: 200,
  });
  return NextResponse.json(rows.map((row) => role === Role.DIRECTOR ? row : ({ ...row, calculation: undefined })));
}

export async function POST(request: Request) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.MANAGER) return NextResponse.json({ error: "Запрос создаёт менеджер" }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const calculationId = Number(body.calculationId), requested = Number(body.requestedSalePrice);
    if (!Number.isInteger(calculationId) || !Number.isFinite(requested) || requested <= 0) return NextResponse.json({ error: "Некорректная цена" }, { status: 400 });
    const calculation = await prisma.leadCalculation.findUnique({ where: { id: calculationId }, include: { client: true } });
    if (!calculation || calculation.client.managerUserId !== Number(auth.session!.user.id)) return NextResponse.json({ error: "Расчёт не найден" }, { status: 404 });
    if (requested >= Number(calculation.clientPrice)) return NextResponse.json({ error: "Согласование требуется только для снижения цены" }, { status: 400 });
    const created = await prisma.priceApprovalRequest.create({ data: { clientId: calculation.clientId, calculationId, proposalId: body.proposalId ? Number(body.proposalId) : null, managerUserId: Number(auth.session!.user.id), managerName: auth.session!.user.name ?? "Менеджер", standardSalePrice: calculation.baseClientPrice, currentSalePrice: calculation.clientPrice, requestedSalePrice: requested, snapshotHash: hash(calculation.snapshot), reason: String(body.reason ?? "Клиент сказал: дорого").slice(0, 300), comment: String(body.comment ?? "").slice(0, 1000) || null } });
    return NextResponse.json(created, { status: 201 });
  } catch { return NextResponse.json({ error: "Не удалось создать запрос согласования" }, { status: 409 }); }
}
