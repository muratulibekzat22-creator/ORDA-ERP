"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { FormEvent, useEffect, useState } from "react";
import type { EmployeeSettlement, OrderTabData } from "./tabs/types";

const money = (value: number) =>
  `${(Math.abs(value) < 0.005 ? 0 : value).toLocaleString("ru-RU")} ₸`;
const statuses: Record<string, string> = {
  NOT_ASSIGNED: "Не передан в цех",
  COST_MISSING: "Стоимость не указана",
  UNPAID: "Не оплачено",
  PARTIAL: "Частично оплачено",
  PARTIALLY_PAID: "Частично оплачено",
  PAID: "Оплачено",
  OVERPAID: "Переплата",
  OVERDUE: "Просрочено",
  PAYABLE: "Не оплачено",
  NOT_ACCRUED: "Не начислено",
  DISPUTED: "Спорный расчёт",
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
const operationLabels: Record<string, string> = {
  COMPANY_TO_PARTNER: "Выплата цеху",
  CLIENT_TO_PARTNER: "Оплата клиента напрямую цеху",
  PARTNER_TO_COMPANY: "Передача денег от цеха компании",
  PARTNER_REFUND: "Возврат от цеха",
  ADJUSTMENT: "Корректировка начисления",
  REVERSAL: "Сторно операции",
};
const control =
  "min-h-11 min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white";

export default function OrderSettlementPanel({
  order,
  readOnly = false,
}: {
  order: Pick<
    OrderTabData,
    "id" | "number" | "client" | "partner" | "settlement" | "defaultWorkshop"
  >;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const role = session?.user.role ?? "";
  const [partners, setPartners] = useState<
    Array<{ id: number; name: string; active: boolean }>
  >([]);
  const [employees, setEmployees] = useState<
    Array<{ id: number; name: string; position: string; user: { role: string } | null }>
  >([]);
  const [defaultWorkshop, setDefaultWorkshop] = useState(
    order.defaultWorkshop ?? null,
  );
  const [partnerId, setPartnerId] = useState(
    String(order.partner?.id ?? order.defaultWorkshop?.id ?? ""),
  );
  const [agreed, setAgreed] = useState(
    String(order.settlement?.partner?.agreed ?? ""),
  );
  const [agreedAt, setAgreedAt] = useState(today());
  const [workDueAt, setWorkDueAt] = useState("");
  const [paymentDueAt, setPaymentDueAt] = useState("");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [operationDate, setOperationDate] = useState(today());
  const [method, setMethod] = useState("bank_transfer");
  const [account, setAccount] = useState("");
  const [comment, setComment] = useState("");
  const [bonusAmount, setBonusAmount] = useState("");
  const [bonusReason, setBonusReason] = useState("");
  const [accrualKind, setAccrualKind] = useState<
    "manager" | "measurer" | "driver" | "other"
  >("manager");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [assignOpen, setAssignOpen] = useState(
    searchParams.get("action") === "assign-workshop",
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [payoutRequests, setPayoutRequests] = useState<Array<{
    id: number;
    amount: string | number;
    status: string;
    operationDate: Date | string;
    comment: string | null;
  }>>([]);

  useEffect(() => {
    const openHistory = (event: Event) => {
      const detail = (event as CustomEvent<{ orderId?: number }>).detail;
      if (detail?.orderId === order.id) setHistoryOpen(true);
    };
    window.addEventListener("orda:open-partner-history", openHistory);
    return () => window.removeEventListener("orda:open-partner-history", openHistory);
  }, [order.id]);

  useEffect(() => {
    if (!["DIRECTOR", "MANAGER"].includes(role)) return;
    void fetch(`/api/orders/${order.id}/economy`, { cache: "no-store" })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as {
              partners?: unknown;
              employees?: unknown;
              period?: { id: number } | null;
              defaultWorkshop?: { id: number; name: string } | null;
            })
          : null,
      )
      .then((payload) => {
        if (!payload) return;
        const partnerRows = payload.partners;
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
        setPeriodId(payload.period?.id ?? null);
        setEmployees(
          Array.isArray(payload.employees)
            ? payload.employees.filter(
                (item): item is {
                  id: number;
                  name: string;
                  position: string;
                  user: { role: string } | null;
                } => Boolean(item) && typeof item === "object" && "id" in item && "name" in item,
              )
            : [],
        );
        setDefaultWorkshop(payload.defaultWorkshop ?? null);
        if (!order.partner && payload.defaultWorkshop)
          setPartnerId(String(payload.defaultWorkshop.id));
      });
  }, [order.id, order.partner, role]);

  useEffect(() => {
    if (!["DIRECTOR", "MANAGER"].includes(role)) return;
    void fetch(`/api/orders/${order.id}/partner-payout-requests`, { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as typeof payoutRequests : [])
      .then(setPayoutRequests);
  }, [order.id, role]);

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
    const saved = await request(
      `/api/orders/${order.id}`,
      {
        action: "assignPartner",
        partnerId: Number(partnerId),
        partnerPrice: Number(agreed),
        partnerAgreedAt: agreedAt,
        workDueAt: workDueAt || null,
        paymentDueAt: paymentDueAt || null,
        reason,
        directorConfirmed: Boolean(
          order.partner && order.partner.id !== Number(partnerId),
        ),
      },
      "PATCH",
    );
    if (saved) setAssignOpen(false);
  }
  async function payout(event: FormEvent) {
    event.preventDefault();
    await request(role === "MANAGER"
      ? `/api/orders/${order.id}/partner-payout-requests`
      : "/api/partners/payments", {
      orderId: order.id,
      amount: Number(amount),
      operationDate,
      method,
      account,
      comment,
    });
  }
  async function withdrawPayoutRequest(operationId: number) {
    const saved = await request(`/api/orders/${order.id}/partner-payout-requests`, { operationId }, "DELETE");
    if (saved)
      setPayoutRequests((items) => items.map((item) =>
        item.id === operationId ? { ...item, status: "CANCELLED" } : item));
  }
  async function adjustPartner() {
    const effectValue = window.prompt("Корректировка начисления цеху: положительная сумма увеличит начисление, отрицательная уменьшит.");
    if (!effectValue) return;
    const adjustmentEffect = Number(effectValue.replace(",", "."));
    if (!Number.isFinite(adjustmentEffect) || adjustmentEffect === 0) return setError("Укажите ненулевую сумму корректировки");
    const adjustmentComment = window.prompt("Обязательное основание корректировки");
    if (!adjustmentComment?.trim() || !partner?.history?.relationId) return setError("Укажите основание корректировки");
    await request("/api/partner-management", {
      action: "operation",
      relationId: partner.history.relationId,
      type: "ADJUSTMENT",
      amount: Math.abs(adjustmentEffect),
      adjustmentEffect,
      operationDate: new Date().toISOString(),
      comment: adjustmentComment,
    });
  }
  async function reverseOperation(operationId: number) {
    const reversalReason = window.prompt("Обязательная причина сторно");
    if (!reversalReason?.trim()) return;
    await request("/api/partner-management", {
      action: "reverse-operation",
      operationId,
      reason: reversalReason,
    });
  }
  async function accrueOrderPayroll(event: FormEvent) {
    event.preventDefault();
    const employeeId = accrualKind === "manager"
      ? order.settlement?.manager?.employeeId
      : accrualKind === "measurer"
        ? order.settlement?.measurer?.employeeId
        : Number(selectedEmployeeId);
    if (!employeeId || !periodId) return;
    await request(`/api/orders/${order.id}/payroll-bonuses`, {
      employeeId,
      periodId,
      type: accrualKind === "manager" ? "ORDER_BONUS" : "EXTRA_BONUS",
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
      {["DIRECTOR", "MANAGER"].includes(role) && !readOnly && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              if (!order.partner && defaultWorkshop)
                setPartnerId(String(defaultWorkshop.id));
              setAssignOpen(true);
            }}
            className="min-h-11 rounded-xl bg-amber-300 px-4 font-semibold text-slate-950"
          >
            {order.partner
              ? partner?.priceSet
                ? "Изменить цех или стоимость"
                : "Указать стоимость цеха"
              : defaultWorkshop
                ? `Передать в основной цех — ${defaultWorkshop.name}`
                : "Назначить цех"}
          </button>
          {!order.partner && defaultWorkshop && (
            <button
              type="button"
              onClick={() => {
                setPartnerId("");
                setAssignOpen(true);
              }}
              className="min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-4 font-semibold text-white"
            >
              Выбрать другой цех
            </button>
          )}
        </div>
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
            {role === "DIRECTOR" && partner.history && (
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => setHistoryOpen(true)} className="min-h-10 rounded-lg bg-amber-700 px-3 text-sm font-semibold text-white">История и полный расчёт</button>
                <button type="button" onClick={() => void adjustPartner()} className="min-h-10 rounded-lg border border-amber-600/50 px-3 text-sm font-semibold text-amber-100">Корректировка</button>
              </div>
            )}
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
      {role === "DIRECTOR" && partner?.history && historyOpen && (
        <div role="presentation" className="fixed inset-0 z-50 bg-black/70" onMouseDown={(event) => { if (event.currentTarget === event.target) setHistoryOpen(false); }}>
          <aside role="dialog" aria-modal="true" aria-label="История и полный расчёт цеха" className="absolute inset-y-0 right-0 w-full max-w-2xl overflow-y-auto border-l border-slate-700 bg-[#101827] p-5 shadow-2xl sm:p-7">
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-lg font-semibold text-white">История и полный расчёт</h3><p className="mt-1 text-sm text-slate-400">{order.number} · {partner.partnerName ?? "Цех не назначен"}</p></div>
              <button type="button" onClick={() => setHistoryOpen(false)} className="min-h-10 rounded-lg border border-slate-700 px-3 text-sm text-white">Закрыть</button>
            </div>
            <dl className="mt-5 grid gap-3 rounded-xl bg-slate-950/60 p-4 text-sm sm:grid-cols-2">
              <Value label="Стоимость цеха" value={partner.agreed === null ? "Не указана" : money(partner.agreed)} />
              <Value label="Остаток" value={money(partner.remaining)} tone="text-amber-300" />
              <Value label="Передан" value={date(partner.history.startsAt)} />
              <Value label="Готовность" value={date(partner.history.workDueAt)} />
              <Value label="Срок выплаты" value={date(partner.history.paymentDueAt)} />
              <Value label="Создал" value={partner.history.createdBy ?? "Система"} />
              {partner.history.comment && <div className="sm:col-span-2"><dt className="text-slate-500">Комментарий</dt><dd className="break-words text-white">{partner.history.comment}</dd></div>}
            </dl>
            <History title="Операции, выплаты, возвраты и сторно">
              {partner.history.operations.length ? partner.history.operations.map((item) => (
                <li key={item.id} className="rounded-xl bg-slate-950/60 p-3 text-sm text-slate-300">
                  <div className="flex flex-wrap items-start justify-between gap-2"><div><strong className="text-white">{operationLabels[item.type] ?? item.type}</strong><p className="text-xs text-slate-500">{date(item.operationDate)} · {item.method ? (methodLabels[item.method] ?? item.method) : "Способ не указан"}{item.account ? ` · ${item.account}` : ""}{item.author ? ` · ${item.author}` : ""}</p></div><strong>{money(item.amount)}</strong></div>
                  {item.adjustmentEffect !== 0 && <p className="mt-1 text-amber-200">Корректировка: {money(item.adjustmentEffect)}</p>}
                  {item.comment && <p className="mt-1 break-words text-xs text-slate-400">{item.comment}</p>}
                  {item.status === "POSTED" && item.type !== "REVERSAL" && !item.reversalOfId && !item.reversalId && <button type="button" disabled={busy} onClick={() => void reverseOperation(item.id)} className="mt-2 min-h-9 rounded-lg border border-rose-700 px-3 text-xs font-semibold text-rose-200">Сторно</button>}
                </li>
              )) : <li className="rounded-xl bg-slate-950/50 p-3 text-sm text-slate-400">Операций пока нет.</li>}
            </History>
            <History title="Audit log">
              {partner.history.audit.length ? partner.history.audit.map((item) => <li key={item.id} className="rounded-xl bg-slate-950/50 p-3 text-sm text-slate-300"><div className="flex flex-wrap justify-between gap-2"><strong className="text-white">{item.action}</strong><span>{date(item.createdAt)}</span></div><p className="mt-1 text-xs text-slate-500">{item.actor ?? "Система"}{item.comment ? ` · ${item.comment}` : ""}</p></li>) : <li className="rounded-xl bg-slate-950/50 p-3 text-sm text-slate-400">Событий пока нет.</li>}
            </History>
          </aside>
        </div>
      )}
      {["DIRECTOR", "MANAGER"].includes(role) && !readOnly && assignOpen && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 bg-black/70"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setAssignOpen(false);
          }}
        >
        <form
          aria-label="Передать заказ в цех"
          onSubmit={assign}
          className="absolute inset-y-0 right-0 grid w-full max-w-xl content-start gap-3 overflow-y-auto border-l border-slate-700 bg-[#101827] p-5 shadow-2xl sm:grid-cols-2 sm:p-7"
        >
          <h3 className="font-semibold text-white sm:col-span-2">
            {order.partner ? "Изменить цех" : "Передать заказ в цех"}
          </h3>
          <div className="rounded-xl bg-slate-950/60 p-3 text-sm sm:col-span-2">
            <p className="text-slate-400">Заказ</p>
            <p className="font-semibold text-white">{order.number}</p>
            <p className="mt-2 text-slate-400">Клиент</p>
            <p className="font-semibold text-white">{order.client.name}</p>
            {defaultWorkshop && (
              <p className="mt-2 text-amber-200">
                Основной цех: {defaultWorkshop.name}
              </p>
            )}
          </div>
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
              min="0.01"
              step="0.01"
              value={agreed}
              onChange={(event) => setAgreed(event.target.value)}
              placeholder="0 ₸"
              className={control}
            />
          </label>
          <label className="grid gap-1 text-sm text-slate-300">
            <span>Срок готовности</span>
            <input
              type="date"
              value={workDueAt}
              onChange={(event) => setWorkDueAt(event.target.value)}
              className={control}
            />
          </label>
          <label className="grid gap-1 text-sm text-slate-300">
            <span>Срок выплаты</span>
            <input
              type="date"
              value={paymentDueAt}
              onChange={(event) => setPaymentDueAt(event.target.value)}
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
          <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row">
            <button
              disabled={busy}
              className="min-h-11 flex-1 rounded-xl bg-blue-600 px-4 font-semibold text-white disabled:opacity-50"
            >
              {order.partner ? "Сохранить без выплаты" : "Передать в цех"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setAssignOpen(false)}
              className="min-h-11 rounded-xl border border-slate-700 px-4 font-semibold text-white"
            >
              Отмена
            </button>
          </div>
        </form>
        </div>
      )}
      {["DIRECTOR", "MANAGER"].includes(role) && !readOnly && (
        <form
          onSubmit={accrueOrderPayroll}
          className="mt-4 grid gap-3 rounded-xl bg-slate-950/50 p-4 sm:grid-cols-2"
        >
          <h3 className="font-semibold text-white sm:col-span-2">
            Начисления сотрудникам по заказу
          </h3>
          {role === "DIRECTOR" && <label className="grid gap-1 text-sm text-slate-300 sm:col-span-2">
            <span>Вид начисления</span>
            <select value={accrualKind} onChange={(event) => setAccrualKind(event.target.value as typeof accrualKind)} className={control}>
              <option value="manager">Бонус менеджера</option>
              <option value="measurer">Замерщик</option>
              <option value="driver">Водитель</option>
              <option value="other">Другое начисление</option>
            </select>
          </label>}
          {!periodId ? (
            <p className="text-sm text-amber-300 sm:col-span-2">
              Откройте текущий расчётный месяц в разделе «Зарплаты».
            </p>
          ) : accrualKind === "manager" && !manager?.employeeId ? (
            <p className="text-sm text-amber-300 sm:col-span-2">
              Для менеджера заказа не настроен активный зарплатный профиль.
            </p>
          ) : accrualKind === "measurer" && !measurer?.employeeId ? (
            <p className="text-sm text-amber-300 sm:col-span-2">
              В заказе нет завершённого замера с зарплатным профилем замерщика.
            </p>
          ) : (
            <>
              {role === "DIRECTOR" && (accrualKind === "driver" || accrualKind === "other") && (
                <label className="grid gap-1 text-sm text-slate-300">
                  <span>Реальный сотрудник</span>
                  <select required value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)} className={control}>
                    <option value="">Выберите сотрудника</option>
                    {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}{employee.position ? ` · ${employee.position}` : ""}</option>)}
                  </select>
                </label>
              )}
              <label className="grid gap-1 text-sm text-slate-300">
                <span>Сумма начисления</span>
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
                  placeholder="Основание начисления по заказу"
                  className={control}
                />
              </label>
              <button
                disabled={busy}
                className="min-h-11 rounded-xl bg-violet-700 px-4 font-semibold text-white disabled:opacity-50 sm:col-span-2"
              >
                {accrualKind === "manager" ? "Начислить бонус менеджеру" : "Создать начисление без выплаты"}
              </button>
              <p className="text-xs text-slate-500 sm:col-span-2">Начисление влияет на прибыль заказа, но не создаёт расход денег до фактической выплаты через Payroll.</p>
            </>
          )}
        </form>
      )}
      {partner?.partnerId &&
        partner.priceSet &&
        !readOnly &&
        ["DIRECTOR", "MANAGER"].includes(role) && (
          <form
            onSubmit={payout}
            className="mt-4 grid gap-3 rounded-xl bg-slate-950/50 p-4 sm:grid-cols-2"
          >
            <h3 className="font-semibold text-white sm:col-span-2">
              {role === "MANAGER" ? "Сообщить об оплате цеху" : "Выплатить цеху"}
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
              <span>Касса или банковский счёт</span>
              <input required value={account} onChange={(event) => setAccount(event.target.value)} placeholder="Касса / расчётный счёт" className={control} />
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
              {role === "MANAGER" ? "Отправить директору на подтверждение" : "Выплатить указанную сумму"}
            </button>
            <button
              type="button"
              disabled={busy || partner.remaining <= 0}
              onClick={() => setAmount(String(partner.remaining))}
              className="min-h-11 rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-4 font-semibold text-emerald-200 disabled:opacity-50 sm:col-span-2"
            >
              Оплатить весь остаток
            </button>
          </form>
        )}
      {payoutRequests.length > 0 && (
        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/50 p-4">
          <h3 className="font-semibold text-white">Заявки на оплату цеху</h3>
          <div className="mt-3 space-y-2">
            {payoutRequests.map((item) => (
              <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-900 p-3 text-sm">
                <div>
                  <p className="font-semibold text-white">{money(Number(item.amount))}</p>
                  <p className="text-slate-400">{date(item.operationDate)} · {item.status === "PENDING" ? "Ожидает подтверждения директора" : item.status === "REJECTED" ? "Отклонено" : item.status === "CANCELLED" ? "Отозвано" : item.status}</p>
                  {item.comment && <p className="text-xs text-slate-500">{item.comment}</p>}
                </div>
                {role === "MANAGER" && item.status === "PENDING" && (
                  <button type="button" disabled={busy} onClick={() => void withdrawPayoutRequest(item.id)} className="min-h-10 rounded-lg border border-rose-700 px-3 font-semibold text-rose-200">Отозвать заявку</button>
                )}
              </article>
            ))}
          </div>
        </div>
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
