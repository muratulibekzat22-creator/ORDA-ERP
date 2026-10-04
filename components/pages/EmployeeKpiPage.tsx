"use client";

import { BarChart3, Check, Plus, Send, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type Unit = "COUNT" | "MONEY" | "PERCENT";
type Metric = {
  code: string;
  title: string;
  kind: "AUTO" | "CUSTOM";
  unit: Unit;
  actual: number | null;
  target: number | null;
  completionPercent: number | null;
  source: string;
  evidence: string | null;
};
type Row = {
  employeeId: number;
  userId: number | null;
  name: string;
  position: string;
  role: string | null;
  metrics: Metric[];
  summary: { planned: number; achieved: number; missing: number };
  request: { id: number; status: "OPEN" | "FULFILLED"; note: string | null; requestedBy: string } | null;
};
type Payload = {
  month: string;
  canManage: boolean;
  rows: Row[];
  requests: Array<{ id: number; employeeId: number; employeeName: string; status: "OPEN" | "FULFILLED"; note: string | null; requestedBy: string }>;
};
type Draft = { title: string; unit: Unit; target: string; actual: string; evidence: string };

const field = "min-h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white";
const currentMonth = () => new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 7);
const draftKey = (employeeId: number, code: string) => `${employeeId}:${code}`;
const format = (value: number | null, unit: Unit) => value === null ? "—" : unit === "MONEY" ? `${Math.round(value).toLocaleString("ru-RU")} ₸` : unit === "PERCENT" ? `${value.toLocaleString("ru-RU")}%` : value.toLocaleString("ru-RU");
const defaultDraft = (): Draft => ({ title: "", unit: "COUNT", target: "", actual: "", evidence: "" });

export default function EmployeeKpiPage() {
  const params = useSearchParams();
  const [month, setMonth] = useState(params.get("month") || currentMonth());
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState("");
  const [message, setMessage] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [personFilter, setPersonFilter] = useState(params.get("employee") || "ALL");
  const [positionFilter, setPositionFilter] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [customDrafts, setCustomDrafts] = useState<Record<number, Draft>>({});
  const [requestNotes, setRequestNotes] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/kpi?month=${encodeURIComponent(month)}`, { cache: "no-store" });
      const body = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось загрузить KPI");
      setData(body);
      const next: Record<string, Draft> = {};
      for (const row of body.rows) for (const metric of row.metrics) {
        next[draftKey(row.employeeId, metric.code)] = {
          title: metric.title,
          unit: metric.unit,
          target: metric.target === null ? "" : String(metric.target),
          actual: metric.actual === null || metric.kind === "AUTO" ? "" : String(metric.actual),
          evidence: metric.evidence ?? "",
        };
      }
      setDrafts(next);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось загрузить KPI");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const roles = useMemo(() => [...new Set(data?.rows.map((row) => row.role || "Без учётной записи") ?? [])], [data]);
  const visibleRows = useMemo(() => data?.rows.filter((row) =>
    (roleFilter === "ALL" || (row.role || "Без учётной записи") === roleFilter) &&
    (personFilter === "ALL" || String(row.employeeId) === personFilter) &&
    (!positionFilter || row.position.toLocaleLowerCase("ru").includes(positionFilter.toLocaleLowerCase("ru"))),
  ) ?? [], [data, roleFilter, personFilter, positionFilter]);
  const totals = useMemo(() => visibleRows.reduce((sum, row) => ({
    planned: sum.planned + row.summary.planned,
    achieved: sum.achieved + row.summary.achieved,
    missing: sum.missing + row.summary.missing,
  }), { planned: 0, achieved: 0, missing: 0 }), [visibleRows]);

  async function send(method: "PATCH" | "POST" | "DELETE", key: string, body: Record<string, unknown>) {
    setSavingKey(key); setMessage("");
    try {
      const response = await fetch("/api/kpi", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, ...body }) });
      const result = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(result.error || "Не удалось сохранить");
      await load();
      setMessage(method === "POST" ? "Запрос отправлен директору" : method === "DELETE" ? "Цель удалена" : "KPI сохранён");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить");
      return false;
    } finally { setSavingKey(""); }
  }

  async function saveMetric(row: Row, metric: Metric) {
    const key = draftKey(row.employeeId, metric.code);
    const draft = drafts[key];
    if (!draft?.target || Number(draft.target) <= 0) { setMessage("План должен быть больше нуля"); return; }
    await send("PATCH", key, {
      employeeId: row.employeeId, code: metric.code, title: draft.title,
      kind: metric.kind, unit: metric.unit, target: Number(draft.target),
      actual: metric.kind === "CUSTOM" && draft.actual !== "" ? Number(draft.actual) : null,
      evidence: metric.kind === "CUSTOM" ? draft.evidence : null,
    });
  }

  async function addCustom(row: Row) {
    const draft = customDrafts[row.employeeId] ?? defaultDraft();
    if (!draft.title.trim() || !draft.target || Number(draft.target) <= 0) { setMessage("Укажите название и план показателя"); return; }
    const saved = await send("PATCH", `custom:${row.employeeId}`, {
      employeeId: row.employeeId, code: `custom:${crypto.randomUUID()}`, title: draft.title,
      kind: "CUSTOM", unit: draft.unit, target: Number(draft.target),
      actual: draft.actual ? Number(draft.actual) : null, evidence: draft.evidence,
    });
    if (saved) setCustomDrafts((current) => ({ ...current, [row.employeeId]: defaultDraft() }));
  }

  const patchDraft = (key: string, patch: Partial<Draft>) => setDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? defaultDraft()), ...patch } }));
  const patchCustom = (id: number, patch: Partial<Draft>) => setCustomDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? defaultDraft()), ...patch } }));

  return <main className="mx-auto w-full max-w-[1500px] space-y-5 p-4 pb-24 text-slate-100 sm:p-6 lg:p-8">
    <header className="rounded-3xl border border-slate-800 bg-[#101827] p-5 sm:p-6">
      <p className="text-xs font-bold uppercase tracking-[.18em] text-blue-300">Команда</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4"><div><h1 className="flex items-center gap-2 text-3xl font-bold"><BarChart3/>KPI сотрудников</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Факт автоматических показателей берётся из задач, CRM, замеров, производства и монтажа. План назначает директор. Дополнительный показатель и его факт директор вносит с указанием основания.</p></div><div className="flex flex-wrap items-end gap-2"><label className="text-sm text-slate-300">Период<input aria-label="Месяц KPI" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className={`${field} mt-1 block min-h-11`}/></label><a href={`/api/kpi?month=${month}&export=csv`} className="inline-flex min-h-11 items-center rounded-lg border border-slate-700 px-3 text-sm font-semibold text-blue-200">Скачать CSV</a></div></div>
    </header>
    {message && <p role="status" className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-100">{message}</p>}
    {loading && !data ? <div className="rounded-2xl border border-slate-800 p-10 text-slate-400">Загружаем фактические показатели…</div> : null}
    {data && <>
      {data.canManage && data.requests.some((item) => item.status === "OPEN") && <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5"><h2 className="text-lg font-bold text-amber-100">Запросы директору · {data.requests.filter((item) => item.status === "OPEN").length}</h2><p className="mt-1 text-sm text-slate-400">Назначьте показатель и план сотруднику. Запрос закроется после сохранения цели.</p><div className="mt-3 grid gap-2 md:grid-cols-2">{data.requests.filter((item) => item.status === "OPEN").map((item) => <button key={item.id} type="button" onClick={() => { setRoleFilter("ALL"); setPositionFilter(""); setPersonFilter(String(item.employeeId)); window.setTimeout(() => document.getElementById(`employee-${item.employeeId}`)?.scrollIntoView({ behavior: "smooth" }), 0); }} className="rounded-xl border border-amber-500/20 bg-slate-950 p-3 text-left text-sm"><strong className="block text-white">{item.employeeName}</strong><span className="text-slate-400">От {item.requestedBy}{item.note ? ` · ${item.note}` : ""}</span></button>)}</div></section>}
      <section className="grid gap-3 sm:grid-cols-3"><Stat label="Сотрудников" value={visibleRows.length}/><Stat label="Цели назначены" value={totals.planned}/><Stat label="Цели достигнуты" value={totals.achieved}/></section>
      <section className="flex flex-wrap gap-3 rounded-2xl border border-slate-800 bg-[#101827] p-4"><label className="text-xs text-slate-400">Сотрудник<select aria-label="Фильтр сотрудника" value={personFilter} onChange={(event) => setPersonFilter(event.target.value)} className={`${field} mt-1 block min-w-48`}><option value="ALL">Все</option>{data.rows.map((row) => <option key={row.employeeId} value={row.employeeId}>{row.name}</option>)}</select></label><label className="text-xs text-slate-400">Роль<select aria-label="Фильтр роли" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className={`${field} mt-1 block min-w-40`}><option value="ALL">Все</option>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label><label className="text-xs text-slate-400">Должность<input aria-label="Фильтр должности" value={positionFilter} onChange={(event) => setPositionFilter(event.target.value)} placeholder="Поиск" className={`${field} mt-1 block min-w-44`}/></label></section>
      {visibleRows.length === 0 && <p className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">Сотрудников по выбранным фильтрам нет. Проверьте карточки сотрудников и выбранный период.</p>}
      {visibleRows.map((row) => <section key={row.employeeId} id={`employee-${row.employeeId}`} className="scroll-mt-5 rounded-2xl border border-slate-800 bg-[#101827] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-white">{row.name}</h2><p className="mt-1 text-sm text-slate-400">{row.position} · {month}</p></div><div className="rounded-xl bg-slate-950 px-3 py-2 text-sm text-slate-300">Планов: {row.summary.planned} · Достигнуто: {row.summary.achieved}{row.summary.missing > 0 ? ` · Без плана: ${row.summary.missing}` : ""}</div></div>
        {row.request && <p className={`mt-3 rounded-lg p-3 text-sm ${row.request.status === "OPEN" ? "bg-amber-500/10 text-amber-100" : "bg-emerald-500/10 text-emerald-100"}`}>{row.request.status === "OPEN" ? "Запрос директору ожидает решения" : "Директор назначил цель"}{row.request.note ? ` · ${row.request.note}` : ""}</p>}
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead className="border-b border-slate-700 text-left text-slate-400"><tr><th className="p-2">Показатель и источник</th><th className="p-2 text-right">План</th><th className="p-2 text-right">Факт</th><th className="p-2 text-right">Выполнение</th>{data.canManage && <th className="p-2">Действие директора</th>}</tr></thead><tbody className="divide-y divide-slate-800">{row.metrics.map((metric) => {
          const key = draftKey(row.employeeId, metric.code);
          const draft = drafts[key] ?? defaultDraft();
          return <tr key={metric.code}>
            <td className="p-2"><strong className="text-white">{metric.title}</strong><span className="block text-xs text-slate-500">{metric.source}{metric.evidence ? ` · ${metric.evidence}` : ""}</span></td>
            <td className="p-2 text-right tabular-nums">{format(metric.target, metric.unit)}</td>
            <td className="p-2 text-right tabular-nums">{format(metric.actual, metric.unit)}</td>
            <td className="p-2 text-right font-semibold tabular-nums text-blue-200">{metric.completionPercent === null ? "—" : `${metric.completionPercent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`}</td>
            {data.canManage && <td className="p-2">{row.role === "MANAGER" && (metric.code === "sales" || metric.code === "orders")
              ? <a href={`/sales-plan?month=${month}#manager-kpi`} className="inline-block rounded-lg border border-blue-500/40 px-3 py-2 text-sm font-semibold text-blue-200">Назначить в плане продаж</a>
              : <div className="flex min-w-[290px] flex-wrap items-center gap-2"><input aria-label={`План ${metric.title} ${row.name}`} type="number" min="0.01" step="any" placeholder="План" value={draft.target} onChange={(event) => patchDraft(key, { target: event.target.value })} className={`${field} w-24`}/>{metric.kind === "CUSTOM" && <><input aria-label={`Факт ${metric.title} ${row.name}`} type="number" min="0" step="any" placeholder="Факт" value={draft.actual} onChange={(event) => patchDraft(key, { actual: event.target.value })} className={`${field} w-24`}/><input aria-label={`Основание ${metric.title} ${row.name}`} value={draft.evidence} onChange={(event) => patchDraft(key, { evidence: event.target.value })} placeholder="Основание факта" className={`${field} w-40`}/></>}<button type="button" disabled={Boolean(savingKey)} onClick={() => void saveMetric(row, metric)} className="rounded-lg bg-blue-600 px-3 py-2 font-semibold disabled:opacity-50"><Check size={16}/></button>{metric.target !== null && <button type="button" aria-label={`Удалить план ${metric.title} ${row.name}`} disabled={Boolean(savingKey)} onClick={() => void send("DELETE", key, { employeeId: row.employeeId, code: metric.code })} className="rounded-lg border border-slate-700 p-2 text-slate-400 disabled:opacity-50"><Trash2 size={16}/></button>}</div>}
            </td>}
          </tr>;
        })}</tbody></table></div>
        {data.canManage ? <div className="mt-4 rounded-xl border border-dashed border-slate-700 p-3"><p className="text-sm font-semibold">Дополнительный показатель директора</p><p className="mt-1 text-xs text-slate-500">Для ручного факта обязательно укажите основание. Автоматические показатели берутся только из системы.</p><div className="mt-3 flex flex-wrap gap-2"><input aria-label={`Новый показатель ${row.name}`} value={(customDrafts[row.employeeId] ?? defaultDraft()).title} onChange={(event) => patchCustom(row.employeeId, { title: event.target.value })} placeholder="Название" className={`${field} min-w-48 flex-1`}/><select aria-label={`Единица нового показателя ${row.name}`} value={(customDrafts[row.employeeId] ?? defaultDraft()).unit} onChange={(event) => patchCustom(row.employeeId, { unit: event.target.value as Unit })} className={field}><option value="COUNT">Количество</option><option value="MONEY">Тенге</option><option value="PERCENT">Процент</option></select><input aria-label={`План нового показателя ${row.name}`} type="number" min="0.01" step="any" value={(customDrafts[row.employeeId] ?? defaultDraft()).target} onChange={(event) => patchCustom(row.employeeId, { target: event.target.value })} placeholder="План" className={`${field} w-28`}/><input aria-label={`Факт нового показателя ${row.name}`} type="number" min="0" step="any" value={(customDrafts[row.employeeId] ?? defaultDraft()).actual} onChange={(event) => patchCustom(row.employeeId, { actual: event.target.value })} placeholder="Факт" className={`${field} w-28`}/><input aria-label={`Основание нового показателя ${row.name}`} value={(customDrafts[row.employeeId] ?? defaultDraft()).evidence} onChange={(event) => patchCustom(row.employeeId, { evidence: event.target.value })} placeholder="Основание факта" className={`${field} min-w-40`}/><button type="button" disabled={Boolean(savingKey)} onClick={() => void addCustom(row)} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold disabled:opacity-50"><Plus size={16}/>Добавить</button></div></div> : row.summary.planned === 0 && <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-sm"><p className="text-amber-100">Директор ещё не назначил план. Фактические результаты уже показаны выше.</p><div className="mt-2 flex flex-wrap gap-2"><input aria-label="Комментарий к запросу KPI" value={requestNotes[row.employeeId] ?? ""} onChange={(event) => setRequestNotes((current) => ({ ...current, [row.employeeId]: event.target.value }))} placeholder="Что нужно уточнить директору" className={`${field} min-w-60 flex-1`}/><button type="button" disabled={Boolean(savingKey) || row.request?.status === "OPEN"} onClick={() => void send("POST", `request:${row.employeeId}`, { employeeId: row.employeeId, note: requestNotes[row.employeeId] ?? "" })} className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-2 font-semibold disabled:opacity-50"><Send size={16}/>{row.request?.status === "OPEN" ? "Запрос отправлен" : "Запросить план"}</button></div></div>}
      </section>)}
      <p className="text-xs leading-5 text-slate-500">Проценты рассчитаны отдельно для каждой цели: факт ÷ план. Разные показатели не складываются в искусственный общий процент.</p>
    </>}
  </main>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl border border-slate-800 bg-[#101827] p-4"><p className="text-xs text-slate-400">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums text-white">{value.toLocaleString("ru-RU")}</p></div>;
}
