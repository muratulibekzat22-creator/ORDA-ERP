import Link from "next/link";
import { ORDER_STAGE_LABELS, isOrderOverdue, orderDeadline, projectOrderStage } from "@/lib/orders/presentation";

export type OrderListItem = {
  id: number; number: string; lifecycle: string; amount?: string; prepayment?: string; balance?: string; manager: string;
  partnerPrice?: string; partnerAgreedAt?: string | null; partnerPaid?: string; partnerBalance?: string; companyProfit?: string;
  productionDeadline?: string | null;
  client: { name: string; phone: string; city: string };
  partner?: { id: number; name: string } | null;
  productions: Array<{ stage: string; master: string; plannedEndAt?: string | null }>;
  installation?: { scheduledAt?: string | null; installer?: { name: string } | null; installerUser?: { name: string } | null } | null;
  blockers: Array<{ title: string; severity: string }>;
};

const money = (value?: string) => value == null ? "—" : `${Number(value).toLocaleString("ru-RU")} ₸`;
const date = (value: string | Date | null | undefined) => value ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(value)) : "—";

export default function OrderTable({ orders }: { orders: OrderListItem[] }) {
  return <>
    <div className="space-y-3 md:hidden">{orders.map((order) => { const stage = projectOrderStage(order.lifecycle, order.productions[0]?.stage); const deadline = orderDeadline(order); const overdue = isOrderOverdue(deadline, order.lifecycle); return <article key={order.id} className="rounded-2xl border border-slate-800 bg-[#101827] p-4">
      <div className="flex items-start justify-between gap-3"><div><strong className="text-white">Заказ {order.number}</strong><p className="mt-1 text-sm text-slate-300">{order.client.name} · {order.client.city || "Город не указан"}</p></div><span className="rounded-full bg-blue-500/10 px-2 py-1 text-xs text-blue-300">{ORDER_STAGE_LABELS[stage]}</span></div>
      <p className="mt-4 text-xl font-bold text-white">{money(order.amount)}</p><div className="mt-3 grid grid-cols-2 gap-2 text-sm"><p className="text-slate-400">Оплачено<br/><span className="text-emerald-300">{money(order.prepayment)}</span></p><p className="text-slate-400">Остаток<br/><span className="text-amber-300">{money(order.balance)}</span></p></div>
      {order.blockers[0] && <p className="mt-3 rounded-lg bg-red-500/10 p-2 text-sm text-red-300">Есть проблема: {order.blockers[0].title}</p>}<p className={`mt-3 text-sm ${overdue ? "text-red-300" : "text-slate-400"}`}>Срок: {date(deadline)}{overdue ? " · просрочен" : ""}</p><Link href={`/orders/${order.id}`} className="mt-4 block min-h-11 rounded-xl bg-blue-600 px-4 py-3 text-center font-semibold text-white">Открыть</Link>
    </article>; })}</div>
    <div className="hidden overflow-x-auto rounded-2xl border border-slate-800 bg-[#101827] md:block"><table className="w-full min-w-[980px] text-sm"><thead className="bg-slate-950/60 text-left text-slate-400"><tr>{["№ заказа", "Клиент", "Город", "Сумма", "Оплачено", "Остаток", "Этап", "Ответственный", "Срок", ""].map((title) => <th key={title} className="px-4 py-3 font-medium">{title}</th>)}</tr></thead><tbody>{orders.map((order) => { const stage = projectOrderStage(order.lifecycle, order.productions[0]?.stage); const deadline = orderDeadline(order); const overdue = isOrderOverdue(deadline, order.lifecycle); return <tr key={order.id} className="border-t border-slate-800 text-slate-200 hover:bg-slate-900/50"><td className="px-4 py-4 font-semibold text-white">{order.number}</td><td className="px-4 py-4">{order.client.name}</td><td className="px-4 py-4">{order.client.city || "—"}</td><td className="px-4 py-4">{money(order.amount)}</td><td className="px-4 py-4 text-emerald-300">{money(order.prepayment)}</td><td className="px-4 py-4 text-amber-300">{money(order.balance)}</td><td className="px-4 py-4"><span className="rounded-full bg-blue-500/10 px-3 py-1 text-blue-300">{ORDER_STAGE_LABELS[stage]}</span>{order.blockers[0] && <span title={order.blockers[0].title} className="ml-2 text-red-300">●</span>}</td><td className="px-4 py-4">{order.installation?.installer?.name ?? order.productions[0]?.master ?? order.manager}</td><td className={`px-4 py-4 ${overdue ? "font-semibold text-red-300" : ""}`}>{date(deadline)}{overdue ? " · просрочен" : ""}</td><td className="px-4 py-4"><Link href={`/orders/${order.id}`} className="rounded-lg bg-blue-600 px-3 py-2 text-white">Открыть</Link></td></tr>; })}</tbody></table></div>
  </>;
}
