"use client";

import Link from "next/link";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import {
  BUSINESS_TIME_ZONE,
  addBusinessDays,
  addBusinessMonths,
  businessDateFromKey,
  businessDateKey,
  calendarMonthGrid,
  calendarViewRange,
  formatBusinessInput,
  splitCalendarRange,
  startOfBusinessMonth,
  startOfBusinessWeek,
  type CalendarDateRange,
  type CalendarViewMode,
} from "@/lib/calendar-time";

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
  acknowledgementRequired: boolean;
  acknowledgedAt: string | null;
  acknowledgementComment: string | null;
  plannedCompletionAt: string | null;
  resultText: string | null;
  resultSubmittedAt: string | null;
  handover: {
    oldName: string | null;
    newName: string | null;
    handover: {
      status: string;
      confirmedAt: string | null;
      confirmedBy: { name: string } | null;
    };
  } | null;
  resultAttachments: Array<{
    id: number;
    fileName: string;
    contentType: string;
    size: number;
  }>;
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

type Indicator = { count: number; overdue: boolean };
type RangeDraft = { start: string | null; end: string | null };

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

const weekDays = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];
const field =
  "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white outline-none focus:border-blue-500";

function display(value: Date | string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: BUSINESS_TIME_ZONE,
    ...options,
  }).format(new Date(value));
}

function dayNumber(value: Date | string) {
  return display(value, { day: "numeric" });
}

function isWithin(key: string, draft: RangeDraft) {
  if (!draft.start || !draft.end) return false;
  const from = draft.start <= draft.end ? draft.start : draft.end;
  const to = draft.start <= draft.end ? draft.end : draft.start;
  return key > from && key < to;
}

function selectedHeading(
  anchor: Date,
  mode: CalendarViewMode,
  period: { start: string; end: string },
) {
  if (mode === "month") {
    return display(anchor, { month: "long", year: "numeric" });
  }
  if (mode === "week") {
    const start = startOfBusinessWeek(anchor);
    const end = addBusinessDays(start, 6);
    return `${display(start, { day: "numeric", month: "long" })} — ${display(end, {
      day: "numeric",
      month: "long",
      year: "numeric",
    })}`;
  }
  if (mode === "period") {
    return `${display(businessDateFromKey(period.start), {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })} — ${display(businessDateFromKey(period.end), {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })}`;
  }
  return display(anchor, { day: "numeric", month: "long", year: "numeric" });
}

async function fetchCalendarTasks(
  range: CalendarDateRange,
  filters: {
    state: string;
    assignee?: string;
    role?: string;
    type?: string;
  },
) {
  const found = new Map<number, Task>();
  for (const chunk of splitCalendarRange(range)) {
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({
        start: chunk.from.toISOString(),
        end: chunk.to.toISOString(),
        state: filters.state,
        limit: "500",
      });
      if (filters.assignee) query.set("assigneeId", filters.assignee);
      if (filters.role) query.set("role", filters.role);
      if (filters.type) query.set("type", filters.type);
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`/api/calendar?${query}`);
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Не удалось загрузить календарь");
      }
      for (const task of (body.tasks ?? []) as Task[]) found.set(task.id, task);
      cursor = body.pagination?.hasMore ? body.pagination.nextCursor : null;
    } while (cursor);
  }
  return [...found.values()].sort(
    (left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime(),
  );
}

function MiniCalendar({
  month,
  anchor,
  indicators,
  rangeDraft,
  rangeMode,
  onMonth,
  onSelect,
  onConfirm,
  onClose,
}: {
  month: Date;
  anchor: Date;
  indicators: Map<string, Indicator>;
  rangeDraft: RangeDraft;
  rangeMode: boolean;
  onMonth: (month: Date) => void;
  onSelect: (date: Date) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const days = calendarMonthGrid(month);
  const monthKey = businessDateKey(startOfBusinessMonth(month)).slice(0, 7);
  const todayKey = businessDateKey(new Date());
  const selectedKey = businessDateKey(anchor);

  return (
    <>
      <button
        type="button"
        aria-label="Закрыть календарь выбора даты"
        className="fixed inset-0 z-40 cursor-default bg-black/20"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label={rangeMode ? "Выбор периода" : "Выбор даты"}
        className="absolute left-1/2 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-slate-700 bg-[#101827] p-4 shadow-2xl shadow-black/50"
      >
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label="Предыдущий месяц в календаре"
            onClick={() => onMonth(addBusinessMonths(month, -1))}
            className="rounded-lg bg-slate-800 p-2 text-slate-200 hover:bg-slate-700"
          >
            <ChevronLeft size={18} />
          </button>
          <b className="capitalize text-white">
            {display(month, { month: "long", year: "numeric" })}
          </b>
          <button
            type="button"
            aria-label="Следующий месяц в календаре"
            onClick={() => onMonth(addBusinessMonths(month, 1))}
            className="rounded-lg bg-slate-800 p-2 text-slate-200 hover:bg-slate-700"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        {rangeMode && (
          <p className="mt-3 rounded-lg bg-slate-950 px-3 py-2 text-xs text-slate-300">
            {!rangeDraft.start
              ? "Выберите дату начала"
              : !rangeDraft.end
                ? "Теперь выберите дату окончания"
                : `${display(businessDateFromKey(rangeDraft.start), { day: "2-digit", month: "2-digit", year: "numeric" })} — ${display(businessDateFromKey(rangeDraft.end), { day: "2-digit", month: "2-digit", year: "numeric" })}`}
          </p>
        )}
        <div className="mt-3 grid grid-cols-7 gap-1">
          {weekDays.map((day) => (
            <span key={day} className="py-1 text-center text-[10px] font-semibold text-slate-500">
              {day}
            </span>
          ))}
          {days.map((date) => {
            const key = businessDateKey(date);
            const indicator = indicators.get(key);
            const outside = key.slice(0, 7) !== monthKey;
            const endpoint = rangeMode && (key === rangeDraft.start || key === rangeDraft.end);
            const selected = !rangeMode && key === selectedKey;
            const inRange = rangeMode && isWithin(key, rangeDraft);
            const today = key === todayKey;
            const base =
              "relative min-h-10 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400";
            let stateClass = outside ? "text-slate-600" : "text-slate-200 hover:bg-slate-800";
            if (inRange) stateClass = "bg-blue-500/15 text-blue-100";
            if (indicator?.overdue) stateClass = "bg-red-950/70 text-red-100 hover:bg-red-900/70";
            if (today) stateClass += " ring-1 ring-slate-400";
            if (selected || endpoint) {
              stateClass = `bg-blue-600 text-white ${today ? "ring-2 ring-slate-200" : ""} ${indicator?.overdue ? "outline outline-2 outline-red-400" : ""}`;
            }
            return (
              <button
                type="button"
                key={key}
                aria-label={`${display(date, { day: "numeric", month: "long", year: "numeric" })}${indicator ? `, задач: ${indicator.count}` : ""}${indicator?.overdue ? ", есть просроченные" : ""}`}
                onClick={() => onSelect(date)}
                className={`${base} ${stateClass}`}
              >
                <span>{dayNumber(date)}</span>
                {indicator && (
                  <span className="absolute bottom-0.5 left-1/2 flex -translate-x-1/2 items-center gap-0.5 text-[9px] font-bold text-red-300">
                    <span className="size-1.5 rounded-full bg-red-400" />
                    {indicator.count > 1 ? indicator.count : ""}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {rangeMode && (
          <button
            type="button"
            disabled={!rangeDraft.start || !rangeDraft.end}
            onClick={onConfirm}
            className="mt-4 min-h-11 w-full rounded-xl bg-blue-600 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Показать задачи за период
          </button>
        )}
      </div>
    </>
  );
}

function TaskCard({
  task,
  onEdit,
  onAction,
}: {
  task: Task;
  onEdit: (task: Task) => void;
  onAction: (id: number, action: "complete" | "cancel") => void;
}) {
  return (
    <article
      className={`rounded-2xl border p-4 ${task.overdue ? "border-red-500/50 bg-red-950/20" : task.status === "COMPLETED" ? "border-slate-800 bg-slate-950/50 opacity-70" : "border-slate-700 bg-[#101827]"}`}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="flex min-w-16 items-center gap-2 text-lg font-bold text-white">
          <Clock3 size={17} />
          {display(task.dueAt, { hour: "2-digit", minute: "2-digit" })}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            <b className="text-white">{task.title}</b>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
              {labels[task.type] ?? task.type}
            </span>
            {task.priority !== "NORMAL" && (
              <span className="rounded-full bg-amber-900 px-2 py-0.5 text-xs text-amber-200">
                {priorities[task.priority] ?? task.priority}
              </span>
            )}
            {task.overdue && <span className="text-xs font-semibold text-red-300">Просрочено</span>}
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {task.client?.name ?? task.order?.client.name ?? "Без клиента"}
            {task.client?.city ? ` · ${task.client.city}` : ""} · {task.assignee.name}
          </p>
          {task.handover?.handover.confirmedAt && (
            <p className="mt-1 text-xs text-amber-200">
              Ранее ответственный — {task.handover.oldName}; передано {task.handover.newName} сотрудником {task.handover.handover.confirmedBy?.name ?? "директор"},{" "}
              {display(task.handover.handover.confirmedAt, {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {task.handover.handover.status === "ROLLED_BACK" ? " · передача отменена" : ""}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            {task.client && (
              <Link className="text-blue-300" href={`/clients/${task.client.id}`}>
                Открыть заявку
              </Link>
            )}
            {task.order && (
              <Link className="text-blue-300" href={`/orders/${task.order.id}`}>
                Заказ №{task.order.number}
              </Link>
            )}
          </div>
          {task.acknowledgementRequired && !task.acknowledgedAt ? (
            <p className="mt-2 text-sm font-semibold text-amber-300">
              Ждёт обязательного ознакомления сотрудника
            </p>
          ) : task.acknowledgedAt ? (
            <p className="mt-2 text-sm text-emerald-300">
              Ознакомлен
              {task.plannedCompletionAt
                ? ` · обещанный срок ${display(task.plannedCompletionAt, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
                : ""}
            </p>
          ) : null}
          {task.resultSubmittedAt && (
            <div className="mt-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm">
              <p className="font-semibold text-emerald-200">Результат получен</p>
              {task.resultText && <p className="mt-1 whitespace-pre-wrap text-slate-300">{task.resultText}</p>}
              {task.resultAttachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {task.resultAttachments.map((file) => (
                    <a
                      key={file.id}
                      href={`/api/calendar/result-attachments/${file.id}`}
                      className="text-blue-300 underline"
                    >
                      {file.fileName}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {!['COMPLETED', 'CANCELLED'].includes(task.status) && (
          <div className="grid grid-cols-2 gap-2 md:flex">
            <button
              type="button"
              onClick={() => onAction(task.id, "complete")}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-white"
            >
              <Check size={17} />
              Выполнить
            </button>
            <button
              type="button"
              onClick={() => onEdit(task)}
              className="rounded-xl bg-slate-700 px-4 text-white"
            >
              <RotateCcw size={17} className="inline" /> Перенести
            </button>
            <button
              type="button"
              onClick={() => onAction(task.id, "cancel")}
              className="col-span-2 text-sm text-slate-400"
            >
              Отменить
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function WeekView({
  anchor,
  tasksByDate,
  indicators,
  onOpenDay,
  onCreate,
}: {
  anchor: Date;
  tasksByDate: Map<string, Task[]>;
  indicators: Map<string, Indicator>;
  onOpenDay: (date: Date) => void;
  onCreate: (date: Date) => void;
}) {
  const start = startOfBusinessWeek(anchor);
  const days = Array.from({ length: 7 }, (_, index) => addBusinessDays(start, index));
  const todayKey = businessDateKey(new Date());
  const selectedKey = businessDateKey(anchor);
  return (
    <section className="overflow-x-auto rounded-2xl border border-slate-800 bg-[#101827]">
      <div className="grid min-w-[760px] grid-cols-7">
        {days.map((date) => {
          const key = businessDateKey(date);
          const dayTasks = tasksByDate.get(key) ?? [];
          const indicator = indicators.get(key);
          const today = key === todayKey;
          const selected = key === selectedKey;
          return (
            <article
              key={key}
              className={`min-h-64 border-r border-slate-800 p-2 last:border-r-0 ${indicator?.overdue ? "bg-red-950/15" : ""}`}
            >
              <div className="flex items-start justify-between gap-1">
                <button
                  type="button"
                  onClick={() => onOpenDay(date)}
                  aria-label={`${display(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}${indicator ? `, задач: ${indicator.count}` : ""}${indicator?.overdue ? ", есть просроченные" : ""}`}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-2 text-left ${selected ? "bg-blue-600 text-white" : today ? "ring-1 ring-slate-500 text-white" : "text-slate-300 hover:bg-slate-800"} ${selected && today ? "ring-2 ring-slate-200" : ""}`}
                >
                  <span className="text-xs font-semibold">{weekDays[days.indexOf(date)]}</span>
                  <b>{dayNumber(date)}</b>
                  {indicator && (
                    <span className="ml-auto flex items-center gap-1 text-xs text-red-300">
                      <span className="size-1.5 rounded-full bg-red-400" /> {indicator.count}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`Добавить задачу на ${display(date, { day: "numeric", month: "long" })}`}
                  onClick={() => onCreate(date)}
                  className="rounded-lg p-2 text-blue-300 hover:bg-slate-800"
                >
                  <Plus size={16} />
                </button>
              </div>
              <div className="mt-2 space-y-2">
                {dayTasks.length === 0 ? (
                  <p className="px-2 py-4 text-center text-xs text-slate-600">Нет задач</p>
                ) : (
                  dayTasks.map((task) => (
                    <button
                      type="button"
                      key={task.id}
                      onClick={() => onOpenDay(date)}
                      className={`w-full rounded-lg border p-2 text-left ${task.overdue ? "border-red-500/40 bg-red-950/30" : "border-slate-700 bg-slate-950/60"}`}
                    >
                      <span className="block text-xs text-slate-400">
                        {display(task.dueAt, { hour: "2-digit", minute: "2-digit" })} · {labels[task.type] ?? task.type}
                      </span>
                      <span className="mt-1 block truncate text-sm text-white">{task.title}</span>
                    </button>
                  ))
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function MonthView({
  anchor,
  tasksByDate,
  indicators,
  onOpenDay,
  onCreate,
}: {
  anchor: Date;
  tasksByDate: Map<string, Task[]>;
  indicators: Map<string, Indicator>;
  onOpenDay: (date: Date) => void;
  onCreate: (date: Date) => void;
}) {
  const days = calendarMonthGrid(anchor);
  const monthKey = businessDateKey(startOfBusinessMonth(anchor)).slice(0, 7);
  const todayKey = businessDateKey(new Date());
  const selectedKey = businessDateKey(anchor);
  return (
    <section className="overflow-x-auto rounded-2xl border border-slate-800 bg-[#101827]">
      <div className="grid min-w-[760px] grid-cols-7 border-b border-slate-800 bg-slate-950/60">
        {weekDays.map((day) => (
          <span key={day} className="px-3 py-2 text-center text-xs font-semibold text-slate-500">
            {day}
          </span>
        ))}
      </div>
      <div className="grid min-w-[760px] grid-cols-7">
        {days.map((date) => {
          const key = businessDateKey(date);
          const outside = key.slice(0, 7) !== monthKey;
          const dayTasks = tasksByDate.get(key) ?? [];
          const indicator = indicators.get(key);
          const today = key === todayKey;
          const selected = key === selectedKey;
          return (
            <article
              key={key}
              className={`min-h-32 border-b border-r border-slate-800 p-2 ${outside ? "bg-slate-950/35" : ""} ${indicator?.overdue ? "bg-red-950/25" : ""}`}
            >
              <div className="flex items-start justify-between gap-1">
                <button
                  type="button"
                  onClick={() => onOpenDay(date)}
                  aria-label={`Открыть ${display(date, { day: "numeric", month: "long", year: "numeric" })}${indicator ? `, задач: ${indicator.count}` : ""}${indicator?.overdue ? ", есть просроченные" : ""}`}
                  className={`flex min-w-9 items-center justify-center gap-1 rounded-lg px-2 py-1 text-sm ${selected ? "bg-blue-600 text-white" : today ? "ring-1 ring-slate-400 text-white" : outside ? "text-slate-600" : "text-slate-300 hover:bg-slate-800"} ${selected && today ? "ring-2 ring-slate-200" : ""}`}
                >
                  {dayNumber(date)}
                  {indicator && (
                    <span className="flex items-center gap-0.5 text-[10px] text-red-300">
                      <span className="size-1.5 rounded-full bg-red-400" />
                      {indicator.count > 1 ? indicator.count : ""}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`Добавить задачу на ${display(date, { day: "numeric", month: "long" })}`}
                  onClick={() => onCreate(date)}
                  className="rounded-lg p-1.5 text-blue-300 hover:bg-slate-800"
                >
                  <Plus size={14} />
                </button>
              </div>
              <div className="mt-1 space-y-1">
                {dayTasks.slice(0, 2).map((task) => (
                  <button
                    type="button"
                    key={task.id}
                    onClick={() => onOpenDay(date)}
                    className={`block w-full truncate rounded-md px-2 py-1 text-left text-xs ${task.overdue ? "bg-red-900/50 text-red-100" : "bg-slate-800 text-slate-300"}`}
                  >
                    {display(task.dueAt, { hour: "2-digit", minute: "2-digit" })} {task.title}
                  </button>
                ))}
                {dayTasks.length > 2 && (
                  <button type="button" onClick={() => onOpenDay(date)} className="px-2 text-xs text-blue-300">
                    Ещё {dayTasks.length - 2}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default function CalendarPage({ initialState = "active" }: { initialState?: string }) {
  const { data: session } = useSession();
  const today = useMemo(() => new Date(), []);
  const todayKey = businessDateKey(today);
  const [mode, setMode] = useState<CalendarViewMode>("day");
  const [anchor, setAnchor] = useState(today);
  const [period, setPeriod] = useState({ start: todayKey, end: todayKey });
  const [rangeDraft, setRangeDraft] = useState<RangeDraft>({ start: todayKey, end: todayKey });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(startOfBusinessMonth(today));
  const [tasks, setTasks] = useState<Task[]>([]);
  const [indicatorTasks, setIndicatorTasks] = useState<Task[]>([]);
  const [meta, setMeta] = useState<Meta>({ assignees: [], clients: [], orders: [] });
  const [assignee, setAssignee] = useState("");
  const [assigneeRole, setAssigneeRole] = useState("");
  const [taskType, setTaskType] = useState("");
  const [state, setState] = useState(
    ["active", "overdue", "completed", "all"].includes(initialState) ? initialState : "active",
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const requestSequence = useRef(0);
  const indicatorSequence = useRef(0);
  const [form, setForm] = useState({
    title: "",
    type: "TASK",
    dueAt: formatBusinessInput(today),
    assigneeId: "",
    priority: "NORMAL",
    clientId: "",
    orderId: "",
    description: "",
    acknowledgementRequired: false,
  });

  const director = session?.user.accountRole === "DIRECTOR";
  const selectedRange = useMemo(
    () => calendarViewRange(anchor, mode, period),
    [anchor, mode, period],
  );
  const indicatorRange = useMemo(() => {
    const grid = calendarMonthGrid(pickerMonth);
    const gridFrom = grid[0];
    const gridTo = addBusinessDays(grid[grid.length - 1], 1);
    if (mode === "period") return { from: gridFrom, to: gridTo };
    return {
      from: selectedRange.from < gridFrom ? selectedRange.from : gridFrom,
      to: selectedRange.to > gridTo ? selectedRange.to : gridTo,
    };
  }, [mode, pickerMonth, selectedRange]);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const result = await fetchCalendarTasks(selectedRange, {
        state,
        assignee,
        role: assigneeRole,
        type: taskType,
      });
      if (sequence === requestSequence.current) setTasks(result);
    } catch (loadError) {
      if (sequence === requestSequence.current) {
        setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить календарь");
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [assignee, assigneeRole, selectedRange, state, taskType]);

  const loadIndicators = useCallback(async () => {
    const sequence = ++indicatorSequence.current;
    try {
      const result = await fetchCalendarTasks(indicatorRange, { state: "all" });
      if (sequence === indicatorSequence.current) {
        setIndicatorTasks(result.filter((task) => task.status !== "CANCELLED"));
      }
    } catch (loadError) {
      if (sequence === indicatorSequence.current) {
        setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить индикаторы задач");
      }
    }
  }, [indicatorRange]);

  const refresh = useCallback(async () => {
    await Promise.all([load(), loadIndicators()]);
  }, [load, loadIndicators]);

  useEffect(() => {
    void fetch("/api/calendar?meta=1")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((nextMeta: Meta) => {
        setMeta(nextMeta);
        setForm((current) => ({
          ...current,
          assigneeId: current.assigneeId || String(nextMeta.assignees[0]?.id ?? ""),
        }));
      })
      .catch(() => setError("Не удалось загрузить справочники"));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadIndicators(), 0);
    return () => window.clearTimeout(timer);
  }, [loadIndicators]);

  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      const key = businessDateKey(task.dueAt);
      map.set(key, [...(map.get(key) ?? []), task]);
    }
    return map;
  }, [tasks]);

  const indicators = useMemo(() => {
    const map = new Map<string, Indicator>();
    for (const task of indicatorTasks) {
      const key = businessDateKey(task.dueAt);
      const current = map.get(key) ?? { count: 0, overdue: false };
      map.set(key, { count: current.count + 1, overdue: current.overdue || task.overdue });
    }
    return map;
  }, [indicatorTasks]);

  const groups = useMemo(
    () =>
      [...tasksByDate.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, items]) => ({ key, date: businessDateFromKey(key), items })),
    [tasksByDate],
  );

  function quickCreate(date = mode === "period" ? businessDateFromKey(period.start) : anchor) {
    const key = businessDateKey(date);
    const time = formatBusinessInput(new Date()).slice(11);
    setEditId(null);
    setForm((current) => ({
      ...current,
      title: "",
      description: "",
      dueAt: `${key}T${time}`,
      assigneeId: current.assigneeId || String(meta.assignees[0]?.id ?? ""),
      clientId: "",
      orderId: "",
      acknowledgementRequired: false,
    }));
    setOpen(true);
  }

  function editTask(task: Task) {
    setEditId(task.id);
    setForm((current) => ({
      ...current,
      title: task.title,
      type: task.type,
      dueAt: formatBusinessInput(task.dueAt),
      assigneeId: String(task.assignee.id),
      priority: task.priority,
      clientId: String(task.client?.id ?? ""),
      orderId: String(task.order?.id ?? ""),
      description: task.description ?? "",
      acknowledgementRequired: task.acknowledgementRequired,
    }));
    setOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(editId ? `/api/calendar/${editId}` : "/api/calendar", {
        method: editId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          assigneeId: Number(form.assigneeId),
          clientId: form.clientId ? Number(form.clientId) : null,
          orderId: form.orderId ? Number(form.orderId) : null,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Не удалось сохранить задачу");
      setOpen(false);
      setNotice(
        editId
          ? "Задача перенесена"
          : body.conflict
            ? `Задача создана. В это время уже есть «${body.conflict.title}».`
            : "Задача создана",
      );
      await refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Не удалось сохранить задачу");
    } finally {
      setSaving(false);
    }
  }

  async function action(id: number, name: "complete" | "cancel") {
    const response = await fetch(`/api/calendar/${id}/${name}`, { method: "POST" });
    if (!response.ok) {
      setError((await response.json()).error ?? "Действие не выполнено");
      return;
    }
    setNotice(name === "complete" ? "Задача выполнена" : "Задача отменена");
    await refresh();
  }

  function openDay(date: Date) {
    setAnchor(date);
    setMode("day");
    setPickerOpen(false);
  }

  function selectMode(nextMode: CalendarViewMode) {
    setMode(nextMode);
    if (nextMode === "period") {
      setPickerMonth(startOfBusinessMonth(businessDateFromKey(period.start)));
      setRangeDraft({ start: null, end: null });
      setPickerOpen(true);
    } else {
      setPickerOpen(false);
    }
  }

  function openPicker() {
    setPickerMonth(startOfBusinessMonth(anchor));
    setRangeDraft(mode === "period" ? period : { start: businessDateKey(anchor), end: null });
    setPickerOpen(true);
  }

  function selectPickerDate(date: Date) {
    if (mode !== "period") {
      openDay(date);
      return;
    }
    const key = businessDateKey(date);
    if (!rangeDraft.start || rangeDraft.end) {
      setRangeDraft({ start: key, end: null });
      return;
    }
    setRangeDraft(
      key < rangeDraft.start
        ? { start: key, end: rangeDraft.start }
        : { start: rangeDraft.start, end: key },
    );
  }

  function confirmPeriod() {
    if (!rangeDraft.start || !rangeDraft.end) return;
    setPeriod({ start: rangeDraft.start, end: rangeDraft.end });
    setAnchor(businessDateFromKey(rangeDraft.start));
    setPickerOpen(false);
  }

  function goToday() {
    const now = new Date();
    const key = businessDateKey(now);
    setAnchor(now);
    setPickerMonth(startOfBusinessMonth(now));
    if (mode === "period") setPeriod({ start: key, end: key });
    setPickerOpen(false);
  }

  function move(direction: number) {
    if (mode === "month") {
      setAnchor((current) => addBusinessMonths(current, direction));
      return;
    }
    if (mode === "week") {
      setAnchor((current) => addBusinessDays(current, direction * 7));
      return;
    }
    if (mode === "period") {
      const startUtc = new Date(`${period.start}T12:00:00.000Z`).getTime();
      const endUtc = new Date(`${period.end}T12:00:00.000Z`).getTime();
      const days = Math.round((endUtc - startUtc) / 86_400_000) + 1;
      const next = {
        start: businessDateKey(addBusinessDays(businessDateFromKey(period.start), days * direction)),
        end: businessDateKey(addBusinessDays(businessDateFromKey(period.end), days * direction)),
      };
      setPeriod(next);
      setAnchor(businessDateFromKey(next.start));
      return;
    }
    setAnchor((current) => addBusinessDays(current, direction));
  }

  return (
    <main className="space-y-5 p-4 md:p-8">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold text-white md:text-3xl">
            <CalendarDays className="text-blue-400" />
            Календарь и задачи
          </h1>
          <p className="mt-1 text-sm text-slate-400">Рабочий день команды · время Казахстана</p>
        </div>
        <button
          type="button"
          onClick={() => quickCreate()}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 font-semibold text-white"
        >
          <Plus size={18} />
          Добавить
        </button>
      </header>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-200">
          <span className="flex gap-2"><AlertCircle /> {error}</span>
          <button type="button" onClick={() => void refresh()} className="rounded-lg bg-red-950 px-3 py-2">Повторить</button>
        </div>
      )}
      {notice && (
        <div className="flex justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-200">
          <span>{notice}</span>
          <button type="button" aria-label="Закрыть уведомление" onClick={() => setNotice("")}><X size={18} /></button>
        </div>
      )}

      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-3 md:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-1 rounded-xl bg-slate-950 p-1">
            <button
              type="button"
              onClick={goToday}
              className="min-h-10 rounded-lg px-3 text-sm font-semibold text-slate-200 hover:bg-slate-800"
            >
              Сегодня
            </button>
            {([
              ["day", "День"],
              ["week", "Неделя"],
              ["month", "Месяц"],
              ["period", "Период"],
            ] as Array<[CalendarViewMode, string]>).map(([key, label]) => (
              <button
                type="button"
                key={key}
                onClick={() => selectMode(key)}
                className={`min-h-10 rounded-lg px-3 text-sm ${mode === key ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative flex items-center justify-center gap-2">
            <button type="button" aria-label="Назад" onClick={() => move(-1)} className="rounded-lg bg-slate-800 p-2 text-white hover:bg-slate-700">
              <ChevronLeft />
            </button>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
              onClick={openPicker}
              className="min-h-10 min-w-48 rounded-xl px-3 text-center font-semibold capitalize text-white hover:bg-slate-800"
            >
              {selectedHeading(anchor, mode, period)}
            </button>
            <button type="button" aria-label="Вперёд" onClick={() => move(1)} className="rounded-lg bg-slate-800 p-2 text-white hover:bg-slate-700">
              <ChevronRight />
            </button>
            {pickerOpen && (
              <MiniCalendar
                month={pickerMonth}
                anchor={anchor}
                indicators={indicators}
                rangeDraft={rangeDraft}
                rangeMode={mode === "period"}
                onMonth={setPickerMonth}
                onSelect={selectPickerDate}
                onConfirm={confirmPeriod}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {director && (
              <select value={assignee} onChange={(event) => setAssignee(event.target.value)} className={field} aria-label="Сотрудник">
                <option value="">Все сотрудники</option>
                {meta.assignees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            )}
            <select value={state} onChange={(event) => setState(event.target.value)} className={field} aria-label="Состояние задач">
              <option value="active">Активные</option>
              <option value="overdue">Просроченные</option>
              <option value="completed">Выполненные</option>
              <option value="all">Все</option>
            </select>
            {director && (
              <select value={assigneeRole} onChange={(event) => setAssigneeRole(event.target.value)} className={field} aria-label="Роль сотрудника">
                <option value="">Все роли</option>
                {[...new Set(meta.assignees.map((item) => item.role))].map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            )}
            <select value={taskType} onChange={(event) => setTaskType(event.target.value)} className={field} aria-label="Тип задачи">
              <option value="">Все типы</option>
              {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-slate-900" />)}
        </div>
      ) : mode === "week" ? (
        <WeekView anchor={anchor} tasksByDate={tasksByDate} indicators={indicators} onOpenDay={openDay} onCreate={quickCreate} />
      ) : mode === "month" ? (
        <MonthView anchor={anchor} tasksByDate={tasksByDate} indicators={indicators} onOpenDay={openDay} onCreate={quickCreate} />
      ) : tasks.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-700 p-12 text-center">
          <CalendarDays className="mx-auto text-slate-500" size={42} />
          <h2 className="mt-3 text-xl font-semibold text-white">
            {mode === "period" ? "За выбранный период задач нет." : "На выбранную дату задач нет."}
          </h2>
          <button type="button" onClick={() => quickCreate()} className="mt-4 text-blue-300">Добавить задачу</button>
        </section>
      ) : (
        <div className="space-y-6">
          {groups.map(({ key, date, items }) => (
            <section key={key}>
              <div className="mb-2 flex items-center gap-2">
                <button type="button" onClick={() => openDay(date)} className="font-semibold capitalize text-slate-300 hover:text-blue-300">
                  {display(date, { weekday: "long", day: "numeric", month: "long", year: mode === "period" ? "numeric" : undefined })}
                </button>
                <button type="button" aria-label={`Добавить задачу на ${display(date, { day: "numeric", month: "long" })}`} onClick={() => quickCreate(date)} className="text-blue-300">
                  <Plus size={16} />
                </button>
              </div>
              <div className="space-y-3">
                {items.map((task) => <TaskCard key={task.id} task={task} onEdit={editTask} onAction={(id, name) => void action(id, name)} />)}
              </div>
            </section>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/70 p-0 sm:place-items-center sm:p-4">
          <form onSubmit={submit} className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-slate-700 bg-[#101827] p-5 sm:max-w-2xl sm:rounded-3xl">
            <div className="flex justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">{editId ? "Перенести задачу" : "Новая задача"}</h2>
                <p className="text-sm text-slate-400">Только необходимые поля</p>
              </div>
              <button type="button" aria-label="Закрыть форму" onClick={() => setOpen(false)} className="text-slate-300"><X /></button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm text-slate-300 sm:col-span-2">
                Название
                <input required maxLength={160} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className={field} />
              </label>
              {director && (
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-slate-200 sm:col-span-2">
                  <input type="checkbox" checked={form.acknowledgementRequired} onChange={(event) => setForm({ ...form, acknowledgementRequired: event.target.checked })} className="mt-0.5 size-5 accent-amber-500" />
                  <span>
                    <b className="block text-amber-200">Обязательное ознакомление и отчёт</b>
                    Сотрудник не сможет продолжить работу в системе, пока не подтвердит, что понял задачу, и не укажет срок. В выбранный день система потребует текст, фото, документ или видео с результатом.
                  </span>
                </label>
              )}
              <label className="text-sm text-slate-300">
                Тип
                <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} className={field}>
                  {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="text-sm text-slate-300">
                Дата и время
                <input required type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} className={field} />
              </label>
              <label className="text-sm text-slate-300">
                Ответственный
                <select required value={form.assigneeId} onChange={(event) => setForm({ ...form, assigneeId: event.target.value })} className={field}>
                  {meta.assignees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="text-sm text-slate-300">
                Приоритет
                <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} className={field}>
                  {Object.entries(priorities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="text-sm text-slate-300">
                Клиент (необязательно)
                <select value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value, orderId: "" })} className={field}>
                  <option value="">Без клиента</option>
                  {meta.clients.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.phone}</option>)}
                </select>
              </label>
              <label className="text-sm text-slate-300">
                Заказ (необязательно)
                <select
                  value={form.orderId}
                  onChange={(event) => {
                    const order = meta.orders.find((item) => item.id === Number(event.target.value));
                    setForm({ ...form, orderId: event.target.value, clientId: order ? String(order.clientId) : form.clientId });
                  }}
                  className={field}
                >
                  <option value="">Без заказа</option>
                  {meta.orders
                    .filter((item) => !form.clientId || item.clientId === Number(form.clientId))
                    .map((item) => <option key={item.id} value={item.id}>№{item.number} · {item.client.name}</option>)}
                </select>
              </label>
              <label className="text-sm text-slate-300 sm:col-span-2">
                Описание / комментарий
                <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className={`${field} min-h-24 py-3`} />
              </label>
            </div>
            <button disabled={saving} className="mt-5 min-h-12 w-full rounded-xl bg-blue-600 font-semibold text-white disabled:opacity-50">
              {saving ? "Сохраняем…" : editId ? "Сохранить перенос" : "Создать"}
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
