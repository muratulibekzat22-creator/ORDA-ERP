"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  MapPin,
  Phone,
  RefreshCw,
  XCircle,
} from "lucide-react";

type Filter = "today" | "upcoming" | "needs-closing" | "completed" | "cancelled" | "all";
type Person = { id: number; name: string };
type AuditEvent = {
  id: number;
  action: string;
  comment?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  createdAt: string;
  actor?: Person | null;
};
type Photo = { id: number; type: string; fileName: string; createdAt: string };
type Measurement = {
  id: number;
  status: string;
  visitDate: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  city: string;
  address: string;
  mapLink?: string | null;
  managerComment?: string | null;
  stepsCount?: number | null;
  sameSize: boolean;
  stepLength?: number | null;
  stepWidth?: number | null;
  stepHeight?: number | null;
  individualSteps?: Array<{ length?: number | null; width?: number | null; height?: number | null }> | null;
  riserHeight?: number | null;
  winderCount: number;
  winders?: Array<{ length?: number | null; width?: number | null; comment?: string | null }> | null;
  platformsCount: number;
  platforms?: Array<{ length?: number | null; width?: number | null }> | null;
  railingLength?: number | null;
  railingComment?: string | null;
  objectNotes?: string | null;
  comment?: string | null;
  clientOutcome?: "READY_TO_CONTINUE" | "RETURN_TO_MANAGER" | "REFUSED" | null;
  refusalReason?: string | null;
  outcomeComment?: string | null;
  outcomeAt?: string | null;
  client: {
    id: number;
    name: string;
    phone: string;
    whatsapp: string;
    city: string;
    address: string;
    manager: string;
    managerUser?: Person | null;
  };
  measurerUser?: Person | null;
  order?: { id: number; number: string } | null;
  attachments: Photo[];
  auditEvents: AuditEvent[];
  operational: { needsClosing: boolean; overdueMs: number };
  latestReschedule?: {
    previousVisitDate?: string | null;
    visitDate: string;
    comment?: string | null;
    changedAt: string;
    changedBy?: Person | null;
    reassigned: boolean;
  } | null;
  cancellation?: {
    reason?: string | null;
    comment?: string | null;
    cancelledAt: string;
    cancelledBy?: Person | null;
  } | null;
};
type Payload = {
  measurements: Measurement[];
  kpi: { today: number; upcoming: number; overdue: number; monthCompleted: number };
};

const filterLabels: Array<[Filter, string]> = [
  ["today", "Сегодня"],
  ["upcoming", "Предстоящие"],
  ["needs-closing", "Требуют закрытия"],
  ["completed", "Выполненные"],
  ["cancelled", "Отменённые"],
  ["all", "Все"],
];
const outcomeLabels: Record<string, string> = {
  READY_TO_CONTINUE: "ГОТОВ ПРОДОЛЖАТЬ",
  RETURN_TO_MANAGER: "ТРЕБУЕТ РАБОТЫ МЕНЕДЖЕРА",
  REFUSED: "КЛИЕНТ ОТКАЗАЛСЯ",
};
const refusalLabels: Record<string, string> = {
  PRICE_TOO_HIGH: "Дорого",
  CHANGED_MIND: "Передумал",
  COMPARING: "Сравнивает",
  NO_BUDGET: "Нет бюджета",
  NOT_READY: "Не готов сейчас",
  UNSUITABLE_SOLUTION: "Не подходит решение",
  NO_RESPONSE: "Не выходит на связь",
  OTHER: "Другое",
};
const auditLabels: Record<string, string> = {
  SCHEDULED: "Замер назначен",
  SELF_CREATED: "Замер создан",
  RESCHEDULED: "Замер перенесён",
  REASSIGNED: "Замер перенесён и переназначен",
  STARTED: "Замер начат",
  DRAFT_SAVED: "Черновик сохранён",
  COMPLETED: "Замер выполнен",
  CLIENT_OUTCOME_RECORDED: "Результат клиента сохранён",
  HANDED_TO_MANAGER: "Результат передан менеджеру",
  MEASUREMENT_CANCELLED: "Замер отменён",
  CANCELLED: "Замер отменён",
};

const date = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "medium" }).format(new Date(value));
const time = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const when = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const businessDate = (value: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));

function overdue(value: number) {
  const minutes = Math.max(1, Math.floor(value / 60_000));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч ${minutes % 60 ? `${minutes % 60} мин` : ""}`.trim();
  const days = Math.floor(hours / 24);
  return `${days} дн ${hours % 24 ? `${hours % 24} ч` : ""}`.trim();
}

function statusLabel(row: Measurement) {
  if (row.status === "IN_PROGRESS") return "В процессе";
  if (["COMPLETED", "HANDED_TO_MANAGER"].includes(row.status)) return "Выполнен";
  if (row.status === "CANCELLED") return "Отменён";
  if (row.status === "ASSIGNED" && businessDate(row.visitDate) === businessDate(new Date())) return `Сегодня, ${time(row.visitDate)}`;
  return "Назначен";
}

function statusTone(row: Measurement) {
  if (row.operational.needsClosing) return "border-red-500/40 bg-red-950/50 text-red-200";
  if (row.status === "IN_PROGRESS") return "border-amber-500/30 bg-amber-950/40 text-amber-200";
  if (["COMPLETED", "HANDED_TO_MANAGER"].includes(row.status)) return "border-emerald-500/30 bg-emerald-950/40 text-emerald-200";
  if (row.status === "CANCELLED") return "border-slate-600 bg-slate-800 text-slate-300";
  return "border-blue-500/30 bg-blue-950/40 text-blue-200";
}

export default function DirectorMeasurementControl() {
  const [filter, setFilter] = useState<Filter>("today");
  const [initialized, setInitialized] = useState(false);
  const [measurerUserId, setMeasurerUserId] = useState("");
  const [managerUserId, setManagerUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [measurers, setMeasurers] = useState<Person[]>([]);
  const [managers, setManagers] = useState<Person[]>([]);
  const [data, setData] = useState<Payload>({ measurements: [], kpi: { today: 0, upcoming: 0, overdue: 0, monthCompleted: 0 } });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const requestedFilter = params.get("filter") as Filter | null;
      if (requestedFilter && filterLabels.some(([value]) => value === requestedFilter)) setFilter(requestedFilter);
      const measurement = Number(params.get("measurement"));
      if (Number.isInteger(measurement) && measurement > 0) setSelectedId(measurement);
      setInitialized(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!initialized) return;
    const controller = new AbortController();
    void fetch("/api/measurements?meta=1", { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ response, body: await response.json().catch(() => ({})) }))
      .then(({ response, body }) => {
        if (!response.ok) throw new Error(body.error ?? "Не удалось загрузить фильтры");
        setMeasurers(body.measurers ?? []);
        setManagers(body.managers ?? []);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить фильтры");
      });
    return () => controller.abort();
  }, [initialized]);

  const load = useCallback(async () => {
    if (!initialized) return;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ workspace: "1", filter });
    if (measurerUserId) params.set("measurerUserId", measurerUserId);
    if (managerUserId) params.set("managerUserId", managerUserId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    try {
      const response = await fetch(`/api/measurements?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Не удалось загрузить замеры");
      setData(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить замеры");
    } finally {
      setLoading(false);
    }
  }, [filter, from, initialized, managerUserId, measurerUserId, to]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selected = data.measurements.find((row) => row.id === selectedId) ?? null;
  const rows = useMemo(() => [...data.measurements].sort((left, right) => new Date(left.visitDate).getTime() - new Date(right.visitDate).getTime()), [data.measurements]);
  const chooseFilter = (value: Filter) => {
    setFilter(value);
    setSelectedId(null);
    const url = new URL(window.location.href);
    url.searchParams.set("filter", value);
    url.searchParams.delete("measurement");
    window.history.replaceState({}, "", url);
  };
  const chooseMeasurement = (id: number) => {
    setSelectedId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("measurement", String(id));
    window.history.replaceState({}, "", url);
  };

  return <main className="min-w-0 space-y-5 overflow-x-hidden p-4 pb-24 md:p-8">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-sm font-semibold uppercase tracking-widest text-amber-300">Director control</p><h1 className="mt-1 text-2xl font-bold text-white md:text-3xl">Замеры компании</h1><p className="mt-1 text-sm text-slate-400">Расписание, фактический статус и результат работы замерщиков.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 font-semibold text-white disabled:opacity-60"><RefreshCw size={18} className={loading ? "animate-spin" : ""}/>Обновить</button>
    </header>

    {error && <p role="alert" className="rounded-xl border border-red-700 bg-red-950/40 p-4 text-red-200">{error}</p>}

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi label="Сегодня" value={data.kpi.today}/><Kpi label="Предстоящие" value={data.kpi.upcoming}/><Kpi label="Требуют закрытия" value={data.kpi.overdue} attention/><Kpi label="Выполнено за месяц" value={data.kpi.monthCompleted}/>
    </section>

    <section className="space-y-3 rounded-2xl border border-slate-800 bg-[#101827] p-3 sm:p-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">{filterLabels.map(([value, label]) => <button type="button" key={value} onClick={() => chooseFilter(value)} className={`min-h-11 rounded-xl px-2 text-sm font-semibold ${filter === value ? "bg-amber-300 text-slate-950" : "bg-slate-900 text-slate-300"}`}>{label}</button>)}</div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs text-slate-400">Замерщик<select value={measurerUserId} onChange={(event) => setMeasurerUserId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="">Все замерщики</option>{measurers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <label className="text-xs text-slate-400">Менеджер<select value={managerUserId} onChange={(event) => setManagerUserId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="">Все менеджеры</option>{managers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <label className="text-xs text-slate-400">Период с<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"/></label>
        <label className="text-xs text-slate-400">Период по<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"/></label>
      </div>
    </section>

    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(340px,0.85fr)_minmax(0,1.35fr)]">
      <section className="min-w-0 space-y-3">
        {loading && !rows.length ? <div className="h-40 animate-pulse rounded-2xl bg-slate-900"/> : rows.length ? rows.map((row) => <MeasurementCard key={row.id} row={row} selected={row.id === selectedId} onOpen={() => chooseMeasurement(row.id)}/>) : <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">Замеров по выбранным фильтрам нет.</div>}
      </section>
      {selected ? <MeasurementDetail row={selected}/> : <section className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-slate-700 p-6 text-center text-slate-400">Откройте замер, чтобы увидеть технический результат, фотографии и историю.</section>}
    </div>
  </main>;
}

function Kpi({ label, value, attention = false }: { label: string; value: number; attention?: boolean }) {
  return <div className={`rounded-2xl border p-4 ${attention && value ? "border-red-700 bg-red-950/30" : "border-slate-800 bg-[#101827]"}`}><p className="text-xs text-slate-400 sm:text-sm">{label}</p><strong className="mt-2 block text-2xl text-white">{value}</strong></div>;
}

function MeasurementCard({ row, selected, onOpen }: { row: Measurement; selected: boolean; onOpen: () => void }) {
  const outcome = row.clientOutcome ? outcomeLabels[row.clientOutcome] : null;
  return <article className={`min-w-0 rounded-2xl border p-4 ${selected ? "border-amber-300/50 bg-amber-300/5" : "border-slate-800 bg-[#101827]"}`}>
    <button type="button" onClick={onOpen} className="w-full min-w-0 text-left">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><span className="text-xs text-slate-400">{date(row.visitDate)}</span><strong className="mt-0.5 block text-xl text-white">{time(row.visitDate)}</strong></div><span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(row)}`}>{statusLabel(row)}</span></div>
      {row.operational.needsClosing && <p className="mt-3 rounded-lg bg-red-950/50 px-3 py-2 text-sm font-semibold text-red-200">Требует закрытия · просрочено на {overdue(row.operational.overdueMs)}</p>}
      <h2 className="mt-3 break-words text-lg font-semibold text-white">{row.client.name || "Клиент без имени"}</h2>
      <p className="mt-1 break-all text-sm text-slate-300">{row.client.phone}</p><p className="mt-1 break-words text-sm text-slate-400">{row.city || row.client.city} · {row.address || row.client.address || "Адрес не указан"}</p>
      <div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2"><span>Менеджер<strong className="block break-words text-slate-200">{row.client.managerUser?.name ?? row.client.manager ?? "Не назначен"}</strong></span><span>Замерщик<strong className="block break-words text-slate-200">{row.measurerUser?.name ?? "Не назначен"}</strong></span></div>
      {row.latestReschedule && <p className="mt-3 text-sm font-medium text-amber-200">Перенесён → {when(row.visitDate)}</p>}
      {outcome && <p className={`mt-3 rounded-lg px-3 py-2 text-sm font-bold ${row.clientOutcome === "REFUSED" ? "bg-red-950/50 text-red-200" : row.clientOutcome === "RETURN_TO_MANAGER" ? "bg-amber-950/40 text-amber-200" : "bg-emerald-950/40 text-emerald-200"}`}>{outcome}{row.refusalReason ? ` · ${refusalLabels[row.refusalReason] ?? row.refusalReason}` : ""}</p>}
      <p className="mt-3 text-xs text-slate-500">Обновлено {when(row.updatedAt)}</p><span className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold text-blue-300">Открыть замер →</span>
    </button>
  </article>;
}

function MeasurementDetail({ row }: { row: Measurement }) {
  return <section className="min-w-0 space-y-5 rounded-2xl border border-slate-800 bg-[#101827] p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm text-blue-300">Замер №{row.id} · {when(row.visitDate)}</p><h2 className="mt-1 break-words text-2xl font-bold text-white">{row.client.name}</h2><p className="mt-1 break-words text-slate-400">{row.city} · {row.address}</p></div><span className={`rounded-full border px-3 py-1 text-sm font-semibold ${statusTone(row)}`}>{statusLabel(row)}</span></div>
    {row.operational.needsClosing && <div className="rounded-xl border border-red-700 bg-red-950/30 p-4"><strong className="text-red-100">Время замера прошло — замерщик должен указать результат</strong><p className="mt-1 text-sm text-red-200">Просрочено на {overdue(row.operational.overdueMs)}. Фактический статус не изменён.</p></div>}
    <div className="grid gap-3 rounded-xl bg-slate-900 p-4 text-sm sm:grid-cols-2"><Detail label="Телефон" value={row.client.phone}/><Detail label="WhatsApp" value={row.client.whatsapp || row.client.phone}/><Detail label="Менеджер" value={row.client.managerUser?.name ?? row.client.manager}/><Detail label="Замерщик" value={row.measurerUser?.name ?? "Не назначен"}/><Detail label="Назначено" value={when(row.visitDate)}/><Detail label="Последнее обновление" value={when(row.updatedAt)}/></div>
    <div className="grid grid-cols-2 gap-2"><a href={`tel:${row.client.phone}`} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-800 px-3"><Phone size={17}/>Позвонить</a>{(row.mapLink || row.address) && <a href={row.mapLink || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${row.city} ${row.address}`)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-800 px-3"><MapPin size={17}/>Карта</a>}</div>
    {row.managerComment && <Info title="Комментарий менеджера">{row.managerComment}</Info>}
    {row.latestReschedule && <section className="rounded-xl border border-amber-700/50 bg-amber-950/20 p-4"><h3 className="flex items-center gap-2 font-semibold text-amber-100"><CalendarClock size={18}/>Замер перенесён</h3><div className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><Detail label="Было" value={row.latestReschedule.previousVisitDate ? when(row.latestReschedule.previousVisitDate) : "Нет данных"}/><Detail label="Стало" value={when(row.visitDate)}/></div>{row.latestReschedule.comment && <p className="mt-2 text-sm text-amber-100">{row.latestReschedule.comment}</p>}<p className="mt-2 text-xs text-slate-500">{when(row.latestReschedule.changedAt)} · {row.latestReschedule.changedBy?.name ?? "Система"}</p></section>}
    {row.status === "CANCELLED" && <section className="rounded-xl border border-slate-600 bg-slate-950/60 p-4"><h3 className="flex items-center gap-2 font-semibold text-white"><XCircle size={18}/>Замер отменён</h3><Detail label="Причина" value={row.cancellation?.reason ?? row.cancellation?.comment ?? "Причина не указана"}/>{row.cancellation?.comment && row.cancellation.comment !== row.cancellation.reason && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{row.cancellation.comment}</p>}<p className="mt-2 text-xs text-slate-500">{row.cancellation ? when(row.cancellation.cancelledAt) : ""} · {row.cancellation?.cancelledBy?.name ?? "Система"}</p></section>}
    {["COMPLETED", "HANDED_TO_MANAGER"].includes(row.status) && <TechnicalResult row={row}/>} 
    <section className="rounded-xl border border-slate-700 bg-slate-950/50 p-4"><h3 className="flex items-center gap-2 font-semibold text-white"><Clock3 size={18}/>История замера</h3><div className="mt-3 space-y-3">{row.auditEvents.length ? [...row.auditEvents].reverse().map((event) => <div key={event.id} className="border-l border-slate-700 pl-3"><strong className="text-sm text-slate-200">{auditLabels[event.action] ?? event.action}</strong>{event.comment && <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-400">{event.comment}</p>}<p className="mt-0.5 text-xs text-slate-500">{when(event.createdAt)} · {event.actor?.name ?? "Система"}</p></div>) : <p className="text-sm text-slate-500">История пока пуста.</p>}</div></section>
  </section>;
}

function TechnicalResult({ row }: { row: Measurement }) {
  return <section className="space-y-4 rounded-xl border border-emerald-700/50 bg-emerald-950/10 p-4"><div><h3 className="flex items-center gap-2 font-semibold text-white"><CheckCircle2 size={18}/>Технический результат заполнен</h3><p className="mt-1 text-xs text-slate-500">{row.completedAt ? `Завершён ${when(row.completedAt)}` : "Дата завершения не указана"} · {row.measurerUser?.name ?? "Замерщик не указан"}</p></div>
    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3"><Detail label="Ступени" value={String(row.stepsCount ?? 0)}/><Detail label="Размер ступени" value={row.sameSize ? `${row.stepLength ?? "—"} × ${row.stepWidth ?? "—"} × ${row.stepHeight ?? "—"} мм` : "Разные размеры"}/><Detail label="Подступенок" value={`${row.riserHeight ?? "—"} мм`}/><Detail label="Забежные" value={String(row.winderCount ?? 0)}/><Detail label="Площадки" value={String(row.platformsCount ?? 0)}/><Detail label="Ограждение" value={`${row.railingLength ?? 0} м`}/></div>
    {row.individualSteps?.length ? <List title="Размеры ступеней" items={row.individualSteps.map((item, index) => `№${index + 1}: ${item.length ?? "—"} × ${item.width ?? "—"} × ${item.height ?? "—"} мм`)}/> : null}
    {row.winders?.length ? <List title="Забежные ступени" items={row.winders.map((item, index) => `№${index + 1}: ${item.length ?? "—"} × ${item.width ?? "—"} мм${item.comment ? ` · ${item.comment}` : ""}`)}/> : null}
    {row.platforms?.length ? <List title="Площадки" items={row.platforms.map((item, index) => `№${index + 1}: ${item.length ?? "—"} × ${item.width ?? "—"} мм`)}/> : null}
    {row.railingComment && <Info title="Ограждение">{row.railingComment}</Info>}{row.objectNotes && <Info title="Особенности объекта">{row.objectNotes}</Info>}{row.comment && <Info title="Комментарий замерщика">{row.comment}</Info>}
    {row.clientOutcome && <div className={`rounded-xl p-4 ${row.clientOutcome === "REFUSED" ? "bg-red-950/50 text-red-100" : row.clientOutcome === "RETURN_TO_MANAGER" ? "bg-amber-950/40 text-amber-100" : "bg-emerald-950/40 text-emerald-100"}`}><strong>{outcomeLabels[row.clientOutcome]}</strong>{row.refusalReason && <p className="mt-1">Причина: {refusalLabels[row.refusalReason] ?? row.refusalReason}</p>}{row.outcomeComment && <p className="mt-1 whitespace-pre-wrap text-sm">{row.outcomeComment}</p>}{row.outcomeAt && <p className="mt-2 text-xs opacity-70">Зафиксировано {when(row.outcomeAt)}</p>}</div>}
    <div><h4 className="font-semibold text-white">Фотографии</h4>{row.attachments.length ? <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">{row.attachments.map((photo) => <a key={photo.id} href={`/api/measurement-attachments/${photo.id}`} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900"><Image src={`/api/measurement-attachments/${photo.id}`} alt={photo.fileName} width={320} height={128} unoptimized className="h-32 w-full object-cover"/><span className="block truncate p-2 text-xs text-blue-200">{photo.type === "SHEET" ? "Замерный лист" : photo.type === "OBJECT" ? "Объект" : photo.fileName}</span></a>)}</div> : <p className="mt-2 text-sm text-slate-500">Фотографии не добавлены.</p>}</div>
  </section>;
}

function Detail({ label, value }: { label: string; value?: string | null }) { return <span className="min-w-0 text-xs text-slate-500">{label}<strong className="mt-0.5 block break-words text-sm font-medium text-slate-200">{value || "—"}</strong></span>; }
function Info({ title, children }: { title: string; children: React.ReactNode }) { return <div className="rounded-xl bg-slate-900 p-3"><strong className="text-sm text-white">{title}</strong><p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-300">{children}</p></div>; }
function List({ title, items }: { title: string; items: string[] }) { return <div><strong className="text-sm text-white">{title}</strong><ul className="mt-1 space-y-1 text-sm text-slate-300">{items.map((item) => <li key={item}>{item}</li>)}</ul></div>; }
