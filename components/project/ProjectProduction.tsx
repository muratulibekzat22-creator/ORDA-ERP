"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";

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

type Production = {
  id: number;
  stage: string;
  percent: number;
  master: string;
  masterUserId?: number | null;
  comment: string | null;
  startDate: string | Date | null;
  finishDate: string | Date | null;
};

type Props = {
  orderId: number;
  production?: Production;
};

function toDateInput(value: string | Date | null) {
  if (!value) return "";

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export default function ProjectProduction({ orderId, production }: Props) {
  const router = useRouter();
  const { getKey, reset } = useIdempotencyKey();
  const [currentProduction, setCurrentProduction] = useState(production);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [masters, setMasters] = useState<Array<{ id:number; userId:number | null; name:string; role:string | null; active:boolean; accountActive:boolean }>>([]);
  const [form, setForm] = useState({
    stage: production?.stage ?? "Подготовка",
    percent: String(production?.percent ?? 0),
    masterUserId: production?.masterUserId ? String(production.masterUserId) : "",
    startDate: toDateInput(production?.startDate ?? null),
    finishDate: toDateInput(production?.finishDate ?? null),
    comment: production?.comment ?? "",
  });
  useEffect(() => { void fetch("/api/employees").then(async response => response.ok ? response.json() as Promise<Array<{ id:number; userId:number | null; name:string; role:string | null; active:boolean; accountActive:boolean }>> : []).then(users => setMasters(users.filter(user => user.active && user.accountActive && user.userId && ["PRODUCTION", "INSTALLER", "DIRECTOR"].includes(user.role ?? "")))); }, []);

  function updateForm(name: keyof typeof form, value: string) {
    setForm((previous) => ({ ...previous, [name]: value }));
  }

  async function saveProduction() {
    const percent = Number(form.percent);

    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      setError("Укажите процент готовности от 0 до 100.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/production", {
        method: currentProduction ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": getKey(),
        },
        body: JSON.stringify({
          ...(currentProduction ? { id: currentProduction.id } : { orderId }),
          stage: form.stage,
          percent,
          masterUserId: Number(form.masterUserId),
          startDate: form.startDate || null,
          finishDate: form.finishDate || null,
          comment: form.comment,
        }),
      });

      const result: unknown = await response.json();

      if (!response.ok) {
        const message =
          result && typeof result === "object" && "error" in result && typeof result.error === "string"
            ? result.error
            : "Не удалось сохранить производство";

        throw new Error(message);
      }

      setCurrentProduction(result as Production);
      reset();
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось сохранить производство");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-5 rounded-2xl border border-slate-700 bg-[#101827] p-6">
      <div>
        <h2 className="text-xl font-bold text-white">Производство</h2>
        <p className="mt-1 text-sm text-slate-400">
          Управление этапом, готовностью и ответственным мастером.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="space-y-2 text-sm text-slate-300">
          Текущий этап
          <select
            value={form.stage}
            onChange={(event) => updateForm("stage", event.target.value)}
            className="w-full rounded-xl bg-slate-900 p-3 text-white outline-none ring-1 ring-slate-700 focus:ring-blue-500"
          >
            {stages.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm text-slate-300">
          Процент готовности
          <input
            type="number"
            min="0"
            max="100"
            value={form.percent}
            onChange={(event) => updateForm("percent", event.target.value)}
            className="w-full rounded-xl bg-slate-900 p-3 text-white outline-none ring-1 ring-slate-700 focus:ring-blue-500"
          />
        </label>

        <label className="space-y-2 text-sm text-slate-300">
          Мастер
          <select value={form.masterUserId} onChange={(event) => updateForm("masterUserId", event.target.value)} className="w-full rounded-xl bg-slate-900 p-3 text-white outline-none ring-1 ring-slate-700 focus:ring-blue-500"><option value="">Выберите мастера</option>{masters.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select>
        </label>

        <label className="space-y-2 text-sm text-slate-300">
          Дата начала
          <input
            type="date"
            value={form.startDate}
            onChange={(event) => updateForm("startDate", event.target.value)}
            className="w-full rounded-xl bg-slate-900 p-3 text-white outline-none ring-1 ring-slate-700 focus:ring-blue-500"
          />
        </label>

        <label className="space-y-2 text-sm text-slate-300">
          Плановая дата окончания
          <input
            type="date"
            value={form.finishDate}
            onChange={(event) => updateForm("finishDate", event.target.value)}
            className="w-full rounded-xl bg-slate-900 p-3 text-white outline-none ring-1 ring-slate-700 focus:ring-blue-500"
          />
        </label>

        <label className="space-y-2 text-sm text-slate-300 xl:col-span-3">
          Комментарий
          <textarea
            value={form.comment}
            onChange={(event) => updateForm("comment", event.target.value)}
            className="min-h-28 w-full rounded-xl bg-slate-900 p-3 text-white outline-none ring-1 ring-slate-700 focus:ring-blue-500"
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="button"
        disabled={loading}
        onClick={saveProduction}
        className="rounded-xl bg-blue-600 px-6 py-3 font-medium text-white transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-70"
      >
        {loading ? "Сохранение..." : "Сохранить производство"}
      </button>
    </section>
  );
}
