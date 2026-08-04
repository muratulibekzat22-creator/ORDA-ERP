"use client";

import { useCallback, useEffect, useState } from "react";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";

type Props = { orderId: number };
type User = { id: number; name: string; role: string; active: boolean };
type Measurement = {
  id: number;
  orderId: number;
  measurer: string;
  measurerUserId: number | null;
  measurerUser: { id: number; name: string } | null;
  visitDate: string;
  floorHeight: number | null;
  staircaseWidth: number | null;
  stepsCount: number | null;
  comment: string | null;
};

const blank = {
  measurerUserId: "",
  visitDate: "",
  floorHeight: "",
  staircaseWidth: "",
  stepsCount: "",
  comment: "",
};

export default function ProjectMeasurement({ orderId }: Props) {
  const { getKey, reset } = useIdempotencyKey();
  const [users, setUsers] = useState<User[]>([]);
  const [items, setItems] = useState<Measurement[]>([]);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<Measurement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [usersResponse, measurementsResponse] = await Promise.all([
      fetch("/api/employees"),
      fetch("/api/measurements"),
    ]);
    if (!usersResponse.ok || !measurementsResponse.ok) {
      throw new Error("Не удалось загрузить замеры");
    }

    setUsers(
      (await usersResponse.json() as User[]).filter(
        (user) => user.active && ["MEASURER", "DIRECTOR"].includes(user.role)
      )
    );
    setItems(
      (await measurementsResponse.json() as Measurement[]).filter(
        (measurement) => measurement.orderId === orderId
      )
    );
  }, [orderId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Ошибка")
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function submit() {
    const isNewMeasurement = !editing;
    setLoading(true);
    setError("");

    try {
      const payload = {
        measurerUserId: Number(form.measurerUserId),
        visitDate: form.visitDate,
        floorHeight: Number(form.floorHeight) || undefined,
        staircaseWidth: Number(form.staircaseWidth) || undefined,
        stepsCount: Number(form.stepsCount) || undefined,
        comment: form.comment,
      };
      const response = await fetch(
        editing ? `/api/measurements/${editing.id}` : "/api/measurements",
        {
          method: editing ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...(isNewMeasurement ? { "Idempotency-Key": getKey() } : {}),
          },
          body: JSON.stringify(editing ? payload : { ...payload, orderId }),
        }
      );

      if (!response.ok) {
        setError(
          (await response.json() as { error?: string }).error ?? "Ошибка сохранения"
        );
        return;
      }

      if (isNewMeasurement) {
        reset();
      }
      setForm(blank);
      setEditing(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка сохранения");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl bg-white p-6 shadow">
      <h2 className="text-xl font-bold">Замер объекта</h2>
      {error && <p className="text-red-600">{error}</p>}
      <select
        required
        value={form.measurerUserId}
        onChange={(event) => setForm({ ...form, measurerUserId: event.target.value })}
      >
        <option value="">Выберите замерщика</option>
        {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
      </select>
      {(["visitDate", "floorHeight", "staircaseWidth", "stepsCount"] as const).map((field) => (
        <input
          key={field}
          type={field === "visitDate" ? "date" : "number"}
          value={form[field]}
          onChange={(event) => setForm({ ...form, [field]: event.target.value })}
        />
      ))}
      <textarea value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} />
      <button type="button" disabled={loading} onClick={() => void submit()}>
        {editing ? "Сохранить" : "Добавить замер"}
      </button>
      {editing && (
        <button type="button" onClick={() => { setEditing(null); setForm(blank); }}>
          Отмена
        </button>
      )}
      <div>
        {items.map((item) => (
          <div key={item.id}>
            {item.measurerUser?.name ?? item.measurer}{" "}
            <button
              onClick={() => {
                setEditing(item);
                setForm({
                  measurerUserId: item.measurerUserId ? String(item.measurerUserId) : "",
                  visitDate: item.visitDate.slice(0, 10),
                  floorHeight: String(item.floorHeight ?? ""),
                  staircaseWidth: String(item.staircaseWidth ?? ""),
                  stepsCount: String(item.stepsCount ?? ""),
                  comment: item.comment ?? "",
                });
              }}
            >
              Редактировать
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
