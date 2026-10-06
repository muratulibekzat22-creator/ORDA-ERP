"use client";

import { ClipboardCopy, LockKeyhole, MessageCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { buildOrderWhatsAppMessages } from "@/lib/orders/whatsapp-messages";
import type { NumericValue } from "@/components/orders/tabs/types";
import { paymentMethodLabel } from "@/lib/orders/registration";

type FollowUp = {
  id: number;
  dueAt: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  expectedAmount: NumericValue | null;
};

type Props = {
  order: {
    id: number;
    client: { name: string; phone: string };
    mapUrl: string;
    address: string;
    staircase: string;
    material: string;
    railingType: string;
    supportType: string;
    lighting: boolean;
    lightingDetails: string;
    cladding: boolean;
    claddingDetails: string;
    additionalDetails: string;
    orderReceivedAt: Date | string;
    promisedAt: Date | string | null;
    manager: string;
    amount: NumericValue;
    prepayment: NumericValue;
    balance: NumericValue;
    paymentMethod: string;
  };
};

const editor = "mt-3 min-h-80 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 p-4 font-sans text-sm leading-6 text-slate-100 outline-none focus:border-blue-500";

export default function OrderWhatsAppMessages({ order }: Props) {
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copyError, setCopyError] = useState("");
  const [notice, setNotice] = useState("");
  const [orderOverride, setOrderOverride] = useState<string | null>(null);
  const [financeOverride, setFinanceOverride] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/orders/${order.id}/payment-follow-ups`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { items?: FollowUp[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Не удалось загрузить обещанные доплаты");
        if (!cancelled) setFollowUps(body.items ?? []);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Не удалось загрузить обещанные доплаты");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [order.id]);

  const generated = useMemo(() => buildOrderWhatsAppMessages({
    clientName: order.client.name,
    phone: order.client.phone,
    mapUrl: order.mapUrl,
    address: order.address,
    staircase: order.staircase,
    material: order.material,
    railingType: order.railingType,
    supportType: order.supportType,
    lighting: order.lighting,
    lightingDetails: order.lightingDetails,
    cladding: order.cladding,
    claddingDetails: order.claddingDetails,
    additionalDetails: order.additionalDetails,
    orderReceivedAt: order.orderReceivedAt,
    promisedAt: order.promisedAt,
    manager: order.manager,
    amount: Number(order.amount),
    received: Number(order.prepayment),
    balance: Number(order.balance),
    paymentMethod: paymentMethodLabel(order.paymentMethod),
    paymentPromises: followUps
      .filter((item) => ["PLANNED", "IN_PROGRESS"].includes(item.status) && item.expectedAmount !== null)
      .map((item) => ({ amount: Number(item.expectedAmount), dueAt: item.dueAt })),
  }), [followUps, order]);

  const orderText = orderOverride ?? generated.orderText;
  const financeText = financeOverride ?? generated.financeText;

  async function copy(kind: "order" | "finance") {
    const text = kind === "order" ? orderText : financeText;
    try {
      await navigator.clipboard.writeText(text);
      setCopyError("");
      setNotice(kind === "order" ? "Данные заказа скопированы" : "Финансовый текст скопирован");
    } catch {
      setNotice("");
      setCopyError("Браузер не разрешил копирование. Выделите текст вручную.");
    }
  }

  const copyDisabled = loading || Boolean(error);
  return (
    <section className="rounded-2xl border border-emerald-700/40 bg-[#101827] p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-white"><MessageCircle className="text-emerald-300" size={21}/>Сообщения для WhatsApp</h2>
          <p className="mt-1 text-sm text-slate-400">Тексты собраны из карточки автоматически. При необходимости их можно дополнить перед копированием.</p>
        </div>
        {generated.promisedTotal > 0 ? <span className="rounded-full bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-200">Остаток рассчитан после обещанной доплаты</span> : null}
      </div>

      {error ? <p role="alert" className="mt-4 rounded-xl border border-red-700/40 bg-red-950/30 p-3 text-sm text-red-200">{error}. Копирование отключено, чтобы не отправить неверный остаток.</p> : null}
      {copyError ? <p role="alert" className="mt-4 rounded-xl border border-red-700/40 bg-red-950/30 p-3 text-sm text-red-200">{copyError}</p> : null}
      {notice ? <p role="status" className="mt-4 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-200">{notice}</p> : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-emerald-700/30 bg-emerald-950/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="font-bold text-white">1. Данные заказа</h3><p className="mt-1 text-xs text-emerald-200">Можно отправлять в рабочую группу и подрядчикам</p></div>
            <button type="button" disabled={copyDisabled} onClick={() => void copy("order")} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-40"><ClipboardCopy size={17}/>{loading ? "Подготовка…" : "Копировать заказ"}</button>
          </div>
          <textarea aria-label="Текст заказа для WhatsApp" value={orderText} onChange={(event) => setOrderOverride(event.target.value)} className={editor}/>
          {orderOverride !== null ? <button type="button" onClick={() => setOrderOverride(null)} className="mt-2 text-xs text-slate-400 underline hover:text-white">Восстановить из карточки</button> : null}
        </article>

        <article className="rounded-2xl border border-amber-700/30 bg-amber-950/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="flex items-center gap-2 font-bold text-white"><LockKeyhole size={17} className="text-amber-300"/>2. Финансы</h3><p className="mt-1 text-xs text-amber-200">Только для внутренней группы — подрядчикам не отправлять</p></div>
            <button type="button" disabled={copyDisabled} onClick={() => void copy("finance")} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-700 px-4 text-sm font-semibold text-white disabled:opacity-40"><ClipboardCopy size={17}/>{loading ? "Подготовка…" : "Копировать финансы"}</button>
          </div>
          <textarea aria-label="Финансовый текст для WhatsApp" value={financeText} onChange={(event) => setFinanceOverride(event.target.value)} className={editor}/>
          {financeOverride !== null ? <button type="button" onClick={() => setFinanceOverride(null)} className="mt-2 text-xs text-slate-400 underline hover:text-white">Восстановить из карточки</button> : null}
        </article>
      </div>
    </section>
  );
}
