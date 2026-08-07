"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

type PayrollRow = {
  id: number;
  baseSalary: string;
  user: { name: string; role: string };
  accruals: Array<{
    id: number;
    type: string;
    amount: string;
    direction: string;
    reason: string;
    createdAt: string;
  }>;
  payments: Array<{
    id: number;
    type: string;
    amount: string;
    paymentDate: string;
  }>;
  advanceRequests: Array<{
    id: number;
    status: string;
    requestedAmount: string;
    approvedAmount?: string | null;
    comment?: string | null;
  }>;
  totals: { accrued: number; paid: number; payable: number };
};
type Payload = {
  period: { id: number; year: number; month: number; status: string } | null;
  rows: PayrollRow[];
  totals: { accrued: number; paid: number; payable: number };
};
const currency = (value: number | string) =>
  `${Number(value).toLocaleString("ru-RU")} ₸`;
const labels: Record<string, string> = {
  BASE_SALARY: "Оклад",
  GUARANTEED_ORDER_BONUS: "Гарантированный бонус",
  ORDER_BONUS: "Бонус за заказ",
  EXTRA_BONUS: "Дополнительный бонус",
  PREMIUM: "Премия",
  DEDUCTION: "Удержание",
  ADJUSTMENT_INCREASE: "Корректировка +",
  ADJUSTMENT_DECREASE: "Корректировка −",
  BONUS_REVERSAL: "Сторно бонуса",
  REQUESTED: "Запрошен",
  APPROVED: "Одобрен",
  REJECTED: "Отклонён",
  PAID: "Выплачен",
  CANCELLED: "Отменён",
};

export default function PayrollPage() {
  const { data: session } = useSession();
  const now = new Date();
  const [period, setPeriod] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });
  const [data, setData] = useState<Payload>({
    period: null,
    rows: [],
    totals: { accrued: 0, paid: 0, payable: 0 },
  });
  const director = session?.user.role === "DIRECTOR";
  const payrollAdmin = director || session?.user.role === "ACCOUNTANT";
  const [advance, setAdvance] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const query = `year=${period.year}&month=${period.month}`;
    let response = await fetch(`/api/payroll?${query}`);
    if (!response.ok) response = await fetch(`/api/payroll/self?${query}`);
    if (response.ok) setData((await response.json()) as Payload);
  }, [period.month, period.year]);
  useEffect(() => {
    // Data arrives asynchronously; the effect only synchronizes the selected period with the API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const requestAdvance = async () => {
    if (!data.period || Number(advance) <= 0) return;
    const response = await fetch("/api/payroll/self", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        periodId: data.period.id,
        amount: Number(advance),
      }),
    });
    setMessage(
      response.ok ? "Запрос на аванс отправлен" : "Не удалось отправить запрос",
    );
    if (response.ok) {
      setAdvance("");
      await load();
    }
  };
  const payrollAction = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/payroll", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
    setMessage(
      response.ok ? "Операция выполнена" : "Не удалось выполнить операцию",
    );
    if (response.ok) await load();
  };
  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white md:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold md:text-3xl">
              {payrollAdmin ? "Зарплата сотрудников" : "Моя зарплата"}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Начисления и фактические выплаты учитываются отдельно.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="Год"
              className="w-24 rounded-xl bg-slate-800 p-3"
              type="number"
              value={period.year}
              onChange={(e) =>
                setPeriod({ ...period, year: Number(e.target.value) })
              }
            />
            <select
              aria-label="Месяц"
              className="rounded-xl bg-slate-800 p-3"
              value={period.month}
              onChange={(e) =>
                setPeriod({ ...period, month: Number(e.target.value) })
              }
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(2026, i).toLocaleString("ru-RU", { month: "long" })}
                </option>
              ))}
            </select>
            {director && !data.period && (
              <button
                className="rounded-xl bg-blue-600 px-4"
                onClick={() =>
                  void payrollAction({ action: "create-period", ...period })
                }
              >
                Открыть месяц
              </button>
            )}
            {director && data.period?.status !== "CLOSED" && data.period && (
              <button
                className="rounded-xl bg-red-700 px-4"
                onClick={() =>
                  void payrollAction({
                    action: "close-period",
                    periodId: data.period!.id,
                  })
                }
              >
                Закрыть месяц
              </button>
            )}
          </div>
        </div>
        <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ["Начислено", data.totals.accrued],
            ["Выплачено", data.totals.paid],
            ["Ожидается к выплате", data.totals.payable],
          ].map(([label, value]) => (
            <article
              key={String(label)}
              className="rounded-2xl border border-slate-800 bg-slate-900 p-5"
            >
              <p className="text-sm text-slate-400">{label}</p>
              <p className="mt-2 text-2xl font-bold">{currency(value)}</p>
            </article>
          ))}
        </section>
        {!director && data.period && (
          <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="font-semibold">Запросить аванс</h2>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                className="min-h-11 flex-1 rounded-xl bg-slate-800 px-4"
                type="number"
                min="1"
                placeholder="Сумма"
                value={advance}
                onChange={(e) => setAdvance(e.target.value)}
              />
              <button
                className="min-h-11 rounded-xl bg-blue-600 px-5 font-semibold"
                onClick={() => void requestAdvance()}
              >
                Запросить аванс
              </button>
            </div>
            {message && (
              <p className="mt-2 text-sm text-slate-300">{message}</p>
            )}
          </section>
        )}
        <section className="mt-6 space-y-4">
          {data.rows.length === 0 ? (
            <div className="rounded-2xl bg-slate-900 p-10 text-center text-slate-400">
              За выбранный месяц данных нет.
            </div>
          ) : (
            data.rows.map((row) => (
              <article
                key={row.id}
                className="rounded-2xl border border-slate-800 bg-slate-900 p-5"
              >
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{row.user.name}</h2>
                    <p className="text-sm text-slate-400">
                      Оклад: {currency(row.baseSalary)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-slate-400">Остаток</p>
                    <p className="text-xl font-bold">
                      {currency(row.totals.payable)}
                    </p>
                  </div>
                </div>
                <div className="mt-5 grid gap-4 lg:grid-cols-3">
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-slate-300">
                      Начисления
                    </h3>
                    {row.accruals.length ? (
                      row.accruals.map((item) => (
                        <p
                          key={item.id}
                          className="border-t border-slate-800 py-2 text-sm"
                        >
                          {labels[item.type] ?? item.type}:{" "}
                          {item.direction === "DECREASE" ? "−" : "+"}
                          {currency(item.amount)}
                        </p>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500">0</p>
                    )}
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-slate-300">
                      Выплаты
                    </h3>
                    {row.payments.length ? (
                      row.payments.map((item) => (
                        <p
                          key={item.id}
                          className="border-t border-slate-800 py-2 text-sm"
                        >
                          {labels[item.type] ?? item.type}:{" "}
                          {currency(item.amount)}
                        </p>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500">0</p>
                    )}
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-slate-300">
                      Авансы
                    </h3>
                    {row.advanceRequests.length ? (
                      row.advanceRequests.map((item) => (
                        <div
                          key={item.id}
                          className="border-t border-slate-800 py-2 text-sm"
                        >
                          <p>
                            {currency(item.requestedAmount)} ·{" "}
                            {labels[item.status] ?? item.status}
                          </p>
                          {director && item.status === "REQUESTED" && (
                            <div className="mt-2 flex gap-2">
                              <button
                                className="rounded-lg bg-green-700 px-3 py-2"
                                onClick={() =>
                                  void payrollAction({
                                    action: "review-advance",
                                    id: item.id,
                                    status: "APPROVED",
                                    approvedAmount: Number(
                                      item.requestedAmount,
                                    ),
                                  })
                                }
                              >
                                Одобрить
                              </button>
                              <button
                                className="rounded-lg bg-red-700 px-3 py-2"
                                onClick={() =>
                                  void payrollAction({
                                    action: "review-advance",
                                    id: item.id,
                                    status: "REJECTED",
                                  })
                                }
                              >
                                Отклонить
                              </button>
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500">0</p>
                    )}
                  </div>
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </main>
  );
}
