"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clipboard, MessageCircleWarning } from "lucide-react";

type FollowUpItem = {
  id: number;
  clientId: number;
  nextActionAt: string;
  followUpStep: number | null;
  nextActionComment: string | null;
  message: string;
  client: { name: string; phone: string; whatsapp: string };
  proposal: { id: number; number: string } | null;
};

export default function ManagerFollowUpGate({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const manager = session?.user.role === "MANAGER";
  const [items, setItems] = useState<FollowUpItem[]>([]);
  const [results, setResults] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!manager) return;
    setLoading(true);
    try {
      const response = await fetch("/api/clients/follow-up-gate", { cache: "no-store" });
      const body = await response.json() as { items?: FollowUpItem[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не удалось проверить контакты");
      setItems(body.items ?? []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось проверить контакты");
    } finally {
      setLoading(false);
      setChecked(true);
    }
  }, [manager]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 60_000);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); };
  }, [load, pathname]);

  async function complete(item: FollowUpItem) {
    const resultComment = results[item.id]?.trim();
    if (!resultComment) {
      setError("Напишите результат: сообщение отправлено и что ответил клиент.");
      return;
    }
    setSaving(item.id);
    setError("");
    try {
      const response = await fetch(`/api/clients/${item.clientId}/next-actions/${item.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resultComment }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не удалось сохранить результат");
      setResults((current) => { const next = { ...current }; delete next[item.id]; return next; });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить результат");
    } finally {
      setSaving(null);
    }
  }

  if (status === "loading" || (manager && (!checked || (loading && items.length === 0))))
    return <section className="grid min-h-full place-items-center p-6 text-slate-300">Проверяем обязательные контакты…</section>;
  if (!manager) return children;
  if (error && items.length === 0)
    return (
      <section className="grid min-h-full place-items-center bg-slate-950 p-6">
        <div className="max-w-lg rounded-2xl border border-red-700 bg-red-950/30 p-5 text-center">
          <MessageCircleWarning className="mx-auto text-red-300" size={34} />
          <h1 className="mt-3 text-xl font-bold text-white">Не удалось проверить обязательные контакты</h1>
          <p role="alert" className="mt-2 text-red-200">{error}</p>
          <button type="button" disabled={loading} onClick={() => void load()} className="mt-4 min-h-11 rounded-xl bg-blue-700 px-5 font-semibold text-white disabled:opacity-50">
            {loading ? "Проверяем…" : "Повторить проверку"}
          </button>
        </div>
      </section>
    );
  if (items.length === 0) return children;

  return (
    <section className="min-h-full bg-slate-950 p-4 sm:p-6 md:p-8">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-2xl border border-amber-600/60 bg-amber-950/25 p-5">
          <MessageCircleWarning className="text-amber-300" size={34} />
          <h1 className="mt-3 text-2xl font-bold text-white">Сначала ответьте клиентам после КП</h1>
          <p className="mt-2 text-slate-300">
            Эти контакты просрочены. После фиксации результата кабинет автоматически откроется.
          </p>
        </div>
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-700 bg-red-950/40 p-3 text-red-200">{error}</p>}
        <div className="mt-5 space-y-4">
          {items.map((item) => (
            <article key={item.id} className="rounded-2xl border border-slate-700 bg-[#101827] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-amber-300">Контакт {item.followUpStep ?? 1} из 2 · КП №{item.proposal?.number ?? "—"}</p>
                  <h2 className="mt-1 text-xl font-bold text-white">{item.client.name}</h2>
                  <p className="text-slate-400">{item.client.phone}</p>
                </div>
                <Link href={`/clients/${item.clientId}`} className="rounded-xl bg-slate-800 px-4 py-3 text-sm text-white">Открыть заявку</Link>
              </div>
              <div className="mt-4 rounded-xl bg-slate-900 p-4">
                <p className="whitespace-pre-wrap text-sm text-slate-200">{item.message}</p>
                <button type="button" onClick={() => void navigator.clipboard.writeText(item.message)} className="mt-3 flex min-h-10 items-center gap-2 rounded-lg bg-blue-700 px-3 text-sm text-white"><Clipboard size={16} />Копировать текст</button>
              </div>
              <label className="mt-4 block text-sm text-slate-300">
                Что сделано и что ответил клиент
                <textarea rows={3} value={results[item.id] ?? ""} onChange={(event) => setResults((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Написала в WhatsApp. Клиент попросил вариант со скидкой и другим дизайном…" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white" />
              </label>
              <button type="button" disabled={saving === item.id} onClick={() => void complete(item)} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 font-semibold text-white disabled:opacity-50"><CheckCircle2 size={18} />{saving === item.id ? "Сохраняем…" : "Зафиксировать контакт"}</button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
