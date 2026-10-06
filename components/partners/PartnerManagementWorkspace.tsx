"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Download, HandCoins, Link2, Plus, RefreshCw, RotateCcw, Search } from "lucide-react";

type Tab = "overview" | "partners" | "orders" | "settlements" | "operations" | "reports";
type DecimalLike = string | number;
type Metrics = {
  orderAmount: DecimalLike; received: DecimalLike; clientRemaining: DecimalLike; companyAmount: DecimalLike;
  partnerPlanned: DecimalLike; partnerAccrued: DecimalLike; companyPaidPartner: DecimalLike; partnerBalance: DecimalLike;
  companyDebt: DecimalLike; partnerDebt: DecimalLike; companyClientReceived: DecimalLike; clientPaidToPartner: DecimalLike;
  partnerTransferred: DecimalLike;
};
type Allocation = {
  dataComplete: boolean; totalSale: DecimalLike; productionCost: DecimalLike;
  plannedCompanyIncome: DecimalLike | null; plannedLoss: DecimalLike | null;
  clientReceived: DecimalLike; clientRemaining: DecimalLike;
  companyIncomeRetained: DecimalLike | null; companyIncomeRemaining: DecimalLike | null;
  productionFunded: DecimalLike | null; workshopReceived: DecimalLike;
  readyToPayWorkshop: DecimalLike | null; workshopRemaining: DecimalLike | null;
  awaitingClientForWorkshop: DecimalLike | null; workshopAdvance: DecimalLike | null;
  companyCashHeld: DecimalLike; directWorkshopHeld: DecimalLike;
};
type Partner = {
  id: number; name: string; kind: string; phone?: string | null; secondaryPhone?: string | null; email?: string | null;
  city?: string | null; address?: string | null; contactPerson?: string | null; businessStatus: string; comment?: string | null;
  defaultRewardRule: string; defaultRewardPercent?: DecimalLike | null; defaultRewardFixedAmount?: DecimalLike | null;
  cooperationStartedAt?: string | null; createdAt: string; updatedAt: string;
  totals: { orders: number; orderAmount: DecimalLike; received: DecimalLike; clientRemaining: DecimalLike; partnerAccrued: DecimalLike; partnerPaid: DecimalLike; balance: DecimalLike; profit: DecimalLike };
};
type PartnerOrder = {
  id: number; partnerId: number; settlementStatus: string; rewardRule: string; rewardPercent?: DecimalLike | null; fixedAmount?: DecimalLike | null;
  partner: Partner; metrics: Metrics; operations: Operation[]; allocation: Allocation;
  order: { id: number; number: string; createdAt: string; orderReceivedAt: string; lifecycle: string; client: { id: number; name: string; phone: string; city: string }; manager: { id: number | null; name: string }; address: string; staircase: string; material: string; amount: DecimalLike; companyProfit: DecimalLike; status: string; contract?: { number?: string | null } | null };
  economy: {
    client: { totalSale: DecimalLike; netReceived: DecimalLike; remaining: DecimalLike };
    partner: { agreed: DecimalLike; accrued: DecimalLike; paid: DecimalLike; remaining: DecimalLike };
    profit: { marginBeforePayroll: DecimalLike; payrollAccrued: DecimalLike; netProfit: DecimalLike; netMarginPercent: DecimalLike };
  };
};
type Operation = { id: number; relationId: number; type: string; status: string; amount: DecimalLike; operationDate: string; method?: string | null; account?: string | null; comment?: string | null; orderNumber?: string; partnerName?: string; createdBy?: { name: string } };
type Payload = {
  partners: Partner[]; orders: PartnerOrder[]; operations: Operation[]; audits: Array<{ id: number; action: string; createdAt: string; comment?: string | null; actor?: { name: string } }>;
  managers: Array<{ id: number; name: string }>;
  totals: { activePartners: number; activeOrders: number; activeOrdaOrders: number; activeOrdersWithoutProductionCost: number; allOrders: number; unassignedOrders: number; orders: number; ordersWithoutProductionCost: number; orderAmount: DecimalLike; received: DecimalLike; clientRemaining: DecimalLike; companyAmount: DecimalLike; partnerAccrued: DecimalLike; partnerPaid: DecimalLike; companyDebt: DecimalLike; partnerDebt: DecimalLike; averageOrder: DecimalLike; profit: DecimalLike; plannedCompanyIncome: DecimalLike; companyIncomeRetained: DecimalLike; productionFunded: DecimalLike; readyToPayWorkshop: DecimalLike; awaitingClientForWorkshop: DecimalLike; workshopAdvance: DecimalLike };
  charts: { monthly: Array<{ month: string; orders: number; sales: DecimalLike; received: DecimalLike }>; partners: Array<{ partnerId: number; name: string; orders: number; sales: DecimalLike; profit: DecimalLike; debt: DecimalLike }> };
};
type SearchOrder = { id: number; number: string; amount: DecimalLike; status: string; address: string; staircase: string; material: string; client: { name: string; phone: string }; documents: Array<{ number: string }>; partnerRelation?: { id: number; partner: { name: string } } | null };
type SearchClient = { id: number; name: string; phone: string; whatsapp?: string | null; city?: string | null; address?: string | null };

const tabs: Array<[Tab, string]> = [["overview", "Обзор"], ["partners", "Цехи"], ["orders", "Заказы цехов"], ["settlements", "Взаиморасчёты"], ["operations", "Выплаты"], ["reports", "Отчёты"]];
const money = (value: DecimalLike | null | undefined) => `${Math.round(Number(value) || 0).toLocaleString("ru-RU")} ₸`;
const date = (value: string) => new Intl.DateTimeFormat("ru-RU").format(new Date(value));
const field = "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300";
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-300 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-200 disabled:opacity-50";
const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:border-slate-500 disabled:opacity-50";
const panel = "rounded-2xl border border-white/10 bg-[#0b1220] p-4 sm:p-5";
const friendlyError = (value: string) => ({
  INVALID_PARTNER_CONFIGURATION: "Проверьте название и данные цеха.",
  INVALID_FIXED_REWARD: "Укажите корректную стоимость.",
  PRODUCTION_PRICE_BELOW_PAID: "Цена производства не может быть меньше уже выплаченной цеху суммы.",
  PARTNER_NOT_FOUND: "Цех не найден или находится в архиве.",
  ORDER_ALREADY_LINKED: "Этот заказ уже привязан к другому цеху.",
  ORDER_ALREADY_HAS_PRIMARY_PARTNER: "В заказе уже выбран другой цех.",
  PAYOUT_EXCEEDS_PARTNER_BALANCE: "Сумма больше текущего остатка по заказу. Обновите данные и проверьте сумму.",
  PAYOUT_ACKNOWLEDGEMENT_ALREADY_REVIEWED: "Эта запись уже была проверена другим руководителем.",
  REJECTION_REASON_REQUIRED: "Укажите причину отклонения.",
} as Record<string, string>)[value] ?? value;

export default function PartnerManagementWorkspace() {
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/partner-management${query ? `?q=${encodeURIComponent(query)}` : ""}`, { cache: "no-store" });
      const payload = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Не удалось загрузить цехи");
      setData(payload);
    } catch (reason) { setError(friendlyError(reason instanceof Error ? reason.message : "Не удалось загрузить цехи")); }
    finally { setLoading(false); }
  }, [query]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const mutate = async (body: Record<string, unknown>, idempotent = false) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/partner-management", {
        method: "POST", headers: { "content-type": "application/json", ...(idempotent ? { "Idempotency-Key": crypto.randomUUID() } : {}) }, body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Операция не выполнена");
      setNotice("Сохранено"); await load(); return true;
    } catch (reason) { setError(friendlyError(reason instanceof Error ? reason.message : "Операция не выполнена")); return false; }
    finally { setBusy(false); }
  };

  return <main className="min-w-0 space-y-5 overflow-x-hidden p-4 text-slate-100 sm:p-6 md:p-8">
    <header className="relative overflow-hidden rounded-[28px] border border-amber-300/20 bg-[#0b1220] p-5 sm:p-7">
      <div className="absolute inset-x-0 top-0 h-px bg-amber-300/70"/>
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-[0.25em] text-amber-300">Производство</p><h1 className="mt-2 text-3xl font-semibold text-white">Цехи и расчёты</h1><p className="mt-2 text-sm text-slate-400">План и факт по каждому заказу: поступления клиента, наш доход и выплаты цеху</p></div>
        <button type="button" onClick={() => void load()} disabled={loading} className={secondary}><RefreshCw size={17} className={loading ? "animate-spin" : ""}/>Обновить</button>
      </div>
    </header>
    <nav aria-label="Разделы цехов" className="flex max-w-full gap-2 overflow-x-auto pb-1">{tabs.map(([value, label]) => <button key={value} type="button" onClick={() => setTab(value)} className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-semibold ${tab === value ? "bg-amber-300 text-slate-950" : "border border-slate-800 bg-slate-900 text-slate-300"}`}>{label}</button>)}</nav>
    {error && <div role="alert" className="rounded-xl border border-red-500/40 bg-red-950/40 p-4 text-red-200">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-4 text-emerald-200">{notice}</div>}
    {loading && !data ? <div className={`${panel} py-16 text-center text-slate-400`}>Загрузка…</div> : data && <>
      {tab === "overview" && <Overview data={data}/>}
      {tab === "partners" && <Partners data={data} busy={busy} mutate={mutate}/>}
      {tab === "orders" && <Orders data={data} busy={busy} mutate={mutate} query={query} setQuery={setQuery}/>}
      {tab === "settlements" && <Settlements data={data} busy={busy} mutate={mutate}/>}
      {tab === "operations" && <Operations data={data} busy={busy} mutate={mutate}/>}
      {tab === "reports" && <Reports data={data}/>}
    </>}
  </main>;
}

function Overview({ data }: { data: Payload }) {
  const pendingPayouts = data.operations.filter((operation) => operation.type === "COMPANY_TO_PARTNER" && operation.status === "PENDING");
  const cards: Array<[string, DecimalLike, string]> = [
    ["Продажи за весь период", data.totals.orderAmount, `${data.totals.orders} заказов, привязанных к цехам`],
    ["Получено от клиентов", data.totals.received, "Фактические поступления"],
    ["Осталось получить", data.totals.clientRemaining, "Долг клиентов"],
    ["Наш доход по плану", data.totals.plannedCompanyIncome, "Продажа минус производство"],
    ["Наш доход уже удержан", data.totals.companyIncomeRetained, "По правилу: сначала маржа"],
    ["Цена производства", data.totals.partnerAccrued, "Согласовано по заказам"],
    ["Можно выплатить цехам сейчас", data.totals.readyToPayWorkshop, "Из уже полученных денег"],
    ["После оплат клиентов", data.totals.awaitingClientForWorkshop, "Будущая часть расчёта"],
  ];
  const max = Math.max(1, ...data.charts.partners.map((item) => Number(item.sales)));
  return <div className="space-y-5">
    {pendingPayouts.length > 0 ? <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100"><b>{pendingPayouts.length} подтверждений выплат ждут проверки.</b> Откройте «Взаиморасчёты», чтобы подтвердить или отклонить записи подрядчиков.</div> : null}
    <div className="rounded-2xl border border-blue-400/20 bg-blue-400/5 p-4 text-sm text-slate-300"><b className="text-white">Важно:</b> сводка ниже показывает весь портфель цехов за все месяцы, а не продажи выбранного месяца. Разбивка по месяцам находится внизу. Всего активных заказов ORDA: {data.totals.activeOrdaOrders}; из них привязано к цехам: {data.totals.activeOrders}; без выбранного цеха: {data.totals.unassignedOrders}.</div>
    {data.totals.activeOrdersWithoutProductionCost > 0 && <div className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-100"><b>{data.totals.activeOrdersWithoutProductionCost} активных заказов ORDA</b> без подтверждённой цены производства. По ним прибыль не считается окончательной. Среди уже привязанных к цехам без цены: {data.totals.ordersWithoutProductionCost}.</div>}
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cards.map(([label, value, hint]) => <div key={label} className={panel}><p className="text-xs text-slate-400 sm:text-sm">{label}</p><p className="mt-2 break-words text-lg font-bold text-white sm:text-2xl">{money(value)}</p><p className="mt-1 text-xs text-slate-500">{hint}</p></div>)}</section>
    <section className="rounded-2xl border border-emerald-400/15 bg-gradient-to-br from-emerald-400/[0.06] to-transparent p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">Распределение поступлений</p><h2 className="mt-2 text-xl font-bold text-white">Сначала доход компании, затем производство</h2><p className="mt-1 max-w-2xl text-sm text-slate-400">Система отдельно показывает, сколько уже обеспечено клиентскими оплатами, сколько реально выплачено и какая часть появится только после следующего платежа клиента.</p></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><Mini label="Цех обеспечен" value={money(data.totals.productionFunded)}/><Mini label="Цеху выплачено" value={money(data.totals.partnerPaid)}/><Mini label="Аванс сверх поступлений" value={money(data.totals.workshopAdvance)}/></div></div></section>
    <section className="grid gap-5 xl:grid-cols-2"><div className={panel}><h2 className="text-lg font-bold">Продажи по цехам</h2><div className="mt-5 space-y-4">{data.charts.partners.slice(0, 8).map((item) => <div key={item.partnerId}><div className="flex justify-between gap-3 text-sm"><span className="truncate">{item.name}</span><span>{money(item.sales)}</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-amber-300" style={{ width: `${Math.max(2, Number(item.sales) / max * 100)}%` }}/></div></div>)}{!data.charts.partners.length && <Empty/>}</div></div>
      <div className={panel}><h2 className="text-lg font-bold">Продажи по месяцам</h2><div className="mt-5 space-y-3">{data.charts.monthly.slice(-8).map((item) => <div key={item.month} className="grid grid-cols-[5rem_1fr] gap-3 rounded-xl bg-slate-900 p-3 text-sm"><span>{item.month}</span><span className="text-right">{item.orders} заказов · {money(item.sales)} · получено {money(item.received)}</span></div>)}{!data.charts.monthly.length && <Empty/>}</div></div></section>
  </div>;
}

function Partners({ data, busy, mutate }: { data: Payload; busy: boolean; mutate: (body: Record<string, unknown>, idem?: boolean) => Promise<boolean> }) {
  const [open, setOpen] = useState(false); const [selected, setSelected] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", kind: "CONTRACTOR", phone: "", secondaryPhone: "", email: "", city: "", address: "", contactPerson: "", cooperationStartedAt: "", rewardRule: "FIXED", rewardPercent: "", fixedAmount: "0", comment: "" });
  const submit = async (event: FormEvent) => { event.preventDefault(); if (await mutate({ action: "create-partner", ...form })) { setOpen(false); setForm({ ...form, name: "", phone: "", secondaryPhone: "", email: "", comment: "" }); } };
  const partner = data.partners.find((item) => item.id === selected);
  return <div className="space-y-5"><div className="flex flex-col gap-3 sm:flex-row sm:justify-between"><div><h2 className="text-xl font-bold">Справочник цехов</h2><p className="text-sm text-slate-400">Добавьте второй цех и укажите его руководителя. Архивирование сохраняет всю историю.</p></div><button type="button" onClick={() => setOpen((value) => !value)} className={primary}><Plus size={17}/>Добавить цех</button></div>
    {open && <form onSubmit={submit} className={`${panel} grid gap-3 md:grid-cols-2 xl:grid-cols-3`}><FormTitle>Новый цех</FormTitle><Input label="Название цеха" value={form.name} required onChange={(value) => setForm({ ...form, name: value })}/><Input label="Руководитель цеха" value={form.contactPerson} onChange={(value) => setForm({ ...form, contactPerson: value })}/><Input label="Телефон" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })}/><Input label="Дополнительный телефон" value={form.secondaryPhone} onChange={(value) => setForm({ ...form, secondaryPhone: value })}/><Input label="Email" type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })}/><Input label="Город" value={form.city} onChange={(value) => setForm({ ...form, city: value })}/><Input label="Адрес" value={form.address} onChange={(value) => setForm({ ...form, address: value })}/><Input label="Дата начала" type="date" value={form.cooperationStartedAt} onChange={(value) => setForm({ ...form, cooperationStartedAt: value })}/><Input label="Комментарий" value={form.comment} onChange={(value) => setForm({ ...form, comment: value })}/><div className="flex items-end"><button disabled={busy} className={`${primary} w-full`}>Сохранить цех</button></div></form>}
    <div className="grid gap-4 xl:grid-cols-2">{data.partners.map((item) => <article key={item.id} className={panel}><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-bold text-white">{item.name}</h3><p className="mt-1 text-sm text-slate-400">{kindLabel(item.kind)} · {item.city || "город не указан"}</p></div><Status value={item.businessStatus}/></div><div className="mt-4 grid grid-cols-2 gap-2 text-sm"><Mini label="Заказов" value={String(item.totals.orders)}/><Mini label="Сумма" value={money(item.totals.orderAmount)}/><Mini label="Начислено" value={money(item.totals.partnerAccrued)}/><Mini label="Баланс" value={money(item.totals.balance)}/></div><div className="mt-4 flex flex-wrap gap-2"><button type="button" className={secondary} onClick={() => setSelected(selected === item.id ? null : item.id)}>Карточка</button><button type="button" className={secondary} disabled={busy} onClick={() => void mutate({ action: "update-partner", partnerId: item.id, businessStatus: item.businessStatus === "ARCHIVED" ? "ACTIVE" : "ARCHIVED" })}>{item.businessStatus === "ARCHIVED" ? "Активировать" : "В архив"}</button></div>{selected === item.id && partner && <PartnerDetails partner={partner} orders={data.orders.filter((order) => order.partnerId === partner.id)} audits={data.audits}/>}</article>)}{!data.partners.length && <Empty/>}</div>
  </div>;
}

function PartnerDetails({ partner, orders, audits }: { partner: Partner; orders: PartnerOrder[]; audits: Payload["audits"] }) {
  return <div className="mt-5 space-y-4 border-t border-white/10 pt-5 text-sm"><div className="grid gap-2 sm:grid-cols-2"><p>Телефон: <b>{partner.phone || "—"}</b></p><p>Email: <b>{partner.email || "—"}</b></p><p>Контакт: <b>{partner.contactPerson || "—"}</b></p><p>Начало работы: <b>{partner.cooperationStartedAt ? date(partner.cooperationStartedAt) : "—"}</b></p></div><p className="text-slate-300">{partner.comment || "Комментарий не указан"}</p><h4 className="font-bold">Заказы</h4>{orders.slice(0, 5).map((item) => <p key={item.id}>{item.order.number} · {item.order.client.name} · {money(item.metrics.orderAmount)}</p>)}<h4 className="font-bold">История</h4>{audits.slice(0, 5).map((item) => <p key={item.id} className="text-slate-400">{date(item.createdAt)} · {item.action} · {item.actor?.name ?? "Система"}</p>)}</div>;
}

function Orders({ data, busy, mutate, query, setQuery }: { data: Payload; busy: boolean; mutate: (body: Record<string, unknown>, idem?: boolean) => Promise<boolean>; query: string; setQuery: (value: string) => void }) {
  const [mode, setMode] = useState<"link" | "create" | null>(null); const [search, setSearch] = useState(""); const [results, setResults] = useState<SearchOrder[]>([]); const [clients, setClients] = useState<SearchClient[]>([]);
  const [link, setLink] = useState({ partnerId: "", orderId: "", rewardRule: "", rewardPercent: "", fixedAmount: "", comment: "" });
  const [order, setOrder] = useState({ partnerId: "", clientId: "", newClient: false, clientName: "", clientPhone: "", secondaryPhone: "", city: "", clientComment: "", address: "", staircase: "Лестница", material: "", description: "", amount: "", orderDate: new Date().toISOString().slice(0, 10), promisedAt: "", managerUserId: "", externalContractNumber: "", status: "Новый", rewardRule: "", rewardPercent: "", fixedAmount: "", comment: "", initialConfirmed: false, initialAmount: "", initialDate: new Date().toISOString().slice(0, 10), initialReceivedBy: "", initialAccount: "", initialMethod: "bank", initialComment: "" });
  const findOrders = async () => { const response = await fetch(`/api/partner-management?view=search-orders&q=${encodeURIComponent(search)}`); if (response.ok) setResults(await response.json() as SearchOrder[]); };
  const findClients = async () => { const response = await fetch(`/api/partner-management?view=search-clients&q=${encodeURIComponent(search)}`); if (response.ok) setClients(await response.json() as SearchClient[]); };
  const linkSubmit = async (event: FormEvent) => { event.preventDefault(); if (await mutate({ action: "link-order", ...link, partnerId: Number(link.partnerId), orderId: Number(link.orderId), rewardRule: link.rewardRule || undefined })) setMode(null); };
  const createSubmit = async (event: FormEvent) => { event.preventDefault(); const body: Record<string, unknown> = { action: "create-order", ...order, partnerId: Number(order.partnerId), clientId: order.newClient ? undefined : Number(order.clientId), managerUserId: order.managerUserId ? Number(order.managerUserId) : undefined, rewardRule: order.rewardRule || undefined, client: order.newClient ? { name: order.clientName, phone: order.clientPhone, secondaryPhone: order.secondaryPhone, city: order.city, address: order.address, comment: order.clientComment } : undefined, initialPayment: order.initialConfirmed ? { confirmed: true, amount: order.initialAmount, date: order.initialDate, receivedBy: order.initialReceivedBy, account: order.initialAccount, method: order.initialMethod, comment: order.initialComment } : undefined }; if (await mutate(body, true)) setMode(null); };
  return <div className="space-y-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><label className="w-full max-w-xl text-sm text-slate-400">Поиск по цеху, заказу, клиенту или телефону<div className="mt-1 flex gap-2"><input className={field} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Введите запрос"/><button type="button" className={secondary}><Search size={17}/></button></div></label><div className="flex flex-col gap-2 sm:flex-row"><button type="button" onClick={() => setMode("link")} className={secondary}><Link2 size={17}/>Привязать существующий</button><button type="button" onClick={() => setMode("create")} className={primary}><Plus size={17}/>Новый заказ цеха</button></div></div>
    {mode === "link" && <form onSubmit={linkSubmit} className={`${panel} grid gap-3 md:grid-cols-2`}><FormTitle>Привязать существующий заказ</FormTitle><Select label="Цех" value={link.partnerId} onChange={(value) => setLink({ ...link, partnerId: value })} options={data.partners.filter((item) => item.businessStatus !== "ARCHIVED").map((item) => [String(item.id), item.name])}/><div><span className="text-sm text-slate-400">Поиск заказа</span><div className="mt-1 flex gap-2"><input className={field} value={search} onChange={(event) => setSearch(event.target.value)}/><button type="button" className={secondary} onClick={() => void findOrders()}><Search size={16}/></button></div></div><Select label="Заказ" value={link.orderId} onChange={(value) => setLink({ ...link, orderId: value })} options={results.map((item) => [String(item.id), `${item.number} · ${item.client.name} · ${money(item.amount)}${item.partnerRelation ? ` · связан с ${item.partnerRelation.partner.name}` : ""}`])}/><Select label="Правило расчёта" value={link.rewardRule} onChange={(value) => setLink({ ...link, rewardRule: value })} options={[["", "По цене производства"], ...rewardRules]}/><Input label="Процент" type="number" value={link.rewardPercent} onChange={(value) => setLink({ ...link, rewardPercent: value })}/><Input label="Фиксированная сумма" type="number" value={link.fixedAmount} onChange={(value) => setLink({ ...link, fixedAmount: value })}/><Input label="Комментарий" value={link.comment} onChange={(value) => setLink({ ...link, comment: value })}/><div className="flex items-end gap-2"><button disabled={busy} className={primary}>Привязать</button><button type="button" onClick={() => setMode(null)} className={secondary}>Отмена</button></div></form>}
    {mode === "create" && <form onSubmit={createSubmit} className={`${panel} grid gap-3 md:grid-cols-2 xl:grid-cols-3`}>
      <FormTitle>Новый обычный заказ ORDA</FormTitle>
      <Select label="Цех" value={order.partnerId} onChange={(value) => setOrder({ ...order, partnerId: value })} options={data.partners.filter((item) => item.businessStatus === "ACTIVE").map((item) => [String(item.id), item.name])}/>
      <label className="flex min-h-11 items-center gap-2 self-end rounded-xl border border-slate-700 px-3"><input type="checkbox" checked={order.newClient} onChange={(event) => setOrder({ ...order, newClient: event.target.checked })}/>Создать нового клиента</label>
      {!order.newClient && <><div><span className="text-sm text-slate-400">Поиск клиента</span><div className="mt-1 flex gap-2"><input className={field} value={search} onChange={(event) => setSearch(event.target.value)}/><button type="button" className={secondary} onClick={() => void findClients()}><Search size={16}/></button></div></div><Select label="Клиент" value={order.clientId} onChange={(value) => setOrder({ ...order, clientId: value })} options={clients.map((item) => [String(item.id), `${item.name} · ${item.phone}`])}/></>}
      {order.newClient && <><Input label="ФИО / компания" value={order.clientName} onChange={(value) => setOrder({ ...order, clientName: value })}/><Input label="Телефон" value={order.clientPhone} onChange={(value) => setOrder({ ...order, clientPhone: value })}/><Input label="Дополнительный телефон" value={order.secondaryPhone} onChange={(value) => setOrder({ ...order, secondaryPhone: value })}/><Input label="Город" value={order.city} onChange={(value) => setOrder({ ...order, city: value })}/><Input label="Комментарий к клиенту" value={order.clientComment} onChange={(value) => setOrder({ ...order, clientComment: value })}/></>}
      <Input label="Адрес объекта" value={order.address} onChange={(value) => setOrder({ ...order, address: value })}/><Input label="Изделие" value={order.staircase} onChange={(value) => setOrder({ ...order, staircase: value })}/><Input label="Материал" value={order.material} onChange={(value) => setOrder({ ...order, material: value })}/><Input label="Описание" value={order.description} onChange={(value) => setOrder({ ...order, description: value })}/><Input label="Сумма заказа" type="number" value={order.amount} onChange={(value) => setOrder({ ...order, amount: value })}/><Input label="Дата заказа" type="date" value={order.orderDate} onChange={(value) => setOrder({ ...order, orderDate: value })}/><Input label="Плановая готовность" type="date" value={order.promisedAt} onChange={(value) => setOrder({ ...order, promisedAt: value })}/><Input label="Внешний договор" value={order.externalContractNumber} onChange={(value) => setOrder({ ...order, externalContractNumber: value })}/><Input label="Статус" value={order.status} onChange={(value) => setOrder({ ...order, status: value })}/>
      <Select label="Менеджер (необязательно)" value={order.managerUserId} onChange={(value) => setOrder({ ...order, managerUserId: value })} options={[["", "Не назначен"], ...data.managers.map((item) => [String(item.id), item.name] as [string, string])]}/><Select label="Правило вознаграждения" value={order.rewardRule} onChange={(value) => setOrder({ ...order, rewardRule: value })} options={[["", "По умолчанию"], ...rewardRules]}/><Input label="Процент" type="number" value={order.rewardPercent} onChange={(value) => setOrder({ ...order, rewardPercent: value })}/><Input label="Фиксированная сумма" type="number" value={order.fixedAmount} onChange={(value) => setOrder({ ...order, fixedAmount: value })}/><Input label="Комментарий" value={order.comment} onChange={(value) => setOrder({ ...order, comment: value })}/>
      <label className="flex min-h-11 items-center gap-2 self-end rounded-xl border border-slate-700 px-3"><input type="checkbox" checked={order.initialConfirmed} onChange={(event) => setOrder({ ...order, initialConfirmed: event.target.checked })}/>Фактическая первоначальная оплата подтверждена</label>
      {order.initialConfirmed && <><Input label="Сумма оплаты" type="number" value={order.initialAmount} onChange={(value) => setOrder({ ...order, initialAmount: value })}/><Input label="Дата оплаты" type="date" value={order.initialDate} onChange={(value) => setOrder({ ...order, initialDate: value })}/><Input label="Кто получил" value={order.initialReceivedBy} onChange={(value) => setOrder({ ...order, initialReceivedBy: value })}/><Input label="Касса / банковский счёт" value={order.initialAccount} onChange={(value) => setOrder({ ...order, initialAccount: value })}/><Input label="Способ оплаты" value={order.initialMethod} onChange={(value) => setOrder({ ...order, initialMethod: value })}/><Input label="Комментарий к оплате" value={order.initialComment} onChange={(value) => setOrder({ ...order, initialComment: value })}/></>}
      <div className="flex items-end gap-2"><button disabled={busy} className={primary}>Создать заказ</button><button type="button" onClick={() => setMode(null)} className={secondary}>Отмена</button></div>
    </form>}
    <OrderCards orders={data.orders} actions={(item) => <><a href={`/orders/${item.order.id}`} className={secondary}>Открыть заказ</a><AgreedCostEditor item={item} busy={busy} mutate={mutate}/></>}/>
  </div>;
}

function OrderCards({ orders, actions }: { orders: PartnerOrder[]; actions?: (item: PartnerOrder) => React.ReactNode }) {
  return (
    <div className="grid gap-4">
      {orders.map((item) => {
        const allocation = item.allocation;
        const receivedPercent = Math.min(
          100,
          Number(allocation.totalSale) > 0
            ? Number(allocation.clientReceived) / Number(allocation.totalSale) * 100
            : 0,
        );
        const plannedIncome = allocation.plannedCompanyIncome === null
          ? null
          : Number(allocation.plannedCompanyIncome);
        return (
          <article key={item.id} className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1220]">
            <div className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-bold text-white">{item.order.number} · {item.partner.name}</h3>
                  <p className="mt-1 break-words text-sm text-slate-400">{item.order.client.name.trim() || "Клиент не указан"} · {item.order.client.phone} · {item.order.client.city || "город не указан"}</p>
                  <p className="text-sm text-slate-500">{date(item.order.orderReceivedAt)} · {item.order.address}</p>
                </div>
                <div className="flex flex-wrap gap-2"><Status value={item.order.lifecycle}/><Status value={item.settlementStatus}/></div>
              </div>
              {!allocation.dataComplete ? (
                <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4">
                  <p className="font-semibold text-amber-200">Цена производства не подтверждена</p>
                  <p className="mt-1 text-sm text-slate-400">Укажите согласованную сумму с цехом — после этого система рассчитает наш доход и график выплаты.</p>
                </div>
              ) : (
                <>
                  <div className="mt-5">
                    <div className="flex items-center justify-between text-xs text-slate-500"><span>Оплачено клиентом</span><span>{receivedPercent.toLocaleString("ru-RU", { maximumFractionDigits: 0 })}%</span></div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${receivedPercent}%` }}/></div>
                  </div>
                  <div className="mt-5">
                    <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">План договора</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3"><Mini label="Продажа" value={money(allocation.totalSale)}/><Mini label="Цена производства" value={money(allocation.productionCost)}/><Mini label={plannedIncome !== null && plannedIncome < 0 ? "Плановый убыток" : "Наш доход"} value={money(plannedIncome !== null && plannedIncome < 0 ? allocation.plannedLoss : allocation.plannedCompanyIncome)}/></div>
                  </div>
                  <div className="mt-5">
                    <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">Факт на сегодня</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4"><Mini label="Клиент оплатил" value={money(allocation.clientReceived)}/><Mini label="Наш доход удержан" value={money(allocation.companyIncomeRetained)}/><Mini label="Цех обеспечен оплатами" value={money(allocation.productionFunded)}/><Mini label="Клиент ещё должен" value={money(allocation.clientRemaining)}/></div>
                  </div>
                  <div className="mt-5 grid gap-2 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-3 sm:grid-cols-3"><Mini label="Цеху уже выплачено" value={money(allocation.workshopReceived)}/><Mini label="Можно выплатить сейчас" value={money(allocation.readyToPayWorkshop)}/><Mini label="После следующих оплат клиента" value={money(allocation.awaitingClientForWorkshop)}/></div>
                  {Number(allocation.workshopAdvance) > 0 ? <p className="mt-3 rounded-xl border border-violet-400/20 bg-violet-400/5 p-3 text-sm text-violet-200">Цеху авансировано сверх обеспеченной клиентскими оплатами суммы: {money(allocation.workshopAdvance)}.</p> : null}
                </>
              )}
              {actions ? <div className="mt-4 flex flex-wrap gap-2">{actions(item)}</div> : null}
            </div>
            <details className="border-t border-white/10 bg-slate-950/50 px-4 py-3 sm:px-5">
              <summary className="cursor-pointer text-sm font-semibold text-slate-300">Детали и контрольные цифры</summary>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"><Mini label="Остаток цеху всего" value={money(allocation.workshopRemaining)}/><Mini label="Доход ещё не удержан" value={money(allocation.companyIncomeRemaining)}/><Mini label="Деньги компании сейчас" value={money(allocation.companyCashHeld)}/><Mini label="Клиент платил цеху" value={money(item.metrics.clientPaidToPartner)}/><Mini label="Цех передал компании" value={money(item.metrics.partnerTransferred)}/><Mini label="Расчётный баланс цеха" value={money(item.metrics.partnerBalance)}/></div>
            </details>
          </article>
        );
      })}
      {!orders.length ? <Empty/> : null}
    </div>
  );
}

function AgreedCostEditor({ item, busy, mutate }: { item: PartnerOrder; busy: boolean; mutate: (body: Record<string, unknown>, idem?: boolean) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(item.allocation.dataComplete ? String(item.allocation.productionCost) : "");
  const [comment, setComment] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await mutate({ action: "set-agreed-cost", relationId: item.id, amount, comment })) setOpen(false);
  };
  return <>{!open ? <button type="button" disabled={busy} className={secondary} onClick={() => setOpen(true)}>{item.allocation.dataComplete ? "Изменить цену производства" : "Указать цену производства"}</button> : <form onSubmit={submit} className="grid w-full gap-2 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto_auto] sm:items-end"><Input label="Согласованная цена, ₸" type="number" required value={amount} onChange={setAmount}/><Input label="Комментарий" value={comment} onChange={setComment}/><button className={primary} disabled={busy || Number(amount) < 2}>Сохранить</button><button type="button" className={secondary} onClick={() => setOpen(false)}>Отмена</button></form>}</>;
}

function Settlements({ data, busy, mutate }: { data: Payload; busy: boolean; mutate: (body: Record<string, unknown>, idem?: boolean) => Promise<boolean> }) {
  const pending = data.operations.filter((operation) => operation.type === "COMPANY_TO_PARTNER" && operation.status === "PENDING");
  return <div className="space-y-4"><h2 className="text-xl font-bold">Текущие взаиморасчёты</h2>
    <section className={`${panel} border-amber-300/25`}><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-lg font-bold text-white">Подтверждения от подрядчиков</h3><p className="mt-1 text-sm text-slate-400">Подрядчик сообщил о полученной сумме. До подтверждения запись не меняет «Выплачено» и остаток.</p></div><span className="rounded-full bg-amber-300 px-3 py-1 text-sm font-bold text-slate-950">На проверке: {pending.length}</span></div>
      <div className="mt-4 space-y-3">{pending.map((item) => <article key={item.id} className="rounded-xl border border-amber-300/20 bg-slate-950 p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><p className="font-bold text-white">{item.orderNumber} · {item.partnerName} · {money(item.amount)}</p><p className="mt-1 break-words text-sm text-slate-400">Получено {date(item.operationDate)} · {item.method || "способ не указан"} · сообщил {item.createdBy?.name ?? "подрядчик"}{item.comment ? ` · ${item.comment}` : ""}</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className={primary} onClick={() => void mutate({ action: "review-payout-acknowledgement", operationId: item.id, decision: "APPROVE" })}>Подтвердить выплату</button><button type="button" disabled={busy} className={secondary} onClick={() => { const comment = window.prompt("Почему запись отклоняется?")?.trim() ?? ""; if (comment) void mutate({ action: "review-payout-acknowledgement", operationId: item.id, decision: "REJECT", comment }); }}>Отклонить</button></div></div></article>)}{!pending.length ? <p className="rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-500">Новых подтверждений нет</p> : null}</div>
    </section>
    <OrderCards orders={[...data.orders].sort((a, b) => Math.abs(Number(b.metrics.partnerBalance)) - Math.abs(Number(a.metrics.partnerBalance)))} actions={(item) => <><button type="button" disabled={busy || Number(item.metrics.partnerBalance) !== 0} className={secondary} onClick={() => void mutate({ action: "settlement-state", relationId: item.id, state: "CLOSE", comment: "Закрыто директором" })}>Закрыть взаиморасчёт</button><button type="button" disabled={busy} className={secondary} onClick={() => { const comment = window.prompt("Причина спорного статуса") ?? ""; if (comment) void mutate({ action: "settlement-state", relationId: item.id, state: "DISPUTE", comment }); }}>Отметить спорным</button></>}/></div>;
}

function Operations({ data, busy, mutate }: { data: Payload; busy: boolean; mutate: (body: Record<string, unknown>, idem?: boolean) => Promise<boolean> }) {
  const [form, setForm] = useState({ relationId: "", type: "CLIENT_TO_COMPANY", amount: "", adjustmentEffect: "", operationDate: new Date().toISOString().slice(0, 10), method: "bank", account: "", comment: "" });
  const selectedOrder = data.orders.find((item) => item.id === Number(form.relationId));
  const submit = async (event: FormEvent) => { event.preventDefault(); if (await mutate({ action: "operation", ...form, relationId: Number(form.relationId) }, true)) setForm({ ...form, amount: "", adjustmentEffect: "", comment: "" }); };
  return <div className="space-y-5"><form onSubmit={submit} className={`${panel} grid gap-3 md:grid-cols-2 xl:grid-cols-3`}><FormTitle>Зафиксировать операцию</FormTitle><Select label="Заказ" value={form.relationId} onChange={(value) => setForm({ ...form, relationId: value })} options={data.orders.map((item) => [String(item.id), `${item.order.number} · ${item.partner.name} · ${item.order.client.name}`])}/><Select label="Направление" value={form.type} onChange={(value) => setForm({ ...form, type: value })} options={operationTypes}/><Input label="Сумма" type="number" value={form.amount} onChange={(value) => setForm({ ...form, amount: value })}/>{selectedOrder && <div className="grid grid-cols-2 gap-2 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-3 md:col-span-2 xl:col-span-3 sm:grid-cols-4"><Mini label="Клиент оплатил" value={money(selectedOrder.allocation.clientReceived)}/><Mini label="Наш доход удержан" value={money(selectedOrder.allocation.companyIncomeRetained)}/><Mini label="Можно цеху сейчас" value={money(selectedOrder.allocation.readyToPayWorkshop)}/><Mini label="Цеху осталось всего" value={money(selectedOrder.allocation.workshopRemaining)}/></div>}{form.type === "ADJUSTMENT" && <Input label="Влияние на баланс (+/−)" type="number" value={form.adjustmentEffect} onChange={(value) => setForm({ ...form, adjustmentEffect: value })}/>}<Input label="Дата" type="date" value={form.operationDate} onChange={(value) => setForm({ ...form, operationDate: value })}/><Input label="Способ" value={form.method} onChange={(value) => setForm({ ...form, method: value })}/><Input label="Касса / счёт" value={form.account} onChange={(value) => setForm({ ...form, account: value })}/><Input label="Комментарий" value={form.comment} onChange={(value) => setForm({ ...form, comment: value })}/><div className="flex items-end"><button disabled={busy} className={`${primary} w-full`}><HandCoins size={17}/>Провести</button></div></form><section className={panel}><h2 className="text-lg font-bold">Журнал операций</h2><div className="mt-4 space-y-3">{data.operations.map((item) => <div key={item.id} className="flex flex-col gap-3 rounded-xl bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="font-semibold">{operationLabel(item.type)} · {money(item.amount)}</p><p className="break-words text-sm text-slate-400">{date(item.operationDate)} · {item.orderNumber} · {item.partnerName} · {item.createdBy?.name ?? "Система"}{item.comment ? ` · ${item.comment}` : ""}</p></div><div className="flex items-center gap-2"><Status value={item.status}/>{item.status === "POSTED" && item.type !== "REVERSAL" && <button type="button" disabled={busy} className={secondary} onClick={() => { const reason = window.prompt("Причина сторно"); if (reason) void mutate({ action: "reverse-operation", operationId: item.id, reason }, true); }}><RotateCcw size={16}/>Сторно</button>}</div></div>)}{!data.operations.length && <Empty/>}</div></section></div>;
}

function Reports({ data }: { data: Payload }) {
  const [partnerId, setPartnerId] = useState(data.partners[0] ? String(data.partners[0].id) : ""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const query = useMemo(() => new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString(), [from, to]);
  return <div className="space-y-5"><section className={`${panel} grid gap-3 md:grid-cols-2 xl:grid-cols-4`}><FormTitle>Выписка по цеху</FormTitle><Select label="Цех" value={partnerId} onChange={setPartnerId} options={data.partners.map((item) => [String(item.id), item.name])}/><Input label="С" type="date" value={from} onChange={setFrom}/><Input label="По" type="date" value={to} onChange={setTo}/><div className="flex flex-col gap-2 sm:flex-row xl:col-span-4"><a className={primary} href={`/api/partner-management/${partnerId}/statement?format=pdf&${query}`}><Download size={17}/>PDF</a><a className={secondary} href={`/api/partner-management/${partnerId}/statement?format=csv&${query}`}><Download size={17}/>CSV</a></div></section><section className={panel}><h2 className="text-lg font-bold">Аналитика цехов</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{data.charts.partners.map((item) => <div key={item.partnerId} className="rounded-xl bg-slate-950 p-4"><p className="font-bold">{item.name}</p><p className="mt-2 text-sm text-slate-400">{item.orders} заказов · продажи {money(item.sales)} · прибыль {money(item.profit)} · баланс {money(item.debt)}</p></div>)}{!data.charts.partners.length && <Empty/>}</div></section></div>;
}

function Input({ label, value, onChange, type = "text", required = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) { return <label className="text-sm text-slate-400"><span>{label}</span><input className={`${field} mt-1`} type={type} required={required} value={value} onChange={(event) => onChange(event.target.value)}/></label>; }
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<readonly [string, string]> }) { return <label className="text-sm text-slate-400"><span>{label}</span><select className={`${field} mt-1`} value={value} onChange={(event) => onChange(event.target.value)}><option value="">Выберите</option>{options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>; }
function FormTitle({ children }: { children: React.ReactNode }) { return <h2 className="text-lg font-bold text-white md:col-span-2 xl:col-span-3">{children}</h2>; }
function Mini({ label, value }: { label: string; value: string }) { return <div className="min-w-0 rounded-xl bg-slate-950 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-bold text-slate-100">{value}</p></div>; }
function Empty() { return <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">Данных пока нет</p>; }
function Status({ value }: { value: string }) { return <span className="inline-flex rounded-full border border-white/10 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200">{statusLabel(value)}</span>; }

const partnerKinds: Array<[string, string]> = [["REFERRER", "Рекомендатель"], ["SALES_AGENT", "Агент по продажам"], ["DEALER", "Дилер"], ["DESIGNER", "Дизайнер"], ["ARCHITECT", "Архитектор"], ["CONSTRUCTION_COMPANY", "Строительная компания"], ["CONTRACTOR", "Подрядчик"], ["OTHER", "Другой"]];
const rewardRules: Array<[string, string]> = [["FIXED", "Фиксированная сумма"], ["ORDER_PERCENT", "% от суммы заказа"], ["PAID_PERCENT", "% от полученной оплаты"], ["PROFIT_PERCENT", "% от валовой прибыли"], ["MANUAL", "Ручная сумма"]];
const operationTypes: Array<[string, string]> = [["CLIENT_TO_COMPANY", "Клиент → компания"], ["CLIENT_TO_PARTNER", "Клиент → партнёр"], ["PARTNER_TO_COMPANY", "Партнёр → компания"], ["COMPANY_TO_PARTNER", "Компания → партнёр"], ["CLIENT_REFUND", "Возврат клиенту"], ["PARTNER_REFUND", "Возврат от партнёра"], ["ADJUSTMENT", "Корректировка"]];
const kindLabel = (value: string) => partnerKinds.find(([key]) => key === value)?.[1] ?? value;
const operationLabel = (value: string) => operationTypes.find(([key]) => key === value)?.[1] ?? (value === "REVERSAL" ? "Сторно" : value);
const statusLabel = (value: string) => ({ ACTIVE: "Активный", SUSPENDED: "Приостановлен", ARCHIVED: "Архивный", NOT_CALCULATED: "Не рассчитан", CALCULATED: "Рассчитан", PARTIALLY_PAID: "Частично выплачен", CLOSED: "Закрыт", PARTNER_OWES_COMPANY: "Партнёр должен", COMPANY_OWES_PARTNER: "Компания должна", DISPUTED: "Спорный", CANCELLED: "Отменён", PENDING: "На проверке", POSTED: "Проведена", REJECTED: "Отклонена", REVERSED: "Сторнирована" } as Record<string, string>)[value] ?? value;
