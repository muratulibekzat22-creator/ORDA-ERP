"use client";

import { BarChart3, BriefcaseBusiness, KanbanSquare, Plus, RefreshCw } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

type Status = "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE";
type Task = { id: number; title: string; description: string | null; status: Status; priority: number; dueAt: string | null; assignee: { id: number; name: string } | null };
type Metric = { id: number; metricMonth: string; channel: string; spend: string; leads: number; orders: number; revenue: string };
type Vacancy = { id: number; title: string; status: "OPEN" | "INTERVIEW" | "OFFER" | "HIRED" | "PAUSED"; candidates: number; note: string | null };
type Data = {
  role: string;
  tasks: Task[];
  metrics: Metric[];
  vacancies: Vacancy[];
  assignees: Array<{ id: number; name: string; role: string }>;
  summary: { spend: number; leads: number; orders: number; revenue: number; cpl: number; cac: number; roas: number; conversion: number };
};

const money = (value: number | string) => `${Math.round(Number(value)).toLocaleString("ru-RU")} ₸`;
const taskColumns: Array<[Status, string]> = [["TODO", "Нужно сделать"], ["IN_PROGRESS", "В работе"], ["REVIEW", "Проверка"], ["DONE", "Готово"]];
const vacancyLabels: Record<Vacancy["status"], string> = { OPEN: "Открыта", INTERVIEW: "Собеседования", OFFER: "Оффер", HIRED: "Сотрудник найден", PAUSED: "Пауза" };
const field = "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white";

export default function MarketingManagementPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [task, setTask] = useState({ title: "", description: "", dueAt: "", assigneeId: "", priority: "2" });
  const [metric, setMetric] = useState({ metricMonth: new Date().toISOString().slice(0, 7), channel: "Instagram / Meta", spend: "", leads: "", orders: "", revenue: "", note: "" });
  const [vacancy, setVacancy] = useState({ title: "", note: "" });
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const response = await fetch("/api/marketing", { cache: "no-store" });
    if (response.ok) setData(await response.json() as Data);
    else setError("Не удалось загрузить маркетинг");
    setLoading(false);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function send(method: "POST" | "PATCH", body: Record<string, unknown>) {
    setError("");
    const response = await fetch("/api/marketing", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error ?? "Не удалось сохранить"); return false; }
    await load(); return true;
  }
  async function addTask(event: FormEvent) { event.preventDefault(); if (await send("POST", { action: "task", ...task })) setTask({ title: "", description: "", dueAt: "", assigneeId: "", priority: "2" }); }
  async function addMetric(event: FormEvent) { event.preventDefault(); if (await send("POST", { action: "metric", ...metric })) setMetric((value) => ({ ...value, spend: "", leads: "", orders: "", revenue: "", note: "" })); }
  async function addVacancy(event: FormEvent) { event.preventDefault(); if (await send("POST", { action: "vacancy", ...vacancy })) setVacancy({ title: "", note: "" }); }

  return <main className="min-w-0 space-y-5 p-4 sm:p-6 xl:p-8">
    <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-semibold uppercase tracking-[.18em] text-fuchsia-300">Director workspace</p><h1 className="mt-1 text-3xl font-bold">Маркетинг и вакансии</h1><p className="mt-1 max-w-3xl text-sm text-slate-400">Директор заполняет расходы, лиды, заказы и задачи. Основатель видит конечные показатели для решений.</p></div><div className="flex gap-2"><a href="/reports" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 font-semibold"><BarChart3 size={17}/>KPI менеджеров</a><a href="/finance" className="inline-flex min-h-11 items-center rounded-xl bg-emerald-700 px-4 font-semibold">Внести расход / доход</a></div></header>
    {error && <p role="alert" className="rounded-xl border border-red-800 bg-red-950/40 p-3 text-red-200">{error}</p>}
    {loading && !data ? <div className="grid place-items-center rounded-2xl border border-slate-800 p-16 text-slate-400"><RefreshCw className="animate-spin"/></div> : null}
    {data ? <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
        <Stat label="Расход рекламы" value={money(data.summary.spend)}/><Stat label="Лиды" value={data.summary.leads}/><Stat label="Заказы" value={data.summary.orders}/><Stat label="Выручка" value={money(data.summary.revenue)}/><Stat label="Цена лида" value={money(data.summary.cpl)}/><Stat label="Цена клиента" value={money(data.summary.cac)}/><Stat label="ROAS" value={`${data.summary.roas.toFixed(2)}×`}/><Stat label="Конверсия" value={`${data.summary.conversion.toFixed(1)}%`}/>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <FormPanel title="Показатели месяца" subtitle="Один канал можно обновлять повторно">
          <form onSubmit={addMetric} className="grid gap-3 sm:grid-cols-2"><Input label="Месяц" type="month" value={metric.metricMonth} onChange={(value)=>setMetric({...metric,metricMonth:value})}/><Input label="Канал" value={metric.channel} onChange={(value)=>setMetric({...metric,channel:value})}/><Input label="Расход" type="number" value={metric.spend} onChange={(value)=>setMetric({...metric,spend:value})}/><Input label="Лиды" type="number" value={metric.leads} onChange={(value)=>setMetric({...metric,leads:value})}/><Input label="Заказы" type="number" value={metric.orders} onChange={(value)=>setMetric({...metric,orders:value})}/><Input label="Выручка" type="number" value={metric.revenue} onChange={(value)=>setMetric({...metric,revenue:value})}/><button className="min-h-11 rounded-xl bg-fuchsia-700 px-4 font-semibold sm:col-span-2"><Plus size={16} className="mr-2 inline"/>Сохранить показатели</button></form>
        </FormPanel>
        <FormPanel title="Новая задача" subtitle="Попадёт в маркетинговый Kanban">
          <form onSubmit={addTask} className="grid gap-3"><Input label="Что сделать" value={task.title} onChange={(value)=>setTask({...task,title:value})}/><div className="grid gap-3 sm:grid-cols-2"><Input label="Срок" type="date" value={task.dueAt} onChange={(value)=>setTask({...task,dueAt:value})}/><label className="text-sm text-slate-300">Ответственный<select className={`${field} mt-1`} value={task.assigneeId} onChange={(e)=>setTask({...task,assigneeId:e.target.value})}><option value="">Не назначен</option>{data.assignees.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><button className="min-h-11 rounded-xl bg-blue-700 px-4 font-semibold"><Plus size={16} className="mr-2 inline"/>Добавить задачу</button></form>
        </FormPanel>
        <FormPanel title="Новая вакансия" subtitle="Контроль найма у директора">
          <form onSubmit={addVacancy} className="grid gap-3"><Input label="Должность" value={vacancy.title} onChange={(value)=>setVacancy({...vacancy,title:value})}/><Input label="Комментарий" value={vacancy.note} onChange={(value)=>setVacancy({...vacancy,note:value})}/><button className="min-h-11 rounded-xl bg-amber-700 px-4 font-semibold"><Plus size={16} className="mr-2 inline"/>Открыть вакансию</button></form>
        </FormPanel>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4"><h2 className="mb-4 flex items-center gap-2 text-xl font-bold"><KanbanSquare className="text-blue-400"/>Marketing Kanban</h2><div className="overflow-x-auto"><div className="grid min-w-[1050px] grid-cols-4 gap-3">{taskColumns.map(([status,label])=><div key={status} className="rounded-xl bg-slate-950/70 p-3"><div className="mb-3 flex justify-between"><strong>{label}</strong><span className="rounded-full bg-blue-500/15 px-2 text-blue-200">{data.tasks.filter(item=>item.status===status).length}</span></div><div className="space-y-2">{data.tasks.filter(item=>item.status===status).map(item=><article key={item.id} className="rounded-xl border border-slate-800 bg-[#101827] p-3"><strong className="block">{item.title}</strong>{item.description && <p className="mt-1 text-xs text-slate-400">{item.description}</p>}<p className="mt-2 text-xs text-slate-500">{item.assignee?.name ?? "Не назначен"} · {item.dueAt ? new Date(item.dueAt).toLocaleDateString("ru-RU") : "без срока"}</p><select aria-label="Этап задачи" value={item.status} onChange={(e)=>void send("PATCH",{action:"task-status",id:item.id,status:e.target.value})} className="mt-3 min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm">{taskColumns.map(([value,title])=><option key={value} value={value}>{title}</option>)}</select></article>)}{!data.tasks.some(item=>item.status===status)&&<p className="rounded-xl border border-dashed border-slate-800 p-4 text-center text-sm text-slate-600">Пусто</p>}</div></div>)}</div></div></section>

      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4"><h2 className="mb-4 flex items-center gap-2 text-xl font-bold"><BriefcaseBusiness className="text-amber-400"/>Вакансии</h2><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.vacancies.map(item=><article key={item.id} className="rounded-xl bg-slate-950 p-4"><strong>{item.title}</strong><p className="mt-1 text-sm text-slate-500">Кандидатов: {item.candidates}</p>{item.note&&<p className="mt-2 text-sm text-slate-300">{item.note}</p>}<div className="mt-3 grid grid-cols-[1fr_100px] gap-2"><select value={item.status} onChange={(e)=>void send("PATCH",{action:"vacancy-status",id:item.id,status:e.target.value,candidates:item.candidates})} className={field}>{Object.entries(vacancyLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><input aria-label="Кандидаты" type="number" min="0" defaultValue={item.candidates} onBlur={(e)=>void send("PATCH",{action:"vacancy-status",id:item.id,status:item.status,candidates:Number(e.target.value)})} className={field}/></div></article>)}{!data.vacancies.length&&<p className="text-slate-500">Открытых вакансий пока нет.</p>}</div></section>
    </> : null}
  </main>;
}

function Stat({label,value}:{label:string;value:string|number}) { return <div className="min-w-0 rounded-2xl border border-slate-800 bg-[#101827] p-4"><p className="truncate text-xs text-slate-500">{label}</p><p className="mt-2 truncate text-xl font-bold">{value}</p></div>; }
function FormPanel({title,subtitle,children}:{title:string;subtitle:string;children:React.ReactNode}) { return <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4"><h2 className="font-bold">{title}</h2><p className="mb-4 text-xs text-slate-500">{subtitle}</p>{children}</section>; }
function Input({label,value,onChange,type="text"}:{label:string;value:string;onChange:(value:string)=>void;type?:string}) { return <label className="text-sm text-slate-300">{label}<input required type={type} min={type==="number"?0:undefined} value={value} onChange={(e)=>onChange(e.target.value)} className={`${field} mt-1`}/></label>; }
