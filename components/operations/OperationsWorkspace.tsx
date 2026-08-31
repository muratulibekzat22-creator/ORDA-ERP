"use client";

import {
  AlertTriangle,
  BadgeDollarSign,
  Bug,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Factory,
  FileWarning,
  Handshake,
  KeyRound,
  LoaderCircle,
  Megaphone,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  UserRoundX,
  Users,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { Role } from "@/lib/roles";

type WorkItem = {
  id: number;
  scope: "ORDA_PROJECT" | "ALTYN_SAPA";
  title: string;
  description?: string | null;
  source: string;
  status: "OPEN" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CANCELLED";
  priority: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
  dueAt?: string | null;
  previewUrl?: string | null;
  productionUrl?: string | null;
  commitSha?: string | null;
  pullRequestUrl?: string | null;
  verificationResult?: string | null;
  releaseStatus?: string | null;
  assignee: { id: number; name: string; role: string; active: boolean };
};

type OrderItem = {
  id: number;
  number: string;
  lifecycle: string;
  balance: string | number;
  partnerPrice: string | number;
  productionDeadline?: string | null;
  client: { id: number; name: string; city?: string | null };
  managerUser?: { id: number; name: string; active: boolean } | null;
};

type Payload = {
  viewer: { role: string; ordaProjectOperationsEnabled: boolean; companyOperationsEnabled: boolean };
  access: null | {
    id: number;
    name: string;
    email: string;
    active: boolean;
    temporaryAccess: boolean;
    grantedAt: string;
    accessExpiresAt?: string | null;
    accessRevokedAt?: string | null;
    remainingDays: number;
    sessionState: string;
    lastLogin?: string | null;
    ordaProjectOperationsEnabled: boolean;
    companyOperationsEnabled: boolean;
  };
  employees: Array<{ id: number; name: string; role: string }>;
  audits: Array<{ id: number; action: string; reason: string; createdAt: string; actor: { name: string } }>;
  project: null | { tasks: WorkItem[] };
  company: null | {
    tasks: WorkItem[];
    unassignedLeads: Array<{ id: number; name: string; city: string }>;
    incompleteOrders: OrderItem[];
    overdueOrders: OrderItem[];
    ordersWithoutContracts: OrderItem[];
    ordersWithoutWorkshop: OrderItem[];
    ordersWithoutWorkshopPrice: OrderItem[];
    awaitingPayment: OrderItem[];
    completedObjects: OrderItem[];
    content: Array<{ id: number; status: string; order: { id: number; number: string }; assignedMarketer?: { name: string } | null }>;
    managerTasks: Array<{ id: number; title: string; dueAt: string; assignee: { name: string }; order?: { id: number; number: string } | null; client?: { id: number; name: string } | null }>;
    managerMorningControl: { activeManagers: number; completed: number; missing: Array<{ id: number; name: string }> };
    problemMeasurements: Array<{ id: number; status: string; visitDate: string; client: { id: number; name: string }; measurerUser?: { name: string } | null }>;
    production: Array<{ stage: string; _count: { _all: number }; _min: { plannedEndAt?: string | null } }>;
    complaints: WorkItem[];
    finance: { sales: number; grossMargin: number; netProfit: number; clientOutstanding: number; partnerPayable: number; calculatedOrders: number; incompleteOrders: number; expensesByCategory: Array<{ name: string; amount: number }> };
    payroll: { orderAccrued: number; pendingOrderAccruals: number; companyDebt: number };
  };
};

const money = (value: number | string) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(value || 0)) + " ₸";
const dateTime = (value?: string | null) => value ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
const button = "min-h-11 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
const panel = "rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-xl sm:p-5";

const metricDefinitions = [
  ["unassignedLeads", "Заявки без ответственного", Users, "/clients"],
  ["incompleteOrders", "Неполные заказы", FileWarning, "/orders?filter=incomplete"],
  ["overdueOrders", "Просроченные заказы", CalendarClock, "/orders?filter=overdue"],
  ["ordersWithoutContracts", "Заказы без договора", ClipboardList, "/orders?filter=without-contract"],
  ["ordersWithoutWorkshop", "Заказы без цеха", Handshake, "/orders?filter=without-partner"],
  ["ordersWithoutWorkshopPrice", "Без стоимости цеха", BadgeDollarSign, "/orders?filter=without-partner-price"],
  ["awaitingPayment", "Ожидают оплату", BadgeDollarSign, "/orders?filter=client-payable"],
  ["completedObjects", "Завершённые объекты", CheckCircle2, "/orders?filter=completed"],
  ["content", "Отзывы и контент", Megaphone, "/marketing"],
  ["managerTasks", "Задачи менеджеров", ClipboardCheck, "/calendar"],
  ["problemMeasurements", "Проблемные замеры", AlertTriangle, "/measurements?filter=needs-closing"],
  ["production", "Производство", Factory, "/production"],
  ["complaints", "Жалобы сотрудников", Bug, "/operations?tab=company&view=complaints"],
] as const;

export default function OperationsWorkspace({ role }: { role: Role }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [tab, setTab] = useState<"project" | "company" | "audit">("project");
  const [selectedMetric, setSelectedMetric] = useState<string>("incompleteOrders");
  const [revokeReason, setRevokeReason] = useState("");
  const [taskOpen, setTaskOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/operations", { cache: "no-store" });
      const payload = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось загрузить данные");
      setData(payload);
      if (!payload.project && payload.company) setTab("company");
      if (!payload.project && !payload.company) setTab("audit");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить данные");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/operations", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as Payload & { error?: string };
        if (!response.ok)
          throw new Error(payload.error || "Не удалось загрузить данные");
        if (!active) return;
        setData(payload);
        if (!payload.project && payload.company) setTab("company");
        if (!payload.project && !payload.company) setTab("audit");
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Не удалось загрузить данные",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function accessAction(body: Record<string, unknown>) {
    setBusy(true); setError(""); setNotice(""); setPassword("");
    try {
      const response = await fetch("/api/operations/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string; code?: string; temporaryPassword?: string };
      if (!response.ok) throw new Error(result.error || result.code || "Операция не выполнена");
      if (result.temporaryPassword) setPassword(result.temporaryPassword);
      setNotice(body.action === "grant" ? "Доступ создан. Скопируйте временный пароль сейчас — повторно он не показывается." : body.action === "revoke" ? "Операционный доступ отключён, задачи переназначены директору." : "Настройки доступа сохранены. Активные сессии инвалидированы.");
      setRevokeReason("");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Операция не выполнена"); }
    finally { setBusy(false); }
  }

  async function updateTask(id: number, body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/operations/tasks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Задача не обновлена");
      setNotice("Операционная задача обновлена");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Задача не обновлена"); }
    finally { setBusy(false); }
  }

  const selectedRows = useMemo(() => {
    if (!data?.company) return [];
    return (data.company[selectedMetric as keyof typeof data.company] as unknown[]) ?? [];
  }, [data, selectedMetric]);

  if (loading && !data) return <div className="grid min-h-[60vh] place-items-center"><LoaderCircle className="size-9 animate-spin text-blue-400" aria-label="Загрузка" /></div>;

  return (
    <div className="min-h-full bg-slate-950 px-3 py-5 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-300">ORDA Operations</p><h1 className="mt-1 text-2xl font-bold sm:text-3xl">Операционное управление</h1><p className="mt-2 text-sm text-slate-400">Проект ORDA ERP и рабочая компания ALTYN SAPA в одном защищённом контуре.</p></div>
          <button type="button" onClick={() => void load()} disabled={loading} className={`${button} flex items-center justify-center gap-2 border border-slate-700 bg-slate-900 hover:bg-slate-800`}><RefreshCw className={loading ? "animate-spin" : ""} size={18}/>Обновить</button>
        </div>

        {error && <div role="alert" className="rounded-xl border border-red-800 bg-red-950/50 p-3 text-sm text-red-200">{error}</div>}
        {notice && <div role="status" className="rounded-xl border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-200">{notice}</div>}

        {role === Role.DIRECTOR && <AccessControl data={data} busy={busy} password={password} revokeReason={revokeReason} setRevokeReason={setRevokeReason} action={accessAction} />}

        <div role="tablist" aria-label="Области операционного управления" className="grid grid-cols-1 gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-2 sm:grid-cols-3">
          {data?.project && <Tab active={tab === "project"} onClick={() => setTab("project")}>Проект ORDA</Tab>}
          {data?.company && <Tab active={tab === "company"} onClick={() => setTab("company")}>ALTYN SAPA</Tab>}
          <Tab active={tab === "audit"} onClick={() => setTab("audit")}>История доступа</Tab>
        </div>

        {tab === "project" && data?.project && <section aria-label="Проект ORDA" className="space-y-4">
          <SectionHeading title="Проект ORDA" subtitle="Ошибки, обращения, требования, Preview/LIVE и готовность релиза" action={<button type="button" onClick={() => setTaskOpen((value) => !value)} className={`${button} flex items-center gap-2 bg-blue-600 hover:bg-blue-500`}><Plus size={18}/>Новая задача</button>} />
          {taskOpen && <TaskForm scope="ORDA_PROJECT" employees={data.employees} done={() => { setTaskOpen(false); void load(); }} />}
          <WorkItems items={data.project.tasks} employees={data.employees} busy={busy} update={updateTask} project />
        </section>}

        {tab === "company" && data?.company && <section aria-label="ALTYN SAPA Operations" className="space-y-5">
          <SectionHeading title="ALTYN SAPA Operations" subtitle="Сроки, менеджеры, заказы, замеры, производство и финансовый read-only контроль" action={<button type="button" onClick={() => setTaskOpen((value) => !value)} className={`${button} flex items-center gap-2 bg-blue-600 hover:bg-blue-500`}><Plus size={18}/>Новая задача</button>} />
          {taskOpen && <TaskForm scope="ALTYN_SAPA" employees={data.employees} done={() => { setTaskOpen(false); void load(); }} />}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metricDefinitions.map(([key, title, Icon, href]) => {
              const value = data.company![key];
              const count = Array.isArray(value) ? value.length : 0;
              return <button key={key} type="button" onClick={() => setSelectedMetric(key)} className={`rounded-2xl border p-4 text-left transition ${selectedMetric === key ? "border-blue-500 bg-blue-500/10" : "border-slate-800 bg-slate-900 hover:border-slate-700"}`}>
                <div className="flex items-start justify-between"><Icon className="text-blue-300" size={22}/><span className="text-2xl font-bold">{count}</span></div><p className="mt-3 font-semibold">{title}</p><a href={href} onClick={(event) => event.stopPropagation()} className="mt-2 inline-block text-xs font-semibold text-blue-300 hover:underline">Открыть раздел</a>
              </button>;
            })}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={panel}><h2 className="font-bold">Экономика и P&amp;L · только чтение</h2><div className="mt-4 grid grid-cols-2 gap-3"><Value label="Продажи" value={money(data.company.finance.sales)}/><Value label="Валовая маржа" value={money(data.company.finance.grossMargin)}/><Value label="Чистая прибыль" value={money(data.company.finance.netProfit)}/><Value label="К получению" value={money(data.company.finance.clientOutstanding)}/><Value label="К выплате партнёрам" value={money(data.company.finance.partnerPayable)}/><Value label="Экономика не заполнена" value={String(data.company.finance.incompleteOrders)}/></div></div>
            <div className={panel}><h2 className="font-bold">Payroll · только агрегаты</h2><div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3"><Value label="Начислено по заказам" value={money(data.company.payroll.orderAccrued)}/><Value label="Непроведённые начисления" value={String(data.company.payroll.pendingOrderAccruals)}/><Value label="Задолженность сотрудникам" value={money(data.company.payroll.companyDebt)}/></div></div>
          </div>
          <MetricDetails name={metricDefinitions.find(([key]) => key === selectedMetric)?.[1] ?? "Детали"} rows={selectedRows} />
          <div><h2 className="mb-3 text-xl font-bold">Операционные задачи компании</h2><WorkItems items={data.company.tasks} employees={data.employees} busy={busy} update={updateTask} /></div>
        </section>}

        {tab === "audit" && <section className={panel}><h2 className="text-xl font-bold">История операционного доступа</h2><div className="mt-4 space-y-3">{data?.audits.length ? data.audits.map((item) => <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3"><div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><span className="text-sm font-semibold text-blue-200">{item.action}</span><time className="text-xs text-slate-500">{dateTime(item.createdAt)}</time></div><p className="mt-1 text-sm text-slate-300">{item.reason}</p><p className="mt-1 text-xs text-slate-500">Автор: {item.actor.name}</p></div>) : <Empty text="Событий пока нет"/>}</div></section>}
      </div>
    </div>
  );
}

function AccessControl({ data, busy, password, revokeReason, setRevokeReason, action }: { data: Payload | null; busy: boolean; password: string; revokeReason: string; setRevokeReason: (value: string) => void; action: (body: Record<string, unknown>) => Promise<void> }) {
  const access = data?.access;
  return <section className={panel} aria-label="Доступ операционного директора">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex items-center gap-2"><ShieldCheck className="text-emerald-400"/><h2 className="text-xl font-bold">Алихан Мамельянов</h2></div><p className="mt-1 break-all text-sm text-slate-400">alikhanmamelyanov@bekzatmuratuly.kz</p>{access ? <div className="mt-3 flex flex-wrap gap-2 text-xs"><Badge ok={access.active} text={access.active ? "Активен" : "Отключён"}/><Badge ok={access.sessionState === "ACTIVE"} text={`Session: ${access.sessionState}`}/><Badge ok={access.temporaryAccess} text={`Осталось дней: ${access.remainingDays}`}/></div> : <p className="mt-3 text-sm text-amber-300">Доступ ещё не создан</p>}</div>
      <div className="flex flex-wrap gap-2">{!access ? <button disabled={busy} type="button" onClick={() => void action({ action: "grant" })} className={`${button} bg-emerald-600 hover:bg-emerald-500`}><KeyRound className="mr-2 inline" size={17}/>Создать доступ на 30 дней</button> : <><button disabled={busy} type="button" onClick={() => void action({ action: "extend" })} className={`${button} bg-blue-600 hover:bg-blue-500`}>Продлить на 30 дней</button></>}</div></div>
    {access && <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4"><Value label="Начало" value={dateTime(access.grantedAt)}/><Value label="Окончание" value={dateTime(access.accessExpiresAt)}/><Value label="Последний вход" value={dateTime(access.lastLogin)}/><Value label="Активные session" value={access.sessionState === "ACTIVE" ? "Допустимы до смены sessionVersion" : "Инвалидированы"}/></div>}
    {access && <div className="mt-4 grid gap-3 sm:grid-cols-2"><ScopeToggle title="ORDA Project Operations" enabled={access.ordaProjectOperationsEnabled} disabled={busy} toggle={() => void action({ action: "scope", scope: "ORDA_PROJECT", enabled: !access.ordaProjectOperationsEnabled })}/><ScopeToggle title="ALTYN SAPA Operations" enabled={access.companyOperationsEnabled} disabled={busy} toggle={() => void action({ action: "scope", scope: "ALTYN_SAPA", enabled: !access.companyOperationsEnabled })}/></div>}
    {password && <div className="mt-4 rounded-xl border border-amber-600/50 bg-amber-950/30 p-4"><p className="text-sm font-semibold text-amber-200">Одноразовый показ временного пароля</p><code className="mt-2 block select-all break-all rounded-lg bg-black/30 p-3 text-base text-white">{password}</code><p className="mt-2 text-xs text-amber-300">Скопируйте сейчас. После обновления страницы пароль не восстанавливается.</p></div>}
    {access?.active && <div className="mt-4 rounded-xl border border-red-900 bg-red-950/20 p-4"><label className="text-sm font-semibold text-red-200">Причина полного отключения<input value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} maxLength={500} placeholder="Укажите причину" className="mt-2 min-h-11 w-full rounded-lg border border-red-900 bg-slate-950 px-3 text-white"/></label><button disabled={busy || revokeReason.trim().length < 5} type="button" onClick={() => void action({ action: "revoke", reason: revokeReason })} className={`${button} mt-3 bg-red-700 hover:bg-red-600`}><UserRoundX className="mr-2 inline" size={17}/>Отключить операционного директора</button></div>}
  </section>;
}

function TaskForm({ scope, employees, done }: { scope: WorkItem["scope"]; employees: Payload["employees"]; done: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget); try { const response = await fetch("/api/operations/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope, title: form.get("title"), description: form.get("description"), source: form.get("source"), priority: form.get("priority"), assigneeId: Number(form.get("assigneeId")), dueAt: form.get("dueAt") || null, previewUrl: form.get("previewUrl") || null, productionUrl: form.get("productionUrl") || null, commitSha: form.get("commitSha") || null, pullRequestUrl: form.get("pullRequestUrl") || null }) }); const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error || "Задача не создана"); done(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Задача не создана"); } finally { setBusy(false); } }
  return <form onSubmit={submit} className={`${panel} grid gap-3 md:grid-cols-2`}><label className="text-sm">Название<input name="title" required maxLength={200} className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3"/></label><label className="text-sm">Источник<input name="source" required maxLength={120} placeholder="EMPLOYEE_REQUEST / BUG / DIRECTOR" className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3"/></label><label className="text-sm">Ответственный<select name="assigneeId" required className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3">{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.role}</option>)}</select></label><label className="text-sm">Приоритет<select name="priority" defaultValue="NORMAL" className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3"><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>CRITICAL</option></select></label><label className="text-sm">Срок<input name="dueAt" type="datetime-local" className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3"/></label>{scope === "ORDA_PROJECT" && <><label className="text-sm">Preview URL<input name="previewUrl" type="url" className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3"/></label><label className="text-sm">Production URL<input name="productionUrl" type="url" className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3"/></label><label className="text-sm">Commit<input name="commitSha" maxLength={64} className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3"/></label><label className="text-sm">PR URL<input name="pullRequestUrl" type="url" className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3"/></label></>}<label className="text-sm md:col-span-2">Описание<textarea name="description" rows={3} maxLength={5000} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3"/></label>{error && <p role="alert" className="text-sm text-red-300 md:col-span-2">{error}</p>}<button disabled={busy} className={`${button} bg-blue-600 hover:bg-blue-500 md:col-span-2`}>{busy ? "Создаём…" : "Создать операционную задачу"}</button></form>;
}

function WorkItems({ items, employees, busy, update, project = false }: { items: WorkItem[]; employees: Payload["employees"]; busy: boolean; update: (id: number, body: Record<string, unknown>) => Promise<void>; project?: boolean }) {
  if (!items.length) return <Empty text="Операционных задач пока нет"/>;
  return <div className="grid gap-3 xl:grid-cols-2">{items.map((item) => <WorkItemCard key={item.id} item={item} employees={employees} busy={busy} update={update} project={project} />)}</div>;
}

function WorkItemCard({ item, employees, busy, update, project }: { item: WorkItem; employees: Payload["employees"]; busy: boolean; update: (id: number, body: Record<string, unknown>) => Promise<void>; project: boolean }) {
  const [editing, setEditing] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await update(item.id, {
      title: form.get("title"),
      description: form.get("description"),
      source: form.get("source"),
      priority: form.get("priority"),
      dueAt: form.get("dueAt") || null,
      ...(project ? {
        previewUrl: form.get("previewUrl") || null,
        productionUrl: form.get("productionUrl") || null,
        commitSha: form.get("commitSha") || null,
        pullRequestUrl: form.get("pullRequestUrl") || null,
        verificationResult: form.get("verificationResult") || null,
        releaseStatus: form.get("releaseStatus") || null,
      } : {}),
    });
    setEditing(false);
  }
  const dueValue = item.dueAt && !Number.isNaN(new Date(item.dueAt).getTime())
    ? new Date(new Date(item.dueAt).getTime() - new Date(item.dueAt).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    : "";
  return <article className={panel}><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-300">{item.source} · {item.priority}</p><h3 className="mt-1 text-lg font-bold">{item.title}</h3></div><span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold">{item.status}</span></div>{item.description && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300">{item.description}</p>}<div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2"><span>Ответственный: {item.assignee.name}</span><span>Срок: {dateTime(item.dueAt)}</span>{item.commitSha && <span>Commit: {item.commitSha}</span>}{item.releaseStatus && <span>Релиз: {item.releaseStatus}</span>}</div><div className="mt-3 flex flex-wrap gap-2">{item.previewUrl && <a className="text-sm font-semibold text-blue-300 hover:underline" href={item.previewUrl} target="_blank" rel="noreferrer">Preview</a>}{item.productionUrl && <a className="text-sm font-semibold text-blue-300 hover:underline" href={item.productionUrl} target="_blank" rel="noreferrer">LIVE</a>}{item.pullRequestUrl && <a className="text-sm font-semibold text-blue-300 hover:underline" href={item.pullRequestUrl} target="_blank" rel="noreferrer">PR</a>}</div><div className="mt-4 flex flex-wrap gap-2"><select disabled={busy} value={item.status} onChange={(event) => void update(item.id, { status: event.target.value })} aria-label={`Статус задачи ${item.title}`} className="min-h-11 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm"><option>OPEN</option><option>IN_PROGRESS</option><option>BLOCKED</option><option>COMPLETED</option><option>CANCELLED</option></select><select disabled={busy} value={item.assignee.id} onChange={(event) => void update(item.id, { assigneeId: Number(event.target.value) })} aria-label={`Ответственный задачи ${item.title}`} className="min-h-11 min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm">{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select><button disabled={busy} type="button" onClick={() => setEditing((value) => !value)} className={`${button} border border-slate-700 bg-slate-950 hover:bg-slate-800`}><Pencil className="mr-2 inline" size={16}/>Редактировать</button>{project && item.status === "COMPLETED" && item.releaseStatus !== "APPROVED" && <button disabled={busy} type="button" onClick={() => void update(item.id, { action: "approve-release", status: "COMPLETED" })} className={`${button} bg-emerald-700 hover:bg-emerald-600`}>Одобрить релиз</button>}</div>{editing && <form onSubmit={save} className="mt-4 grid gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3 sm:grid-cols-2"><label className="text-xs">Название<input name="title" required maxLength={200} defaultValue={item.title} className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm"/></label><label className="text-xs">Источник<input name="source" required maxLength={120} defaultValue={item.source} className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm"/></label><label className="text-xs">Приоритет<select name="priority" defaultValue={item.priority} className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm"><option>LOW</option><option>NORMAL</option><option>HIGH</option><option>CRITICAL</option></select></label><label className="text-xs">Срок<input name="dueAt" type="datetime-local" defaultValue={dueValue} className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm"/></label><label className="text-xs sm:col-span-2">Описание<textarea name="description" maxLength={5000} rows={3} defaultValue={item.description ?? ""} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm"/></label>{project && <><label className="text-xs">Preview URL<input name="previewUrl" type="url" defaultValue={item.previewUrl ?? ""} className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm"/></label><label className="text-xs">Production URL<input name="productionUrl" type="url" defaultValue={item.productionUrl ?? ""} className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm"/></label><label className="text-xs">Commit<input name="commitSha" maxLength={64} defaultValue={item.commitSha ?? ""} className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm"/></label><label className="text-xs">PR URL<input name="pullRequestUrl" type="url" defaultValue={item.pullRequestUrl ?? ""} className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm"/></label><label className="text-xs">Результат проверки<input name="verificationResult" maxLength={2000} defaultValue={item.verificationResult ?? ""} className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm"/></label><label className="text-xs">Статус релиза<input name="releaseStatus" maxLength={100} defaultValue={item.releaseStatus ?? ""} className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm"/></label></>}<button disabled={busy} className={`${button} bg-blue-600 hover:bg-blue-500 sm:col-span-2`}>Сохранить задачу</button></form>}</article>;
}

function MetricDetails({ name, rows }: { name: string; rows: unknown[] }) { return <div className={panel}><h2 className="text-xl font-bold">{name}</h2><div className="mt-4 space-y-2">{rows.length ? rows.slice(0, 100).map((value, index) => { const row = value as Record<string, unknown>; const order = row.order as Record<string, unknown> | undefined; const client = row.client as Record<string, unknown> | undefined; const assignee = row.assignee as Record<string, unknown> | undefined; const label = String(row.number ?? order?.number ?? row.title ?? client?.name ?? row.stage ?? `Запись ${index + 1}`); const id = Number(row.id ?? order?.id ?? 0); const href = order?.id ? `/orders/${order.id}` : row.number ? `/orders/${id}` : client?.id ? `/clients/${client.id}` : null; return <div key={`${id}-${index}`} className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">{label}</p><p className="text-xs text-slate-400">{String(row.status ?? row.lifecycle ?? "")} {assignee?.name ? `· ${assignee.name}` : ""}</p></div>{href && <a href={href} className="min-h-11 rounded-lg border border-slate-700 px-3 py-2 text-center text-sm font-semibold text-blue-300">Открыть</a>}</div>; }) : <Empty text="Записей нет"/>}</div></div>; }
function SectionHeading({ title, subtitle, action }: { title: string; subtitle: string; action: React.ReactNode }) { return <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-2xl font-bold">{title}</h2><p className="mt-1 text-sm text-slate-400">{subtitle}</p></div>{action}</div>; }
function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button role="tab" aria-selected={active} type="button" onClick={onClick} className={`${button} ${active ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}>{children}</button>; }
function Value({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 break-words font-bold text-slate-100">{value}</p></div>; }
function Badge({ ok, text }: { ok: boolean; text: string }) { return <span className={`rounded-full px-2.5 py-1 font-semibold ${ok ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>{text}</span>; }
function ScopeToggle({ title, enabled, disabled, toggle }: { title: string; enabled: boolean; disabled: boolean; toggle: () => void }) { const Icon = enabled ? ToggleRight : ToggleLeft; return <button type="button" disabled={disabled} onClick={toggle} className="flex min-h-14 items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-4 text-left"><span className="font-semibold">{title}</span><span className={enabled ? "text-emerald-400" : "text-slate-500"}><Icon size={32}/></span></button>; }
function Empty({ text }: { text: string }) { return <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">{text}</div>; }
