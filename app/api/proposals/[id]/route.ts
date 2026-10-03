import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { scheduleProposalFollowUp } from "@/lib/leads/proposal-follow-up";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

type Context = { params: Promise<{ id: string }> };
const statuses = ["DRAFT", "GENERATED", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "Черновик", "Подготовлено", "Отправлено", "Принято", "Отклонено", "Истекло"];

export async function PATCH(request: Request, { params }: Context) {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.OPERATIONS_DIRECTOR && role !== Role.MANAGER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const id = Number((await params).id), body = await request.json() as Record<string, unknown>, status = String(body.status ?? "");
  if (!Number.isInteger(id) || !statuses.includes(status)) return NextResponse.json({ error: "Некорректный статус" }, { status: 400 });
  const current = await prisma.commercialProposal.findUnique({ where: { id }, include: { client: { select: { status: true, stage: true, managerUserId: true } } } });
  if (!current || role === Role.MANAGER && current.client.managerUserId !== Number(auth.session!.user.id)) return NextResponse.json({ error: "КП не найдено" }, { status: 404 });
  const sent = status === "SENT" || status === "Отправлено";
  const accepted = status === "ACCEPTED" || status === "Принято";
  const clientStatus = accepted ? "Готов оформить заказ" : sent ? "КП отправлено" : current.client.status;
  const sentAt = current.sentAt ?? new Date();
  const result = await prisma.$transaction(async (tx) => {
    const proposal = await tx.commercialProposal.update({ where: { id }, data: { status: sent ? "SENT" : status, sentAt: sent ? sentAt : current.sentAt, acceptedAt: accepted ? new Date() : current.acceptedAt } });
    if (clientStatus !== current.client.status || sent) {
      await tx.client.update({ where: { id: current.clientId }, data: { status: clientStatus, ...(sent ? { stage: "PROPOSAL_SENT" } : {}) } });
      await tx.leadStatusHistory.create({ data: { clientId: current.clientId, fromStatus: current.client.status, toStatus: clientStatus, fromStage: sent ? current.client.stage : undefined, toStage: sent ? "PROPOSAL_SENT" : undefined, authorId: Number(auth.session!.user.id), authorName: auth.session!.user.name ?? "Пользователь", comment: sent ? `КП №${current.number} отправлено вручную` : `Статус КП: ${status}` } });
    }
    if (sent) {
      await scheduleProposalFollowUp(tx, {
        proposalId: id,
        clientId: current.clientId,
        actorId: Number(auth.session!.user.id),
        sentAt,
      });
    }
    return proposal;
  });
  return NextResponse.json(result);
}
