"use client";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { useCallback } from "react";
import { ORDER_STATUSES } from "@/lib/orders/lifecycle";
type Dashboard = {
  activeOrders: number;
  completedOrders: number;
  totals: { price: number; paid: number; balance: number };
  statuses: Record<string, number>;
  recentPayments: Array<{
    id: number;
    amount: number;
    method: string;
    comment: string | null;
    operationDate: string;
    order: { number: string };
  }>;
};
export default function PartnerPage() {
  const [d, setD] = useState<Dashboard | null>(null),
    [orders, setOrders] = useState<
      Array<{
        id: number;
        number: string;
        status: string;
        address: string;
        material: string;
        partnerPrice: string;
        partnerPaid: string;
        partnerBalance: string;
        partnerPlannedReadyAt: string | null;
        partnerComment: string;
        readyForInstallation: boolean;
        installationCompleted: boolean;
      }>
    >([]),
    [error, setError] = useState("");
  const load = useCallback(
    () =>
      Promise.all([fetch("/api/partner/dashboard"), fetch("/api/orders")])
        .then(async ([a, b]) => {
          if (!a.ok || !b.ok) throw new Error("Не удалось загрузить кабинет");
          setD((await a.json()) as Dashboard);
          setOrders(await b.json());
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Ошибка")),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function updateOrder(id: number, data: Record<string, unknown>) {
    setError("");
    const response = await fetch(`/api/orders/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(data),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok)
      return setError(payload.error ?? "Не удалось обновить заказ");
    await load();
  }
  const money = (v: number | string) =>
    `${Number(v).toLocaleString("ru-RU")} ₸`;
  return (
    <main className="min-h-screen bg-slate-950 p-5 text-white md:p-8">
      <header className="mb-6 flex justify-between">
        <div>
          <h1 className="text-3xl font-bold">Кабинет цеха</h1>
          <p className="text-slate-400">Только ваши заказы и выплаты</p>
        </div>
        <button onClick={() => void signOut({ callbackUrl: "/login" })}>
          Выйти
        </button>
      </header>
      {error && <p className="text-red-400">{error}</p>}
      {d && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            ["Активные", d.activeOrders],
            ["Сумма", money(d.totals.price)],
            ["Выплачено", money(d.totals.paid)],
            ["Остаток", money(d.totals.balance)],
            ["Завершённые заказы", d.completedOrders],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-xl bg-slate-900 p-4">
              <p className="text-slate-400">{k}</p>
              <b>{v}</b>
            </div>
          ))}
        </div>
      )}
      <section className="mt-6 rounded-xl bg-slate-900 p-5">
        <h2 className="text-xl font-semibold">Мои заказы</h2>
        {orders.map((o) => (
          <PartnerOrder
            key={o.id}
            order={o}
            money={money}
            onUpdate={updateOrder}
          />
        ))}
        {!orders.length && (
          <p className="mt-3 text-slate-400">Заказов пока нет.</p>
        )}
      </section>
      {d && (
        <section className="mt-6 rounded-xl bg-slate-900 p-5">
          <h2 className="text-xl font-semibold">Последние выплаты</h2>
          {d.recentPayments.map((p) => (
            <p key={p.id} className="mt-2">
              {p.order.number} — {money(p.amount)} · {p.method}
            </p>
          ))}
        </section>
      )}
    </main>
  );
}

type PartnerOrderItem = {
  id: number;
  number: string;
  status: string;
  address: string;
  material: string;
  partnerPrice: string;
  partnerPaid: string;
  partnerBalance: string;
  partnerPlannedReadyAt: string | null;
  partnerComment: string;
  readyForInstallation: boolean;
  installationCompleted: boolean;
};

function PartnerOrder({
  order,
  money,
  onUpdate,
}: {
  order: PartnerOrderItem;
  money: (value: number | string) => string;
  onUpdate: (id: number, data: Record<string, unknown>) => Promise<void>;
}) {
  const [status, setStatus] = useState(order.status);
  const [date, setDate] = useState(
    order.partnerPlannedReadyAt?.slice(0, 10) ?? "",
  );
  const [comment, setComment] = useState(order.partnerComment ?? "");
  const safeStatuses = ORDER_STATUSES.filter((value) =>
    [
      "Заготовка",
      "Покраска",
      "Заказ готов",
      "Ожидает установки",
      "Установка",
      "Заказ завершён",
    ].includes(value),
  );
  return (
    <article className="mt-4 rounded-xl border border-slate-700 bg-slate-950/40 p-4">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h3 className="font-bold text-white">{order.number}</h3>
          <p className="text-sm text-slate-400">
            {order.address} · {order.material}
          </p>
        </div>
        <span className="rounded-full bg-blue-950 px-3 py-1 text-sm text-blue-300">
          {order.status}
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm text-slate-300">
          Разрешённый этап
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 px-3"
          >
            {!safeStatuses.includes(
              status as (typeof safeStatuses)[number],
            ) && <option>{status}</option>}
            {safeStatuses.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-300">
          Плановая дата готовности
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 px-3"
          />
        </label>
        <label className="text-sm text-slate-300 md:col-span-2">
          Комментарий
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            className="mt-1 min-h-20 w-full rounded-lg bg-slate-800 p-3"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            void onUpdate(order.id, {
              status,
              comment,
              partnerPlannedReadyAt: date || null,
              partnerComment: comment,
            })
          }
          className="min-h-11 rounded-lg bg-blue-600 px-4"
        >
          Сохранить изменения
        </button>
        <button
          type="button"
          onClick={() =>
            void onUpdate(order.id, {
              readyForInstallation: true,
              partnerComment: comment,
            })
          }
          className="min-h-11 rounded-lg bg-green-700 px-4"
        >
          Готово к установке
        </button>
        <button
          type="button"
          onClick={() =>
            void onUpdate(order.id, {
              installationCompleted: true,
              status: "Заказ завершён",
              comment,
            })
          }
          className="min-h-11 rounded-lg bg-emerald-800 px-4"
        >
          Установка завершена
        </button>
      </div>
      <p className="mt-4 text-sm text-slate-400">
        Стоимость работ цеха: {money(order.partnerPrice)} · Выплачено:{" "}
        {money(order.partnerPaid)} · Остаток: {money(order.partnerBalance)}
      </p>
    </article>
  );
}
