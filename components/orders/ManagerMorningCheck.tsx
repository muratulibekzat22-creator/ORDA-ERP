"use client";

import { ArrowRight, CheckCircle2, ClipboardCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type MorningOrder = {
  id: number;
  number: string;
  client: string;
  phone: string;
  city: string;
  amount: number;
  promisedAt: string | null;
  status: string;
  missing: string[];
  overdue: boolean;
  requiresAction: boolean;
  actionLabel: string;
  href: string;
};

type MorningState = {
  businessDate: string;
  reviewedToday: boolean;
  mustReview: boolean;
  bypassReason: string | null;
  inventory: {
    companyOrderCount: number;
    companyClientCount: number;
    managerOrderCount: number;
    legacyOrderCount: number;
    healthy: boolean;
  };
  actionOrderCount: number;
  orders: MorningOrder[];
};

const money = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₸`;

export default function ManagerMorningCheck({ initialState }: { initialState: MorningState }) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function complete() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/manager-morning-check", { method: "POST" });
      const body = await response.json() as MorningState & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не удалось завершить проверку");
      setState(body);
      router.push("/");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось завершить проверку");
    } finally {
      setBusy(false);
    }
  }

  if (state.bypassReason === "OWNERSHIP_REQUIRED")
    return <main className="mx-auto w-full max-w-3xl p-3 sm:p-6">
      <section className="rounded-2xl border border-amber-700/60 bg-amber-950/20 p-5">
        <TriangleAlert className="text-amber-300" />
        <h1 className="mt-3 text-xl font-bold text-white">Заказы требуют проверки привязки</h1>
        <p className="mt-2 text-sm leading-6 text-amber-100">Система нашла заказы с вашим именем, но без надёжной связи с аккаунтом. Кабинет не заблокирован; директор видит точный список для исправления.</p>
        <Link href="/" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-blue-600 px-4 font-semibold text-white">Открыть кабинет</Link>
      </section>
    </main>;

  return <main className="mx-auto w-full max-w-6xl space-y-4 p-3 pb-24 sm:p-6">
    <header className="rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-950/60 to-slate-950 p-5 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-300">Утренний контроль · {state.businessDate}</p>
          <h1 className="mt-2 text-2xl font-bold text-white">Проверьте свои действующие заказы</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Заполните недостающие данные и подтвердите проверку. Внутренние этапы заготовки и покраски ведёт цех — менеджеру достаточно актуального клиентского статуса.</p>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 text-center">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3"><strong className="block text-xl text-white">{state.inventory.managerOrderCount}</strong><span className="text-xs text-slate-400">моих заказов</span></div>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3"><strong className="block text-xl text-amber-200">{state.actionOrderCount}</strong><span className="text-xs text-amber-100">требуют действия</span></div>
        </div>
      </div>
    </header>

    {error && <p role="alert" className="rounded-xl border border-red-800 bg-red-950/30 p-4 text-sm text-red-200">{error}</p>}

    <section className="grid min-w-0 gap-3 lg:grid-cols-2">
      {state.orders.map((order) => <article key={order.id} className={`min-w-0 rounded-2xl border p-4 ${order.requiresAction ? "border-amber-800/60 bg-amber-950/15" : "border-emerald-900/50 bg-emerald-950/10"}`}>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0"><h2 className="break-words font-semibold text-white">{order.number} · {order.client}</h2><p className="mt-1 break-words text-sm text-slate-400">{order.city || "Город не указан"}{order.phone ? ` · ${order.phone}` : " · телефон не указан"}</p></div>
          <span className="shrink-0 rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-200">{order.status}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm"><span className="rounded-lg bg-black/20 p-2 text-slate-300"><small className="block text-slate-500">Сумма</small>{money(order.amount)}</span><span className="rounded-lg bg-black/20 p-2 text-slate-300"><small className="block text-slate-500">Срок</small>{order.promisedAt ? new Date(order.promisedAt).toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty" }) : "не указан"}</span></div>
        {order.missing.length ? <p className="mt-3 break-words text-sm text-amber-200"><TriangleAlert className="mr-1 inline" size={15}/>Не заполнено: {order.missing.join(", ")}</p> : <p className="mt-3 text-sm text-emerald-300"><CheckCircle2 className="mr-1 inline" size={15}/>Основные данные заполнены.</p>}
        <Link href={order.href} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500">{order.actionLabel}<ArrowRight size={16}/></Link>
      </article>)}
    </section>

    <section className="sticky bottom-3 rounded-2xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl backdrop-blur">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold text-white">Проверка выполнена?</h2><p className="mt-1 text-sm text-slate-400">Незавершённые пункты останутся в очереди внимания и после входа.</p></div><button type="button" disabled={busy || !state.mustReview} onClick={() => void complete()} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 font-bold text-slate-950 disabled:opacity-50"><ClipboardCheck size={19}/>{busy ? "Сохранение…" : "Завершить утреннюю проверку"}</button></div>
    </section>
  </main>;
}
