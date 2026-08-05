"use client";

import { useCallback, useEffect, useState } from "react";
import { Save, ShieldCheck } from "lucide-react";
import { useSession } from "next-auth/react";

const labels: Record<string, string> = {
  pinePrice: "Сосна",
  elmPrice: "Карагач",
  oakPrice: "Дуб",
  woodRailing: "Деревянное ограждение",
  glassRailing: "Стеклянное ограждение",
  brassRailing: "Латунное ограждение",
  ledPrice: "Подсветка",
  paintingPrice: "Покраска",
  installationPrice: "Монтаж",
};

export default function CalculatorConfigPage() {
  const { data: session } = useSession();
  const [config, setConfig] = useState<Record<string, number> | null>(null),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const canEdit = session?.user.role === "DIRECTOR";
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/calculator-config", {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Конфигурация недоступна");
      setConfig(payload);
    } catch (next) {
      setError(
        next instanceof Error ? next.message : "Конфигурация недоступна",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function save() {
    if (!config || !canEdit) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/calculator-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось сохранить конфигурацию");
      setConfig(payload);
      setSuccess("Конфигурация калькулятора сохранена");
    } catch (next) {
      setError(
        next instanceof Error
          ? next.message
          : "Не удалось сохранить конфигурацию",
      );
    } finally {
      setSaving(false);
    }
  }
  if (loading)
    return (
      <section className="p-8 text-slate-300" aria-live="polite">
        Загрузка конфигурации…
      </section>
    );
  return (
    <section className="flex-1 overflow-auto p-4 md:p-8">
      <header>
        <h1 className="text-3xl font-bold text-white">
          Конфигурация калькулятора
        </h1>
        <p className="mt-2 text-slate-400">
          Внутренние базовые цены ALTYN SAPA. Раздел закрыт от менеджеров и
          производственных ролей.
        </p>
      </header>
      <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-700/40 bg-amber-950/30 p-4 text-amber-200">
        <ShieldCheck className="shrink-0" />
        <p>
          {canEdit
            ? "Директор может просматривать и изменять цены."
            : "Доступ только для просмотра при наличии отдельного права settings."}
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-5 rounded-xl bg-red-950/40 p-4 text-red-300"
        >
          {error}
        </p>
      )}
      {success && (
        <p
          role="status"
          className="mt-5 rounded-xl bg-green-950/40 p-4 text-green-300"
        >
          {success}
        </p>
      )}
      {config && (
        <div className="mt-6 rounded-2xl border border-slate-700 bg-[#101827] p-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Object.entries(config).map(([key, value]) => (
              <label key={key} className="text-sm text-slate-300">
                {labels[key] ?? key}
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  disabled={!canEdit || saving}
                  value={value}
                  onChange={(event) =>
                    setConfig((current) =>
                      current
                        ? { ...current, [key]: Number(event.target.value) }
                        : current,
                    )
                  }
                  className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white disabled:opacity-60"
                />
              </label>
            ))}
          </div>
          {canEdit && (
            <button
              disabled={saving}
              onClick={() => void save()}
              className="mt-6 flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:opacity-60"
            >
              <Save size={18} />
              {saving ? "Сохраняем…" : "Сохранить конфигурацию"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
