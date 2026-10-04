"use client";

import { BarChart3, BriefcaseBusiness, ClipboardCheck, KanbanSquare, Plus, RefreshCw, Trash2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

type Status = "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE";
type Task = { id: number; title: string; description: string | null; status: Status; priority: number; dueAt: string | null; assignee: { id: number; name: string } | null; createdBy: { id: number; name: string } };
type Metric = { id: number; metricMonth: string; channel: string; spend: string; leads: number; orders: number; revenue: string };
type Vacancy = { id: number; title: string; status: "OPEN" | "INTERVIEW" | "OFFER" | "HIRED" | "PAUSED"; candidates: number; note: string | null };
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
  spend: number;
  conversations: number;
  leadActions: number;
  linkClicks: number;
  impressions: number;
  campaigns: Array<{ id: string; name: string; spend: number; reach: number; impressions: number; linkClicks: number; conversations: number; leadActions: number }>;
};
type Data = {
  role: string;
  month: string;
  tasks: Task[];
  metrics: Metric[];
  reports: MarketingReport[];
  vacancies: Vacancy[];
  assignees: Array<{ id: number; name: string; role: string }>;
  integration: { configured: boolean; account: string | null; graphVersion: string; automatic: boolean; campaignCount: number; booksToLedger: boolean; state: "NEEDS_SETUP" | "READY" | "ACTIVE"; lastSyncedAt: string | null };
  summary: {
    spend: number;
    leads: number;
    orders: number;
    revenue: number;
    cpl: number | null;
    cac: number | null;
    roas: number | null;
    conversion: number | null;
    spendTracked: boolean;
    crmTracked: boolean;
    metaAttributionMissing: boolean;
  };
  dailyCrm: {
    dateLabel: string;
    totals: { leadsReceived: number; contacted: number; interested: number; measurementsScheduled: number; measurementsCompleted: number; ordersCreated: number; revenue: number };
    managers: Array<{ managerId: number; manager: string; leadsReceived: number; contacted: number; interested: number; measurementsScheduled: number; measurementsCompleted: number; ordersCreated: number; revenue: number; reportStatus: "NOT_SENT" | "ACKNOWLEDGED" | "SENT" }>;
  };
};

const money = (value: number | string) => `${Math.round(Number(value)).toLocaleString("ru-RU")} ₸`;
const sourceMoney = (value: number, currency: string) => new Intl.NumberFormat("ru-RU", { style: "currency", currency }).format(value);
const taskColumns: Array<[Status, string]> = [["TODO", "Нужно сделать"], ["IN_PROGRESS", "В работе"], ["REVIEW", "Проверка"], ["DONE", "Готово"]];
const vacancyLabels: Record<Vacancy["status"], string> = { OPEN: "Открыта", INTERVIEW: "Собеседования", OFFER: "Оффер", HIRED: "Сотрудник найден", PAUSED: "Пауза" };
const reportPeriodLabels: Record<MarketingReport["periodType"], string> = { DAILY: "День", WEEKLY: "Неделя", MONTHLY: "Месяц" };
const reportStatusLabels: Record<MarketingReport["status"], string> = { SUBMITTED: "На проверке", NEEDS_REVISION: "На доработке", APPROVED: "Принят" };
const field = "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white";
const today = new Date().toISOString().slice(0, 10);

export default function MarketingManagementPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [metaReport, setMetaReport] = useState<MetaCampaignReport | null>(null);
  const [metaReportError, setMetaReportError] = useState("");
  const [task, setTask] = useState({ title: "", description: "", dueAt: "", assigneeId: "", priority: "2" });
  const [report, setReport] = useState({ periodType: "WEEKLY", periodStart: today, periodEnd: today, workCompleted: "", resultSummary: "", bestResult: "", problems: "", nextActions: "", creativesPublished: "0", qualifiedLeads: "0", unqualifiedLeads: "0" });
  const [reviewComments, setReviewComments] = useState<Record<number, string>>({});
  const [metricMonth, setMetricMonth] = useState(new Date().toISOString().slice(0, 7));
  const [vacancy, setVacancy] = useState({ title: "", note: "" });
  const selectedMonth = metricMonth;
  const canReview = data?.role === "DIRECTOR" || data?.role === "OPERATIONS_DIRECTOR";
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
      try {
        const response = await fetch(`/api/marketing/meta-campaigns?month=${encodeURIComponent(selectedMonth)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("META_REPORT_FAILED");
        const report = await response.json() as MetaCampaignReport;
        if (!cancelled) { setMetaReport(report); setMetaReportError(""); }
      } catch {
        if (!cancelled) { setMetaReport(null); setMetaReportError("Не удалось загрузить детализацию кампаний Meta"); }
      }
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [data?.integration.configured, data?.integration.lastSyncedAt, data?.month, selectedMonth]);

  async function send(method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>) {
    setError("");
    const response = await fetch("/api/marketing", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error ?? "Не удалось сохранить"); return false; }
    await load(); return true;
  }
  async function addTask(event: FormEvent) { event.preventDefault(); if (await send("POST", { action: "task", ...task })) setTask({ title: "", description: "", dueAt: "", assigneeId: "", priority: "2" }); }
  async function addReport(event: FormEvent) {
    event.preventDefault();
    if (await send("POST", { action: "report", ...report })) setReport({ periodType: "WEEKLY", periodStart: today, periodEnd: today, workCompleted: "", resultSummary: "", bestResult: "", problems: "", nextActions: "", creativesPublished: "0", qualifiedLeads: "0", unqualifiedLeads: "0" });
  }
  async function addVacancy(event: FormEvent) { event.preventDefault(); if (await send("POST", { action: "vacancy", ...vacancy })) setVacancy({ title: "", note: "" }); }
  async function remove(action: "task" | "report" | "vacancy", id: number, title: string) {
    if (!window.confirm(`Удалить «${title}»? Это действие нельзя отменить.`)) return;
    await send("DELETE", { action, id });
  }
  async function reviewReport(id: number, status: "APPROVED" | "NEEDS_REVISION") {
    if (await send("PATCH", { action: "report-review", id, status, directorComment: reviewComments[id] ?? "" })) setReviewComments((current) => ({ ...current, [id]: "" }));
  }

  return <main className="min-w-0 space-y-5 p-4 sm:p-6 xl:p-8">
    <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-semibold uppercase tracking-[.18em] text-fuchsia-300">Director workspace</p><h1 className="mt-1 text-3xl font-bold">Маркетинг и вакансии</h1><p className="mt-1 max-w-3xl text-sm text-slate-400">Обращения, заказы и выручка считаются из CRM; рекламный расход загружается из Meta после подключения. Директор контролирует отклонения, а не переписывает цифры вручную.</p></div><div className="flex flex-wrap gap-2"><input aria-label="Месяц маркетинга" type="month" value={selectedMonth} onChange={(event)=>setMetricMonth(event.target.value)} className={field}/><a href="/reports" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 font-semibold"><BarChart3 size={17}/>KPI менеджеров</a><a href="/finance" className="inline-flex min-h-11 items-center rounded-xl bg-emerald-700 px-4 font-semibold">Финансовые операции</a></div></header>
    {error && <p role="alert" className="rounded-xl border border-red-800 bg-red-950/40 p-3 text-red-200">{error}</p>}
    {loading && !data ? <div className="grid place-items-center rounded-2xl border border-slate-800 p-16 text-slate-400"><RefreshCw className="animate-spin"/></div> : null}
    {data ? <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
        <Stat label="Расход рекламы" value={data.summary.spendTracked ? money(data.summary.spend) : "—"}/><Stat label="Обращения" value={data.summary.leads}/><Stat label="Заказы" value={data.summary.orders}/><Stat label="Выручка" value={money(data.summary.revenue)}/><Stat label="Цена обращения" value={data.summary.cpl === null ? "—" : money(data.summary.cpl)}/><Stat label="Цена заказа" value={data.summary.cac === null ? "—" : money(data.summary.cac)}/><Stat label="ROAS" value={data.summary.roas === null ? "—" : `${data.summary.roas.toFixed(2)}×`}/><Stat label="Конверсия" value={data.summary.conversion === null ? "—" : `${data.summary.conversion.toFixed(1)}%`}/>
      </section>
      {metaReportError && <p role="alert" className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-100">{metaReportError}</p>}
      {metaReport && metaReport.key === selectedMonth && data.month === selectedMonth && <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4">
        <h2 className="text-xl font-bold">Кампании Meta за {selectedMonth}</h2>
        <p className="mt-1 text-sm text-slate-400">Аккаунт act_{metaReport.accountId} · {metaReport.accountTimezone ?? "часовой пояс аккаунта не указан"} · выбрано кампаний: {metaReport.selectedCampaignCount}</p>
        <p className="mt-3 text-sm text-slate-300">Расход: {sourceMoney(metaReport.spend, metaReport.currency)} · начатые переписки: {metaReport.conversations} · события lead Meta: {metaReport.leadActions} · клики по ссылке: {metaReport.linkClicks.toLocaleString("ru-RU")} · показы: {metaReport.impressions.toLocaleString("ru-RU")}</p>
        <p className="mt-2 text-xs text-amber-200">Начатая переписка Meta не означает подтверждённую заявку. Фактические обращения учитываются отдельно в CRM.</p>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead className="text-left text-slate-400"><tr>{["Кампания", "Расход", "Переписки", "Lead Meta", "Клики", "Показы", "Охват"].map(label => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-800">{metaReport.campaigns.map(row => <tr key={row.id}><td className="px-3 py-3"><span className="font-semibold text-white">{row.name}</span><span className="block text-xs text-slate-500">{row.id}</span></td><td className="px-3 py-3">{sourceMoney(row.spend, metaReport.currency)}</td><td className="px-3 py-3">{row.conversations}</td><td className="px-3 py-3">{row.leadActions}</td><td className="px-3 py-3">{row.linkClicks.toLocaleString("ru-RU")}</td><td className="px-3 py-3">{row.impressions.toLocaleString("ru-RU")}</td><td className="px-3 py-3">{row.reach.toLocaleString("ru-RU")}</td></tr>)}</tbody></table></div>
      </section>}

      {!data.summary.spendTracked ? <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-100">Обращения, заказы и выручка уже считаются из CRM. Расход появится после подключения служебного доступа Meta.</p> : null}
      {data.summary.metaAttributionMissing ? <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-100">Обращения и заказы CRM пока не связаны с конкретными кампаниями Meta. Поэтому цена обращения, цена заказа и ROAS не рассчитываются по общим данным всех источников.</p> : null}

      <section className="rounded-2xl border border-amber-500/20 bg-[#101827] p-4">
        <h2 className="text-xl font-bold text-amber-100">Требует внимания</h2>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">{attentionItems.map((item)=><article key={`${item.title}-${item.fact}`} className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-4"><strong>{item.title}</strong><p className="mt-2 text-sm text-slate-300">Факт: {item.fact}</p><p className="mt-2 text-sm text-amber-100">Действие: {item.action}</p></article>)}{!attentionItems.length&&<p className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-200">Критических замечаний по доступным данным нет.</p>}</div>
      </section>

      <section className="rounded-2xl border border-cyan-500/20 bg-[#101827] p-4">
        <div><p className="text-xs font-bold uppercase tracking-[.18em] text-cyan-300">CRM за предыдущий день</p><h2 className="mt-1 text-xl font-bold">{data.dailyCrm.dateLabel}</h2><p className="mt-1 text-sm text-slate-400">Показывает фактическую обработку обращений менеджерами; расход Meta синхронизируется системой отдельно.</p></div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7"><Stat label="Новые заявки" value={data.dailyCrm.totals.leadsReceived}/><Stat label="Есть контакт" value={data.dailyCrm.totals.contacted}/><Stat label="Заинтересованы" value={data.dailyCrm.totals.interested}/><Stat label="Замеры назначены" value={data.dailyCrm.totals.measurementsScheduled}/><Stat label="Замеры завершены" value={data.dailyCrm.totals.measurementsCompleted}/><Stat label="Заказы" value={data.dailyCrm.totals.ordersCreated}/><Stat label="Продажи" value={money(data.dailyCrm.totals.revenue)}/></div>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[800px] text-sm"><thead className="text-left text-slate-500"><tr>{["Менеджер","Заявки","Контакт","Интерес","Замеры","Заказы","Продажи","Отчёт"].map(label=><th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-800">{data.dailyCrm.managers.map(row=><tr key={row.managerId}><td className="px-3 py-3 font-semibold text-white">{row.manager}</td><td className="px-3 py-3">{row.leadsReceived}</td><td className="px-3 py-3">{row.contacted}</td><td className="px-3 py-3">{row.interested}</td><td className="px-3 py-3">{row.measurementsScheduled} / {row.measurementsCompleted}</td><td className="px-3 py-3">{row.ordersCreated}</td><td className="px-3 py-3">{money(row.revenue)}</td><td className={`px-3 py-3 font-semibold ${row.reportStatus==="SENT"?"text-emerald-300":row.reportStatus==="ACKNOWLEDGED"?"text-blue-300":"text-amber-300"}`}>{row.reportStatus==="SENT"?"Отправлен":row.reportStatus==="ACKNOWLEDGED"?"Ознакомлен":"Ждёт отчёта"}</td></tr>)}</tbody></table></div>
      </section>

      <section className="rounded-2xl border border-violet-500/20 bg-[#101827] p-4">
        <div className="flex items-start gap-3"><ClipboardCheck className="mt-1 text-violet-300"/><div><h2 className="text-xl font-bold">Отчёт маркетолога</h2><p className="mt-1 text-sm text-slate-400">Человеческая часть отчёта: выполненная работа, качество обращений, лучший результат, проблемы и следующий план. Расход, показы, клики и CRM система уже считает автоматически.</p></div></div>
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

      <section className="grid gap-4 xl:grid-cols-3">
        <FormPanel title="Meta Ads — автоматически" subtitle="Без ручного переноса цифр директором">
          <div className={`rounded-xl border p-3 text-sm ${data.integration.state === "ACTIVE" || metaReport?.key === selectedMonth ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100" : "border-amber-500/30 bg-amber-500/10 text-amber-100"}`}>
            <p className="font-semibold">{data.integration.state === "ACTIVE" || metaReport?.key === selectedMonth ? "Синхронизация работает" : data.integration.state === "READY" ? "Подключено, ждём первую синхронизацию" : "Нужно подключить доступ Meta и указать ID кампаний"}</p>
            <p className="mt-1 text-xs opacity-80">Аккаунт: {data.integration.account ?? "не задан"} · кампаний: {data.integration.campaignCount} · API {data.integration.graphVersion}{data.integration.lastSyncedAt ? ` · обновлено ${new Date(data.integration.lastSyncedAt).toLocaleString("ru-RU")}` : ""}</p>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-400">Обращения, заказы и выручка считаются прямо из CRM. После подключения Meta ORDA будет каждое утро получать рекламный расход, а детализацию выбранных кампаний загружать при открытии страницы; курс валюты берётся у Национального Банка Казахстана. {data.integration.booksToLedger ? "Расход также записывается в финансовый журнал." : "В финансовый журнал расход не добавляется."}</p>
          <button type="button" disabled={!data.integration.configured || loading} onClick={() => void send("POST", { action: "sync-meta", month: selectedMonth })} className="mt-3 min-h-11 w-full rounded-xl bg-fuchsia-700 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-40">{loading ? "Обновляем…" : "Обновить сейчас"}</button>
        </FormPanel>
        <FormPanel title="Новая задача" subtitle="Попадёт в маркетинговый Kanban">
          <form onSubmit={addTask} className="grid gap-3"><Input label="Что сделать" value={task.title} onChange={(value)=>setTask({...task,title:value})}/><TextArea label="Ожидаемый результат и критерий готовности" value={task.description} onChange={(value)=>setTask({...task,description:value})}/><div className="grid gap-3 sm:grid-cols-3"><Input label="Срок" type="date" value={task.dueAt} onChange={(value)=>setTask({...task,dueAt:value})}/><label className="text-sm text-slate-300">Ответственный<select className={`${field} mt-1`} value={task.assigneeId} onChange={(e)=>setTask({...task,assigneeId:e.target.value})}><option value="">Не назначен</option>{data.assignees.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-sm text-slate-300">Приоритет<select className={`${field} mt-1`} value={task.priority} onChange={(e)=>setTask({...task,priority:e.target.value})}><option value="1">Обычный</option><option value="2">Важный</option><option value="3">Срочный</option></select></label></div><button className="min-h-11 rounded-xl bg-blue-700 px-4 font-semibold"><Plus size={16} className="mr-2 inline"/>Добавить задачу</button></form>
        </FormPanel>
        <FormPanel title="Новая вакансия" subtitle="Контроль найма у директора">
          <form onSubmit={addVacancy} className="grid gap-3"><Input label="Должность" value={vacancy.title} onChange={(value)=>setVacancy({...vacancy,title:value})}/><Input label="Комментарий" value={vacancy.note} onChange={(value)=>setVacancy({...vacancy,note:value})}/><button className="min-h-11 rounded-xl bg-amber-700 px-4 font-semibold"><Plus size={16} className="mr-2 inline"/>Открыть вакансию</button></form>
        </FormPanel>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4"><h2 className="mb-4 flex items-center gap-2 text-xl font-bold"><KanbanSquare className="text-blue-400"/>Marketing Kanban</h2><div className="overflow-x-auto"><div className="grid min-w-[1050px] grid-cols-4 gap-3">{taskColumns.map(([status,label])=><div key={status} className="rounded-xl bg-slate-950/70 p-3"><div className="mb-3 flex justify-between"><strong>{label}</strong><span className="rounded-full bg-blue-500/15 px-2 text-blue-200">{data.tasks.filter(item=>item.status===status).length}</span></div><div className="space-y-2">{data.tasks.filter(item=>item.status===status).map(item=><article key={item.id} className="rounded-xl border border-slate-800 bg-[#101827] p-3"><div className="flex items-start justify-between gap-2"><strong className="block">{item.title}</strong>{canReview&&<button type="button" aria-label="Удалить задачу" onClick={()=>void remove("task",item.id,item.title)} className="text-red-300"><Trash2 size={15}/></button>}</div>{item.description && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-400">{item.description}</p>}<p className="mt-2 text-xs text-slate-500">{item.assignee?.name ?? "Не назначен"} · {item.dueAt ? new Date(item.dueAt).toLocaleDateString("ru-RU") : "без срока"} · приоритет {item.priority} · создал {item.createdBy.name}</p><select aria-label="Этап задачи" value={item.status} onChange={(e)=>void send("PATCH",{action:"task-status",id:item.id,status:e.target.value})} className="mt-3 min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm">{taskColumns.map(([value,title])=><option key={value} value={value}>{title}</option>)}</select></article>)}{!data.tasks.some(item=>item.status===status)&&<p className="rounded-xl border border-dashed border-slate-800 p-4 text-center text-sm text-slate-600">Пусто</p>}</div></div>)}</div></div></section>

      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4"><h2 className="mb-4 flex items-center gap-2 text-xl font-bold"><BriefcaseBusiness className="text-amber-400"/>Вакансии</h2><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.vacancies.map(item=><article key={item.id} className="rounded-xl bg-slate-950 p-4"><div className="flex items-start justify-between gap-2"><strong>{item.title}</strong>{canReview&&<button type="button" aria-label="Удалить вакансию" onClick={()=>void remove("vacancy",item.id,item.title)} className="text-red-300"><Trash2 size={15}/></button>}</div><p className="mt-1 text-sm text-slate-500">Кандидатов: {item.candidates}</p>{item.note&&<p className="mt-2 text-sm text-slate-300">{item.note}</p>}<div className="mt-3 grid grid-cols-[1fr_100px] gap-2"><select value={item.status} onChange={(e)=>void send("PATCH",{action:"vacancy-status",id:item.id,status:e.target.value,candidates:item.candidates})} className={field}>{Object.entries(vacancyLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><input aria-label="Кандидаты" type="number" min="0" defaultValue={item.candidates} onBlur={(e)=>void send("PATCH",{action:"vacancy-status",id:item.id,status:item.status,candidates:Number(e.target.value)})} className={field}/></div></article>)}{!data.vacancies.length&&<p className="text-slate-500">Открытых вакансий пока нет.</p>}</div></section>
    </> : null}
  </main>;
}

function Stat({label,value}:{label:string;value:string|number}) { return <div className="min-w-0 rounded-2xl border border-slate-800 bg-[#101827] p-4"><p className="truncate text-xs text-slate-500">{label}</p><p className="mt-2 truncate text-xl font-bold">{value}</p></div>; }
function FormPanel({title,subtitle,children}:{title:string;subtitle:string;children:React.ReactNode}) { return <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4"><h2 className="font-bold">{title}</h2><p className="mb-4 text-xs text-slate-500">{subtitle}</p>{children}</section>; }
function Input({label,value,onChange,type="text"}:{label:string;value:string;onChange:(value:string)=>void;type?:string}) { return <label className="text-sm text-slate-300">{label}<input required type={type} min={type==="number"?0:undefined} value={value} onChange={(e)=>onChange(e.target.value)} className={`${field} mt-1`}/></label>; }
function TextArea({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) { return <label className="text-sm text-slate-300">{label}<textarea required rows={3} value={value} onChange={(event)=>onChange(event.target.value)} className={`${field} mt-1 py-3`}/></label>; }
function ReportText({label,value}:{label:string;value:string}) { return <div className="rounded-xl border border-slate-800 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 whitespace-pre-wrap leading-6 text-slate-200">{value}</p></div>; }
