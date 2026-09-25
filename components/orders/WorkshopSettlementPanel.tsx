"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import type { NumericValue, OrderTabData } from "./tabs/types";

type WorkshopOrder = Pick<
  OrderTabData,
  | "id"
  | "partner"
  | "productionPrice"
  | "settlement"
>;

const control =
  "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white outline-none focus:border-blue-500";
const today = () => new Date().toISOString().slice(0, 10);
const money = (value: NumericValue | null | undefined) =>
  value === null || value === undefined
    ? "Не заполнена"
    : `${Number(value).toLocaleString("ru-RU")} ₸`;
const date = (value: Date | string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("ru-RU").format(new Date(value))
    : "—";
const purposeLabels: Record<string, string> = {
  SUPPORT: "Поддержка цеху",
  ADVANCE: "Аванс цеху",
  FINAL_PAYMENT: "Финальный расчёт",
  OTHER: "Прочая выплата",
};

export default function WorkshopSettlementPanel({
  order,
  readOnly = false,
}: {
  order: WorkshopOrder;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const role = session?.user.role ?? "";
  const canSetPrice = !readOnly && ["DIRECTOR", "OPERATIONS_DIRECTOR", "MANAGER"].includes(role);
  const canManageSettlement =
    !readOnly && ["DIRECTOR", "OPERATIONS_DIRECTOR", "ACCOUNTANT"].includes(role);
  const director = role === "DIRECTOR" || role === "OPERATIONS_DIRECTOR";
  const partnerSettlement = order.settlement?.partner;
  const [productionPrice, setProductionPrice] = useState(
    order.productionPrice == null ? "" : String(order.productionPrice),
  );
  const [partners, setPartners] = useState<
    Array<{ id: number; name: string; active: boolean }>
  >([]);
  const [partnerId, setPartnerId] = useState(String(order.partner?.id ?? ""));
  const [payoutAmount, setPayoutAmount] = useState("");
  const [purpose, setPurpose] = useState("SUPPORT");
  const [operationDate, setOperationDate] = useState(today());
  const [method, setMethod] = useState("bank_transfer");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!director) return;
    void fetch("/api/partners", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: unknown) => {
        setPartners(
          Array.isArray(rows)
            ? rows.filter(
                (item): item is { id: number; name: string; active: boolean } =>
                  Boolean(item) &&
                  typeof item === "object" &&
                  "id" in item &&
                  "name" in item &&
                  (!("active" in item) || item.active === true),
              )
            : [],
        );
      });
  }, [director]);

  const payouts = useMemo(
    () => partnerSettlement?.payouts ?? [],
    [partnerSettlement?.payouts],
  );
  const supportPaid = useMemo(
    () =>
      payouts.reduce(
        (sum, payout) =>
          ["SUPPORT", "ADVANCE"].includes(payout.purpose)
            ? sum + (payout.type === "PARTNER_PAYOUT_REVERSAL" ? -payout.amount : payout.amount)
            : sum,
        0,
      ),
    [payouts],
  );

  async function request(
    url: string,
    payload: Record<string, unknown>,
    success: string,
    method = "POST",
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Операция не выполнена");
      setNotice(success);
      setPayoutAmount("");
      setComment("");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Операция не выполнена");
    } finally {
      setBusy(false);
    }
  }

  function savePrice(event: FormEvent) {
    event.preventDefault();
    return request(
      `/api/orders/${order.id}`,
      {
        action: "setProductionPrice",
        productionPrice: Number(productionPrice),
      },
      "Цена производства сохранена",
      "PATCH",
    );
  }

  function assignPartner(event: FormEvent) {
    event.preventDefault();
    return request(
      `/api/orders/${order.id}`,
      {
        action: "assignPartner",
        partnerId: Number(partnerId),
        directorConfirmed: Boolean(
          order.partner && order.partner.id !== Number(partnerId),
        ),
      },
      "Цех назначен",
      "PATCH",
    );
  }

  function addPayout(event: FormEvent) {
    event.preventDefault();
    return request(
      "/api/partners/payments",
      {
        orderId: order.id,
        amount: Number(payoutAmount),
        purpose,
        operationDate,
        method,
        comment,
      },
      "Выплата цеху сохранена",
    );
  }

  return (
    <section className="rounded-2xl border border-cyan-900/60 bg-[#101827] p-4 shadow-sm md:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">
            {director || role === "ACCOUNTANT"
              ? "Расчёт с цехом"
              : "Цена производства"}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {director || role === "ACCOUNTANT"
              ? "Цена, поддержка, авансы и остаток по заказу — в одном расчёте."
              : "Цена не блокирует передачу в цех. Пока она не указана, прибыль и маржа не рассчитываются."}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${order.productionPrice == null ? "bg-amber-500/10 text-amber-200" : "bg-emerald-500/10 text-emerald-200"}`}
        >
          {order.productionPrice == null ? "Не заполнена" : "Заполнена"}
        </span>
      </div>

      {error || notice ? (
        <p
          role={error ? "alert" : "status"}
          className={`mt-3 rounded-xl border p-3 text-sm ${error ? "border-red-800 bg-red-950/40 text-red-300" : "border-emerald-800 bg-emerald-950/40 text-emerald-300"}`}
        >
          {error || notice}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Цена производства" value={money(order.productionPrice)} />
        <Metric label="Цех" value={order.partner?.name ?? "Не назначен"} />
        {(director || role === "ACCOUNTANT") && partnerSettlement ? (
          <>
            <Metric label="Поддержка и авансы" value={money(supportPaid)} />
            <Metric label="Всего выплачено" value={money(partnerSettlement.paid)} />
            <Metric label="Осталось выплатить" value={money(partnerSettlement.remaining)} accent />
          </>
        ) : null}
      </div>

      {canSetPrice ? (
        <form onSubmit={savePrice} className="mt-4 grid gap-3 rounded-xl bg-slate-950/55 p-3 sm:grid-cols-[minmax(0,220px)_auto] sm:items-end sm:justify-start">
          <label className="text-sm text-slate-300">
            Цена производства, ₸
            <input type="number" min="1" step="1" required value={productionPrice} onChange={(event) => setProductionPrice(event.target.value)} className={`${control} mt-1`} />
          </label>
          <button type="submit" disabled={busy || !Number(productionPrice)} className="min-h-11 rounded-xl bg-blue-600 px-4 font-semibold text-white disabled:opacity-50">
            Сохранить
          </button>
        </form>
      ) : null}

      {director ? (
        <form onSubmit={assignPartner} className="mt-4 grid gap-3 rounded-xl border border-slate-800 p-3 sm:grid-cols-[minmax(0,280px)_auto] sm:items-end sm:justify-start">
          <label className="text-sm text-slate-300">
            Назначить цех
            <select required value={partnerId} onChange={(event) => setPartnerId(event.target.value)} className={`${control} mt-1`}>
              <option value="">Выберите цех</option>
              {partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy || !partnerId} className="min-h-11 rounded-xl border border-cyan-700 bg-cyan-950/40 px-4 font-semibold text-cyan-100 disabled:opacity-50">
            Назначить
          </button>
        </form>
      ) : null}

      {canManageSettlement && order.partner && order.productionPrice != null ? (
        <form onSubmit={addPayout} className="mt-4 grid gap-3 rounded-xl border border-amber-900/50 bg-amber-950/10 p-3 md:grid-cols-2 xl:grid-cols-6 xl:items-end">
          <label className="text-sm text-slate-300">Вид выплаты<select value={purpose} onChange={(event) => setPurpose(event.target.value)} className={`${control} mt-1`}><option value="SUPPORT">Поддержка цеху</option><option value="ADVANCE">Аванс цеху</option><option value="FINAL_PAYMENT">Финальный расчёт</option><option value="OTHER">Прочая выплата</option></select></label>
          <label className="text-sm text-slate-300">Сумма, ₸<input type="number" min="1" step="1" required value={payoutAmount} onChange={(event) => setPayoutAmount(event.target.value)} className={`${control} mt-1`} /></label>
          <label className="text-sm text-slate-300">Дата<input type="date" required value={operationDate} onChange={(event) => setOperationDate(event.target.value)} className={`${control} mt-1`} /></label>
          <label className="text-sm text-slate-300">Способ<select value={method} onChange={(event) => setMethod(event.target.value)} className={`${control} mt-1`}><option value="bank_transfer">Банковский перевод</option><option value="kaspi">Kaspi</option><option value="cash">Наличные</option><option value="other">Другое</option></select></label>
          <label className="text-sm text-slate-300">Комментарий<input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Необязательно" className={`${control} mt-1`} /></label>
          <button type="submit" disabled={busy || !Number(payoutAmount)} className="min-h-11 rounded-xl bg-amber-600 px-4 font-semibold text-white disabled:opacity-50">Записать выплату</button>
        </form>
      ) : null}

      {(director || role === "ACCOUNTANT") && payouts.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Дата</th><th className="px-3 py-2">Назначение</th><th className="px-3 py-2">Сумма</th><th className="px-3 py-2">Способ</th><th className="px-3 py-2">Комментарий</th><th className="px-3 py-2">Автор</th></tr></thead>
            <tbody>{payouts.map((payout) => <tr key={payout.id} className="border-t border-slate-800"><td className="px-3 py-3">{date(payout.operationDate)}</td><td className="px-3 py-3">{payout.type === "PARTNER_PAYOUT_REVERSAL" ? "Отмена выплаты" : purposeLabels[payout.purpose] ?? purposeLabels.OTHER}</td><td className={`px-3 py-3 font-semibold ${payout.type === "PARTNER_PAYOUT_REVERSAL" ? "text-red-300" : "text-emerald-300"}`}>{payout.type === "PARTNER_PAYOUT_REVERSAL" ? "−" : ""}{money(payout.amount)}</td><td className="px-3 py-3">{payout.method || "—"}</td><td className="px-3 py-3">{payout.comment || "—"}</td><td className="px-3 py-3">{payout.author || "—"}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <div className="min-w-0 rounded-xl bg-slate-950/55 p-3"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 break-words font-semibold ${accent ? "text-amber-300" : "text-white"}`}>{value}</p></div>;
}
