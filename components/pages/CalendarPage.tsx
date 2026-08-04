"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
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

export default function CalendarPage() {
  const { getKey, reset } = useIdempotencyKey();
  const [data, setData] = useState<Data>(empty);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [assignee, setAssignee] = useState("");
  const [form, setForm] = useState({
    sourceType: "measurement" as "measurement" | "production",
    orderId: "",
    startDate: "",
    assignedUserId: "",
    stage: "Проектирование",
    comment: "",
  });

  const load = useCallback(async () => {
    const [calendarResponse, employeesResponse] = await Promise.all([
      fetch(`/api/calendar${assignee ? `?assignedUserId=${assignee}` : ""}`),
      fetch("/api/employees"),
    ]);
    if (!calendarResponse.ok || !employeesResponse.ok) {
      throw new Error("Не удалось загрузить календарь");
    }

    const [nextData, nextUsers] = await Promise.all([
      calendarResponse.json() as Promise<Data>,
      employeesResponse.json() as Promise<User[]>,
    ]);
    setData(nextData);
    setUsers(nextUsers.filter((user) => user.active));
  }, [assignee]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Ошибка"))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const candidates = users.filter((user) => {
    if (form.sourceType === "measurement") {
      return ["MEASURER", "DIRECTOR"].includes(user.role);
    }
    return form.stage === "Монтаж"
      ? ["INSTALLER", "DIRECTOR"].includes(user.role)
      : ["PRODUCTION", "DIRECTOR"].includes(user.role);
  });

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
        setError((await response.json() as { error?: string }).error ?? "Ошибка");
        return;
      }

      reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка");
    } finally {
      setCreating(false);
    }
  }

  async function drop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const item = JSON.parse(event.dataTransfer.getData("event")) as Pick<CalendarEvent, "id" | "sourceType">;
    const response = await fetch("/api/calendar", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...item, id: Number(item.id), startDate: new Date().toISOString() }),
    });
    if (!response.ok) {
      setError("Не удалось перенести событие");
      return;
    }
    await load();
  }

  return (
    <section className="p-8">
      <h1 className="text-3xl font-bold text-white">Календарь</h1>
      {error && <p className="text-red-400">{error}</p>}
      <select value={assignee} onChange={(event) => { setLoading(true); setAssignee(event.target.value); }}>
        <option value="">Все исполнители</option>
        {data.filters.assignees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <form onSubmit={create} className="mt-4 grid gap-2">
        <select value={form.sourceType} onChange={(event) => setForm({ ...form, sourceType: event.target.value as "measurement" | "production", assignedUserId: "" })}>
          <option value="measurement">Замер</option>
          <option value="production">Производство</option>
        </select>
        <select required value={form.orderId} onChange={(event) => setForm({ ...form, orderId: event.target.value })}>
          <option value="">Заказ</option>
          {data.orders.map((item) => <option key={item.id} value={item.id}>{item.number}</option>)}
        </select>
        <input required type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} />
        {form.sourceType === "production" && (
          <select value={form.stage} onChange={(event) => setForm({ ...form, stage: event.target.value, assignedUserId: "" })}>
            {["Проектирование", "Заготовка", "Покраска", "Монтаж", "Сдано"].map((stage) => <option key={stage}>{stage}</option>)}
          </select>
        )}
        <select required value={form.assignedUserId} onChange={(event) => setForm({ ...form, assignedUserId: event.target.value })}>
          <option value="">Исполнитель</option>
          {candidates.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </select>
        <button disabled={creating}>{creating ? "Создание..." : "Создать"}</button>
      </form>
      {loading ? "Загрузка..." : (
        <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => void drop(event)} className="mt-6 space-y-2">
          {data.events.map((item) => (
            <div draggable onDragStart={(event) => event.dataTransfer.setData("event", JSON.stringify({ id: item.id, sourceType: item.sourceType }))} key={`${item.sourceType}-${item.id}`}>
              {item.title} — {item.assignedUserName ?? item.legacyAssignedName}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
