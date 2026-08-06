import { LeadStage, Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Filters = { period?: string; from?: Date; to?: Date; manager?: string; managerUserId?: number; role?: Role; partnerId?: number; city?: string; status?: string };
const percent = (value: number, total: number) => total ? Math.round(value / total * 1000) / 10 : 0;
const averageMs = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;

function periodRange(filters: Filters) {
  const now = new Date(), end = filters.to ?? now, start = filters.from ? new Date(filters.from) : new Date(now);
  if (!filters.from) {
    if (filters.period === "today") start.setHours(0, 0, 0, 0);
    else if (filters.period === "week") start.setDate(now.getDate() - 7);
    else if (filters.period === "month") start.setMonth(now.getMonth() - 1);
    else if (filters.period === "quarter") start.setMonth(now.getMonth() - 3);
    else if (filters.period === "year") start.setFullYear(now.getFullYear() - 1);
    else start.setFullYear(2000);
  }
  return { start, end };
}

export async function getAnalytics(filters: Filters) {
  const { start, end } = periodRange(filters), now = new Date();
  const where: Prisma.ClientWhereInput = {
    createdAt: { gte: start, lte: end }, active: true,
    ...(filters.role === Role.MANAGER && filters.managerUserId ? { managerUserId: filters.managerUserId } : {}),
    ...(filters.manager ? { manager: filters.manager } : {}), ...(filters.city ? { city: filters.city } : {}),
    ...(filters.status && Object.values(LeadStage).includes(filters.status as LeadStage) ? { stage: filters.status as LeadStage } : {}),
  };
  const leads = await prisma.client.findMany({ where, include: {
    leadStatusHistory: { select: { toStage: true, createdAt: true } },
    nextActions: { select: { nextActionAt: true, completedAt: true, createdAt: true } },
    commercialProposals: { select: { id: true, sentAt: true } },
    leadConversion: { select: { createdAt: true, orderId: true } },
    managerUser: { select: { id: true, name: true } },
  } });
  const reached = (lead: typeof leads[number], stage: LeadStage) => lead.stage === stage || lead.leadStatusHistory.some((item) => item.toStage === stage);
  const countStage = (stage: LeadStage) => leads.filter((lead) => reached(lead, stage)).length;
  const won = countStage(LeadStage.WON), lost = countStage(LeadStage.LOST), qualified = countStage(LeadStage.QUALIFIED);
  const proposalCohort = leads.filter((lead) => reached(lead, LeadStage.PROPOSAL_SENT)), measurementCohort = leads.filter((lead) => reached(lead, LeadStage.MEASUREMENT_COMPLETED));
  const firstStageAt = (lead: typeof leads[number], stage: LeadStage) => lead.leadStatusHistory.filter((item) => item.toStage === stage).map((item) => item.createdAt.getTime()).sort()[0];
  const proposalTimes = leads.map((lead) => { const at = firstStageAt(lead, LeadStage.PROPOSAL_SENT); return at ? at - lead.createdAt.getTime() : null; }).filter((value): value is number => value !== null && value >= 0);
  const wonTimes = leads.map((lead) => { const at = firstStageAt(lead, LeadStage.WON); return at ? at - lead.createdAt.getTime() : null; }).filter((value): value is number => value !== null && value >= 0);
  const managerMap = new Map<number, { managerUserId: number; manager: string; leads: typeof leads }>();
  for (const lead of leads) { const id = lead.managerUserId ?? 0, current = managerMap.get(id) ?? { managerUserId: id, manager: lead.managerUser?.name ?? lead.manager, leads: [] }; current.leads.push(lead); managerMap.set(id, current); }
  const managers = [...managerMap.values()].map((group) => {
    const has = (lead: typeof leads[number], stage: LeadStage) => reached(lead, stage), groupWon = group.leads.filter((lead) => has(lead, LeadStage.WON)).length, groupQualified = group.leads.filter((lead) => has(lead, LeadStage.QUALIFIED)).length;
    const responseTimes = group.leads.flatMap((lead) => { const value = lead.leadStatusHistory.filter((item) => item.toStage && item.toStage !== LeadStage.NEW).map((item) => item.createdAt.getTime()).sort()[0]; return value && value >= lead.createdAt.getTime() ? [value - lead.createdAt.getTime()] : []; });
    return { managerUserId: group.managerUserId, manager: group.manager, newLeads: group.leads.length, processed: group.leads.filter((lead) => lead.stage !== LeadStage.NEW).length, proposals: group.leads.filter((lead) => has(lead, LeadStage.PROPOSAL_SENT)).length, followUps: group.leads.filter((lead) => has(lead, LeadStage.FOLLOW_UP)).length, measurements: group.leads.filter((lead) => has(lead, LeadStage.MEASUREMENT_SCHEDULED)).length, won: groupWon, lost: group.leads.filter((lead) => has(lead, LeadStage.LOST)).length, conversion: percent(groupWon, groupQualified), overdueNextActions: group.leads.flatMap((lead) => lead.nextActions).filter((action) => !action.completedAt && action.nextActionAt < now).length, averageResponseTimeMs: averageMs(responseTimes), convertedOrders: group.leads.filter((lead) => lead.leadConversion).length };
  });
  const lostReasons = await prisma.client.groupBy({ by: ["lostReason"], where: { ...where, stage: LeadStage.LOST, lostReason: { not: null } }, _count: true });
  const sourcePerformance = await prisma.client.groupBy({ by: ["sourceCode"], where, _count: true });
  const pendingPriceApprovals = await prisma.priceApprovalRequest.count({ where: { status: "PENDING", ...(filters.role === Role.MANAGER && filters.managerUserId ? { managerUserId: filters.managerUserId } : {}), createdAt: { gte: start, lte: end } } });
  const orders = filters.role === Role.DIRECTOR ? await prisma.order.findMany({ where: { createdAt: { gte: start, lte: end } }, include: { partner: { select: { id: true, name: true } } } }) : [];
  const partnerIds = [...new Set(orders.filter((order) => order.partner).map((order) => order.partner!.id))];
  const byPartner = partnerIds.map((id) => { const rows = orders.filter((order) => order.partnerId === id); return { partner: rows[0].partner!.name, count: rows.length, amount: rows.reduce((sum, order) => sum + Number(order.amount), 0) }; });
  const months = Array.from({ length: 6 }, (_, index) => { const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1), rows = leads.filter((lead) => lead.createdAt.getFullYear() === date.getFullYear() && lead.createdAt.getMonth() === date.getMonth()); return { month: date.toLocaleDateString("ru-RU", { month: "short" }), leads: rows.length, won: rows.filter((lead) => reached(lead, LeadStage.WON)).length }; });
  const partners = filters.role === Role.DIRECTOR ? await prisma.partner.findMany({ select: { id: true, name: true } }) : [];
  const open = leads.filter((lead) => lead.stage !== LeadStage.WON && lead.stage !== LeadStage.LOST);
  const overdueNextActions = open.flatMap((lead) => lead.nextActions).filter((action) => !action.completedAt && action.nextActionAt < now).length;
  const leadsWithoutNextAction = open.filter((lead) => lead.stage !== LeadStage.NEW && !lead.nextActions.some((action) => !action.completedAt)).length;
  return {
    period: { start, end },
    sales: { newLeads: leads.length, qualified, calculations: countStage(LeadStage.CALCULATION_READY), proposalsSent: countStage(LeadStage.PROPOSAL_SENT), measurementsScheduled: countStage(LeadStage.MEASUREMENT_SCHEDULED), measurementsCompleted: countStage(LeadStage.MEASUREMENT_COMPLETED), won, lost, conversion: percent(won, qualified), validLeadConversion: percent(won, leads.length), proposalConversion: percent(proposalCohort.filter((lead) => reached(lead, LeadStage.WON)).length, proposalCohort.length), measurementConversion: percent(measurementCohort.filter((lead) => reached(lead, LeadStage.WON)).length, measurementCohort.length), averageTimeToProposalMs: averageMs(proposalTimes), averageTimeToWonMs: averageMs(wonTimes) },
    attention: { overdueNextActions, leadsWithoutNextAction, pendingPriceApprovals }, managers,
    lostReasons: lostReasons.map((item) => ({ reason: item.lostReason, count: item._count })), sourcePerformance: sourcePerformance.map((item) => { const cohort = leads.filter((lead) => lead.sourceCode === item.sourceCode), cohortWon = cohort.filter((lead) => reached(lead, LeadStage.WON)).length; return { source: item.sourceCode, leads: item._count, won: cohortWon, conversion: percent(cohortWon, cohort.length) }; }),
    kpi: { leads: leads.length, conversion: percent(won, qualified), measurements: countStage(LeadStage.MEASUREMENT_SCHEDULED), contracts: won },
    funnel: Object.values(LeadStage).map((stage) => ({ stage, count: countStage(stage), share: percent(countStage(stage), leads.length) })), byManager: managers, byPartner, months,
    filters: { managers: [...new Set(leads.map((lead) => lead.manager))], cities: [...new Set(leads.map((lead) => lead.city))], statuses: Object.values(LeadStage), partners },
  };
}
