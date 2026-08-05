"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";

type Row = {
  id: number;
  number: string;
  client: string;
  partner: string;
  amount: number;
  prepayment: number;
  balance: number;
  partnerPrice: number;
  partnerPaid: number;
  partnerBalance: number;
  companyProfit: number;
};
type Operation = {
  id: number;
  type: string;
  amount: number;
  method: string;
  comment: string | null;
  operationDate: string;
  order: { number: string; client: { name: string } } | null;
  partner: { name: string } | null;
};
type Data = {
  rows: Row[];
  partners: { id: number; name: string }[];
  operations: Operation[];
  operationTotals: { income: number; expense: number; net: number };
  totals: {
    turnover: number;
    received: number;
    clientBalance: number;
    partnerPaid: number;
    partnerBalance: number;
    profit: number;
  };
};
const empty: Data = {
  rows: [],
  partners: [],
  operations: [],
  operationTotals: { income: 0, expense: 0, net: 0 },
  totals: {
    turnover: 0,
    received: 0,
    clientBalance: 0,
    partnerPaid: 0,
    partnerBalance: 0,
    profit: 0,
  },
};
const money = (value: number) => `${value.toLocaleString("ru-RU")} ₸`;

export default function FinancePage() {
  const [data, setData] = useState<Data>(empty);
  const [period, setPeriod] = useState("all");
  const [typeFilter, setTypeFilter] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [operation, setOperation] = useState({
    type: "CLIENT_PAYMENT",
    amount: "",
    method: "cash",
    orderId: "",
    partnerId: "",
    comment: "",
    operationDate: new Date().toISOString().slice(0, 10),
    adjustmentDirection: "INCOME",
  });
  const { getKey, reset } = useIdempotencyKey();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ period });
      if (typeFilter) params.set("type", typeFilter);
      const response = await fetch(`/api/finance?${params}`);
      const result = (await response.json()) as Data & { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? "Не удалось загрузить финансы");
      setData(result);
      setError("");
    } catch (value) {
      setError(
        value instanceof Error ? value.message : "Не удалось загрузить финансы",
      );
    } finally {
      setLoading(false);
    }
  }, [period, typeFilter]);
  // Fetching is the effect's sole external synchronization; the state updates occur after it resolves.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/finance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": getKey(),
        },
        body: JSON.stringify({
          ...operation,
          orderId: operation.orderId || undefined,
          partnerId: operation.partnerId || undefined,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? "Не удалось сохранить операцию");
      reset();
      setOperation((item) => ({ ...item, amount: "", comment: "" }));
      setOpen(false);
      await load();
    } catch (value) {
      setError(
        value instanceof Error
          ? value.message
          : "Не удалось сохранить операцию",
      );
    } finally {
      setSaving(false);
    }
  }
  const set = (key: keyof typeof operation, value: string) =>
    setOperation((item) => ({ ...item, [key]: value }));
  return (
    <section className="space-y-6 p-5 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Финансы</h1>
          <p className="mt-1 text-slate-400">
            Операции, расчёты и остатки по заказам
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-xl bg-blue-600 px-5 py-3 font-medium text-white"
        >
          {open ? "Закрыть" : "Добавить операцию"}
        </button>
      </header>
      {open && (
        <form
          onSubmit={submit}
          className="grid gap-3 rounded-2xl border border-slate-700 bg-[#101827] p-5 md:grid-cols-2 xl:grid-cols-4"
        >
          <Field label="Тип">
            <Select
              value={operation.type}
              onChange={(v) => set("type", v)}
              options={[
                ["CLIENT_PAYMENT", "Оплата клиента"],
                ["REFUND", "Возврат"],
                ["EXPENSE", "Расход"],
                ["OTHER_INCOME", "Прочий приход"],
                ["PARTNER_PAYOUT", "Выплата цеху"],
                ["ADJUSTMENT", "Корректировка"],
              ]}
            />
          </Field>
          <Field label="Сумма">
            <input
              required
              min="0.01"
              step="0.01"
              type="number"
              value={operation.amount}
              onChange={(e) => set("amount", e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Способ оплаты">
            <Select
              value={operation.method}
              onChange={(v) => set("method", v)}
              options={[
                ["cash", "Наличные"],
                ["kaspi", "Kaspi"],
                ["bank_transfer", "Банковский перевод"],
                ["card", "Карта"],
                ["other", "Другое"],
              ]}
            />
          </Field>
          <Field label="Дата">
            <input
              required
              type="date"
              value={operation.operationDate}
              onChange={(e) => set("operationDate", e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Заказ">
            <Select
              value={operation.orderId}
              onChange={(v) => set("orderId", v)}
              options={[
                ["", "Без заказа"],
                ...data.rows.map((row) => [
                  String(row.id),
                  `${row.number} — ${row.client}`,
                ]),
              ]}
            />
          </Field>
          <Field label="Цех">
            <Select
              value={operation.partnerId}
              onChange={(v) => set("partnerId", v)}
              options={[
                ["", "Не выбран"],
                ...data.partners.map((partner) => [
                  String(partner.id),
                  partner.name,
                ]),
              ]}
            />
          </Field>
          {operation.type === "ADJUSTMENT" && (
            <Field label="Направление">
              <Select
                value={operation.adjustmentDirection}
                onChange={(v) => set("adjustmentDirection", v)}
                options={[
                  ["INCOME", "Приход"],
                  ["EXPENSE", "Расход"],
                ]}
              />
            </Field>
          )}
          <Field label="Комментарий">
            <input
              maxLength={2000}
              value={operation.comment}
              onChange={(e) => set("comment", e.target.value)}
              className="input"
            />
          </Field>
          <div className="flex items-end">
            <button
              disabled={saving}
              className="w-full rounded-xl bg-green-600 p-3 font-medium text-white disabled:opacity-50"
            >
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
        </form>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        <Card
          title="Приход"
          value={data.operationTotals.income}
          color="text-green-400"
        />
        <Card
          title="Расход"
          value={data.operationTotals.expense}
          color="text-red-400"
        />
        <Card
          title="Чистое движение"
          value={data.operationTotals.net}
          color="text-blue-400"
        />
      </div>
      <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-700 bg-[#101827] p-4">
        <Field label="Период">
          <Select
            value={period}
            onChange={setPeriod}
            options={[
              ["all", "За всё время"],
              ["month", "Последний месяц"],
              ["quarter", "Последний квартал"],
              ["year", "Последний год"],
            ]}
          />
        </Field>
        <Field label="Тип операции">
          <Select
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              ["", "Все операции"],
              ["CLIENT_PAYMENT", "Оплаты клиентов"],
              ["REFUND", "Возвраты"],
              ["EXPENSE", "Расходы"],
              ["OTHER_INCOME", "Прочий приход"],
              ["PARTNER_PAYOUT", "Выплаты цеху"],
              ["ADJUSTMENT", "Корректировки"],
            ]}
          />
        </Field>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-slate-400">Загрузка…</p>}
      <Table title="Операции">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Тип</th>
            <th>Заказ</th>
            <th>Цех</th>
            <th>Комментарий</th>
            <th>Сумма</th>
          </tr>
        </thead>
        <tbody>
          {data.operations.map((item) => (
            <tr key={item.id}>
              <td>
                {new Date(item.operationDate).toLocaleDateString("ru-RU")}
              </td>
              <td>{item.type}</td>
              <td>{item.order?.number ?? "—"}</td>
              <td>{item.partner?.name ?? "—"}</td>
              <td>{item.comment ?? "—"}</td>
              <td>{money(item.amount)}</td>
            </tr>
          ))}
          {!data.operations.length && <Empty colSpan={6} />}
        </tbody>
      </Table>
      <Table title="Заказы">
        <thead>
          <tr>
            <th>Заказ</th>
            <th>Клиент</th>
            <th>Сумма</th>
            <th>Оплачено</th>
            <th>Остаток</th>
            <th>Цех</th>
            <th>Выплачено</th>
            <th>Прибыль</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.id}>
              <td>{row.number}</td>
              <td>{row.client}</td>
              <td>{money(row.amount)}</td>
              <td>{money(row.prepayment)}</td>
              <td>{money(row.balance)}</td>
              <td>{row.partner}</td>
              <td>{money(row.partnerPaid)}</td>
              <td>{money(row.companyProfit)}</td>
            </tr>
          ))}
          {!data.rows.length && <Empty colSpan={8} />}
        </tbody>
      </Table>
    </section>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1 text-sm text-slate-300">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="input"
    >
      {options.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}
function Card({
  title,
  value,
  color,
}: {
  title: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-[#101827] p-5">
      <p className="text-slate-400">{title}</p>
      <p className={`mt-2 text-2xl font-bold ${color}`}>{money(value)}</p>
    </div>
  );
}
function Table({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-[#101827]">
      <h2 className="p-5 text-lg font-semibold text-white">{title}</h2>
      <table className="min-w-[800px] w-full text-left text-sm">
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function Empty({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-6 text-center text-slate-400">
        Нет записей.
      </td>
    </tr>
  );
}
