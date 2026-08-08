import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

type Context = { params: Promise<{ id: string }> };
const statuses = ["DRAFT", "GENERATED", "ACCEPTED", "REJECTED", "EXPIRED", "Черновик", "Подготовлено", "Принято", "Отклонено", "Истекло"];

export async function PATCH(request: Request, { params }: Context) {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const id = Number((await params).id), body = await request.json() as Record<string, unknown>, status = String(body.status ?? "");
  if (!Number.isInteger(id) || !statuses.includes(status)) return NextResponse.json({ error: "Некорректный статус" }, { status: 400 });
  const current = await prisma.commercialProposal.findUnique({ where: { id }, include: { client: { select: { status: true, managerUserId: true } } } });
  if (!current || role === Role.MANAGER && current.client.managerUserId !== Number(auth.session!.user.id)) return NextResponse.json({ error: "КП не найдено" }, { status: 404 });
  const clientStatus = status === "ACCEPTED" || status === "Принято" ? "Готов оформить заказ" : current.client.status;
  const result = await prisma.$transaction(async (tx) => {
    const proposal = await tx.commercialProposal.update({ where: { id }, data: { status, acceptedAt: status === "ACCEPTED" || status === "Принято" ? new Date() : current.acceptedAt } });
    if (clientStatus !== current.client.status) {
      await tx.client.update({ where: { id: current.clientId }, data: { status: clientStatus } });
      await tx.leadStatusHistory.create({ data: { clientId: current.clientId, fromStatus: current.client.status, toStatus: clientStatus, authorId: Number(auth.session!.user.id), authorName: auth.session!.user.name ?? "Пользователь", comment: `Статус КП: ${status}` } });
    }
    return proposal;
  });
  return NextResponse.json(result);
}
