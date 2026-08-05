"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Plus,
} from "lucide-react";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";

type User = { id: number; name: string; role: string; active: boolean };
type CalendarEvent = {
  id: string;
  sourceType: "measurement" | "production";
  orderId: number;
  title: string;
  stage: string;
  startDate: string;
  assignedUserId: number | null;
  assignedUserName: string | null;
  legacyAssignedName: string;
  client: string;
};
type Data = {
  events: CalendarEvent[];
  orders: { id: number; number: string; client: string }[];
  filters: { assignees: { id: number; name: string }[] };
};
const empty: Data = { events: [], orders: [], filters: { assignees: [] } };
const stages = [
  "Подготовка",
  "Каркас",
  "Дерево",
  "Покраска",
  "Комплектация",
  "Готово к монтажу",
  "Монтаж",
  "Сдано",
];
const fieldClass =
  "mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500";

export default function CalendarPage() {
  const { data: session } = useSession();
  const { getKey, reset } = useIdempotencyKey();
  const [data, setData] = useState<Data>(empty),
    [users, setUsers] = useState<User[]>([]),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [loading, setLoading] = useState(true),
    [creating, setCreating] = useState(false),
    [assignee, setAssignee] = useState("");
  const [form, setForm] = useState({
    sourceType: "measurement" as "measurement" | "production",
    orderId: "",
    startDate: "",
    assignedUserId: "",
    stage: "Подготовка",
    comment: "",
  });
  const role = session?.user.role,
    currentUserId = session?.user.id,
    currentUserName = session?.user.name;
  const canAssign = role === "DIRECTOR" || role === "MANAGER";
  const canCreate = [
    "DIRECTOR",
    "MANAGER",
    "MEASURER",
    "PRODUCTION",
    "INSTALLER",
  ].includes(role ?? "");
  const load = useCallback(async () => {
    const response = await fetch(
      `/api/calendar${assignee ? `?assignedUserId=${assignee}` : ""}`,
    );
    if (!response.ok)
      throw new Error("Не удалось загрузить календарь. Попробуйте ещё раз.");
    const next = (await response.json()) as Data;
    setData(next);
    if (canAssign) {
      const employees = await fetch("/api/employees");
      setUsers(
        employees.ok
          ? ((await employees.json()) as User[]).filter((user) => user.active)
          : [],
      );
    } else if (currentUserId && role)
      setUsers([
        {
          id: Number(currentUserId),
          name: currentUserName ?? "Исполнитель",
          role,
          active: true,
        },
      ]);
    else setUsers([]);
  }, [assignee, canAssign, currentUserId, currentUserName, role]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void load()
        .catch((cause) =>
          setError(
            cause instanceof Error
              ? cause.message
              : "Не удалось загрузить календарь.",
          ),
        )
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const candidates = users.filter((user) =>
    form.sourceType === "measurement"
      ? ["MEASURER", "DIRECTOR"].includes(user.role)
      : form.stage === "Монтаж"
        ? ["INSTALLER", "DIRECTOR"].includes(user.role)
        : ["PRODUCTION", "DIRECTOR"].includes(user.role),
  );
  function showSuccess(message: string) {
    setSuccess(message);
    window.setTimeout(() => setSuccess(""), 4000);
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/calendar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": getKey(),
        },
        body: JSON.stringify({
          ...form,
          orderId: Number(form.orderId),
          assignedUserId: Number(form.assignedUserId),
        }),
      });
      if (!response.ok) {
        setError(
          ((await response.json()) as { error?: string }).error ??
            "Не удалось добавить событие.",
        );
        return;
      }
      reset();
      await load();
      showSuccess("Работа добавлена в календарь.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось добавить событие.",
      );
    } finally {
      setCreating(false);
    }
  }
  async function drop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    try {
      const item = JSON.parse(event.dataTransfer.getData("event")) as Pick<
        CalendarEvent,
        "id" | "sourceType"
      >;
      const response = await fetch("/api/calendar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...item,
          id: Number(item.id),
          startDate: new Date().toISOString(),
        }),
      });
      if (!response.ok) throw new Error();
      await load();
      showSuccess("Событие перенесено.");
    } catch {
      setError(
        "Не удалось перенести событие. Обновите страницу и попробуйте снова.",
      );
    }
  }
  return (
    <section className="space-y-6 p-4 md:p-8">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-bold text-white">
          <CalendarDays className="text-blue-400" />
          Календарь работ
        </h1>
        <p className="mt-2 text-slate-400">
          Замеры, производство и монтаж по датам и исполнителям
        </p>
      </div>
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          <AlertCircle size={20} />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-green-300">
          <CheckCircle2 size={20} />
          {success}
        </div>
      )}
      <label className="block max-w-sm text-sm text-slate-300">
        Показать задачи сотрудника
        <select
          value={assignee}
          onChange={(event) => {
            setLoading(true);
            setAssignee(event.target.value);
          }}
          className={fieldClass}
        >
          <option value="">Все исполнители</option>
          {data.filters.assignees.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {canCreate && (
        <form
          onSubmit={create}
          className="grid gap-4 rounded-2xl border border-slate-700 bg-[#101827] p-5 md:grid-cols-2 xl:grid-cols-3"
        >
          <div className="md:col-span-2 xl:col-span-3">
            <h2 className="text-xl font-semibold text-white">
              Добавить работу
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Выберите заказ, дату и ответственного сотрудника.
            </p>
          </div>
          <label className="text-sm text-slate-300">
            Тип работы
            <select
              value={form.sourceType}
              onChange={(event) =>
                setForm({
                  ...form,
                  sourceType: event.target.value as
                    | "measurement"
                    | "production",
                  assignedUserId: "",
                })
              }
              className={fieldClass}
            >
              <option value="measurement">Замер</option>
              <option value="production">Производство или монтаж</option>
            </select>
          </label>
          <label className="text-sm text-slate-300">
            Заказ
            <select
              required
              value={form.orderId}
              onChange={(event) =>
                setForm({ ...form, orderId: event.target.value })
              }
              className={fieldClass}
            >
              <option value="">Выберите заказ</option>
              {data.orders.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.number} — {item.client}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-300">
            Дата
            <input
              required
              type="date"
              value={form.startDate}
              onChange={(event) =>
                setForm({ ...form, startDate: event.target.value })
              }
              className={fieldClass}
            />
          </label>
          {form.sourceType === "production" && (
            <label className="text-sm text-slate-300">
              Этап
              <select
                value={form.stage}
                onChange={(event) =>
                  setForm({
                    ...form,
                    stage: event.target.value,
                    assignedUserId: "",
                  })
                }
                className={fieldClass}
              >
                {stages.map((stage) => (
                  <option key={stage}>{stage}</option>
                ))}
              </select>
            </label>
          )}
          <label className="text-sm text-slate-300">
            Ответственный
            <select
              required
              value={form.assignedUserId}
              onChange={(event) =>
                setForm({ ...form, assignedUserId: event.target.value })
              }
              className={fieldClass}
            >
              <option value="">Выберите сотрудника</option>
              {candidates.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              disabled={creating}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 p-3 font-semibold text-white disabled:opacity-50"
            >
              <Plus size={18} />
              {creating ? "Добавляем…" : "Добавить в календарь"}
            </button>
          </div>
        </form>
      )}
      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-24 animate-pulse rounded-2xl bg-slate-900"
            />
          ))}
        </div>
      ) : (
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => void drop(event)}
          className="space-y-3"
        >
          {!data.events.length ? (
            <div className="rounded-2xl border border-dashed border-slate-700 p-12 text-center">
              <CalendarDays className="mx-auto text-slate-500" size={42} />
              <h2 className="mt-4 text-xl font-semibold text-white">
                Запланированных работ нет
              </h2>
              <p className="mt-2 text-slate-400">
                Добавьте замер, производственную работу или монтаж.
              </p>
            </div>
          ) : (
            data.events.map((item) => (
              <div
                draggable
                onDragStart={(event) =>
                  event.dataTransfer.setData(
                    "event",
                    JSON.stringify({
                      id: item.id,
                      sourceType: item.sourceType,
                    }),
                  )
                }
                key={`${item.sourceType}-${item.id}`}
                className="flex flex-col gap-3 rounded-2xl border border-slate-700 bg-[#101827] p-4 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <p className="font-semibold text-white">{item.title}</p>
                  <p className="mt-1 text-sm text-slate-400">
                    {item.client} · {item.stage}
                  </p>
                </div>
                <div className="text-sm text-slate-300">
                  <p className="flex items-center gap-2">
                    <Clock3 size={16} />
                    {new Date(item.startDate).toLocaleDateString("ru-RU")}
                  </p>
                  <p className="mt-1">
                    {item.assignedUserName ?? item.legacyAssignedName}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
