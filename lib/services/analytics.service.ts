import { prisma } from "@/lib/prisma";

const stages = ["Новая заявка", "Подготовка", "Каркас", "Дерево", "Покраска", "Комплектация", "Готово к монтажу", "Монтаж", "Сдано"];

export async function getAnalytics(filters: { period?: string; manager?: string; partnerId?: number; city?: string; status?: string }) {
  const now = new Date(); const start = new Date(now);
  if (filters.period === "month") start.setMonth(now.getMonth() - 1);
  if (filters.period === "quarter") start.setMonth(now.getMonth() - 3);
  if (filters.period === "year") start.setFullYear(now.getFullYear() - 1);
  const where = {
    ...(filters.period && filters.period !== "all" ? { createdAt: { gte: start } } : {}),
    ...(filters.manager ? { manager: filters.manager } : {}),
    ...(filters.partnerId ? { partnerId: filters.partnerId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.city ? { client: { city: filters.city } } : {}),
  };
  const orders = await prisma.order.findMany({ where, include: { client: true, partner: true, payments: true } });
  const isContract = (status: string) => ["Каркас", "Дерево", "Покраска", "Комплектация", "Готово к монтажу", "Монтаж", "Сдано"].includes(status);
  const amount = (items: typeof orders) => items.reduce((s, o) => s + Number(o.amount), 0);
  const received = (items: typeof orders) => items.reduce((s, o) => s + o.payments.reduce((p, x) => p + x.amount, 0), 0);
  const profit = (items: typeof orders) => items.reduce((s, o) => s + Number(o.companyProfit), 0);
  const contracts = orders.filter((o) => isContract(o.status));
  const kpi = { leads: orders.length, measurements: orders.filter((o) => o.status !== "Новая заявка").length, contracts: contracts.length, contractAmount: amount(contracts), received: received(orders), profit: profit(orders), averageCheck: contracts.length ? Math.round(amount(contracts) / contracts.length) : 0, conversion: orders.length ? Math.round((contracts.length / orders.length) * 100) : 0 };
  const funnel = stages.map((stage) => { const items = orders.filter((o) => o.status === stage); return { stage, count: items.length, share: orders.length ? Math.round((items.length / orders.length) * 100) : 0, amount: amount(items) }; });
  const byManager = Array.from(new Set(orders.map((o) => o.manager))).map((manager) => { const items = orders.filter((o) => o.manager === manager); const c = items.filter((o) => isContract(o.status)); return { manager, leads: items.length, contracts: c.length, amount: amount(c), received: received(items), profit: profit(items), conversion: items.length ? Math.round((c.length / items.length) * 100) : 0, averageCheck: c.length ? Math.round(amount(c) / c.length) : 0 }; });
  const byPartner = Array.from(new Set(orders.filter((o) => o.partner).map((o) => o.partner!.id))).map((id) => { const items = orders.filter((o) => o.partner?.id === id); return { partner: items[0].partner!.name, count: items.length, amount: amount(items), paid: items.reduce((s,o)=>s+Number(o.partnerPaid),0), balance: items.reduce((s,o)=>s+Number(o.partnerBalance),0), profit: profit(items) }; });
  const months = Array.from({ length: 6 }, (_, index) => { const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1); const items = orders.filter((o) => o.createdAt.getFullYear() === date.getFullYear() && o.createdAt.getMonth() === date.getMonth()); return { month: date.toLocaleDateString("ru-RU", { month: "short" }), revenue: amount(items), profit: profit(items), leads: items.length, contracts: items.filter((o) => isContract(o.status)).length }; });
  const [managers, partners, cities, statuses] = await Promise.all([prisma.order.findMany({ distinct:["manager"],select:{manager:true} }), prisma.partner.findMany({select:{id:true,name:true}}), prisma.client.findMany({distinct:["city"],select:{city:true}}), prisma.order.findMany({distinct:["status"],select:{status:true}})]);
  return { kpi, funnel, byManager, byPartner, months, filters: { managers: managers.map(x=>x.manager), partners, cities: cities.map(x=>x.city), statuses: statuses.map(x=>x.status) } };
}
