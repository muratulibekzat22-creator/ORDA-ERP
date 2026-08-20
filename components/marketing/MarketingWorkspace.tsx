"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { BarChart3, Download, FileUp, Loader2, Plus, RefreshCw, Search, Send } from "lucide-react";

import { CAMPAIGN_STATUS_LABELS, SPEND_STATUS_LABELS } from "@/lib/marketing/domain";

type Source = { id: number; name: string; code: string; platform: string; isPaid: boolean; system: boolean };
type Channel = { id: number; name: string; code: string; system: boolean };
type Campaign = { id: number; name: string; platform: string; status: keyof typeof CAMPAIGN_STATUS_LABELS; startsAt: string; endsAt?: string | null; plannedBudget: string; dailyBudget: string; source?: { name: string } | null; responsible?: { name: string } | null; adSets: Array<{ id: number; name: string }>; ads: Array<{ id: number; name: string }>; creatives: Array<{ id: number; name: string }> };
type Inquiry = { id: number; receivedAt: string; name: string; phone: string; city: string; instagramUsername?: string | null; message?: string | null; status: string; isDuplicate: boolean; applicationId?: number | null; externalLeadId?: string | null; firstResponseAt?: string | null; source: { id: number; name: string }; channel: { id: number; name: string }; campaign?: { id: number; name: string } | null; adSet?: { name: string } | null; ad?: { name: string } | null; assignedManager?: { id: number; name: string } | null };
type Attribution = { applicationId: number; firstContactAt: string; attributionStatus: string; verificationStatus: string; source: { name: string }; primarySource: { id: number; name: string }; firstTouchSource: { name: string }; lastTouchSource: { name: string }; channel: { name: string }; campaign?: { name: string } | null; application: { id: number; name: string; phone: string; city: string; stage: string; managerUser?: { name: string } | null; measurements: Array<{ status: string }>; commercialProposals: Array<{ id: number }> ; leadConversion?: { order: { id: number; amount?: string; lifecycle: string } } | null } };
type Spend = { id: number; spendDate: string; platform: string; amount: string; status: keyof typeof SPEND_STATUS_LABELS; evidenceUrl?: string | null; comment?: string | null; campaign?: { name: string } | null; createdBy: { name: string }; reviewedBy?: { name: string } | null; financeEntry?: { id: number; category: string; method?: string | null } | null };
type Budget = { id: number; month: string; planned: string; comment?: string | null; source?: { name: string } | null; campaign?: { name: string } | null };
type Performance = { id: number; name: string; platform: string; spend: number; clicks: number; platformLeads: number; applications: number; orders: number; cpc: number; cpl: number; roas: number };
type WorkspaceData = {
  role: "DIRECTOR" | "MARKETER";
  overview: { claimedSpend: number; confirmedSpend: number; rejectedSpend: number; unreconciledSpend: number; inquiries: number; uniquePeople: number; repeatedInquiries: number; duplicates: number; applications: number; orders: number; completedMeasurements: number; payingClients: number; platformLeads: number; platformLeadDifference: number; clicks: number; impressions: number; cpc: number; cpl: number; measurementCost: number; cpa: number; cac: number; roas: number; romi: number; director?: { soldAmount: number; paidAmount: number; grossProfit: number; roas: number; romi: number } | null };
  funnel: Array<{ label: string; value: number; conversion: number }>;
  performance: Performance[]; sources: Source[]; channels: Channel[]; campaigns: Campaign[]; inquiries: Inquiry[]; attributions: Attribution[];
  metrics: Array<{ id: number; metricDate: string; platform: string; campaignId: number; reportedSpend: string; impressions: number; reach: number; clicks: number; linkClicks: number; messages: number; platformLeads: number }>;
  spends: Spend[]; budgets: Budget[]; managers: Array<{ id: number; name: string; role: string }>; marketingUsers: Array<{ id: number; name: string; role: string }>; categories: Array<{ id: number; name: string; code: string }>;
};

const tabs = ["Обзор", "Входящие", "Заявки", "Кампании", "Каналы", "Расходы и показатели", "Воронка", "Атрибуция", "Бюджет", "Отчёты"] as const;
type Tab = typeof tabs[number];
const field = "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500";
const card = "rounded-2xl border border-slate-800 bg-slate-900/70 p-4";
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50";
const secondary = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50";
const money = (value: number | string | null | undefined) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "KZT", maximumFractionDigits: 0 }).format(Number(value || 0));
const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value || 0);
const percent = (value: number) => `${number(value)}%`;
const ratio = (value: number) => `${number(value)}×`;
const when = (value: string) => new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
const day = (value: string) => new Date(value).toLocaleDateString("ru-RU");
const idempotencyKey = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

function formObject(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form).entries());
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={`grid gap-1 text-sm text-slate-300 ${wide ? "md:col-span-2" : ""}`}><span>{label}</span>{children}</label>;
}

function Empty({ children = "За выбранный период данных нет" }: { children?: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">{children}</div>;
}

function ErrorBanner({ message }: { message: string }) {
  return <div role="alert" className="rounded-xl border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-200">{message}</div>;
}

function Kpi({ label, value, tone = "blue", note }: { label: string; value: string; tone?: "blue" | "green" | "amber" | "violet"; note?: string }) {
  const colors = { blue: "text-blue-300", green: "text-emerald-300", amber: "text-amber-300", violet: "text-violet-300" };
  return <div className={card}><p className="text-xs uppercase tracking-wide text-slate-400">{label}</p><p className={`mt-2 text-2xl font-bold ${colors[tone]}`}>{value}</p>{note && <p className="mt-1 text-xs text-slate-500">{note}</p>}</div>;
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return <div data-scroll-region className="overflow-x-auto rounded-2xl border border-slate-800"><table className="min-w-full divide-y divide-slate-800 text-sm">{children}</table></div>;
}

function Head({ children }: { children: React.ReactNode }) { return <thead className="bg-slate-900 text-left text-xs uppercase tracking-wide text-slate-400"><tr>{children}</tr></thead>; }
const Th = ({ children }: { children: React.ReactNode }) => <th className="whitespace-nowrap px-4 py-3 font-semibold">{children}</th>;
const Td = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => <td className={`px-4 py-3 align-top ${className}`}>{children}</td>;

export default function MarketingWorkspace() {
  const { data: session } = useSession();
  const now = new Date();
  const [active, setActive] = useState<Tab>("Обзор");
  const [from, setFrom] = useState(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29).toISOString().slice(0, 10));
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const [search, setSearch] = useState("");
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ from, to, ...(search.trim() ? { search: search.trim() } : {}) });
      const response = await fetch(`/api/marketing?${params}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Не удалось загрузить маркетинг");
      setData(body as WorkspaceData);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ошибка загрузки"); }
    finally { setBusy(false); }
  }, [from, to, search]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const send = useCallback(async (payload: Record<string, unknown>, useKey = false) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/marketing", { method: "POST", headers: { "Content-Type": "application/json", ...(useKey ? { "Idempotency-Key": idempotencyKey() } : {}) }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Операция не выполнена");
      setNotice("Сохранено"); await load(); return body;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Операция не выполнена"); return null; }
    finally { setBusy(false); }
  }, [load]);

  return <div className="mx-auto min-h-full max-w-[1680px] p-3 md:p-6">
    <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div><p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-300">Сквозная аналитика</p><h1 className="mt-1 text-3xl font-bold">Маркетинг</h1><p className="mt-1 text-sm text-slate-400">От первого касания до заказа и фактической оплаты</p></div>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Field label="С"><input type="date" className={field} value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
        <Field label="По"><input type="date" className={field} value={to} onChange={(event) => setTo(event.target.value)} /></Field>
        <button type="button" className={`${secondary} self-end`} onClick={() => void load()} disabled={busy}>{busy ? <Loader2 className="animate-spin" size={18}/> : <RefreshCw size={18}/>} Обновить</button>
      </div>
    </header>
    {error && <div className="mb-4"><ErrorBanner message={error}/></div>}
    {notice && <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">{notice}</div>}
    <div data-scroll-region className="mb-5 overflow-x-auto"><div role="tablist" aria-label="Разделы маркетинга" className="flex min-w-max gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-2">{tabs.map((tab) => <button key={tab} role="tab" aria-selected={active === tab} type="button" onClick={() => setActive(tab)} className={`min-h-11 rounded-xl px-4 text-sm font-semibold ${active === tab ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}>{tab}</button>)}</div></div>
    {!data ? (busy ? <div className="grid min-h-72 place-items-center text-slate-400"><Loader2 className="animate-spin"/></div> : <Empty/>) : <>
      {active === "Обзор" && <Overview data={data}/>} 
      {active === "Входящие" && <Incoming data={data} search={search} setSearch={setSearch} send={send} busy={busy}/>} 
      {active === "Заявки" && <Applications data={data}/>} 
      {active === "Кампании" && <Campaigns data={data} send={send} busy={busy}/>} 
      {active === "Каналы" && <Catalogs data={data} send={send} busy={busy}/>} 
      {active === "Расходы и показатели" && <MetricsAndSpend data={data} send={send} busy={busy}/>} 
      {active === "Воронка" && <Funnel data={data}/>} 
      {active === "Атрибуция" && <AttributionTab data={data} send={send} busy={busy}/>} 
      {active === "Бюджет" && <BudgetTab data={data} send={send} busy={busy}/>} 
      {active === "Отчёты" && <Reports data={data} from={from} to={to}/>} 
    </>}
    <p className="mt-6 text-xs text-slate-600">Роль: {session?.user.role === "DIRECTOR" ? "Директор" : "Маркетолог"} · Google Ads предусмотрен в классификации; внешняя интеграция не подключена.</p>
  </div>;
}

function Overview({ data }: { data: WorkspaceData }) {
  const o = data.overview;
  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Kpi label="Подтверждено расходов" value={money(o.confirmedSpend)} tone="amber" note={`Заявлено: ${money(o.claimedSpend)}`}/>
      <Kpi label="Обращения" value={number(o.inquiries)} note={`${o.uniquePeople} уникальных · ${o.repeatedInquiries} повторных`}/>
      <Kpi label="Реальные заявки ORDA" value={number(o.applications)} tone="green" note={`Платформа: ${o.platformLeads} · разница ${o.platformLeadDifference}`}/>
      <Kpi label="Заказы" value={number(o.orders)} tone="violet" note={`${o.payingClients} клиентов с оплатой`}/>
      <Kpi label="Клики" value={number(o.clicks)} note={`${number(o.impressions)} показов`}/>
    </section>
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      <Kpi label="CPC" value={money(o.cpc)}/><Kpi label="CPL" value={money(o.cpl)}/><Kpi label="Стоимость замера" value={money(o.measurementCost)}/><Kpi label="CPA заказа" value={money(o.cpa)}/><Kpi label="CAC" value={money(o.cac)}/>
      <Kpi label="ROAS" value={ratio(data.role === "DIRECTOR" ? o.director?.roas ?? 0 : o.roas)} tone="green"/>
      <Kpi label="ROMI" value={data.role === "DIRECTOR" ? percent((o.director?.romi ?? 0) * 100) : "Скрыто"} tone="violet" note={data.role === "DIRECTOR" ? undefined : "Доступно директору"}/>
    </section>
    {data.role === "DIRECTOR" && o.director && <section className="grid gap-3 sm:grid-cols-3"><Kpi label="Продано" value={money(o.director.soldAmount)} tone="green"/><Kpi label="Фактически оплачено" value={money(o.director.paidAmount)} tone="blue"/><Kpi label="Валовая прибыль" value={money(o.director.grossProfit)} tone="violet"/></section>}
    <PerformanceTable rows={data.performance}/>
  </div>;
}

function PerformanceTable({ rows }: { rows: Performance[] }) {
  return <section><div className="mb-3 flex items-center gap-2"><BarChart3 className="text-blue-300"/><h2 className="text-xl font-bold">Эффективность кампаний</h2></div>{!rows.length ? <Empty/> : <TableWrap><Head><Th>Кампания</Th><Th>Расход</Th><Th>Клики</Th><Th>Лиды платформы</Th><Th>Заявки ORDA</Th><Th>Заказы</Th><Th>CPC</Th><Th>CPL</Th><Th>ROAS</Th></Head><tbody className="divide-y divide-slate-800 bg-slate-950/40">{rows.map((row) => <tr key={row.id}><Td><strong>{row.name}</strong><p className="text-xs text-slate-500">{row.platform}</p></Td><Td>{money(row.spend)}</Td><Td>{row.clicks}</Td><Td>{row.platformLeads}</Td><Td>{row.applications}</Td><Td>{row.orders}</Td><Td>{money(row.cpc)}</Td><Td>{money(row.cpl)}</Td><Td>{ratio(row.roas)}</Td></tr>)}</tbody></TableWrap>}</section>;
}

function Incoming({ data, search, setSearch, send, busy }: { data: WorkspaceData; search: string; setSearch: (value: string) => void; send: (payload: Record<string, unknown>, useKey?: boolean) => Promise<unknown>; busy: boolean }) {
  const [show, setShow] = useState(false);
  const act = async (item: Inquiry, action: string) => {
    if (action === "convertInquiry") {
      const managerUserId = prompt("ID менеджера", String(item.assignedManager?.id ?? data.managers[0]?.id ?? "")); if (!managerUserId) return;
      const estimatedAmount = prompt("Предварительный бюджет", "0"); if (estimatedAmount === null) return;
      const productInterest = prompt("Интересующий продукт", "");
      const description = prompt("Описание запроса", item.message ?? "");
      const comment = prompt("Комментарий", "");
      await send({ command: action, inquiryId: item.id, managerUserId, estimatedAmount, productInterest, description, comment }); return;
    }
    if (action === "link") { const applicationId = prompt("ID существующей заявки/клиента"); if (!applicationId) return; await send({ command: "updateInquiry", action, inquiryId: item.id, applicationId }); return; }
    if (action === "assign") { const managerId = prompt("ID менеджера", String(data.managers[0]?.id ?? "")); if (!managerId) return; await send({ command: "updateInquiry", action, inquiryId: item.id, managerId }); return; }
    if (action === "source") { const sourceId = prompt("ID нового источника", String(data.sources[0]?.id ?? "")); const comment = prompt("Обязательный комментарий к изменению"); if (!sourceId || !comment) return; await send({ command: "updateInquiry", action, inquiryId: item.id, sourceId, comment }); return; }
    await send({ command: "updateInquiry", action, inquiryId: item.id });
  };
  return <div className="space-y-4">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div className="flex-1"><label className="text-sm text-slate-400">Поиск по имени, телефону, username, внешнему ID, городу или кампании</label><div className="mt-1 flex gap-2"><div className="relative flex-1"><Search className="absolute left-3 top-3 text-slate-500" size={18}/><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} className={`${field} pl-10`} placeholder="Поиск"/></div></div></div><button type="button" className={button} onClick={() => setShow((value) => !value)}><Plus size={18}/> Добавить обращение</button></div>
    {show && <form className={`${card} grid gap-3 md:grid-cols-2 xl:grid-cols-4`} onSubmit={(event) => { event.preventDefault(); const payload = formObject(event.currentTarget); void send({ command: "createInquiry", ...payload }).then((result) => { if (result) { event.currentTarget.reset(); setShow(false); } }); }}>
      <Field label="Имя *"><input required name="name" className={field}/></Field><Field label="Телефон *"><input required name="phone" className={field} placeholder="+7 700 000 00 00"/></Field><Field label="Доп. телефон"><input name="additionalPhone" className={field}/></Field><Field label="Город *"><input required name="city" className={field}/></Field>
      <Field label="Источник *"><select required name="sourceId" className={field}><option value="">Выберите</option>{data.sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Канал обращения *"><select required name="channelId" className={field}><option value="">Выберите</option>{data.channels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Кампания"><select name="campaignId" className={field}><option value="">Без кампании</option>{data.campaigns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Группа объявлений"><select name="adSetId" className={field}><option value="">Не указана</option>{data.campaigns.flatMap((campaign) => campaign.adSets.map((item) => <option key={item.id} value={item.id}>{campaign.name} · {item.name}</option>))}</select></Field><Field label="Объявление"><select name="adId" className={field}><option value="">Не указано</option>{data.campaigns.flatMap((campaign) => campaign.ads.map((item) => <option key={item.id} value={item.id}>{campaign.name} · {item.name}</option>))}</select></Field><Field label="Менеджер"><select name="assignedManagerId" className={field}><option value="">Не назначен</option>{data.managers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="Instagram username"><input name="instagramUsername" className={field}/></Field><Field label="Внешний ID"><input name="externalLeadId" className={field}/></Field><Field label="Дата обращения"><input name="receivedAt" type="datetime-local" className={field}/></Field><Field label="Сообщение / описание запроса" wide><textarea name="message" rows={3} className={field}/></Field>
      <button disabled={busy} className={`${button} md:col-span-2 xl:col-span-4`}><Plus size={18}/> Сохранить обращение</button>
    </form>}
    {!data.inquiries.length ? <Empty/> : <TableWrap><Head><Th>Дата / контакт</Th><Th>Источник → канал</Th><Th>Кампания / реклама</Th><Th>Сообщение</Th><Th>Статус</Th><Th>Менеджер</Th><Th>Ответ</Th><Th>Действия</Th></Head><tbody className="divide-y divide-slate-800">{data.inquiries.map((item) => <tr key={item.id}><Td><strong>{item.name}</strong><p>{item.phone}</p><p className="text-xs text-slate-500">{item.city} · {when(item.receivedAt)}</p>{item.instagramUsername && <p className="text-xs text-blue-300">@{item.instagramUsername}</p>}</Td><Td><strong>{item.source.name}</strong><p className="text-xs text-slate-400">через {item.channel.name}</p></Td><Td>{item.campaign?.name ?? "—"}<p className="text-xs text-slate-500">{item.adSet?.name ?? ""} {item.ad?.name ?? ""}</p></Td><Td className="max-w-72"><p className="line-clamp-3 whitespace-pre-wrap text-slate-300">{item.message ?? "—"}</p></Td><Td><span className={`rounded-full px-2 py-1 text-xs ${item.isDuplicate ? "bg-red-500/15 text-red-300" : item.applicationId ? "bg-emerald-500/15 text-emerald-300" : "bg-blue-500/15 text-blue-300"}`}>{item.isDuplicate ? "Дубль" : item.applicationId ? `Заявка #${item.applicationId}` : item.status}</span></Td><Td>{item.assignedManager?.name ?? "Не назначен"}</Td><Td>{item.firstResponseAt ? when(item.firstResponseAt) : "—"}</Td><Td><div className="flex min-w-48 flex-wrap gap-1">{!item.applicationId && <button className={secondary} onClick={() => void act(item, "convertInquiry")}>Создать заявку</button>}<button className={secondary} onClick={() => void act(item, "link")}>Связать</button><button className={secondary} onClick={() => void act(item, "assign")}>Назначить</button><button className={secondary} onClick={() => void act(item, "source")}>Источник</button>{!item.isDuplicate && <button className={secondary} onClick={() => void act(item, "duplicate")}>Дубль</button>}{item.applicationId && <a className={secondary} href={`/clients/${item.applicationId}`}>Открыть</a>}</div></Td></tr>)}</tbody></TableWrap>}
  </div>;
}

function Applications({ data }: { data: WorkspaceData }) {
  return !data.attributions.length ? <Empty>Маркетинговые заявки появятся здесь после создания или связывания входящего обращения.</Empty> : <TableWrap><Head><Th>Заявка</Th><Th>Источник</Th><Th>Канал / кампания</Th><Th>Менеджер</Th><Th>Этап CRM</Th><Th>Замеры</Th><Th>КП</Th><Th>Заказ</Th></Head><tbody className="divide-y divide-slate-800">{data.attributions.map((item) => <tr key={item.applicationId}><Td><a className="font-bold text-blue-300 hover:underline" href={`/clients/${item.applicationId}`}>#{item.applicationId} · {item.application.name}</a><p>{item.application.phone}</p><p className="text-xs text-slate-500">{item.application.city}</p></Td><Td>{item.primarySource.name}</Td><Td>{item.channel.name}<p className="text-xs text-slate-500">{item.campaign?.name ?? "Без кампании"}</p></Td><Td>{item.application.managerUser?.name ?? "—"}</Td><Td>{item.application.stage}</Td><Td>{item.application.measurements.length}</Td><Td>{item.application.commercialProposals.length}</Td><Td>{item.application.leadConversion ? <a className="text-emerald-300 hover:underline" href={`/orders/${item.application.leadConversion.order.id}`}>{money(item.application.leadConversion.order.amount)}</a> : "—"}</Td></tr>)}</tbody></TableWrap>;
}

function Campaigns({ data, send, busy }: { data: WorkspaceData; send: (payload: Record<string, unknown>) => Promise<unknown>; busy: boolean }) {
  const [show, setShow] = useState(false);
  const createLevel = async (campaign: Campaign, level: "adSet" | "ad" | "creative") => { const name = prompt(level === "adSet" ? "Название группы объявлений" : level === "ad" ? "Название объявления" : "Название креатива"); if (!name) return; await send({ command: "createCampaignLevel", level, campaignId: campaign.id, name }); };
  return <div className="space-y-4"><div className="flex justify-end"><button type="button" className={button} onClick={() => setShow((value) => !value)}><Plus size={18}/> Новая кампания</button></div>{show && <form className={`${card} grid gap-3 md:grid-cols-2 xl:grid-cols-4`} onSubmit={(event) => { event.preventDefault(); void send({ command: "createCampaign", ...formObject(event.currentTarget) }).then((result) => result && setShow(false)); }}>
    <Field label="Название *"><input required name="name" className={field}/></Field><Field label="Платформа *"><input required name="platform" className={field} placeholder="META, TIKTOK, GOOGLE"/></Field><Field label="Источник"><select name="sourceId" className={field}><option value="">Не указан</option>{data.sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Рекламный аккаунт"><input name="advertisingAccount" className={field}/></Field>
    <Field label="Цель"><input name="objective" className={field}/></Field><Field label="Город / регион"><input name="region" className={field}/></Field><Field label="Аудитория"><input name="audience" className={field}/></Field><Field label="Ответственный маркетолог"><select name="responsibleId" className={field}><option value="">Не назначен</option>{data.marketingUsers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    <Field label="Дата начала *"><input required type="date" name="startsAt" className={field}/></Field><Field label="Дата завершения"><input type="date" name="endsAt" className={field}/></Field><Field label="Плановый бюджет"><input type="number" min="0" step="0.01" name="plannedBudget" defaultValue="0" className={field}/></Field><Field label="Дневной бюджет"><input type="number" min="0" step="0.01" name="dailyBudget" defaultValue="0" className={field}/></Field>
    <Field label="Статус"><select name="status" className={field}>{Object.entries(CAMPAIGN_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="UTM source"><input name="utmSource" className={field}/></Field><Field label="UTM medium"><input name="utmMedium" className={field}/></Field><Field label="UTM campaign"><input name="utmCampaign" className={field}/></Field><Field label="Внешний ID"><input name="externalId" className={field}/></Field><Field label="Комментарий" wide><textarea name="comment" rows={2} className={field}/></Field><button disabled={busy} className={`${button} md:col-span-2 xl:col-span-4`}>Сохранить кампанию</button>
  </form>}
  {!data.campaigns.length ? <Empty/> : <div className="grid gap-3 lg:grid-cols-2">{data.campaigns.map((item) => <article key={item.id} className={card}><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wide text-blue-300">{item.platform}</p><h3 className="text-lg font-bold">{item.name}</h3><p className="text-sm text-slate-400">{item.source?.name ?? "Без источника"}</p></div><span className="rounded-full bg-slate-800 px-3 py-1 text-xs">{CAMPAIGN_STATUS_LABELS[item.status]}</span></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Период</dt><dd>{day(item.startsAt)} — {item.endsAt ? day(item.endsAt) : "без даты"}</dd></div><div><dt className="text-slate-500">Бюджет</dt><dd>{money(item.plannedBudget)} · {money(item.dailyBudget)}/день</dd></div><div><dt className="text-slate-500">Группы</dt><dd>{item.adSets.length}</dd></div><div><dt className="text-slate-500">Объявления / креативы</dt><dd>{item.ads.length} / {item.creatives.length}</dd></div></dl><div className="mt-4 flex flex-wrap gap-2"><button className={secondary} onClick={() => void createLevel(item, "adSet")}>+ Группа</button><button className={secondary} onClick={() => void createLevel(item, "ad")}>+ Объявление</button><button className={secondary} onClick={() => void createLevel(item, "creative")}>+ Креатив</button></div></article>)}</div>}
  </div>;
}

function Catalogs({ data, send, busy }: { data: WorkspaceData; send: (payload: Record<string, unknown>) => Promise<unknown>; busy: boolean }) {
  return <div className="grid gap-5 xl:grid-cols-2"><section><h2 className="mb-3 text-xl font-bold">Источники привлечения</h2><form className={`${card} mb-3 grid gap-3 sm:grid-cols-2`} onSubmit={(event) => { event.preventDefault(); void send({ command: "createCatalog", kind: "source", ...formObject(event.currentTarget), isPaid: new FormData(event.currentTarget).get("isPaid") === "on" }).then((result) => result && event.currentTarget.reset()); }}><Field label="Название"><input required name="name" className={field}/></Field><Field label="Платформа"><input required name="platform" className={field}/></Field><Field label="Код"><input required name="code" className={field}/></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isPaid"/> Платный источник</label><button disabled={busy} className={`${button} sm:col-span-2`}>Добавить источник</button></form><div className="grid gap-2">{data.sources.map((item) => <div key={item.id} className={`${card} flex items-center justify-between`}><div><strong>{item.name}</strong><p className="text-xs text-slate-500">{item.platform} · {item.code}</p></div><span className={`rounded-full px-2 py-1 text-xs ${item.isPaid ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"}`}>{item.isPaid ? "Платный" : "Органический"}</span></div>)}</div></section>
    <section><h2 className="mb-3 text-xl font-bold">Каналы обращения</h2><form className={`${card} mb-3 grid gap-3 sm:grid-cols-2`} onSubmit={(event) => { event.preventDefault(); void send({ command: "createCatalog", kind: "channel", ...formObject(event.currentTarget) }).then((result) => result && event.currentTarget.reset()); }}><Field label="Название"><input required name="name" className={field}/></Field><Field label="Код"><input required name="code" className={field}/></Field><button disabled={busy} className={`${button} sm:col-span-2`}>Добавить канал</button></form><div className="grid gap-2">{data.channels.map((item) => <div key={item.id} className={card}><strong>{item.name}</strong><p className="text-xs text-slate-500">{item.code}</p></div>)}</div></section></div>;
}

function parseCsvLine(line: string, separator: string) { const cells: string[] = []; let value = "", quoted = false; for (let index = 0; index < line.length; index += 1) { const char = line[index]; if (char === '"') { if (quoted && line[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted; } else if (char === separator && !quoted) { cells.push(value.trim()); value = ""; } else value += char; } cells.push(value.trim()); return cells; }

function MetricsAndSpend({ data, send, busy }: { data: WorkspaceData; send: (payload: Record<string, unknown>, useKey?: boolean) => Promise<unknown>; busy: boolean }) {
  const [preview, setPreview] = useState<Array<Record<string, string>>>([]); const [csvError, setCsvError] = useState("");
  const readCsv = async (file?: File) => { setPreview([]); setCsvError(""); if (!file) return; const raw = (await file.text()).replace(/^\uFEFF/, ""); const lines = raw.split(/\r?\n/).filter(Boolean); if (!lines.length) return setCsvError("Файл пуст"); const separator = lines[0].includes(";") ? ";" : ","; const headers = parseCsvLine(lines[0], separator); const required = ["metricDate", "platform", "campaignId"]; const missing = required.filter((item) => !headers.includes(item)); if (missing.length) return setCsvError(`Нет колонок: ${missing.join(", ")}`); setPreview(lines.slice(1, 101).map((line) => Object.fromEntries(headers.map((header, index) => [header, parseCsvLine(line, separator)[index] ?? ""])))); };
  return <div className="space-y-6"><section><h2 className="mb-3 text-xl font-bold">Показатели рекламных кабинетов</h2><form className={`${card} grid gap-3 sm:grid-cols-2 lg:grid-cols-4`} onSubmit={(event) => { event.preventDefault(); void send({ command: "createMetric", ...formObject(event.currentTarget) }, true).then((result) => result && event.currentTarget.reset()); }}><Field label="Дата"><input required type="date" name="metricDate" className={field}/></Field><Field label="Платформа"><input required name="platform" className={field}/></Field><Field label="Кампания"><select required name="campaignId" className={field}><option value="">Выберите</option>{data.campaigns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Потрачено по платформе"><input name="reportedSpend" type="number" min="0" step="0.01" defaultValue="0" className={field}/></Field>{["impressions:Показы", "reach:Охват", "clicks:Клики", "linkClicks:Переходы", "messages:Входящие сообщения", "platformLeads:Лиды платформы", "videoViews:Просмотры видео", "saves:Сохранения", "comments:Комментарии"].map((pair) => { const [name, label] = pair.split(":"); return <Field key={name} label={label}><input name={name} type="number" min="0" defaultValue="0" className={field}/></Field>; })}<Field label="Внешний отчёт"><input name="externalReport" className={field} placeholder="Ссылка или номер"/></Field><button disabled={busy} className={`${button} sm:col-span-2 lg:col-span-4`}>Сохранить показатели</button></form>
    <div className={`${card} mt-3`}><div className="flex flex-wrap items-center gap-3"><label className={secondary}><FileUp size={18}/> Выбрать CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => void readCsv(event.target.files?.[0])}/></label>{preview.length > 0 && <button type="button" className={button} disabled={busy} onClick={() => void send({ command: "importMetrics", rows: preview }, true).then((result) => result && setPreview([]))}>Импортировать {preview.length} строк</button>}<a className={secondary} href="data:text/csv;charset=utf-8,metricDate%2Cplatform%2CcampaignId%2CadSetId%2CadId%2CreportedSpend%2Cimpressions%2Creach%2Cclicks%2ClinkClicks%2Cmessages%2CplatformLeads%2CvideoViews%2Csaves%2Ccomments" download="marketing-metrics-template.csv"><Download size={18}/> Шаблон</a></div>{csvError && <div className="mt-3"><ErrorBanner message={csvError}/></div>}{preview.length > 0 && <div className="mt-3 max-h-64 overflow-auto"><pre className="text-xs text-slate-300">{JSON.stringify(preview.slice(0, 10), null, 2)}</pre><p className="mt-2 text-xs text-slate-500">Preview первых {Math.min(10, preview.length)} строк. Сервер повторно валидирует каждую строку и исключает дубли.</p></div>}</div>
    {data.metrics.length > 0 && <div className="mt-3"><TableWrap><Head><Th>Дата</Th><Th>Платформа</Th><Th>Кампания</Th><Th>Показы</Th><Th>Клики</Th><Th>Сообщения</Th><Th>Лиды платформы</Th><Th>Расход платформы</Th></Head><tbody className="divide-y divide-slate-800">{data.metrics.slice(0, 100).map((item) => <tr key={item.id}><Td>{day(item.metricDate)}</Td><Td>{item.platform}</Td><Td>{data.campaigns.find((campaign) => campaign.id === item.campaignId)?.name ?? `#${item.campaignId}`}</Td><Td>{item.impressions}</Td><Td>{item.clicks}</Td><Td>{item.messages}</Td><Td>{item.platformLeads}</Td><Td>{money(item.reportedSpend)}</Td></tr>)}</tbody></TableWrap></div>}</section>
    <section><h2 className="mb-3 text-xl font-bold">Расходы и подтверждение</h2><form className={`${card} grid gap-3 sm:grid-cols-2 lg:grid-cols-4`} onSubmit={(event) => { event.preventDefault(); void send({ command: "createSpend", ...formObject(event.currentTarget) }, true).then((result) => result && event.currentTarget.reset()); }}><Field label="Дата"><input required type="date" name="spendDate" className={field}/></Field><Field label="Платформа"><input required name="platform" className={field}/></Field><Field label="Кампания"><select name="campaignId" className={field}><option value="">Общий расход</option>{data.campaigns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Сумма"><input required name="amount" type="number" min="0.01" step="0.01" className={field}/></Field><Field label="Счёт / чек / скрин"><input name="evidenceUrl" className={field} placeholder="Ссылка на файл"/></Field><Field label="Комментарий" wide><input name="comment" className={field}/></Field><button disabled={busy} className={`${button} sm:col-span-2 lg:col-span-4`}>Создать черновик расхода</button></form>
    {!data.spends.length ? <div className="mt-3"><Empty/></div> : <div className="mt-3"><TableWrap><Head><Th>Дата</Th><Th>Кампания</Th><Th>Сумма</Th><Th>Статус</Th><Th>Подтверждение</Th><Th>Действия</Th></Head><tbody className="divide-y divide-slate-800">{data.spends.map((item) => <tr key={item.id}><Td>{day(item.spendDate)}<p className="text-xs text-slate-500">{item.platform}</p></Td><Td>{item.campaign?.name ?? "Общий расход"}</Td><Td>{money(item.amount)}</Td><Td>{SPEND_STATUS_LABELS[item.status]}</Td><Td>{item.financeEntry ? `Финансы #${item.financeEntry.id} · ${item.financeEntry.category}` : "Не создана"}</Td><Td><div className="flex flex-wrap gap-2">{(item.status === "DRAFT" || item.status === "REJECTED") && <button className={secondary} onClick={() => void send({ command: "reviewSpend", action: "submit", spendId: item.id }, true)}><Send size={16}/> На подтверждение</button>}{data.role === "DIRECTOR" && item.status === "SUBMITTED" && <><button className={secondary} onClick={() => { const categoryId = prompt("ID финансовой категории", String(data.categories[0]?.id ?? "")); const paymentAccount = prompt("Касса или банковский счёт"); if (categoryId && paymentAccount) void send({ command: "reviewSpend", action: "approve", spendId: item.id, categoryId, paymentAccount }, true); }}>Подтвердить</button><button className={secondary} onClick={() => { const comment = prompt("Причина отклонения"); if (comment) void send({ command: "reviewSpend", action: "reject", spendId: item.id, comment }, true); }}>Отклонить</button></>}</div></Td></tr>)}</tbody></TableWrap></div>}</section></div>;
}

function Funnel({ data }: { data: WorkspaceData }) {
  const max = Math.max(...data.funnel.map((item) => item.value), 1);
  return <div className="grid gap-3 xl:grid-cols-2"><section className={card}><h2 className="mb-4 text-xl font-bold">Сквозная воронка</h2><div className="space-y-3">{data.funnel.map((item) => <div key={item.label}><div className="mb-1 flex items-center justify-between text-sm"><span>{item.label}</span><strong>{number(item.value)} · {percent(item.conversion)}</strong></div><div className="h-3 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-violet-500" style={{ width: `${Math.max(2, item.value / max * 100)}%` }}/></div></div>)}</div></section><section><h2 className="mb-4 text-xl font-bold">Платформа vs ORDA</h2><div className="grid gap-3 sm:grid-cols-2"><Kpi label="Лиды платформы" value={number(data.overview.platformLeads)} tone="amber"/><Kpi label="Реальные заявки ORDA" value={number(data.overview.applications)} tone="green"/><Kpi label="Разница" value={number(data.overview.platformLeadDifference)} tone="violet"/><Kpi label="Доля переноса в ORDA" value={percent(data.overview.platformLeads ? data.overview.applications / data.overview.platformLeads * 100 : 0)}/></div><p className={`${card} mt-3 text-sm text-slate-400`}>Заявки, замеры, КП, договоры, заказы и оплаты получены из канонических модулей ORDA. Ручное число платформы их не заменяет.</p></section></div>;
}

function AttributionTab({ data, send, busy }: { data: WorkspaceData; send: (payload: Record<string, unknown>) => Promise<unknown>; busy: boolean }) {
  const update = async (item: Attribution) => { const primarySourceId = prompt("ID нового основного источника", String(item.primarySource.id)); const comment = prompt("Обязательный комментарий"); if (primarySourceId && comment) await send({ command: "updateAttribution", applicationId: item.applicationId, primarySourceId, comment }); };
  return <div className="space-y-3"><div className={card}><p className="text-sm text-slate-300">Официальная аналитика использует один основной источник на заявку. Первое и последнее касания сохраняются отдельно; смена основного источника записывается в audit log.</p></div>{!data.attributions.length ? <Empty/> : <TableWrap><Head><Th>Заявка</Th><Th>Первое касание</Th><Th>Последнее касание</Th><Th>Основной источник</Th><Th>Канал</Th><Th>Кампания</Th><Th>Проверка</Th><Th>Действие</Th></Head><tbody className="divide-y divide-slate-800">{data.attributions.map((item) => <tr key={item.applicationId}><Td><a href={`/clients/${item.applicationId}`} className="font-bold text-blue-300">#{item.applicationId} · {item.application.name}</a><p className="text-xs text-slate-500">{day(item.firstContactAt)}</p></Td><Td>{item.firstTouchSource.name}</Td><Td>{item.lastTouchSource.name}</Td><Td><strong>{item.primarySource.name}</strong></Td><Td>{item.channel.name}</Td><Td>{item.campaign?.name ?? "—"}</Td><Td>{item.attributionStatus} · {item.verificationStatus}</Td><Td><button disabled={busy} className={secondary} onClick={() => void update(item)}>Изменить</button></Td></tr>)}</tbody></TableWrap>}</div>;
}

function BudgetTab({ data, send, busy }: { data: WorkspaceData; send: (payload: Record<string, unknown>) => Promise<unknown>; busy: boolean }) {
  const planned = data.budgets.reduce((sum, item) => sum + Number(item.planned), 0); const actual = data.overview.confirmedSpend;
  return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-3"><Kpi label="План" value={money(planned)}/><Kpi label="Факт подтверждённый" value={money(actual)} tone="amber"/><Kpi label="Отклонение" value={money(planned - actual)} tone={planned >= actual ? "green" : "violet"}/></div><form className={`${card} grid gap-3 sm:grid-cols-2 lg:grid-cols-4`} onSubmit={(event) => { event.preventDefault(); void send({ command: "saveBudget", ...formObject(event.currentTarget) }).then((result) => result && event.currentTarget.reset()); }}><Field label="Месяц"><input required type="month" name="month" className={field}/></Field><Field label="Источник"><select name="sourceId" className={field}><option value="">Все источники</option>{data.sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Кампания"><select name="campaignId" className={field}><option value="">Все кампании</option>{data.campaigns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Плановый бюджет"><input required name="planned" type="number" min="0" step="0.01" className={field}/></Field><Field label="Комментарий" wide><input name="comment" className={field}/></Field><button disabled={busy} className={`${button} sm:col-span-2 lg:col-span-4`}>Сохранить бюджет</button></form>{!data.budgets.length ? <Empty/> : <TableWrap><Head><Th>Месяц</Th><Th>Источник</Th><Th>Кампания</Th><Th>План</Th><Th>Комментарий</Th></Head><tbody className="divide-y divide-slate-800">{data.budgets.map((item) => <tr key={item.id}><Td>{day(item.month)}</Td><Td>{item.source?.name ?? "Все"}</Td><Td>{item.campaign?.name ?? "Все"}</Td><Td>{money(item.planned)}</Td><Td>{item.comment ?? "—"}</Td></tr>)}</tbody></TableWrap>}</div>;
}

function Reports({ data, from, to }: { data: WorkspaceData; from: string; to: string }) {
  const csv = useMemo(() => [
    ["Кампания", "Платформа", "Подтверждено расходов", "Клики", "Лиды платформы", "Заявки ORDA", "Заказы", "CPC", "CPL", "ROAS"],
    ...data.performance.map((row) => [row.name, row.platform, row.spend, row.clicks, row.platformLeads, row.applications, row.orders, row.cpc, row.cpl, row.roas]),
  ].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n"), [data.performance]);
  const href = `data:text/csv;charset=utf-8,%EF%BB%BF${encodeURIComponent(csv)}`;
  return <div className="space-y-4"><div className={`${card} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}><div><h2 className="text-xl font-bold">Отчёт по эффективности</h2><p className="text-sm text-slate-400">Период {from} — {to}. В выгрузке подтверждённые расходы и фактические заявки ORDA.</p></div><a className={button} href={href} download={`marketing-report-${from}-${to}.csv`}><Download size={18}/> Скачать CSV</a></div><PerformanceTable rows={data.performance}/><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Kpi label="Заявлено" value={money(data.overview.claimedSpend)}/><Kpi label="Подтверждено" value={money(data.overview.confirmedSpend)} tone="green"/><Kpi label="Отклонено" value={money(data.overview.rejectedSpend)} tone="violet"/><Kpi label="Не сверено" value={money(data.overview.unreconciledSpend)} tone="amber"/></div></div>;
}
