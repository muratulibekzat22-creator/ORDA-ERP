import { LeadStage, Prisma, Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

export async function GET() {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const now = new Date(), start = new Date(now); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1);
  const scope: Prisma.ClientWhereInput = role === Role.MANAGER ? { managerUserId: Number(auth.session!.user.id) } : {};
  const leads = await prisma.client.findMany({ where: { ...scope, active: true, stage: { notIn: [LeadStage.WON, LeadStage.LOST] }, OR: [
    { nextActions: { some: { completedAt: null, nextActionAt: { lt: end } } } },
    { stage: LeadStage.NEW },
    { stage: LeadStage.PROPOSAL_SENT, nextActions: { none: { completedAt: null } } },
    { priceApprovals: { some: { status: "APPROVED" } }, nextActions: { none: { completedAt: null } } },
  ] }, include: { nextActions: { where: { completedAt: null }, orderBy: { nextActionAt: "asc" }, take: 1 }, priceApprovals: { where: { status: "APPROVED" }, orderBy: { reviewedAt: "desc" }, take: 1 } } });
  const items = leads.map((lead) => {
    const action = lead.nextActions[0], overdue = Boolean(action && action.nextActionAt < now), today = Boolean(action && action.nextActionAt >= start && action.nextActionAt < end);
    const kind = overdue ? "OVERDUE" : today ? "TODAY" : lead.stage === LeadStage.NEW ? "NEW" : lead.priceApprovals.length ? "APPROVED_PRICE" : "PROPOSAL_WITHOUT_FOLLOW_UP";
    const priority = overdue ? 0 : today ? 1 : lead.stage === LeadStage.NEW ? 2 : 3;
    const overdueByMs = overdue && action ? now.getTime() - action.nextActionAt.getTime() : 0;
    const overdueLabel = overdueByMs ? `Просрочено на ${overdueByMs < 3_600_000 ? `${Math.max(1, Math.floor(overdueByMs / 60_000))} мин.` : overdueByMs < 86_400_000 ? `${Math.floor(overdueByMs / 3_600_000)} ч.` : `${Math.floor(overdueByMs / 86_400_000)} дн.`}` : null;
    return { clientId: lead.id, name: lead.name, phone: lead.phone, stage: lead.stage, kind, priority, nextAction: action ?? null, overdueByMs, overdueLabel };
  }).sort((a, b) => a.priority - b.priority || (a.nextAction?.nextActionAt.getTime() ?? a.clientId) - (b.nextAction?.nextActionAt.getTime() ?? b.clientId));
  return NextResponse.json({ generatedAt: now, items });
}
