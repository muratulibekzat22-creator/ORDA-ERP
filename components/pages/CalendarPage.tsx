"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { BUSINESS_TIME_ZONE, formatBusinessInput } from "@/lib/calendar-time";

type Mode = "today" | "day" | "week" | "month";
type Task = {
  id: number;
  title: string;
  description: string | null;
  type: string;
  dueAt: string;
  status: string;
  priority: string;
  overdue: boolean;
  assignee: { id: number; name: string };
  client: {
    id: number;
    name: string;
    phone: string;
    whatsapp: string;
    city: string;
  } | null;
  order: { id: number; number: string; client: { name: string } } | null;
};
type Meta = {
  assignees: Array<{ id: number; name: string; role: string }>;
  clients: Array<{ id: number; name: string; phone: string }>;
  orders: Array<{
    id: number;
    number: string;
    clientId: number;
    client: { name: string };
  }>;
};
const labels: Record<string, string> = {
  CALL: "Звонок",
  MEETING: "Встреча",
  MEASUREMENT: "Замер",
  INSTALLATION: "Монтаж",
  DELIVERY: "Доставка",
  TASK: "Задача",
  REMINDER: "Напоминание",
  OTHER: "Другое",
};
const priorities: Record<string, string> = {
  NORMAL: "Обычный",
  IMPORTANT: "Важный",
  URGENT: "Срочный",
};
const field =
  "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white outline-none focus:border-blue-500";

function zonedParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((x) => x.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}
function businessMidnight(date: Date) {
  const p = zonedParts(date);
  return new Date(
    `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T00:00:00+05:00`,
  );
}
function range(anchor: Date, mode: Mode) {
  const start = businessMidnight(anchor);
  if (mode === "week") {
    const day = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - day);
  }
  if (mode === "month") {
    const p = zonedParts(anchor);
    return {
      from: new Date(
        `${p.year}-${String(p.month).padStart(2, "0")}-01T00:00:00+05:00`,
      ),
      to: new Date(
        `${p.month === 12 ? p.year + 1 : p.year}-${String(p.month === 12 ? 1 : p.month + 1).padStart(2, "0")}-01T00:00:00+05:00`,
      ),
    };
  }
  const to = new Date(start);
  to.setUTCDate(to.getUTCDate() + (mode === "week" ? 7 : 1));
  return { from: start, to };
}
function display(value: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: BUSINESS_TIME_ZONE,
    ...options,
  }).format(new Date(value));
}

export default function CalendarPage({ initialState = "active" }: { initialState?: string }) {
  const { data: session } = useSession();
  const [mode, setMode] = useState<Mode>("today"),
    [anchor, setAnchor] = useState(new Date()),
    [tasks, setTasks] = useState<Task[]>([]),
    [meta, setMeta] = useState<Meta>({
      assignees: [],
      clients: [],
      orders: [],
    }),
    [assignee, setAssignee] = useState(""),
    [assigneeRole, setAssigneeRole] = useState(""),
    [taskType, setTaskType] = useState(""),
    [state, setState] = useState(["active", "overdue", "completed", "all"].includes(initialState) ? initialState : "active"),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [open, setOpen] = useState(false),
    [editId, setEditId] = useState<number | null>(null),
    [saving, setSaving] = useState(false);
  const [pagination, setPagination] = useState<{ nextCursor: string | null; hasMore: boolean }>({ nextCursor: null, hasMore: false });
  const [form, setForm] = useState({
    title: "",
    type: "TASK",
    dueAt: formatBusinessInput(new Date()),
    assigneeId: "",
    priority: "NORMAL",
    clientId: "",
    orderId: "",
    description: "",
  });
  const role = session?.user.role,
    director = role === "DIRECTOR";
  const selectedRange = useMemo(() => range(anchor, mode), [anchor, mode]);
  const load = useCallback(async (cursor?: string) => {
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({
        start: selectedRange.from.toISOString(),
        end: selectedRange.to.toISOString(),
        state,
        limit: "200",
      });
      if (assignee) q.set("assigneeId", assignee);
      if (assigneeRole) q.set("role", assigneeRole);
      if (taskType) q.set("type", taskType);
      if (cursor) q.set("cursor", cursor);
      const res = await fetch(`/api/calendar?${q}`);
      if (!res.ok)
        throw new Error(
          (await res.json()).error ?? "Не удалось загрузить календарь",
        );
      const body = await res.json();
      setTasks((current) => cursor ? [...current, ...(body.tasks ?? [])].filter((task, index, rows) => rows.findIndex((candidate) => candidate.id === task.id) === index) : (body.tasks ?? []));
      setPagination(body.pagination ?? { nextCursor: null, hasMore: false });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Не удалось загрузить календарь",
      );
    } finally {
      setLoading(false);
    }
  }, [assignee, assigneeRole, selectedRange, state, taskType]);
  useEffect(() => {
    void fetch("/api/calendar?meta=1")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((m: Meta) => {
        setMeta(m);
        setForm((f) => ({
          ...f,
          assigneeId: f.assigneeId || String(m.assignees[0]?.id ?? ""),
        }));
      })
      .catch(() => setError("Не удалось загрузить справочники"));
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const groups = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      const key = display(task.dueAt, {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
      map.set(key, [...(map.get(key) ?? []), task]);
    }
    return [...map.entries()];
  }, [tasks]);
  function quickCreate(date?: Date) {
    const next = date ?? new Date();
    setEditId(null);
    setForm((f) => ({
      ...f,
      title: "",
      description: "",
      dueAt: formatBusinessInput(next),
      assigneeId: f.assigneeId || String(meta.assignees[0]?.id ?? ""),
      clientId: "",
      orderId: "",
    }));
    setOpen(true);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        editId ? `/api/calendar/${editId}` : "/api/calendar",
        {
          method: editId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            assigneeId: Number(form.assigneeId),
            clientId: form.clientId ? Number(form.clientId) : null,
            orderId: form.orderId ? Number(form.orderId) : null,
          }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setOpen(false);
      setNotice(
        editId
          ? "Задача перенесена"
          : body.conflict
            ? `Задача создана. В это время уже есть «${body.conflict.title}».`
            : "Задача создана",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить задачу");
    } finally {
      setSaving(false);
    }
  }
  async function action(id: number, name: "complete" | "cancel") {
    const res = await fetch(`/api/calendar/${id}/${name}`, { method: "POST" });
    if (!res.ok) {
      setError((await res.json()).error ?? "Действие не выполнено");
      return;
    }
    setNotice(name === "complete" ? "Задача выполнена" : "Задача отменена");
    await load();
  }
  function move(direction: number) {
    const next = new Date(anchor);
    next.setDate(
      next.getDate() +
        direction * (mode === "week" ? 7 : mode === "month" ? 30 : 1),
    );
    setAnchor(next);
  }
  return (
    <main className="space-y-5 p-4 md:p-8">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold text-white md:text-3xl">
            <CalendarDays className="text-blue-400" />
            Календарь и задачи
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Рабочий день команды · время Казахстана
          </p>
        </div>
        <button
          onClick={() => quickCreate()}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 font-semibold text-white"
        >
          <Plus size={18} />
          Добавить
        </button>
      </header>
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-200"
        >
          <span className="flex gap-2">
            <AlertCircle /> {error}
          </span>
          <button
            onClick={() => void load()}
            className="rounded-lg bg-red-950 px-3 py-2"
          >
            Повторить
          </button>
        </div>
      )}
      {notice && (
        <div className="flex justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-200">
          <span>{notice}</span>
          <button onClick={() => setNotice("")}>
            <X size={18} />
          </button>
        </div>
      )}
      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-3 md:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-950 p-1">
            {(
              [
                ["today", "Сегодня"],
                ["day", "День"],
                ["week", "Неделя"],
                ["month", "Месяц"],
              ] as Array<[Mode, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => {
                  setMode(key);
                  if (key === "today") setAnchor(new Date());
                }}
                className={`min-h-10 rounded-lg px-2 text-sm ${mode === key ? "bg-blue-600 text-white" : "text-slate-300"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-center gap-2">
            <button
              aria-label="Назад"
              onClick={() => move(-1)}
              className="rounded-lg bg-slate-800 p-2 text-white"
            >
              <ChevronLeft />
            </button>
            <b className="min-w-44 text-center text-white">
              {new Intl.DateTimeFormat("ru-RU", {
                timeZone: BUSINESS_TIME_ZONE,
                day: "numeric",
                month: "long",
                year: "numeric",
              }).format(anchor)}
            </b>
            <button
              aria-label="Вперёд"
              onClick={() => move(1)}
              className="rounded-lg bg-slate-800 p-2 text-white"
            >
              <ChevronRight />
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {director && (
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className={field}
              >
                <option value="">Все сотрудники</option>
                {meta.assignees.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            )}
            <select
              value={state}
              onChange={(e) => setState(e.target.value)}
              className={field}
            >
              <option value="active">Активные</option>
              <option value="overdue">Просроченные</option>
              <option value="completed">Выполненные</option>
              <option value="all">Все</option>
            </select>
            {director && <select value={assigneeRole} onChange={(e) => setAssigneeRole(e.target.value)} className={field}><option value="">Все роли</option>{[...new Set(meta.assignees.map((item) => item.role))].map((value) => <option key={value} value={value}>{value}</option>)}</select>}
            <select value={taskType} onChange={(e) => setTaskType(e.target.value)} className={field}><option value="">Все типы</option><option value="TASK">Задачи</option><option value="MEASUREMENT">Замеры</option><option value="MEETING">Встречи</option><option value="CALL">Звонки</option><option value="INSTALLATION">Монтаж</option><option value="DELIVERY">Доставка</option><option value="REMINDER">Напоминания</option><option value="OTHER">Другое</option></select>
          </div>
        </div>
      </section>
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((x) => (
            <div
              key={x}
              className="h-28 animate-pulse rounded-2xl bg-slate-900"
            />
          ))}
        </div>
      ) : !tasks.length ? (
        <section className="rounded-2xl border border-dashed border-slate-700 p-12 text-center">
          <CalendarDays className="mx-auto text-slate-500" size={42} />
          <h2 className="mt-3 text-xl font-semibold text-white">
            На сегодня задач нет.
          </h2>
          <button onClick={() => quickCreate()} className="mt-4 text-blue-300">
            Добавить первую задачу
          </button>
        </section>
      ) : (
        <div className="space-y-6">
          {groups.map(([day, items]) => (
            <section key={day}>
              <button
                onClick={() => {
                  const d = new Date(items[0].dueAt);
                  d.setMinutes(d.getMinutes() + 60);
                  quickCreate(d);
                }}
                className="mb-2 text-left font-semibold capitalize text-slate-300 hover:text-blue-300"
              >
                {day} <Plus className="inline" size={15} />
              </button>
              <div className="space-y-3">
                {items.map((task) => (
                  <article
                    key={task.id}
                    className={`rounded-2xl border p-4 ${task.overdue ? "border-red-500/50 bg-red-950/20" : task.status === "COMPLETED" ? "border-slate-800 bg-slate-950/50 opacity-70" : "border-slate-700 bg-[#101827]"}`}
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-center">
                      <div className="flex min-w-16 items-center gap-2 text-lg font-bold text-white">
                        <Clock3 size={17} />
                        {display(task.dueAt, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap gap-2">
                          <b className="text-white">{task.title}</b>
                          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                            {labels[task.type]}
                          </span>
                          {task.priority !== "NORMAL" && (
                            <span className="rounded-full bg-amber-900 px-2 py-0.5 text-xs text-amber-200">
                              {priorities[task.priority]}
                            </span>
                          )}
                          {task.overdue && (
                            <span className="text-xs font-semibold text-red-300">
                              Просрочено
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-slate-400">
                          {task.client?.name ??
                            task.order?.client.name ??
                            "Без клиента"}
                          {task.client?.city ? ` · ${task.client.city}` : ""} ·{" "}
                          {task.assignee.name}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-3 text-sm">
                          {task.client && (
                            <Link
                              className="text-blue-300"
                              href={`/clients/${task.client.id}`}
                            >
                              Открыть заявку
                            </Link>
                          )}
                          {task.order && (
                            <Link
                              className="text-blue-300"
                              href={`/orders/${task.order.id}`}
                            >
                              Заказ №{task.order.number}
                            </Link>
                          )}
                        </div>
                      </div>
                      {!["COMPLETED", "CANCELLED"].includes(task.status) && (
                        <div className="grid grid-cols-2 gap-2 md:flex">
                          <button
                            onClick={() => void action(task.id, "complete")}
                            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-white"
                          >
                            <Check size={17} />
                            Выполнить
                          </button>
                          <button
                            onClick={() => {
                              setEditId(task.id);
                              setForm((f) => ({
                                ...f,
                                title: task.title,
                                type: task.type,
                                dueAt: formatBusinessInput(task.dueAt),
                                assigneeId: String(task.assignee.id),
                                priority: task.priority,
                                clientId: String(task.client?.id ?? ""),
                                orderId: String(task.order?.id ?? ""),
                                description: task.description ?? "",
                              }));
                              setOpen(true);
                            }}
                            className="rounded-xl bg-slate-700 px-4 text-white"
                          >
                            <RotateCcw size={17} className="inline" /> Перенести
                          </button>
                          <button
                            onClick={() => void action(task.id, "cancel")}
                            className="col-span-2 text-sm text-slate-400"
                          >
                            Отменить
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
          {pagination.hasMore && pagination.nextCursor && <button type="button" onClick={() => void load(pagination.nextCursor ?? undefined)} disabled={loading} className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 font-semibold text-white disabled:opacity-50">Загрузить ещё</button>}
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/70 p-0 sm:place-items-center sm:p-4">
          <form
            onSubmit={submit}
            className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-slate-700 bg-[#101827] p-5 sm:max-w-2xl sm:rounded-3xl"
          >
            <div className="flex justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">
                  {editId ? "Перенести задачу" : "Новая задача"}
                </h2>
                <p className="text-sm text-slate-400">
                  Только необходимые поля
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-slate-300"
              >
                <X />
              </button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2 text-sm text-slate-300">
                Название
                <input
                  required
                  maxLength={160}
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className={field}
                />
              </label>
              <label className="text-sm text-slate-300">
                Тип
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className={field}
                >
                  {Object.entries(labels).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-slate-300">
                Дата и время
                <input
                  required
                  type="datetime-local"
                  value={form.dueAt}
                  onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
                  className={field}
                />
              </label>
              <label className="text-sm text-slate-300">
                Ответственный
                <select
                  required
                  value={form.assigneeId}
                  onChange={(e) =>
                    setForm({ ...form, assigneeId: e.target.value })
                  }
                  className={field}
                >
                  {meta.assignees.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-slate-300">
                Приоритет
                <select
                  value={form.priority}
                  onChange={(e) =>
                    setForm({ ...form, priority: e.target.value })
                  }
                  className={field}
                >
                  {Object.entries(priorities).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-slate-300">
                Клиент (необязательно)
                <select
                  value={form.clientId}
                  onChange={(e) =>
                    setForm({ ...form, clientId: e.target.value, orderId: "" })
                  }
                  className={field}
                >
                  <option value="">Без клиента</option>
                  {meta.clients.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} · {x.phone}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-slate-300">
                Заказ (необязательно)
                <select
                  value={form.orderId}
                  onChange={(e) => {
                    const o = meta.orders.find(
                      (x) => x.id === Number(e.target.value),
                    );
                    setForm({
                      ...form,
                      orderId: e.target.value,
                      clientId: o ? String(o.clientId) : form.clientId,
                    });
                  }}
                  className={field}
                >
                  <option value="">Без заказа</option>
                  {meta.orders
                    .filter(
                      (x) =>
                        !form.clientId || x.clientId === Number(form.clientId),
                    )
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        №{x.number} · {x.client.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="sm:col-span-2 text-sm text-slate-300">
                Описание / комментарий
                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  className={`${field} min-h-24 py-3`}
                />
              </label>
            </div>
            <button
              disabled={saving}
              className="mt-5 min-h-12 w-full rounded-xl bg-blue-600 font-semibold text-white disabled:opacity-50"
            >
              {saving
                ? "Сохраняем…"
                : editId
                  ? "Сохранить перенос"
                  : "Создать"}
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
