"use client";

import { BarChart3, ChevronDown, ChevronRight, ClipboardCheck, Eye, KanbanSquare, MessageCircle, MousePointerClick, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Fragment, type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { salesConversionPercent } from "@/lib/marketing-funnel";

type Status = "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE";
type Task = { id: number; title: string; description: string | null; status: Status; priority: number; dueAt: string | null; assignee: { id: number; name: string } | null; createdBy: { id: number; name: string } };
type Metric = { id: number; metricMonth: string; channel: string; spend: string; leads: number; orders: number; revenue: string };
type MarketingReport = {
  id: number;
  periodType: "DAILY" | "WEEKLY" | "MONTHLY";
  periodStart: string;
  periodEnd: string;
  workCompleted: string;
  resultSummary: string;
  bestResult: string;
  problems: string;
  nextActions: string;
  creativesPublished: number;
  qualifiedLeads: number;
  unqualifiedLeads: number;
  status: "SUBMITTED" | "NEEDS_REVISION" | "APPROVED";
  directorComment: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  author: { id: number; name: string; role: string };
  reviewedBy: { id: number; name: string } | null;
};
type MetaCampaignReport = {
  key: string;
  accountId: string;
  accountTimezone: string | null;
  currency: string;
  selectedCampaignCount: number;
  loadedAt: string;
  spend: number;
  spendKzt: number | null;
  exchangeRate: number | null;
  exchangeRateSource: string | null;
  exchangeRateFallback: "CONFIGURED" | "LAST_SUCCESSFUL_SYNC" | null;
  conversations: number;
  leadActions: number;
  linkClicks: number;
  impressions: number;
  daily: MetaDaily[];
  campaigns: Array<MetaMetrics & {
    id: string;
    name: string;
    daily: MetaDaily[];
    ads: Array<MetaMetrics & { id: string; name: string; daily: MetaDaily[] }>;
  }>;
};
type MetaMetrics = { spend: number; reach: number; impressions: number; linkClicks: number; conversations: number; leadActions: number };
type MetaDaily = MetaMetrics & { date: string };
type AdPeriod = "TODAY" | "YESTERDAY" | "LAST_7_DAYS" | "MONTH";
type Data = {
  role: string;
  month: string;
  tasks: Task[];
  metrics: Metric[];
  reports: MarketingReport[];
  assignees: Array<{ id: number; name: string; role: string }>;
  integration: { configured: boolean; account: string | null; graphVersion: string; automatic: boolean; campaignCount: number; booksToLedger: boolean; state: "NEEDS_SETUP" | "READY" | "ACTIVE"; lastSyncedAt: string | null };
  summary: {
    spend: number;
    leads: number;
    orders: number;
    revenue: number;
    metaSpend: number;
    metaConversations: number;
    metaLeadActions: number;
    metaCrmLeads: number;
    metaProposals: number;
    metaMeasurements: number;
    metaOrders: number;
    metaRevenue: number;
    costPerConversation: number | null;
    cpl: number | null;
    cac: number | null;
    roas: number | null;
    conversion: number | null;
    metaConversion: number | null;
    spendTracked: boolean;
    metaSpendTracked: boolean;
    crmTracked: boolean;
    metaAttributionMissing: boolean;
  };
  dailyCrm: {
    dateLabel: string;
    weeklyDayOffLabel: string;
    reportRequired: boolean;
    totals: { leadsReceived: number; contacted: number; interested: number; measurementsScheduled: number; measurementsCompleted: number; ordersCreated: number; revenue: number };
    managers: Array<{ managerId: number; manager: string; leadsReceived: number; contacted: number; interested: number; measurementsScheduled: number; measurementsCompleted: number; ordersCreated: number; revenue: number; reportStatus: "NOT_SENT" | "ACKNOWLEDGED" | "SENT" | "DAY_OFF" }>;
  };
  managerSales: {
    rows: Array<{ userId: number; name: string; active: boolean; leads: number; orders: number; sales: number; planOrders: number | null; planSales: number | null; completionPercent: number | null }>;
    otherOrders: number;
    otherSales: number;
  };
};

const money = (value: number | string) => `${Math.round(Number(value)).toLocaleString("ru-RU")} ₸`;
const sourceMoney = (value: number, currency: string) => new Intl.NumberFormat("ru-RU", { style: "currency", currency }).format(value);
const number = (value: number) => Math.round(value).toLocaleString("ru-RU");
const monthName = (key: string) => new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date(`${key}-01T12:00:00+05:00`));
const dateLabel = (key: string) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(`${key}T12:00:00+05:00`));
const zeroMeta = (): MetaMetrics => ({ spend: 0, reach: 0, impressions: 0, linkClicks: 0, conversations: 0, leadActions: 0 });
const sumMeta = (rows: MetaMetrics[]) => rows.reduce((total, row) => ({
  spend: Math.round((total.spend + row.spend) * 100) / 100,
  reach: total.reach + row.reach,
  impressions: total.impressions + row.impressions,
  linkClicks: total.linkClicks + row.linkClicks,
  conversations: total.conversations + row.conversations,
  leadActions: total.leadActions + row.leadActions,
}), zeroMeta());
const taskColumns: Array<[Status, string]> = [["TODO", "Нужно сделать"], ["IN_PROGRESS", "В работе"], ["REVIEW", "Проверка"], ["DONE", "Готово"]];
const reportPeriodLabels: Record<MarketingReport["periodType"], string> = { DAILY: "День", WEEKLY: "Неделя", MONTHLY: "Месяц" };
const reportStatusLabels: Record<MarketingReport["status"], string> = { SUBMITTED: "На проверке", NEEDS_REVISION: "На доработке", APPROVED: "Принят" };
const field = "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white";
const businessDateKey = (value = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
const shiftDateKey = (key: string, days: number) => {
  const value = new Date(`${key}T12:00:00+05:00`);
  value.setUTCDate(value.getUTCDate() + days);
  return businessDateKey(value);
};
const monthEndKey = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  return businessDateKey(new Date(Date.UTC(year, monthNumber, 0, 7)));
};
const today = businessDateKey();

export default function MarketingManagementPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [metaReport, setMetaReport] = useState<MetaCampaignReport | null>(null);
  const [metaReportError, setMetaReportError] = useState("");
  const [task, setTask] = useState({ title: "", description: "", dueAt: "", assigneeId: "", priority: "2" });
  const [report, setReport] = useState({ periodType: "WEEKLY", periodStart: shiftDateKey(today, -6), periodEnd: today, workCompleted: "", resultSummary: "", bestResult: "", problems: "", nextActions: "", creativesPublished: "0", qualifiedLeads: "0", unqualifiedLeads: "0" });
  const [reviewComments, setReviewComments] = useState<Record<number, string>>({});
  const [metricMonth, setMetricMonth] = useState(today.slice(0, 7));
  const [adPeriod, setAdPeriod] = useState<AdPeriod>("MONTH");
  const [campaignsOpen, setCampaignsOpen] = useState(false);
  const [dailyOpen, setDailyOpen] = useState(false);
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState("");
  const selectedMonth = metricMonth;
  const canReview = data?.role === "DIRECTOR" || data?.role === "OPERATIONS_DIRECTOR";
  const adRange = useMemo(() => {
    const first = `${selectedMonth}-01`;
    const currentMonth = today.slice(0, 7) === selectedMonth;
    const end = currentMonth ? today : monthEndKey(selectedMonth);
    const start = adPeriod === "TODAY" ? end
      : adPeriod === "YESTERDAY" ? shiftDateKey(end, -1)
        : adPeriod === "LAST_7_DAYS" ? shiftDateKey(end, -6)
          : first;
    const clampedStart = start < first ? first : start;
    return {
      start: clampedStart,
      end: adPeriod === "YESTERDAY" ? shiftDateKey(end, -1) : end,
      label: adPeriod === "TODAY" ? `Сегодня, ${dateLabel(end)}`
        : adPeriod === "YESTERDAY" ? `Вчера, ${dateLabel(shiftDateKey(end, -1))}`
          : adPeriod === "LAST_7_DAYS" ? `${dateLabel(clampedStart)} — ${dateLabel(end)}`
            : monthName(selectedMonth),
    };
  }, [adPeriod, selectedMonth]);
  const campaignRows = useMemo(() => (metaReport?.campaigns ?? []).map((campaign) => ({
    ...campaign,
    ...(adPeriod === "MONTH" ? campaign : sumMeta(campaign.daily.filter((row) => row.date >= adRange.start && row.date <= adRange.end))),
    ads: campaign.ads.map((ad) => ({
      ...ad,
      ...(adPeriod === "MONTH" ? ad : sumMeta(ad.daily.filter((row) => row.date >= adRange.start && row.date <= adRange.end))),
    })).filter((ad) => ad.spend > 0 || ad.impressions > 0),
  })), [adPeriod, adRange.end, adRange.start, metaReport]);
  const metaTotals = useMemo(() => sumMeta(campaignRows), [campaignRows]);
  const metaDailyRows = useMemo(() => (metaReport?.daily ?? []).filter((row) => row.date >= adRange.start && row.date <= adRange.end), [adRange.end, adRange.start, metaReport]);
  const metaSpendKzt = metaReport?.exchangeRate ? Math.round(metaTotals.spend * metaReport.exchangeRate) : null;
  const attentionItems: Array<{ title: string; fact: string; action: string }> = [];
  if (data && data.month === selectedMonth) {
    const overdueTasks = data.tasks.filter((item) => item.status !== "DONE" && item.dueAt && item.dueAt.slice(0, 10) < today).length;
    if (!data.reports.length) attentionItems.push({ title: "Нет отчёта маркетолога", fact: `За ${selectedMonth} человеческий отчёт ещё не отправлен.`, action: "Маркетологу заполнить сделанное, результат, качество обращений, проблемы и следующий план." });
    if (data.reports.some((item) => item.status === "NEEDS_REVISION")) attentionItems.push({ title: "Есть отчёт на доработке", fact: `${data.reports.filter((item) => item.status === "NEEDS_REVISION").length} отчёт(а) возвращено директором.`, action: "Исправить отчёт по комментарию и отправить повторно." });
    if (overdueTasks) attentionItems.push({ title: "Просрочены маркетинговые задачи", fact: `${overdueTasks} задач(и) не завершены к сроку.`, action: "Назначить новый срок либо перевести выполненную задачу на проверку." });
    if (data.dailyCrm.totals.leadsReceived > 0 && data.dailyCrm.totals.contacted === 0) attentionItems.push({ title: "Новые обращения без зафиксированного контакта", fact: `${data.dailyCrm.totals.leadsReceived} новых обращений, контактов — 0.`, action: "Директору проверить менеджеров и зафиксировать первый контакт в CRM." });
    if (metaReport?.key === selectedMonth && metaReport.spend > 0 && metaReport.conversations === 0 && metaReport.leadActions === 0) attentionItems.push({ title: "Расход без результата Meta", fact: `${sourceMoney(metaReport.spend, metaReport.currency)} расхода, переписок и lead-событий — 0.`, action: "Остановить слабые объявления и проверить креатив, аудиторию и сообщение." });
  }
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const response = await fetch(`/api/marketing?month=${encodeURIComponent(selectedMonth)}`, { cache: "no-store" });
    if (response.ok) setData(await response.json() as Data);
    else setError("Не удалось загрузить маркетинг");
    setLoading(false);
  }, [selectedMonth]);
  const loadMeta = useCallback(async () => {
    try {
      const response = await fetch(`/api/marketing/meta-campaigns?month=${encodeURIComponent(selectedMonth)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("META_REPORT_FAILED");
      setMetaReport(await response.json() as MetaCampaignReport);
      setMetaReportError("");
    } catch {
      setMetaReport(null);
      setMetaReportError("Meta временно не отдала детализацию. Последние данные ORDA сохранены, попробуйте обновить позже.");
    }
  }, [selectedMonth]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (!data?.integration.configured || data.month !== selectedMonth) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (!cancelled) await loadMeta();
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [data?.integration.configured, data?.integration.lastSyncedAt, data?.month, loadMeta, selectedMonth]);

  async function send(method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>) {
    setError("");
    const response = await fetch("/api/marketing", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error ?? "Не удалось сохранить"); return false; }
    await load(); return true;
  }
  async function addTask(event: FormEvent) { event.preventDefault(); if (await send("POST", { action: "task", ...task })) setTask({ title: "", description: "", dueAt: "", assigneeId: "", priority: "2" }); }
  async function syncMeta() {
    setSyncNotice("Обновляем данные Meta…");
    const success = await send("POST", { action: "sync-meta", month: selectedMonth });
    if (!success) { setSyncNotice(""); return; }
    await loadMeta();
    setSyncNotice("Данные Meta обновлены");
  }
  async function addReport(event: FormEvent) {
    event.preventDefault();
    if (await send("POST", { action: "report", ...report })) setReport({ periodType: "WEEKLY", periodStart: shiftDateKey(today, -6), periodEnd: today, workCompleted: "", resultSummary: "", bestResult: "", problems: "", nextActions: "", creativesPublished: "0", qualifiedLeads: "0", unqualifiedLeads: "0" });
  }
  async function remove(action: "task" | "report", id: number, title: string) {
    if (!window.confirm(`Удалить «${title}»? Это действие нельзя отменить.`)) return;
    await send("DELETE", { action, id });
  }
  async function reviewReport(id: number, status: "APPROVED" | "NEEDS_REVISION") {
    if (await send("PATCH", { action: "report-review", id, status, directorComment: reviewComments[id] ?? "" })) setReviewComments((current) => ({ ...current, [id]: "" }));
  }

  return <main className="min-w-0 space-y-5 p-4 sm:p-6 xl:p-8">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-semibold uppercase tracking-[.18em] text-fuchsia-300">Кабинет собственника и директора</p><h1 className="mt-1 text-3xl font-bold">Результаты маркетинга</h1><p className="mt-1 max-w-3xl text-sm text-slate-400">Сначала факты Meta, затем воронка WhatsApp → заявка → КП → замер → заказ. Автоматические цифры не нужно переносить вручную.</p></div><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Месяц данных<input aria-label="Месяц маркетинга" type="month" value={selectedMonth} onChange={(event)=>{setMetricMonth(event.target.value);setAdPeriod("MONTH");setMetaReport(null);}} className={`${field} mt-1`}/></label></header>
    {error && <p role="alert" className="rounded-xl border border-red-800 bg-red-950/40 p-3 text-red-200">{error}</p>}
    {loading && !data ? <div className="grid place-items-center rounded-2xl border border-slate-800 p-16 text-slate-400"><RefreshCw className="animate-spin"/></div> : null}
    {data ? <>
      {metaReportError && <p role="alert" className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-100">{metaReportError}</p>}
      <section className="overflow-hidden rounded-2xl border border-fuchsia-500/20 bg-[#101827]">
        <div className="border-b border-slate-800 p-4 sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-2xl font-bold">Meta Ads</h2><span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-200">Автоматически</span></div><p className="mt-1 text-sm text-slate-400">{adRange.label} · 5 рабочих кампаний ORDA{metaReport?.loadedAt ? ` · получено из Meta ${new Date(metaReport.loadedAt).toLocaleString("ru-RU")}` : ""}</p></div>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-950 p-1 sm:grid-cols-4">{([["TODAY","Сегодня"],["YESTERDAY","Вчера"],["LAST_7_DAYS","7 дней"],["MONTH","Месяц"]] as Array<[AdPeriod,string]>).map(([value,label])=><button key={value} type="button" onClick={()=>setAdPeriod(value)} className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${adPeriod===value?"bg-fuchsia-700 text-white":"text-slate-400 hover:text-white"}`}>{label}</button>)}</div>
          </div>
          {metaReport && metaReport.key === selectedMonth && data.month === selectedMonth ? <>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <OwnerMetric icon={<BarChart3 size={19}/>} label="Общий расход рекламы" value={metaSpendKzt === null ? sourceMoney(metaTotals.spend, metaReport.currency) : money(metaSpendKzt)} note={`${sourceMoney(metaTotals.spend, metaReport.currency)}${metaReport.exchangeRate ? ` · курс ${metaReport.exchangeRate.toFixed(2)} ₸` : ""}`}/>
              <OwnerMetric icon={<MessageCircle size={19}/>} label="Начатые переписки" value={number(metaTotals.conversations)} note={metaTotals.conversations && metaSpendKzt !== null ? `${money(metaSpendKzt/metaTotals.conversations)} за переписку` : "Ответы и заявки проверяются в CRM"}/>
              <OwnerMetric icon={<MousePointerClick size={19}/>} label="Клики по ссылке" value={number(metaTotals.linkClicks)} note={metaTotals.linkClicks && metaSpendKzt !== null ? `${money(metaSpendKzt/metaTotals.linkClicks)} за клик` : "Переходы из объявлений"}/>
              <OwnerMetric icon={<Eye size={19}/>} label="Показы" value={number(metaTotals.impressions)} note="Сколько раз показана реклама"/>
              <OwnerMetric icon={<Eye size={19}/>} label="Охват кампаний" value={number(metaTotals.reach)} note="Сумма охвата по кампаниям"/>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" onClick={()=>setCampaignsOpen(value=>!value)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-4 font-semibold">{campaignsOpen?<ChevronDown size={18}/>:<ChevronRight size={18}/>}Кампании и объявления ({campaignRows.length})</button>
              <button type="button" onClick={()=>setDailyOpen(value=>!value)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-4 font-semibold">{dailyOpen?<ChevronDown size={18}/>:<ChevronRight size={18}/>}Расход по дням</button>
              <button type="button" disabled={loading} onClick={()=>void syncMeta()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-fuchsia-700 px-4 font-semibold disabled:opacity-50"><RefreshCw size={17} className={loading?"animate-spin":""}/>Обновить из Meta</button>
              {syncNotice&&<span className="text-sm text-emerald-300">{syncNotice}</span>}
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">ORDA загружает свежую детализацию при открытии страницы и выполняет ежедневную автоматическую сверку. Переписка Meta ещё не является подтверждённым обращением CRM. {metaReport.exchangeRateFallback==="LAST_SUCCESSFUL_SYNC"?"Если НБК временно недоступен, используется последний успешно полученный курс.":""}</p>
          </> : metaReportError ? <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-5"><strong className="text-amber-100">Свежая детализация Meta временно недоступна</strong><p className="mt-2 text-sm leading-6 text-slate-300">ORDA продолжает показывать сохранённые результаты CRM и последнюю синхронизацию. Повторите загрузку позже — вводить рекламные цифры вручную не требуется.</p><button type="button" onClick={()=>void loadMeta()} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-amber-500/30 px-4 text-sm font-semibold text-amber-100"><RefreshCw size={16}/>Повторить загрузку</button></div> : <div className="mt-5 flex min-h-36 items-center justify-center rounded-xl border border-dashed border-slate-700 text-slate-400"><RefreshCw className="mr-2 animate-spin" size={18}/>Получаем свежие данные Meta…</div>}
        </div>

        {campaignsOpen && metaReport && <div className="border-b border-slate-800 p-4 sm:p-5"><div className="overflow-x-auto"><table className="w-full min-w-[950px] text-sm"><thead className="text-left text-slate-500"><tr>{["Кампания / объявление","Расход","Переписки","Цена переписки","Клики","Показы","Охват"].map(label=><th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-800">{campaignRows.map(row=><Fragment key={row.id}><tr><td className="px-3 py-3"><button type="button" onClick={()=>setExpandedCampaignId(value=>value===row.id?null:row.id)} className="flex items-start gap-2 text-left">{expandedCampaignId===row.id?<ChevronDown className="mt-0.5 shrink-0" size={16}/>:<ChevronRight className="mt-0.5 shrink-0" size={16}/>}<span><strong className="text-white">{row.name}</strong><span className="block text-xs text-slate-500">Кампания · {row.id} · объявлений: {row.ads.length}</span></span></button></td><td className="px-3 py-3"><strong>{metaReport.exchangeRate?money(row.spend*metaReport.exchangeRate):sourceMoney(row.spend,metaReport.currency)}</strong><span className="block text-xs text-slate-500">{sourceMoney(row.spend,metaReport.currency)}</span></td><td className="px-3 py-3">{number(row.conversations)}</td><td className="px-3 py-3">{row.conversations&&metaReport.exchangeRate?money(row.spend*metaReport.exchangeRate/row.conversations):"—"}</td><td className="px-3 py-3">{number(row.linkClicks)}</td><td className="px-3 py-3">{number(row.impressions)}</td><td className="px-3 py-3">{number(row.reach)}</td></tr>{expandedCampaignId===row.id&&<tr><td colSpan={7} className="bg-slate-950/60 px-6 py-4"><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-fuchsia-300">Объявления внутри кампании</p>{row.ads.length?<div className="overflow-x-auto"><table className="w-full min-w-[780px] text-xs"><tbody className="divide-y divide-slate-800">{row.ads.map(ad=><tr key={ad.id}><td className="py-2 pr-3"><strong className="text-slate-200">{ad.name}</strong><span className="block text-slate-600">{ad.id}</span></td><td className="px-3 py-2">{metaReport.exchangeRate?money(ad.spend*metaReport.exchangeRate):sourceMoney(ad.spend,metaReport.currency)}</td><td className="px-3 py-2">Переписки: {number(ad.conversations)}</td><td className="px-3 py-2">Клики: {number(ad.linkClicks)}</td><td className="px-3 py-2">Показы: {number(ad.impressions)}</td><td className="px-3 py-2">Охват: {number(ad.reach)}</td></tr>)}</tbody></table></div>:<p className="text-slate-500">У Meta нет расходов по отдельным объявлениям за выбранный период.</p>}</td></tr>}</Fragment>)}</tbody></table></div></div>}

        {dailyOpen && metaReport && <div className="p-4 sm:p-5"><h3 className="font-bold">Динамика по дням</h3><p className="mt-1 text-sm text-slate-500">Общий расход пяти кампаний, переписки и клики за каждый день.</p><div className="mt-4 space-y-2">{metaDailyRows.map(row=>{const max=Math.max(...metaDailyRows.map(item=>item.spend),1);return <div key={row.date} className="grid gap-2 rounded-xl border border-slate-800 p-3 sm:grid-cols-[110px_1fr_130px_110px_110px] sm:items-center"><strong>{dateLabel(row.date)}</strong><div className="h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-fuchsia-500" style={{width:`${Math.max(2,row.spend/max*100)}%`}}/></div><span className="font-semibold">{metaReport.exchangeRate?money(row.spend*metaReport.exchangeRate):sourceMoney(row.spend,metaReport.currency)}</span><span className="text-sm text-slate-400">{row.conversations} переписок</span><span className="text-sm text-slate-400">{row.linkClicks} кликов</span></div>})}{!metaDailyRows.length&&<p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-slate-500">За этот период расходов не было.</p>}</div></div>}
      </section>

      <section className="rounded-2xl border border-blue-500/20 bg-[#101827] p-4 sm:p-5">
        <div><p className="text-xs font-bold uppercase tracking-[.18em] text-blue-300">Результат CRM за {monthName(selectedMonth)}</p><h2 className="mt-1 text-xl font-bold">Все каналы продаж</h2><p className="mt-1 text-sm text-slate-400">Сюда входят обращения из WhatsApp, звонков, Instagram, Meta и других источников. Это не только лиды рекламы Meta.</p></div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4"><OwnerMetric label="Все новые обращения CRM" value={number(data.summary.leads)} note="Созданы в CRM за месяц"/><OwnerMetric label="Заказы CRM" value={number(data.summary.orders)} note="Оформлены за месяц"/><OwnerMetric label="Сумма заказов" value={money(data.summary.revenue)} note="Не равно полученной оплате"/><OwnerMetric label="Конверсия в заказ" value={data.summary.conversion===null?"—":`${data.summary.conversion.toFixed(1)}%`} note="Заказы / обращения"/></div>
        <h3 className="mt-5 font-bold text-white">Воронка Meta → WhatsApp → CRM · {monthName(selectedMonth)}</h3>
        <p className="mt-1 text-sm text-slate-400">Каждый этап считается за выбранный месяц. КП и замеры считаются по уникальным клиентам, чтобы повторная версия документа не раздувала воронку.</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"><OwnerMetric label="1. Переписки WhatsApp" value={number(data.summary.metaConversations)} note="Начатые переписки из Meta Ads"/><OwnerMetric label="2. Заявки из Meta" value={number(data.summary.metaCrmLeads)} note={salesConversionPercent(data.summary.metaCrmLeads,data.summary.metaConversations)===null?"Нет переписок для расчёта":`${salesConversionPercent(data.summary.metaCrmLeads,data.summary.metaConversations)?.toFixed(1)}% из переписок`}/><OwnerMetric label="3. Клиенты с КП" value={number(data.summary.metaProposals)} note={salesConversionPercent(data.summary.metaProposals,data.summary.metaCrmLeads)===null?"Нет заявок для расчёта":`${salesConversionPercent(data.summary.metaProposals,data.summary.metaCrmLeads)?.toFixed(1)}% из заявок`}/><OwnerMetric label="4. Замеры" value={number(data.summary.metaMeasurements)} note={salesConversionPercent(data.summary.metaMeasurements,data.summary.metaProposals)===null?"Нет КП для расчёта":`${salesConversionPercent(data.summary.metaMeasurements,data.summary.metaProposals)?.toFixed(1)}% из КП`}/><OwnerMetric label="5. Заказы" value={number(data.summary.metaOrders)} note={salesConversionPercent(data.summary.metaOrders,data.summary.metaMeasurements)===null?"Нет замеров для расчёта":`${salesConversionPercent(data.summary.metaOrders,data.summary.metaMeasurements)?.toFixed(1)}% из замеров`}/></div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"><OwnerMetric label="Цена переписки" value={data.summary.costPerConversation===null?"—":money(data.summary.costPerConversation)} note="Расход / переписки"/><OwnerMetric label="Цена заявки" value={data.summary.cpl===null?"—":money(data.summary.cpl)} note="Расход / заявки CRM из Meta"/><OwnerMetric label="Цена заказа" value={data.summary.cac===null?"—":money(data.summary.cac)} note="Расход / заказы из Meta"/><OwnerMetric label="Сумма заказов" value={money(data.summary.metaRevenue)} note="Оборот, а не полученные деньги"/><OwnerMetric label="ROAS" value={data.summary.roas===null?"—":`${data.summary.roas.toFixed(2)}×`} note="Сумма заказов / расход Meta"/></div>
        <p className="mt-3 text-xs leading-5 text-slate-400">Переписка ещё не является заявкой: менеджер создаёт карточку только для клиента, который действительно интересуется лестницей. Поэтому цена переписки и цена заявки должны отличаться.</p>
        {data.summary.metaAttributionMissing?<p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-100">В Meta есть переписки, но в CRM нет лидов с источником Meta за этот месяц. Проверьте источник обращения, иначе цена CRM-лида, цена заказа и ROAS будут неполными.</p>:null}
      </section>

      <section id="manager-kpi" className="scroll-mt-5 rounded-2xl border border-slate-800 bg-[#101827] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-white">KPI и продажи менеджеров · {selectedMonth}</h2><p className="mt-1 text-sm text-slate-400">Обращения — по дате заявки, продажи — по подтверждённой дате заказа. Личный план назначает директор.</p></div>{canReview && <a href={`/sales-plan?month=${selectedMonth}#manager-kpi`} className="rounded-lg border border-blue-500/40 px-3 py-2 text-sm font-semibold text-blue-200">Назначить план</a>}</div>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="border-b border-slate-700 text-left text-slate-400"><tr><th className="px-3 py-2">Менеджер</th><th className="px-3 py-2 text-right">Обращения</th><th className="px-3 py-2 text-right">Заказы</th><th className="px-3 py-2 text-right">Конверсия в продажу</th><th className="px-3 py-2 text-right">План продаж</th><th className="px-3 py-2 text-right">Факт продаж</th><th className="px-3 py-2 text-right">Выполнение</th></tr></thead><tbody className="divide-y divide-slate-800">{data.managerSales.rows.map(row => { const conversion = salesConversionPercent(row.orders, row.leads); return <tr key={row.userId}><td className="px-3 py-3 font-semibold text-white">{row.name}{!row.active && <span className="ml-2 text-xs font-normal text-slate-500">бывший сотрудник</span>}</td><td className="px-3 py-3 text-right tabular-nums">{row.leads}</td><td className="px-3 py-3 text-right tabular-nums">{row.orders}</td><td className="px-3 py-3 text-right font-semibold tabular-nums text-fuchsia-200">{conversion === null ? "—" : `${conversion.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`}</td><td className="px-3 py-3 text-right tabular-nums">{row.planSales === null ? "Не задан" : money(row.planSales)}</td><td className="px-3 py-3 text-right font-semibold tabular-nums text-emerald-200">{money(row.sales)}</td><td className="px-3 py-3 text-right font-semibold tabular-nums text-blue-200">{row.completionPercent === null ? "—" : `${row.completionPercent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`}</td></tr>; })}{data.managerSales.otherOrders > 0 && <tr><td className="px-3 py-3 text-slate-300">Директор или без менеджера</td><td className="px-3 py-3 text-right">—</td><td className="px-3 py-3 text-right tabular-nums">{data.managerSales.otherOrders}</td><td className="px-3 py-3 text-right">—</td><td className="px-3 py-3 text-right">—</td><td className="px-3 py-3 text-right tabular-nums">{money(data.managerSales.otherSales)}</td><td className="px-3 py-3 text-right">—</td></tr>}</tbody></table></div>
        {!data.managerSales.rows.length && <p className="mt-3 text-sm text-slate-400">Менеджеров продаж не найдено. Проверьте роли сотрудников.</p>}
      </section>

      <section className="rounded-2xl border border-amber-500/20 bg-[#101827] p-4">
        <h2 className="text-xl font-bold text-amber-100">Требует внимания</h2>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">{attentionItems.map((item)=><article key={`${item.title}-${item.fact}`} className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-4"><strong>{item.title}</strong><p className="mt-2 text-sm text-slate-300">Факт: {item.fact}</p><p className="mt-2 text-sm text-amber-100">Действие: {item.action}</p></article>)}{!attentionItems.length&&<p className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-200">Критических замечаний по доступным данным нет.</p>}</div>
      </section>

      <section className="rounded-2xl border border-cyan-500/20 bg-[#101827] p-4">
        <div><p className="text-xs font-bold uppercase tracking-[.18em] text-cyan-300">Работа менеджеров продаж за вчера</p><h2 className="mt-1 text-xl font-bold">{data.dailyCrm.dateLabel}</h2><p className="mt-1 text-sm text-slate-400">{data.dailyCrm.reportRequired ? "Только менеджеры продаж. Замерщики здесь не оцениваются; их работа контролируется в разделе замеров." : `Это выходной день (${data.dailyCrm.weeklyDayOffLabel}). Показатели сохранены, обязательный отчёт не требуется.`}</p></div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6"><Stat label="Новые обращения" value={data.dailyCrm.totals.leadsReceived}/><Stat label="Зафиксирован контакт" value={data.dailyCrm.totals.contacted}/><Stat label="Квалифицированы" value={data.dailyCrm.totals.interested}/><Stat label="Заказы" value={data.dailyCrm.totals.ordersCreated}/><Stat label="Сумма заказов" value={money(data.dailyCrm.totals.revenue)}/><Stat label="Без контакта" value={Math.max(0,data.dailyCrm.totals.leadsReceived-data.dailyCrm.totals.contacted)}/></div>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="text-left text-slate-500"><tr>{["Менеджер","Обращения","Контакт","Квалифицированы","Заказы","Конверсия в продажу","Сумма заказов","Ежедневный отчёт"].map(label=><th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-800">{data.dailyCrm.managers.map(row=>{ const conversion = salesConversionPercent(row.ordersCreated, row.leadsReceived); return <tr key={row.managerId}><td className="px-3 py-3 font-semibold text-white">{row.manager}</td><td className="px-3 py-3">{row.leadsReceived}</td><td className="px-3 py-3">{row.contacted}</td><td className="px-3 py-3">{row.interested}</td><td className="px-3 py-3">{row.ordersCreated}</td><td className="px-3 py-3 font-semibold text-fuchsia-200">{conversion === null ? "—" : `${conversion.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`}</td><td className="px-3 py-3">{money(row.revenue)}</td><td className={`px-3 py-3 font-semibold ${row.reportStatus==="DAY_OFF"?"text-slate-300":row.reportStatus==="SENT"?"text-emerald-300":row.reportStatus==="ACKNOWLEDGED"?"text-blue-300":"text-amber-300"}`}>{row.reportStatus==="DAY_OFF"?"Выходной — отчёт не нужен":row.reportStatus==="SENT"?"Отправлен":row.reportStatus==="ACKNOWLEDGED"?"Ознакомлен":"Не отправлен"}</td></tr>; })}</tbody></table></div>
      </section>

      <section className="rounded-2xl border border-violet-500/20 bg-[#101827] p-4">
        <div className="flex items-start gap-3"><ClipboardCheck className="mt-1 text-violet-300"/><div><h2 className="text-xl font-bold">Отчёт маркетолога</h2><p className="mt-1 text-sm text-slate-400">Человеческая часть отчёта: выполненная работа, качество обращений, лучший результат, проблемы и следующий план. Расход, показы, клики и CRM система уже считает автоматически.</p></div></div>
        <div className="mt-4 rounded-xl border border-violet-500/15 bg-violet-500/5 p-3 text-sm text-slate-300"><strong className="text-violet-200">Что заполняет человек:</strong> опубликованные креативы, качество обращений, вывод по лучшей гипотезе, причины проблем и конкретный план с ответственным и сроком. Расход, переписки, клики, показы и охват переносить вручную не нужно.</div>
        <form onSubmit={addReport} className="mt-5 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm text-slate-300">Период<select className={`${field} mt-1`} value={report.periodType} onChange={(event)=>setReport({...report,periodType:event.target.value})}>{Object.entries(reportPeriodLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
            <Input label="Начало" type="date" value={report.periodStart} onChange={(value)=>setReport({...report,periodStart:value})}/>
            <Input label="Конец" type="date" value={report.periodEnd} onChange={(value)=>setReport({...report,periodEnd:value})}/>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="Опубликовано креативов" type="number" value={report.creativesPublished} onChange={(value)=>setReport({...report,creativesPublished:value})}/>
            <Input label="Квалифицированные обращения" type="number" value={report.qualifiedLeads} onChange={(value)=>setReport({...report,qualifiedLeads:value})}/>
            <Input label="Нецелевые обращения" type="number" value={report.unqualifiedLeads} onChange={(value)=>setReport({...report,unqualifiedLeads:value})}/>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <TextArea label="Что сделано" value={report.workCompleted} onChange={(value)=>setReport({...report,workCompleted:value})}/>
            <TextArea label="Какой результат получен" value={report.resultSummary} onChange={(value)=>setReport({...report,resultSummary:value})}/>
            <TextArea label="Лучший креатив / гипотеза и почему" value={report.bestResult} onChange={(value)=>setReport({...report,bestResult:value})}/>
            <TextArea label="Проблемы и причины" value={report.problems} onChange={(value)=>setReport({...report,problems:value})}/>
          </div>
          <TextArea label="Что будет сделано дальше: действие, ответственный, срок" value={report.nextActions} onChange={(value)=>setReport({...report,nextActions:value})}/>
          <button className="min-h-11 rounded-xl bg-violet-700 px-4 font-semibold">Отправить отчёт на проверку</button>
        </form>

        <div className="mt-6 space-y-3">
          <h3 className="font-bold">История отчётов</h3>
          {data.reports.map(item=><article key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{reportPeriodLabels[item.periodType]} · {new Date(item.periodStart).toLocaleDateString("ru-RU")}–{new Date(item.periodEnd).toLocaleDateString("ru-RU")}</p><p className="mt-1 text-xs text-slate-500">{item.author.name} · отправлен {new Date(item.submittedAt).toLocaleString("ru-RU")}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${item.status==="APPROVED"?"bg-emerald-500/15 text-emerald-200":item.status==="NEEDS_REVISION"?"bg-amber-500/15 text-amber-200":"bg-blue-500/15 text-blue-200"}`}>{reportStatusLabels[item.status]}</span></div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm"><Stat label="Креативы" value={item.creativesPublished}/><Stat label="Квалифицировано" value={item.qualifiedLeads}/><Stat label="Нецелевые" value={item.unqualifiedLeads}/></div>
            <div className="mt-3 grid gap-3 text-sm lg:grid-cols-2"><ReportText label="Сделано" value={item.workCompleted}/><ReportText label="Результат" value={item.resultSummary}/><ReportText label="Лучший результат" value={item.bestResult}/><ReportText label="Проблемы" value={item.problems}/><ReportText label="Следующие действия" value={item.nextActions}/>{item.directorComment&&<ReportText label={`Комментарий: ${item.reviewedBy?.name??"директор"}`} value={item.directorComment}/>}</div>
            {canReview&&<div className="mt-4 grid gap-2 border-t border-slate-800 pt-4 lg:grid-cols-[1fr_auto_auto_auto]"><input aria-label={`Комментарий к отчёту ${item.id}`} value={reviewComments[item.id]??""} onChange={(event)=>setReviewComments((current)=>({...current,[item.id]:event.target.value}))} placeholder="Комментарий директора" className={field}/><button type="button" onClick={()=>void reviewReport(item.id,"NEEDS_REVISION")} className="min-h-11 rounded-xl border border-amber-500/30 px-4 text-sm font-semibold text-amber-200">На доработку</button><button type="button" onClick={()=>void reviewReport(item.id,"APPROVED")} className="min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-semibold">Принять</button><button type="button" aria-label="Удалить отчёт" onClick={()=>void remove("report",item.id,`отчёт ${item.author.name}`)} className="min-h-11 rounded-xl border border-red-500/30 px-4 text-red-200"><Trash2 size={16}/></button></div>}
          </article>)}
          {!data.reports.length&&<p className="rounded-xl border border-dashed border-slate-800 p-5 text-center text-sm text-slate-500">За выбранный месяц отчёты ещё не отправлялись.</p>}
        </div>
      </section>

      <section>
        <FormPanel title="Новая задача" subtitle="Попадёт в маркетинговый Kanban">
          <form onSubmit={addTask} className="grid gap-3"><Input label="Что сделать" value={task.title} onChange={(value)=>setTask({...task,title:value})}/><TextArea label="Ожидаемый результат и критерий готовности" value={task.description} onChange={(value)=>setTask({...task,description:value})}/><div className="grid gap-3 sm:grid-cols-3"><Input label="Срок" type="date" value={task.dueAt} onChange={(value)=>setTask({...task,dueAt:value})}/><label className="text-sm text-slate-300">Ответственный<select className={`${field} mt-1`} value={task.assigneeId} onChange={(e)=>setTask({...task,assigneeId:e.target.value})}><option value="">Не назначен</option>{data.assignees.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-sm text-slate-300">Приоритет<select className={`${field} mt-1`} value={task.priority} onChange={(e)=>setTask({...task,priority:e.target.value})}><option value="1">Обычный</option><option value="2">Важный</option><option value="3">Срочный</option></select></label></div><button className="min-h-11 rounded-xl bg-blue-700 px-4 font-semibold"><Plus size={16} className="mr-2 inline"/>Добавить задачу</button></form>
        </FormPanel>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4"><h2 className="mb-4 flex items-center gap-2 text-xl font-bold"><KanbanSquare className="text-blue-400"/>Marketing Kanban</h2><div className="overflow-x-auto"><div className="grid min-w-[1050px] grid-cols-4 gap-3">{taskColumns.map(([status,label])=><div key={status} className="rounded-xl bg-slate-950/70 p-3"><div className="mb-3 flex justify-between"><strong>{label}</strong><span className="rounded-full bg-blue-500/15 px-2 text-blue-200">{data.tasks.filter(item=>item.status===status).length}</span></div><div className="space-y-2">{data.tasks.filter(item=>item.status===status).map(item=><article key={item.id} className="rounded-xl border border-slate-800 bg-[#101827] p-3"><div className="flex items-start justify-between gap-2"><strong className="block">{item.title}</strong>{canReview&&<button type="button" aria-label="Удалить задачу" onClick={()=>void remove("task",item.id,item.title)} className="text-red-300"><Trash2 size={15}/></button>}</div>{item.description && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-400">{item.description}</p>}<p className="mt-2 text-xs text-slate-500">{item.assignee?.name ?? "Не назначен"} · {item.dueAt ? new Date(item.dueAt).toLocaleDateString("ru-RU") : "без срока"} · приоритет {item.priority} · создал {item.createdBy.name}</p><select aria-label="Этап задачи" value={item.status} onChange={(e)=>void send("PATCH",{action:"task-status",id:item.id,status:e.target.value})} className="mt-3 min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm">{taskColumns.map(([value,title])=><option key={value} value={value}>{title}</option>)}</select></article>)}{!data.tasks.some(item=>item.status===status)&&<p className="rounded-xl border border-dashed border-slate-800 p-4 text-center text-sm text-slate-600">Пусто</p>}</div></div>)}</div></div></section>

    </> : null}
  </main>;
}

function Stat({label,value}:{label:string;value:string|number}) { return <div className="min-w-0 rounded-2xl border border-slate-800 bg-[#101827] p-4"><p className="truncate text-xs text-slate-500">{label}</p><p className="mt-2 truncate text-xl font-bold">{value}</p></div>; }
function OwnerMetric({label,value,note,icon}:{label:string;value:string|number;note:string;icon?:React.ReactNode}) { return <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950/60 p-4"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{icon&&<span className="text-fuchsia-300">{icon}</span>}{label}</div><p className="mt-2 truncate text-2xl font-bold text-white">{value}</p><p className="mt-1 min-h-8 text-xs leading-4 text-slate-500">{note}</p></div>; }
function FormPanel({title,subtitle,children}:{title:string;subtitle:string;children:React.ReactNode}) { return <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4"><h2 className="font-bold">{title}</h2><p className="mb-4 text-xs text-slate-500">{subtitle}</p>{children}</section>; }
function Input({label,value,onChange,type="text"}:{label:string;value:string;onChange:(value:string)=>void;type?:string}) { return <label className="text-sm text-slate-300">{label}<input required type={type} min={type==="number"?0:undefined} value={value} onChange={(e)=>onChange(e.target.value)} className={`${field} mt-1`}/></label>; }
function TextArea({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) { return <label className="text-sm text-slate-300">{label}<textarea required rows={3} value={value} onChange={(event)=>onChange(event.target.value)} className={`${field} mt-1 py-3`}/></label>; }
function ReportText({label,value}:{label:string;value:string}) { return <div className="rounded-xl border border-slate-800 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 whitespace-pre-wrap leading-6 text-slate-200">{value}</p></div>; }
