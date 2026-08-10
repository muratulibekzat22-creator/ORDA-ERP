"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { FormEvent, useEffect, useState } from "react";
import type { EmployeeSettlement, OrderTabData } from "./tabs/types";

const money = (value: number) => `${value.toLocaleString("ru-RU")} ₸`;
const statuses: Record<string, string> = {
  NOT_ASSIGNED: "Не назначен",
  UNPAID: "Не оплачено",
  PARTIAL: "Частично",
  PAID: "Оплачено",
  OVERPAID: "Переплата",
};
const payrollStatuses: Record<string, string> = {
  ACCRUED: "Начислено",
  PARTIALLY_PAID: "Частично выплачено",
  PAID: "Выплачено",
};
const today = () => new Date().toISOString().slice(0, 10);
const date = (value: Date | string | null) =>
  value && !Number.isNaN(new Date(value).getTime())
    ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "Дата не указана";
const methodLabels: Record<string, string> = {
  cash: "Наличные",
  kaspi: "Kaspi",
  bank_transfer: "Банковский перевод",
  other: "Другое",
};
const control =
  "min-h-11 min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white";

export default function OrderSettlementPanel({
  order,
  readOnly = false,
}: {
  order: Pick<OrderTabData, "id" | "partner" | "settlement">;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const role = session?.user.role ?? "";
  const [partners, setPartners] = useState<
    Array<{ id: number; name: string; active: boolean }>
  >([]);
  const [partnerId, setPartnerId] = useState(String(order.partner?.id ?? ""));
  const [agreed, setAgreed] = useState(
    String(order.settlement?.partner?.agreed ?? ""),
  );
  const [agreedAt, setAgreedAt] = useState(today());
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [operationDate, setOperationDate] = useState(today());
  const [method, setMethod] = useState("bank_transfer");
  const [comment, setComment] = useState("");
  const [bonusAmount, setBonusAmount] = useState("");
  const [bonusReason, setBonusReason] = useState("");
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (role !== "DIRECTOR") return;
    const now = new Date();
    void Promise.all([
      fetch("/api/partners").then((response) =>
        response.ok ? response.json() : [],
      ),
      fetch(
        `/api/payroll?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
      ).then((response) => (response.ok ? response.json() : null)),
    ]).then(
      ([partnerRows, payroll]: [
        unknown,
        { period?: { id: number } | null } | null,
      ]) => {
        setPartners(
          Array.isArray(partnerRows)
            ? partnerRows.filter(
                (item): item is { id: number; name: string; active: boolean } =>
                  Boolean(item) &&
                  typeof item === "object" &&
                  "id" in item &&
                  "name" in item &&
                  (!("active" in item) || item.active === true),
              )
            : [],
        );
        setPeriodId(payroll?.period?.id ?? null);
      },
    );
  }, [role]);

  async function request(
    url: string,
    payload: Record<string, unknown>,
    methodValue = "POST",
  ) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, {
        method: methodValue,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? "Операция не выполнена");
      setAmount("");
      setComment("");
      setReason("");
      setBonusAmount("");
      setBonusReason("");
      router.refresh();
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Операция не выполнена",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function assign(event: FormEvent) {
    event.preventDefault();
    await request(
      `/api/orders/${order.id}`,
      {
        action: "assignPartner",
        partnerId: Number(partnerId),
        partnerPrice: Number(agreed),
        partnerAgreedAt: agreedAt,
        reason,
        directorConfirmed: Boolean(
          order.partner && order.partner.id !== Number(partnerId),
        ),
      },
      "PATCH",
    );
  }
  async function payout(event: FormEvent) {
    event.preventDefault();
    await request("/api/partners/payments", {
      orderId: order.id,
      amount: Number(amount),
      operationDate,
      method,
      comment,
    });
  }
  async function accrueManagerBonus(event: FormEvent) {
    event.preventDefault();
    const employeeId = order.settlement?.manager?.employeeId;
    if (!employeeId || !periodId) return;
    await request(`/api/orders/${order.id}/payroll-bonuses`, {
      employeeId,
      periodId,
      type: "ORDER_BONUS",
      amount: Number(bonusAmount),
      reason: bonusReason,
      paymentMode: "ACCUMULATE",
    });
  }
  async function payAccrual(
    worker: EmployeeSettlement,
    accrual: EmployeeSettlement["accruals"][number],
  ) {
    if (
      !window.confirm(
        `Выплатить ${money(accrual.remaining)} сотруднику ${worker.name ?? ""}?`,
      )
    )
      return;
    await request("/api/payroll", {
      action: "payment",
      employeeId: accrual.employeeId,
      periodId: accrual.periodId,
      amount: accrual.remaining,
      type: "ORDER_BONUS_PAYMENT",
      paymentDate: operationDate,
      method,
      comment: comment || `Выплата бонуса по заказу`,
      relatedAccrualId: accrual.id,
    });
  }

  const client = order.settlement?.client,
    partner = order.settlement?.partner;
  const manager = order.settlement?.manager,
    measurer = order.settlement?.measurer;
  if (!client && !partner) return null;
  return (
    <section
      id="settlements"
      className="scroll-mt-24 rounded-2xl border border-slate-800 bg-[#101827] p-4 md:p-5"
    >
      <h2 className="text-lg font-semibold text-white">Расчёты</h2>
      <p className="mt-1 text-sm text-slate-400">
        Единый финансовый водопад заказа: клиент, цех и выплаты сотрудникам.
        Денежные события проводятся только через канонические Payment и Payroll.
      </p>
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-red-950/50 p-3 text-sm text-red-300"
        >
          {error}
        </p>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {client && (
          <div className="min-w-0 rounded-xl border border-blue-900/70 bg-blue-950/15 p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="font-semibold text-white">Клиент</h3>
              <span className="text-sm text-blue-300">
                {statuses[client.status] ?? client.status}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <Value label="Сумма заказа" value={money(client.total)} />
              <Value
                label="Получено от клиента"
                value={money(client.received)}
                tone="text-emerald-300"
              />
              <Value
                label="Остаток клиента"
                value={money(client.remaining)}
                tone="text-amber-300"
              />
              {client.overpayment > 0 && (
                <Value
                  label="Переплата"
                  value={money(client.overpayment)}
                  tone="text-violet-300"
                />
              )}
            </dl>
          </div>
        )}
        {partner && (
          <div className="min-w-0 rounded-xl border border-amber-900/70 bg-amber-950/10 p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="font-semibold text-white">Цех / партнёр</h3>
              <span className="text-sm text-blue-300">
                {statuses[partner.status] ?? partner.status}
              </span>
            </div>
            <p className="mt-1 break-words text-sm text-slate-300">
              {partner.partnerName ?? "Не назначен"}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <Value
                label="Согласованная стоимость цеха"
                value={
                  partner.priceSet && partner.agreed !== null
                    ? money(partner.agreed)
                    : "Стоимость цеха не указана"
                }
              />
              <Value
                label="Выплачено цеху"
                value={money(partner.paid)}
                tone="text-emerald-300"
              />
              <Value
                label="Осталось выплатить"
                value={money(partner.remaining)}
                tone="text-amber-300"
              />
              {role === "DIRECTOR" && (
                <Value
                  label="Валовая маржа"
                  value={
                    partner.priceSet && partner.agreed !== null && client
                      ? money(client.total - partner.agreed)
                      : "—"
                  }
                  tone="text-cyan-300"
                />
              )}
              {partner.overpayment > 0 && (
                <Value
                  label="Переплата"
                  value={money(partner.overpayment)}
                  tone="text-violet-300"
                />
              )}
            </dl>
          </div>
        )}
        {manager && (
          <EmployeeBlock
            title="Менеджер"
            worker={manager}
            canPay={!readOnly && ["DIRECTOR", "ACCOUNTANT"].includes(role)}
            busy={busy}
            onPay={payAccrual}
          />
        )}
        {measurer && (
          <EmployeeBlock
            title="Замерщик"
            worker={measurer}
            canPay={!readOnly && ["DIRECTOR", "ACCOUNTANT"].includes(role)}
            busy={busy}
            onPay={payAccrual}
          />
        )}
      </div>
      {role === "DIRECTOR" && !readOnly && (
        <form
          onSubmit={assign}
          className="mt-4 grid gap-3 rounded-xl bg-slate-950/50 p-4 sm:grid-cols-2"
        >
          <h3 className="font-semibold text-white sm:col-span-2">
            Указать стоимость цеха
          </h3>
          <label className="grid gap-1 text-sm text-slate-300">
            <span>Партнёр / цех</span>
            <select
              required
              value={partnerId}
              onChange={(event) => setPartnerId(event.target.value)}
              className={control}
            >
              <option value="">Выберите цех</option>
              {partners.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm text-slate-300">
            <span>Согласованная стоимость цеха</span>
            <input
              required
              type="number"
              min="0"
              step="0.01"
              value={agreed}
              onChange={(event) => setAgreed(event.target.value)}
              placeholder="0 ₸"
              className={control}
            />
          </label>
          <label className="grid gap-1 text-sm text-slate-300">
            <span>Дата согласования</span>
            <input
              required
              type="date"
              value={agreedAt}
              onChange={(event) => setAgreedAt(event.target.value)}
              className={control}
            />
          </label>
          <label className="grid gap-1 text-sm text-slate-300">
            <span>Причина изменения / комментарий</span>
            <input
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Согласовано с цехом"
              className={control}
            />
          </label>
          <button
            disabled={busy}
            className="min-h-11 rounded-xl bg-blue-600 px-4 font-semibold text-white disabled:opacity-50 sm:col-span-2"
          >
            Указать стоимость цеха
          </button>
        </form>
      )}
      {role === "DIRECTOR" && !readOnly && manager && (
        <form
          onSubmit={accrueManagerBonus}
          className="mt-4 grid gap-3 rounded-xl bg-slate-950/50 p-4 sm:grid-cols-2"
        >
          <h3 className="font-semibold text-white sm:col-span-2">
            Начислить бонус менеджеру
          </h3>
          {!manager.employeeId ? (
            <p className="text-sm text-amber-300 sm:col-span-2">
              Сначала настройте зарплатный профиль сотрудника в разделе
              «Зарплаты».
            </p>
          ) : !periodId ? (
            <p className="text-sm text-amber-300 sm:col-span-2">
              Откройте текущий расчётный месяц в разделе «Зарплаты».
            </p>
          ) : (
            <>
              <label className="grid gap-1 text-sm text-slate-300">
                <span>Сумма бонуса</span>
                <input
                  required
                  type="number"
                  min="1"
                  step="0.01"
                  value={bonusAmount}
                  onChange={(event) => setBonusAmount(event.target.value)}
                  className={control}
                />
              </label>
              <label className="grid gap-1 text-sm text-slate-300">
                <span>Основание</span>
                <input
                  required
                  value={bonusReason}
                  onChange={(event) => setBonusReason(event.target.value)}
                  placeholder="Бонус за оформленный заказ"
                  className={control}
                />
              </label>
              <button
                disabled={busy}
                className="min-h-11 rounded-xl bg-violet-700 px-4 font-semibold text-white disabled:opacity-50 sm:col-span-2"
              >
                Начислить бонус
              </button>
            </>
          )}
        </form>
      )}
      {partner?.partnerId &&
        partner.priceSet &&
        !readOnly &&
        ["DIRECTOR", "ACCOUNTANT"].includes(role) && (
          <form
            onSubmit={payout}
            className="mt-4 grid gap-3 rounded-xl bg-slate-950/50 p-4 sm:grid-cols-2"
          >
            <h3 className="font-semibold text-white sm:col-span-2">
              Выплатить цеху
            </h3>
            <label className="grid gap-1 text-sm text-slate-300">
              <span>Сумма выплаты</span>
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                max={partner.remaining}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0 ₸"
                className={control}
              />
            </label>
            <label className="grid gap-1 text-sm text-slate-300">
              <span>Дата выплаты</span>
              <input
                required
                type="date"
                value={operationDate}
                onChange={(event) => setOperationDate(event.target.value)}
                className={control}
              />
            </label>
            <label className="grid gap-1 text-sm text-slate-300">
              <span>Способ оплаты</span>
              <select
                value={method}
                onChange={(event) => setMethod(event.target.value)}
                className={control}
              >
                <option value="cash">Наличные</option>
                <option value="kaspi">Kaspi</option>
                <option value="bank_transfer">Банковский перевод</option>
                <option value="other">Другое</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm text-slate-300">
              <span>Комментарий</span>
              <input
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                className={control}
              />
            </label>
            <button
              disabled={
                busy ||
                Number(amount) <= 0 ||
                Number(amount) > partner.remaining
              }
              className="min-h-11 rounded-xl bg-emerald-700 px-4 font-semibold text-white disabled:opacity-50 sm:col-span-2"
            >
              Выплатить цеху
            </button>
          </form>
        )}
      {partner && partner.assignments.length > 0 && (
        <History title="История стоимости цеха">
          {partner.assignments.map((item) => (
            <li
              key={item.id}
              className="rounded-lg bg-slate-950/50 p-3 text-sm text-slate-300"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <strong className="text-white">{money(item.newPayable)}</strong>
                <span>{date(item.createdAt)}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {item.authorName ?? "Система"} · {item.reason}
              </p>
            </li>
          ))}
        </History>
      )}
      {partner && partner.payouts.length > 0 && (
        <History title="История выплат цеху">
          {partner.payouts.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 rounded-lg bg-slate-950/50 p-3 text-sm text-slate-300 sm:flex-row sm:items-center sm:justify-between"
            >
              <span>
                <strong className="text-slate-100">
                  {item.type === "PARTNER_PAYOUT_REVERSAL"
                    ? "Возврат выплаты"
                    : "Выплата"}
                </strong>
                <span className="block text-xs text-slate-500">
                  {date(item.operationDate)} ·{" "}
                  {(methodLabels[item.method] ?? item.method) ||
                    "Способ не указан"}
                  {item.author ? ` · ${item.author}` : ""}
                  {item.comment ? ` · ${item.comment}` : ""}
                </span>
              </span>
              <strong
                className={
                  item.type === "PARTNER_PAYOUT_REVERSAL"
                    ? "text-red-300"
                    : "text-white"
                }
              >
                {item.type === "PARTNER_PAYOUT_REVERSAL" ? "−" : ""}
                {money(item.amount)}
              </strong>
            </li>
          ))}
        </History>
      )}
    </section>
  );
}

function EmployeeBlock({
  title,
  worker,
  canPay,
  busy,
  onPay,
}: {
  title: string;
  worker: EmployeeSettlement;
  canPay: boolean;
  busy: boolean;
  onPay: (
    worker: EmployeeSettlement,
    accrual: EmployeeSettlement["accruals"][number],
  ) => Promise<void>;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-violet-900/70 bg-violet-950/10 p-4">
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <h3 className="font-semibold text-white">{title}</h3>
          <p className="text-sm text-slate-300">
            {worker.name ?? "Не назначен"}
          </p>
        </div>
        <span className="text-sm text-violet-300">
          {statuses[worker.status] ?? worker.status}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <Value label="Начислено" value={money(worker.accrued)} />
        <Value
          label="Выплачено"
          value={money(worker.paid)}
          tone="text-emerald-300"
        />
        <Value
          label="К выплате"
          value={money(worker.remaining)}
          tone="text-amber-300"
        />
      </dl>
      {worker.accruals.length > 0 && (
        <ul className="mt-3 space-y-2">
          {worker.accruals.map((item) => (
            <li
              key={item.id}
              className="rounded-lg bg-slate-950/60 p-3 text-sm"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-slate-300">
                  {payrollStatuses[item.status] ??
                    statuses[item.status] ??
                    item.status}
                </span>
                <b className="text-white">{money(item.amount)}</b>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Выплачено {money(item.paid)} · осталось {money(item.remaining)}
              </p>
              {canPay && item.remaining > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onPay(worker, item)}
                  className="mt-2 min-h-10 rounded-lg bg-violet-700 px-3 font-semibold text-white disabled:opacity-50"
                >
                  Выплатить {money(item.remaining)}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
function Value({
  label,
  value,
  tone = "text-white",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className={`break-words font-semibold ${tone}`}>{value}</dd>
    </div>
  );
}
function History({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <h3 className="font-semibold text-white">{title}</h3>
      <ul className="mt-2 space-y-2">{children}</ul>
    </div>
  );
}
