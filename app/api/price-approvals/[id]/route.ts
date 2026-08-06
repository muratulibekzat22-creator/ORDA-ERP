import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR) return NextResponse.json({ error: "Только директор принимает решение" }, { status: 403 });
  const id = Number((await params).id);
  try {
    const body = await request.json() as Record<string, unknown>, status = String(body.status ?? "");
    if (!["APPROVED", "REJECTED", "COUNTER_OFFER"].includes(status)) return NextResponse.json({ error: "Некорректное решение" }, { status: 400 });
    const row = await prisma.priceApprovalRequest.findUnique({ where: { id } });
    if (!row || row.status !== "PENDING") return NextResponse.json({ error: "Запрос уже обработан или не найден" }, { status: 409 });
    const approved = status === "APPROVED" ? Number(row.requestedSalePrice) : status === "COUNTER_OFFER" ? Number(body.approvedSalePrice) : null;
    if (status === "COUNTER_OFFER" && (!Number.isFinite(approved) || approved! <= 0 || approved! > Number(row.currentSalePrice))) return NextResponse.json({ error: "Некорректная встречная цена" }, { status: 400 });
    const updated = await prisma.priceApprovalRequest.update({ where: { id }, data: { status, approvedSalePrice: approved, reviewedAt: new Date(), reviewedByUserId: Number(auth.session!.user.id), reviewedByName: auth.session!.user.name ?? "Директор", comment: String(body.comment ?? row.comment ?? "").slice(0, 1000) || null } });
    return NextResponse.json(updated);
  } catch { return NextResponse.json({ error: "Не удалось сохранить решение" }, { status: 409 }); }
}
