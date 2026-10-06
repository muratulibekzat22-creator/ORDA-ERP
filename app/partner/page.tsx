"use client";

import { signOut } from "next-auth/react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ORDER_STATUSES } from "@/lib/orders/lifecycle";

type Measurement = { id: number; status: string; completedAt: string | null; visitDate: string; stepsCount: number | null; measurer: string; sheetHref: string };
type PayoutAcknowledgement = { id: number; amount: number; operationDate: string; method: string | null; comment: string | null; status: string; createdAt: string };
type PartnerOrder = {
  id: number; number: string; status: string; lifecycle: string;
  client: { id: number; name: string; phone: string; city: string };
  address: string; staircase: string; material: string; mapUrl: string;
  orderReceivedAt: string; promisedAt: string | null; productionDeadline: string | null;
  frameComment: string; railingType: string; supportType: string; color: string;
  lighting: boolean; lightingDetails: string; cladding: boolean; claddingDetails: string;
  additionalDetails: string; designStyle: string; designNotes: string;
  partnerPrice: number; partnerAgreedAt: string | null; partnerPaid: number; partnerBalance: number;
  partnerPlannedReadyAt: string | null; partnerComment: string;
  readyForInstallation: boolean; installationCompleted: boolean; measurements: Measurement[];
  payoutAcknowledgements: PayoutAcknowledgement[];
};
type Dashboard = {
  partner: { id: number; name: string; phone: string };
  activeOrders: number; completedOrders: number;
  totals: { price: number; paid: number; balance: number };
  statuses: Record<string, number>; orders: PartnerOrder[];
  recentPayments: Array<{ id: number; amount: number; method: string; comment: string | null; operationDate: string; order: { number: string } }>;
};

const money = (value: number) => `${Number(value).toLocaleString("ru-RU")} ₸`;
const day = (value?: string | null) => value ? new Date(value).toLocaleDateString("ru-RU") : "Не указана";

export default function PartnerPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [query, setQuery] = useState(""), [mode, setMode] = useState<"active" | "completed" | "all">("active");
  const load = useCallback(async () => {
    setError("");
    const response = await fetch("/api/partner/dashboard", { cache: "no-store" }), body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось загрузить кабинет"); else setDashboard(body as Dashboard);
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const orders = useMemo(() => (dashboard?.orders ?? []).filter((order) => {
    const completed = order.lifecycle === "COMPLETED" || order.installationCompleted;
    const modeMatch = mode === "all" || (mode === "completed" ? completed : !completed);
    const needle = query.trim().toLocaleLowerCase("ru");
    return modeMatch && (!needle || [order.number, order.client.name, order.client.phone, order.address, order.material].some((value) => value.toLocaleLowerCase("ru").includes(needle)));
  }), [dashboard, mode, query]);
  async function updateOrder(id: number, data: Record<string, unknown>) {
    setError("");
    const response = await fetch(`/api/orders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(data) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось обновить заказ"); else await load();
  }
  async function submitPayoutAcknowledgement(data: { orderId: number; amount: number; operationDate: string; method: string; comment: string }) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/partner/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(data),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        const friendly = body.error === "PAYOUT_ACKNOWLEDGEMENT_EXCEEDS_BALANCE"
          ? "Сумма больше доступного остатка с учётом заявок на проверке."
          : body.error === "PARTNER_COST_NOT_AGREED"
            ? "Согласованная стоимость по заказу ещё не подтверждена компанией."
            : body.error ?? "Не удалось отправить подтверждение";
        setError(friendly); return false;
      }
      setNotice("Выплата отправлена на подтверждение директору. После подтверждения обновятся «Выплачено» и «Осталось».");
      await load(); return true;
    } catch {
      setError("Не удалось связаться с системой. Повторите попытку."); return false;
    } finally { setBusy(false); }
  }
  return <main className="min-h-screen bg-slate-950 p-4 text-white md:p-8">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-wider text-blue-300">ORDA · производство партнёра</p><h1 className="mt-1 text-3xl font-bold">Кабинет подрядчика</h1><p className="mt-1 text-slate-400">Заказы, переданные вашей команде, документы и расчёты с компанией.</p></div><button onClick={() => void signOut({ callbackUrl: "/login" })} className="rounded-xl bg-slate-800 px-4 py-3">Выйти</button></header>
    {error && <p className="mt-4 rounded-xl border border-red-800 bg-red-950/40 p-3 text-red-200">{error}</p>}
    {notice && <p className="mt-4 rounded-xl border border-emerald-800 bg-emerald-950/40 p-3 text-emerald-200">{notice}</p>}
    {dashboard && <>
      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">{[["В работе", dashboard.activeOrders], ["Согласовано с нами", money(dashboard.totals.price)], ["Выплачено", money(dashboard.totals.paid)], ["Осталось получить", money(dashboard.totals.balance)], ["Завершено", dashboard.completedOrders]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-sm text-slate-400">{label}</p><b className="mt-1 block text-lg">{value}</b></div>)}</section>
      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Переданные заказы</h2><p className="text-sm text-slate-400">Технические данные и сумма договора компании с вами.</p></div><div className="flex gap-2">{(["active", "completed", "all"] as const).map((value) => <button key={value} onClick={() => setMode(value)} className={`min-h-10 rounded-lg px-3 text-sm ${mode === value ? "bg-blue-600" : "bg-slate-800"}`}>{value === "active" ? "В работе" : value === "completed" ? "Завершённые" : "Все"}</button>)}</div></div>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, клиент, телефон, адрес или материал" className="mt-4 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 outline-none focus:border-blue-500" />
        <div className="mt-4 space-y-4">{orders.map((order) => <PartnerOrderCard key={order.id} order={order} busy={busy} onUpdate={updateOrder} onPayout={submitPayoutAcknowledgement} />)}{!orders.length && <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-slate-400">Подходящих заказов нет.</p>}</div>
      </section>
      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-5"><h2 className="text-xl font-semibold">Последние выплаты от компании</h2>{dashboard.recentPayments.length ? dashboard.recentPayments.map((payment) => <p key={payment.id} className="mt-3 text-sm text-slate-300"><b className="text-white">{payment.order.number}</b> · {money(payment.amount)} · {payment.method} · {day(payment.operationDate)}</p>) : <p className="mt-3 text-slate-400">Выплат пока нет.</p>}</section>
    </>}
  </main>;
}

function PartnerOrderCard({ order, busy, onUpdate, onPayout }: { order: PartnerOrder; busy: boolean; onUpdate: (id: number, data: Record<string, unknown>) => Promise<void>; onPayout: (data: { orderId: number; amount: number; operationDate: string; method: string; comment: string }) => Promise<boolean> }) {
  const [status, setStatus] = useState(order.status), [dateValue, setDateValue] = useState(order.partnerPlannedReadyAt?.slice(0, 10) ?? ""), [comment, setComment] = useState(order.partnerComment ?? "");
  const [payoutOpen, setPayoutOpen] = useState(false), [payoutAmount, setPayoutAmount] = useState(""), [payoutDate, setPayoutDate] = useState(new Date().toISOString().slice(0, 10)), [payoutMethod, setPayoutMethod] = useState("Kaspi"), [payoutComment, setPayoutComment] = useState("");
  const statuses = ORDER_STATUSES.filter((value) => ["Заготовка", "Покраска", "Заказ готов", "Ожидает установки", "Установка", "Заказ завершён"].includes(value));
  const pendingAmount = order.payoutAcknowledgements.filter((item) => item.status === "PENDING").reduce((sum, item) => sum + item.amount, 0);
  const available = Math.max(order.partnerBalance - pendingAmount, 0);
  const submitPayout = async (event: FormEvent) => {
    event.preventDefault();
    if (await onPayout({ orderId: order.id, amount: Number(payoutAmount), operationDate: payoutDate, method: payoutMethod, comment: payoutComment })) {
      setPayoutAmount(""); setPayoutComment(""); setPayoutOpen(false);
    }
  };
  return <article className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-bold">{order.number}</h3><p className="text-sm text-slate-400">{order.client.name} · <a href={`tel:${order.client.phone}`} className="text-blue-300">{order.client.phone}</a></p><p className="mt-1 text-sm text-slate-400">{order.client.city} · {order.address}</p></div><span className="rounded-full bg-blue-950 px-3 py-1 text-sm text-blue-200">{order.status}</span></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Info label="Лестница" value={order.staircase}/><Info label="Материал" value={order.material}/><Info label="Цвет" value={order.color}/><Info label="Срок производства" value={day(order.productionDeadline)}/><Info label="Ограждение" value={order.railingType}/><Info label="Опора" value={order.supportType}/><Info label="Подсветка" value={order.lighting ? order.lightingDetails || "Да" : "Нет"}/><Info label="Обшивка" value={order.cladding ? order.claddingDetails || "Да" : "Нет"}/></div>
    {[order.frameComment, order.additionalDetails, order.designStyle, order.designNotes].some(Boolean) && <div className="mt-3 rounded-lg bg-slate-900 p-3 text-sm text-slate-300">{[order.frameComment, order.additionalDetails, order.designStyle, order.designNotes].filter(Boolean).join(" · ")}</div>}
    <div className="mt-4 rounded-xl border border-emerald-900 bg-emerald-950/20 p-3"><h4 className="font-semibold text-white">Расчёт между компанией и подрядчиком</h4><div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4"><Info label="Согласовано" value={money(order.partnerPrice)}/><Info label="Выплачено" value={money(order.partnerPaid)}/><Info label="Осталось" value={money(order.partnerBalance)}/><Info label="На проверке" value={money(pendingAmount)}/></div>
      {order.partnerAgreedAt && order.partnerBalance > 0 ? <div className="mt-3"><button type="button" disabled={busy || available <= 0} onClick={() => setPayoutOpen((value) => !value)} className="min-h-10 rounded-lg border border-emerald-700 bg-emerald-950 px-3 text-sm text-emerald-100 disabled:opacity-50">{payoutOpen ? "Скрыть форму" : "Сообщить о полученной выплате"}</button><p className="mt-2 text-xs text-slate-400">Доступно для подтверждения: {money(available)}. Сумма попадёт в расчёт после проверки директором.</p></div> : null}
      {payoutOpen ? <form onSubmit={submitPayout} className="mt-3 grid gap-3 rounded-xl border border-slate-700 bg-slate-950/70 p-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-sm text-slate-300">Получено, ₸<input required min="1" max={available} step="0.01" type="number" value={payoutAmount} onChange={(event) => setPayoutAmount(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 px-3"/></label><label className="text-sm text-slate-300">Дата получения<input required type="date" value={payoutDate} onChange={(event) => setPayoutDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 px-3"/></label><label className="text-sm text-slate-300">Способ<select value={payoutMethod} onChange={(event) => setPayoutMethod(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 px-3"><option>Kaspi</option><option>Наличные</option><option>Банковский перевод</option><option>Другое</option></select></label><label className="text-sm text-slate-300">Комментарий<input value={payoutComment} onChange={(event) => setPayoutComment(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 px-3"/></label><button disabled={busy || Number(payoutAmount) <= 0 || Number(payoutAmount) > available} className="min-h-11 rounded-lg bg-emerald-700 px-4 font-semibold disabled:opacity-50 sm:col-span-2 lg:col-span-4">Отправить директору на подтверждение</button></form> : null}
      {order.payoutAcknowledgements.length ? <div className="mt-3 space-y-2"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">История подтверждений</p>{order.payoutAcknowledgements.slice(0, 5).map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-950/70 px-3 py-2 text-sm"><span>{money(item.amount)} · {day(item.operationDate)} · {item.method || "Не указан"}</span><span className={item.status === "POSTED" ? "text-emerald-300" : item.status === "REJECTED" ? "text-red-300" : "text-amber-300"}>{item.status === "POSTED" ? "Подтверждено" : item.status === "REJECTED" ? "Отклонено" : "На проверке"}</span>{item.comment ? <span className="w-full text-xs text-slate-500">{item.comment}</span> : null}</div>)}</div> : null}
    </div>
    <div className="mt-4"><h4 className="font-semibold">Замерные листы</h4>{order.measurements.length ? <div className="mt-2 flex flex-wrap gap-2">{order.measurements.map((measurement) => <a key={measurement.id} href={measurement.sheetHref} target="_blank" className="rounded-lg bg-blue-800 px-3 py-2 text-sm">Замер №{measurement.id} · {measurement.stepsCount ?? "—"} ступ.</a>)}</div> : <p className="mt-1 text-sm text-slate-500">Завершённый замер пока не привязан.</p>}</div>
    <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-sm text-slate-300">Этап<select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 px-3">{!statuses.includes(status as never) && <option>{status}</option>}{statuses.map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-sm text-slate-300">Плановая готовность<input type="date" value={dateValue} onChange={(event) => setDateValue(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 px-3" /></label><label className="text-sm text-slate-300 md:col-span-2">Комментарий подрядчика<textarea value={comment} onChange={(event) => setComment(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg bg-slate-800 p-3" /></label></div>
    <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => void onUpdate(order.id, { status, partnerPlannedReadyAt: dateValue || null, partnerComment: comment })} className="min-h-11 rounded-lg bg-blue-600 px-4">Сохранить</button><button onClick={() => void onUpdate(order.id, { readyForInstallation: true, partnerComment: comment })} className="min-h-11 rounded-lg bg-green-700 px-4">Готово к установке</button><button onClick={() => void onUpdate(order.id, { installationCompleted: true, status: "Заказ завершён", partnerComment: comment })} className="min-h-11 rounded-lg bg-emerald-800 px-4">Установка завершена</button>{order.mapUrl && <a href={order.mapUrl} target="_blank" className="min-h-11 rounded-lg bg-slate-800 px-4 py-3">Открыть карту</a>}</div>
  </article>;
}

function Info({ label, value }: { label: string; value: string }) { return <span className="min-w-0 text-sm text-slate-400">{label}<b className="block break-words text-white">{value || "—"}</b></span>; }
