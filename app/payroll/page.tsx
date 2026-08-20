"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  History,
  Plus,
  Receipt,
  UserRound,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Accrual = {
  id: number;
  type: string;
  amount: string;
  direction: "INCREASE" | "DECREASE";
  reason: string;
  orderId?: number | null;
  createdAt: string;
  reversalOfId?: number | null;
  reversedBy?: { id: number } | null;
};
type Payment = {
  id: number;
  type: string;
  amount: string;
  paymentDate: string;
  method?: string | null;
  comment?: string | null;
  paidBy?: { id: number; name: string } | null;
  reversalOfId?: number | null;
  reversalOf?: { id: number; type: string } | null;
  reversedAt?: string | null;
  reversal?: { id: number } | null;
};
type Confirmation = {
  id: number;
  amount: string;
  type: string;
  claimedPaymentDate: string;
  method?: string | null;
  comment?: string | null;
  status: "PENDING" | "CONFIRMED" | "REJECTED";
  reviewComment?: string | null;
  confirmedPaymentId?: number | null;
  createdBy?: { id: number; name: string } | null;
  reviewedBy?: { id: number; name: string } | null;
  createdAt: string;
};
type Advance = {
  id: number;
  status: string;
  requestedAmount: string;
  approvedAmount?: string | null;
  method?: string | null;
  comment?: string | null;
  reviewedBy?: { id: number; name: string } | null;
  payment?: { id: number; method?: string | null; paymentDate: string } | null;
  createdAt: string;
};
type PayrollRow = {
  id: number;
  userId: number | null;
  position: string;
  hasOrdaAccess: boolean;
  baseSalary: string;
  defaultGuaranteedBonus: string;
  user: { id: number; name: string; role: string; active: boolean };
  salaryRates: Array<{
    id: number;
    amount: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
    comment?: string | null;
    approvedBy?: { id: number; name: string };
  }>;
  currentSalary: number;
  salaryEffectiveFrom: string;
  plannedDays: number;
  workedDays: number;
  calculatedSalary: number;
  accruals: Accrual[];
  payments: Payment[];
  paymentConfirmations: Confirmation[];
  advanceRequests: Advance[];
  totals: { accrued: number; paid: number; received: number; deductions: number; pending: number; payable: number };
  breakdown: { salaryAccrued: number; bonusesAccrued: number; premiumsAccrued: number; otherAccruals: number; advancesPaid: number; partialPayments: number; finalPayments: number; salaryPayments: number; deductions: number; totalAccrued: number; totalPaid: number; payable: number };
  bonusAccruals: Array<{ id: number; orderId?: number | null; measurementId?: number | null; type: string; amount: number; rule: "FIXED" | "PAID_PERCENT" | "PROFIT_PERCENT"; ruleValue: number; basisAmount: number; order: { id: number; number: string; amount: number; paid: number; profit: number; client: { id: number; name: string }; contract: { id: number; number: string } | null } | null; approvedBy?: { id: number; name: string } | null; accruedAt: string; paid: number; payable: number; status: "ACCRUED" | "PARTIALLY_PAID" | "PAID" }>;
};
type Payload = {
  period: { id: number; year: number; month: number; status: string } | null;
  rows: PayrollRow[];
  totals: { accrued: number; paid: number; received: number; deductions: number; pending: number; payable: number };
  breakdown: { salaryAccrued: number; bonusesAccrued: number; premiumsAccrued: number; otherAccruals: number; advancesPaid: number; partialPayments: number; finalPayments: number; salaryPayments: number; deductions: number; totalAccrued: number; totalPaid: number; payable: number };
  settings: { paydayDayOfMonth: number };
  unconfigured?: Array<{ id: number; name: string; role: string }>;
};
type Operation =
  "salary" | "salaryAccrual" | "allowance" | "bonus" | "premium" | "deduction" | "payment" | "reversal";
type Form = {
  amount: string;
  reason: string;
  date: string;
  orderId: string;
  type: string;
  accrualId: string;
  method: string;
  bonusRule: "FIXED" | "PAID_PERCENT" | "PROFIT_PERCENT";
};

const months = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];
const roleNames: Record<string, string> = {
  DIRECTOR: "Директор",
  MANAGER: "Менеджер",
  ACCOUNTANT: "Бухгалтер",
  MEASURER: "Замерщик",
  DESIGNER: "Конструктор",
  PRODUCTION: "Производство",
  INSTALLER: "Монтажник",
};
const labels: Record<string, string> = {
  BASE_SALARY: "Оклад",
  GUARANTEED_ORDER_BONUS: "Гарантированный бонус",
  ORDER_BONUS: "Бонус за заказ",
  MEASUREMENT_BONUS: "Бонус за замер",
  EXTRA_BONUS: "Бонус",
  PREMIUM: "Премия",
  DEDUCTION: "Удержание",
  ADJUSTMENT_INCREASE: "Корректировка",
  ADJUSTMENT_DECREASE: "Корректировка",
  BONUS_REVERSAL: "Сторно",
  ADVANCE: "Аванс",
  IMMEDIATE_BONUS: "Выплата бонуса",
  SALARY_PAYMENT: "Выплата зарплаты",
  GUARANTEED_BONUS_PAYMENT: "Гарантированный бонус",
  ORDER_BONUS_PAYMENT: "Бонус за заказ",
  PREMIUM_PAYMENT: "Премия",
  FINAL_SETTLEMENT: "Окончательный расчёт",
  OTHER_PAYROLL_PAYMENT: "Другая выплата",
  EMPLOYEE_REFUND: "Возврат сотрудника",
  REQUESTED: "Ожидает решения",
  APPROVED: "Одобрен",
  REJECTED: "Отклонён",
  PAID: "Выплачен",
  PENDING: "Ожидает подтверждения директора",
  CONFIRMED: "Подтверждено директором",
  OPEN: "Открыт",
  REVIEW: "На проверке",
  CLOSED: "Закрыт",
};
const methodLabels: Record<string, string> = {
  cash: "Наличные",
  kaspi: "Kaspi",
  bank_transfer: "Банковский перевод",
  other: "Другое",
};
const currency = (value: number | string) =>
  `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₸`;
const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString("ru-RU");
const employeePosition = (row: PayrollRow) =>
  row.position || roleNames[row.user.role] || row.user.role || "Сотрудник";
const errorLabels: Record<string, string> = {
  FORBIDDEN: "Недостаточно прав для этой операции",
  PERIOD_CLOSED: "Закрытый месяц нельзя изменять",
  PERIOD_NOT_OPEN: "Период находится на проверке. Верните его в работу для изменений",
  REASON_REQUIRED: "Укажите обязательную причину",
  INVALID_PERIOD_TRANSITION: "Этот переход статуса периода недоступен",
  INVALID_AMOUNT: "Введите сумму больше нуля",
  EMPLOYEE_NOT_FOUND: "Сотрудник не найден",
  ORDER_REQUIRED: "Для бонуса за заказ укажите заказ",
  ORDER_NOT_FOUND: "Заказ не найден",
  ORDER_MANAGER_MISMATCH: "Заказ закреплён за другим сотрудником",
  INVALID_BONUS_VALUE: "Укажите корректное правило и значение бонуса",
  INVALID_BONUS_PERCENT: "Процент бонуса должен быть от 0 до 100",
  INVALID_ACTION: "Операция не поддерживается",
};
const emptyForm = (): Form => ({
  amount: "",
  reason: "",
  date: new Date().toISOString().slice(0, 10),
  orderId: "",
  type: "SALARY_PAYMENT",
  accrualId: "",
  method: "bank_transfer",
  bonusRule: "FIXED",
});

export default function PayrollPage() {
  const { data: session, status: sessionStatus } = useSession();
  const now = new Date();
  const [selected, setSelected] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });
  const [data, setData] = useState<Payload>({
    period: null,
    rows: [],
    totals: { accrued: 0, paid: 0, received: 0, deductions: 0, pending: 0, payable: 0 },
    breakdown: { salaryAccrued: 0, bonusesAccrued: 0, premiumsAccrued: 0, otherAccruals: 0, advancesPaid: 0, partialPayments: 0, finalPayments: 0, salaryPayments: 0, deductions: 0, totalAccrued: 0, totalPaid: 0, payable: 0 },
    settings: { paydayDayOfMonth: 1 },
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [details, setDetails] = useState<PayrollRow | null>(null),
    [operation, setOperation] = useState<Operation | null>(null),
    [target, setTarget] = useState<PayrollRow | null>(null);
  const [form, setForm] = useState<Form>(emptyForm),
    [advanceAmount, setAdvanceAmount] = useState(""),
    [advanceMethod, setAdvanceMethod] = useState("bank_transfer"),
    [advanceComment, setAdvanceComment] = useState("");
  const [receipt, setReceipt] = useState({
    amount: "",
    type: "SALARY_PAYMENT",
    paymentDate: new Date().toISOString().slice(0, 10),
    method: "bank_transfer",
    comment: "",
  });
  const role = session?.user.role ?? "",
    director = role === "DIRECTOR",
    accountant = role === "ACCOUNTANT",
    adminView = director || accountant,
    closed = data.period?.status === "CLOSED",
    locked = Boolean(data.period && data.period.status !== "OPEN");

  const load = useCallback(async () => {
    if (sessionStatus !== "authenticated") return;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({
      year: String(selected.year),
      month: String(selected.month),
    });
    const response = await fetch(
        `${adminView ? "/api/payroll" : "/api/payroll/self"}?${query}`,
      ),
      body = await response.json().catch(() => ({}));
    if (!response.ok)
      setError(errorLabels[body.error] ?? "Не удалось загрузить зарплату");
    else setData(body as Payload);
    setLoading(false);
  }, [adminView, selected.month, selected.year, sessionStatus]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const changeMonth = (step: number) =>
    setSelected((value) => {
      const date = new Date(value.year, value.month - 1 + step, 1);
      return { year: date.getFullYear(), month: date.getMonth() + 1 };
    });
  const run = async (
    body: Record<string, unknown>,
    success = "Операция выполнена",
  ) => {
    setError("");
    setNotice("");
    const response = await fetch("/api/payroll", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      }),
      result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(errorLabels[result.error] ?? "Не удалось выполнить операцию");
      return false;
    }
    setNotice(success);
    await load();
    return true;
  };
  const openOperation = (next: Operation, row?: PayrollRow) => {
    const employee = row ?? details ?? data.rows[0] ?? null;
    setOperation(next);
    setTarget(employee);
    setForm(next === "salaryAccrual" && employee
      ? { ...emptyForm(), amount: String(employee.currentSalary), reason: "Оклад за расчётный период" }
      : emptyForm());
  };
  const submitOperation = async () => {
    if (!target || !operation || !data.period) return;
    const amount = Number(form.amount);
    let body: Record<string, unknown>;
    if (operation === "salary")
      body = {
        action: "salary",
        employeeId: target.id,
        amount,
        effectiveFrom: form.date,
        comment: form.reason,
      };
    else if (operation === "allowance")
      body = {
        action: "allowance",
        employeeId: target.id,
        amount,
        comment: form.reason,
      };
    else if (operation === "payment")
      body = {
        action: "payment",
        employeeId: target.id,
        periodId: data.period.id,
        amount,
        type: form.type,
        paymentDate: form.date,
        method: form.method,
        comment: form.reason,
        relatedAccrualId: form.accrualId ? Number(form.accrualId) : undefined,
      };
    else if (operation === "reversal")
      body = {
        action: "reverse-accrual",
        id: Number(form.accrualId),
        periodId: data.period.id,
        reason: form.reason,
      };
    else
      body = {
        action: "accrual",
        employeeId: target.id,
        periodId: data.period.id,
        amount,
        reason:
          form.reason ||
          labels[
            operation === "salaryAccrual"
              ? "BASE_SALARY"
              : operation === "premium"
              ? "PREMIUM"
              : operation === "deduction"
                ? "DEDUCTION"
                : "EXTRA_BONUS"
          ],
        type:
          operation === "salaryAccrual"
            ? "BASE_SALARY"
            : operation === "premium"
            ? "PREMIUM"
            : operation === "deduction"
              ? "DEDUCTION"
              : form.orderId
                ? "ORDER_BONUS"
                : "EXTRA_BONUS",
        orderId: form.orderId ? Number(form.orderId) : undefined,
        bonusRule:
          operation === "bonus" && form.orderId ? form.bonusRule : undefined,
        bonusValue:
          operation === "bonus" && form.orderId ? amount : undefined,
      };
    if (await run(body)) {
      setOperation(null);
      setDetails(null);
    }
  };
  const transitionPeriod = async (status: "OPEN" | "REVIEW" | "CLOSED") => {
    if (!data.period) return;
    let reason = "";
    if (data.period.status === "CLOSED" && status === "OPEN") {
      reason = window.prompt("Причина повторного открытия месяца (обязательно)", "Исправление начисления сотрудника")?.trim() ?? "";
      if (!reason) return setError("Укажите причину повторного открытия");
    } else if (status === "CLOSED" && !window.confirm(`Закрыть ${months[selected.month - 1].toLowerCase()}?`)) return;
    await run(
      { action: "transition-period", periodId: data.period.id, status, reason },
      status === "REVIEW" ? "Месяц отправлен на проверку" : status === "CLOSED" ? "Месяц закрыт" : "Месяц открыт для изменений",
    );
  };
  const reviewAdvance = (item: Advance, decision: "APPROVED" | "REJECTED") =>
    run(
      {
        action: "review-advance",
        id: item.id,
        status: decision,
      },
      decision === "APPROVED"
        ? "Аванс подтверждён, выплата и финансовая операция созданы"
        : "Запрос отклонён",
    );
  const payAdvance = (item: Advance) =>
    run(
      { action: "pay-advance", id: item.id },
      "Выплата аванса зарегистрирована",
    );
  const reviewConfirmation = async (
    item: Confirmation,
    decision: "CONFIRM" | "REJECT",
  ) => {
    const comment = decision === "REJECT"
      ? window.prompt("Причина отклонения", "Выплата не подтверждена")?.trim()
      : item.comment ?? "";
    if (decision === "REJECT" && !comment) return;
    await run(
      {
        action: "review-payment-confirmation",
        id: item.id,
        decision,
        comment,
      },
      decision === "CONFIRM" ? "Выплата подтверждена" : "Сообщение отклонено",
    );
  };
  const reversePayrollPayment = async (item: Payment) => {
    const reason = window.prompt("Обязательная причина сторно")?.trim();
    if (!reason) return;
    await run({ action: "reverse-payment", id: item.id, reason }, "Выплата сторнирована");
  };
  const reportReceipt = async () => {
    if (!data.period || Number(receipt.amount) <= 0) return;
    setError("");
    const response = await fetch("/api/payroll/self", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ action: "report-payment", periodId: data.period.id, ...receipt, amount: Number(receipt.amount) }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) setError(errorLabels[result.error] ?? "Не удалось сообщить о получении");
    else {
      setReceipt((value) => ({ ...value, amount: "", comment: "" }));
      setNotice("Сообщение отправлено директору. Выплата пока не подтверждена.");
      await load();
    }
  };
  const requestAdvance = async () => {
    if (!data.period || Number(advanceAmount) <= 0) return;
    const response = await fetch("/api/payroll/self", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          periodId: data.period.id,
          amount: Number(advanceAmount),
          method: advanceMethod,
          comment: advanceComment,
        }),
      }),
      result = await response.json().catch(() => ({}));
    if (!response.ok)
      setError(errorLabels[result.error] ?? "Не удалось отправить запрос");
    else {
      setAdvanceAmount("");
      setAdvanceComment("");
      setNotice("Запрос на аванс отправлен");
      await load();
    }
  };
  const configureEmployee = async (user: { id: number; name: string }) => {
    const value = window.prompt(`Укажите оклад для ${user.name}`, "0");
    if (value === null) return;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0)
      return setError("Некорректный оклад");
    await run(
      {
        action: "profile",
        userId: user.id,
        hiredAt: new Date().toISOString(),
        baseSalary: amount,
      },
      "Зарплатный профиль настроен",
    );
  };
  const pending = useMemo(
    () =>
      data.rows.flatMap((row) =>
        row.advanceRequests
          .filter(
            (item) => item.status === "REQUESTED" || item.status === "APPROVED",
          )
          .map((item) => ({ row, item })),
      ),
    [data.rows],
  );
  const pendingConfirmations = useMemo(
    () => data.rows.flatMap((row) => row.paymentConfirmations.filter((item) => item.status === "PENDING").map((item) => ({ row, item }))),
    [data.rows],
  );
  const stats: Array<[string, number, LucideIcon, string]> = [
    ["Оклад", data.breakdown.salaryAccrued, CircleDollarSign, "text-blue-300"],
    ["Бонусы", data.breakdown.bonusesAccrued, Receipt, "text-cyan-300"],
    ["Премии", data.breakdown.premiumsAccrued, Receipt, "text-violet-300"],
    ["Другие начисления", data.breakdown.otherAccruals, Plus, "text-slate-300"],
    ["Всего начислено", data.breakdown.totalAccrued, CircleDollarSign, "text-white"],
    ["Авансы", data.breakdown.advancesPaid, Check, "text-orange-300"],
    ["Выплачено", data.breakdown.salaryPayments, Check, "text-emerald-300"],
    ["Всего получено", data.breakdown.totalPaid, Banknote, "text-emerald-300"],
    ["Удержания", data.breakdown.deductions, Receipt, "text-red-300"],
    ["К выплате", data.breakdown.payable, Banknote, "text-amber-300"],
  ];

  if (sessionStatus === "loading")
    return <div className="p-8 text-slate-400">Загрузка…</div>;
  return (
    <main className="min-h-full bg-slate-950 p-4 text-white md:p-6 xl:p-8">
      <div className="mx-auto max-w-[1500px]">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-sm font-medium text-blue-400">
              Финансы · Payroll
            </p>
            <h1 className="mt-1 text-2xl font-bold md:text-3xl">
              {adminView ? "Зарплаты" : "Моя зарплата"}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Начисления, выплаты и остаток без смешивания денежных событий.
            </p>
            <p className="mt-1 text-sm text-blue-300">Плановый день выплаты: {data.settings.paydayDayOfMonth}-е число. Расчётный месяц и фактическая дата выплаты учитываются отдельно.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => changeMonth(-1)}
              aria-label="Предыдущий месяц"
              className="grid size-11 place-items-center rounded-xl border border-slate-700 bg-slate-900"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4">
              <CalendarDays size={18} className="text-blue-400" />
              <b>
                {months[selected.month - 1]} {selected.year}
              </b>
            </div>
            <button
              onClick={() => changeMonth(1)}
              aria-label="Следующий месяц"
              className="grid size-11 place-items-center rounded-xl border border-slate-700 bg-slate-900"
            >
              <ArrowRight size={18} />
            </button>
            {data.period && (
              <span
                className={`rounded-full px-3 py-2 text-sm font-semibold ${closed ? "bg-slate-700" : data.period.status === "REVIEW" ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"}`}
              >
                {labels[data.period.status]}
              </span>
            )}
            {director && !data.period && (
              <button
                onClick={() =>
                  void run(
                    { action: "create-period", ...selected },
                    "Месяц открыт",
                  )
                }
                className="min-h-11 rounded-xl bg-blue-600 px-4 font-semibold"
              >
                Открыть месяц
              </button>
            )}
            {director && data.period?.status === "OPEN" && (
              <button
                onClick={() => void transitionPeriod("REVIEW")}
                className="min-h-11 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 font-semibold text-amber-200"
              >
                На проверку
              </button>
            )}
            {director && data.period?.status === "REVIEW" && <><button onClick={() => void transitionPeriod("OPEN")} className="min-h-11 rounded-xl border border-slate-600 px-4 font-semibold">Вернуть в работу</button><button onClick={() => void transitionPeriod("CLOSED")} className="min-h-11 rounded-xl border border-red-500/40 bg-red-500/10 px-4 font-semibold text-red-300">Закрыть месяц</button></>}
            {director && data.period?.status === "CLOSED" && <button onClick={() => void transitionPeriod("OPEN")} className="min-h-11 rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 font-semibold text-blue-200">Открыть месяц снова</button>}
            {adminView && data.period && !locked && (
              <button
                onClick={() => openOperation("payment")}
                disabled={!data.rows.length}
                className="flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 font-semibold disabled:opacity-40"
              >
                <Plus size={18} /> Выплатить
              </button>
            )}
          </div>
        </header>
        {(error || notice) && (
          <div
            role={error ? "alert" : "status"}
            className={`mt-4 flex items-center justify-between rounded-xl border p-3 text-sm ${error ? "border-red-500/40 bg-red-500/10 text-red-200" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"}`}
          >
            <span>{error || notice}</span>
            <button
              aria-label="Закрыть сообщение"
              onClick={() => {
                setError("");
                setNotice("");
              }}
            >
              <X size={18} />
            </button>
          </div>
        )}
        <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {stats.map(([label, value, Icon, color]) => (
            <article
              key={label}
              className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/70 p-4"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400 sm:text-sm">{label}</p>
                <Icon className={color} size={18} />
              </div>
              <p className={`mt-2 text-lg font-bold sm:text-xl ${color}`}>
                {currency(value)}
              </p>
            </article>
          ))}
        </section>
        {adminView && pendingConfirmations.length > 0 && (
          <section className="mt-5 rounded-2xl border border-orange-500/30 bg-orange-500/5 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Clock3 size={19} className="text-orange-300" />
              <h2 className="font-semibold">Требуют подтверждения</h2>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {pendingConfirmations.map(({ row, item }) => (
                <article key={item.id} className="min-w-0 rounded-xl bg-slate-900 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><b>{row.user.name}</b><p className="text-sm text-slate-400">{labels[item.type] ?? item.type}</p></div>
                    <strong className="text-orange-200">{currency(item.amount)}</strong>
                  </div>
                  <p className="mt-2 break-words text-sm text-slate-400">{dateLabel(item.claimedPaymentDate)}{item.comment ? ` · ${item.comment}` : ""}</p>
                  {!locked && <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <button onClick={() => void reviewConfirmation(item, "CONFIRM")} className="min-h-11 rounded-lg bg-emerald-700 px-3 text-sm font-semibold">Подтвердить выплату</button>
                    <button onClick={() => void reviewConfirmation(item, "REJECT")} className="min-h-11 rounded-lg bg-red-900 px-3 text-sm font-semibold">Отклонить</button>
                  </div>}
                </article>
              ))}
            </div>
          </section>
        )}
        {adminView && pending.length > 0 && (
          <section className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Clock3 size={19} className="text-amber-300" />
              <h2 className="font-semibold">Запросы на аванс</h2>
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              {pending.map(({ row, item }) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-xl bg-slate-900 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <b>{row.user.name}</b>
                    <p className="text-sm text-slate-400">
                      {currency(item.requestedAmount)} · {labels[item.status]}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {adminView && !locked && item.status === "REQUESTED" && (
                      <>
                        <button
                          onClick={() => void reviewAdvance(item, "APPROVED")}
                          className="rounded-lg bg-emerald-700 px-3 py-2 text-sm"
                        >
                          Одобрить
                        </button>
                        <button
                          onClick={() => void reviewAdvance(item, "REJECTED")}
                          className="rounded-lg bg-red-900 px-3 py-2 text-sm"
                        >
                          Отклонить
                        </button>
                      </>
                    )}
                    {adminView && !locked && item.status === "APPROVED" && (
                      <button
                        onClick={() => void payAdvance(item)}
                        className="rounded-lg bg-blue-600 px-3 py-2 text-sm"
                      >
                        Зарегистрировать выплату
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        {!adminView && data.period && !locked && (
          <section className="mt-5 rounded-2xl border border-orange-500/30 bg-orange-500/5 p-4">
            <h2 className="font-semibold">Сообщить о получении</h2>
            <p className="mt-1 text-sm text-slate-400">Это создаст запрос со статусом «Ожидает подтверждения директора», а не финансовую выплату.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <input type="number" min="1" inputMode="decimal" value={receipt.amount} onChange={(e) => setReceipt({ ...receipt, amount: e.target.value })} placeholder="Сумма, ₸" className="control min-w-0" />
              <select value={receipt.type} onChange={(e) => setReceipt({ ...receipt, type: e.target.value })} className="control min-w-0"><option value="SALARY_PAYMENT">Выплата зарплаты</option><option value="ADVANCE">Аванс</option></select>
              <input type="date" value={receipt.paymentDate} onChange={(e) => setReceipt({ ...receipt, paymentDate: e.target.value })} className="control min-w-0" />
              <select value={receipt.method} onChange={(e) => setReceipt({ ...receipt, method: e.target.value })} className="control min-w-0"><option value="cash">Наличные</option><option value="kaspi">Kaspi</option><option value="bank_transfer">Банковский перевод</option><option value="other">Другое</option></select>
              <button onClick={() => void reportReceipt()} disabled={Number(receipt.amount) <= 0} className="min-h-11 rounded-xl bg-orange-700 px-4 font-semibold disabled:opacity-40">Отметить как полученное</button>
              <input value={receipt.comment} onChange={(e) => setReceipt({ ...receipt, comment: e.target.value })} placeholder="Комментарий" className="control min-w-0 sm:col-span-2 lg:col-span-5" />
            </div>
          </section>
        )}
        {!adminView && data.period && !locked && (
          <section className="mt-5 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="font-semibold">Запросить аванс</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <input
                type="number"
                min={operation === "allowance" ? "0" : "1"}
                value={advanceAmount}
                onChange={(e) => setAdvanceAmount(e.target.value)}
                placeholder="Сумма, ₸"
                className="control min-w-0"
              />
              <select value={advanceMethod} onChange={(event) => setAdvanceMethod(event.target.value)} className="control min-w-0">
                <option value="cash">Наличные</option>
                <option value="kaspi">Kaspi</option>
                <option value="bank_transfer">Банковский перевод</option>
                <option value="other">Другое</option>
              </select>
              <input value={advanceComment} onChange={(event) => setAdvanceComment(event.target.value)} placeholder="Комментарий" className="control min-w-0" />
              <button
                onClick={() => void requestAdvance()}
                className="min-h-11 rounded-xl bg-blue-600 px-5 font-semibold"
              >
                Отправить запрос
              </button>
            </div>
          </section>
        )}
        {adminView && Boolean(data.unconfigured?.length) && (
          <section className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
            <h2 className="font-semibold text-white">Зарплата не настроена</h2>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {data.unconfigured!.map((user) => (
                <div key={user.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-900 p-3">
                  <span><b>{user.name}</b><small className="block text-slate-400">{roleNames[user.role] ?? user.role}</small></span>
                  {director && <button onClick={() => void configureEmployee(user)} className="min-h-10 rounded-lg bg-blue-600 px-3 font-semibold">Настроить</button>}
                </div>
              ))}
            </div>
          </section>
        )}
        <section className="mt-5">
          {loading ? (
            <Empty text="Загружаем ведомость…" />
          ) : !data.period ? (
            <Empty
              text={
                director
                  ? "Период ещё не открыт. Откройте месяц, чтобы начать работу."
                  : "За выбранный месяц расчётный период ещё не открыт."
              }
            />
          ) : !data.rows.length ? (
            <Empty text="Начислений пока нет. Настройте зарплатные профили сотрудников." />
          ) : (
            <>
              <div className="hidden overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 xl:block">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      {[
                        "Сотрудник",
                        "Должность",
                        "Оклад",
                        "Бонусы",
                        "Премии",
                        "Другие начисления",
                        "Начислено",
                        "Авансы",
                        "Частичные выплаты",
                        "Всего получено",
                        "Удержания",
                        "К выплате",
                        "Статус",
                      ].map((title) => (
                        <th key={title} className="px-4 py-3">
                          {title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <PayrollTableRow
                        key={row.id}
                        row={row}
                        onOpen={() => setDetails(row)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 xl:hidden">
                {data.rows.map((row) => (
                  <article
                    key={row.id}
                    className="rounded-2xl border border-slate-800 bg-slate-900 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <b>{row.user.name}</b>
                        <p className="text-sm text-slate-400">
                          {employeePosition(row)}
                        </p>
                      </div>
                      <Status
                        payable={row.totals.payable}
                        paid={row.totals.paid}
                      />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                      <Metric label="Начислено" value={row.totals.accrued} />
                      <Metric label="Получено" value={row.totals.received} />
                      <Metric label="Удержания" value={row.totals.deductions} />
                      <Metric
                        label="К выплате"
                        value={row.totals.payable}
                        accent
                      />
                    </div>
                    <button
                      onClick={() => setDetails(row)}
                      className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 font-medium"
                    >
                      Открыть <ChevronRight size={17} />
                    </button>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
      {details && (
        <EmployeeDrawer
          row={data.rows.find((row) => row.id === details.id) ?? details}
          director={director}
          accountant={accountant}
          closed={locked}
          onClose={() => setDetails(null)}
          onOperation={openOperation}
          onReview={reviewAdvance}
          onPayAdvance={payAdvance}
          onReversePayment={reversePayrollPayment}
        />
      )}{" "}
      {operation && target && data.period && (
        <OperationModal
          operation={operation}
          row={target}
          form={form}
          setForm={setForm}
          onClose={() => setOperation(null)}
          onSubmit={submitOperation}
        />
      )}
    </main>
  );
}

function PayrollTableRow({
  row,
  onOpen,
}: {
  row: PayrollRow;
  onOpen: () => void;
}) {
  return (
    <tr
      onClick={onOpen}
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen()}
      className="cursor-pointer border-t border-slate-800 hover:bg-slate-800/60"
    >
      <td className="px-4 py-4 font-semibold">{row.user.name}</td>
      <td className="px-4 py-4 text-slate-400">
        {employeePosition(row)}
      </td>
      <td className="px-4 py-4">{currency(row.currentSalary)}</td>
      <td className="px-4 py-4">{currency(row.breakdown.bonusesAccrued)}</td>
      <td className="px-4 py-4">{currency(row.breakdown.premiumsAccrued)}</td>
      <td className="px-4 py-4">{currency(row.breakdown.otherAccruals)}</td>
      <td className="px-4 py-4">{currency(row.totals.accrued)}</td>
      <td className="px-4 py-4">{currency(row.breakdown.advancesPaid)}</td>
      <td className="px-4 py-4">{currency(row.breakdown.partialPayments)}</td>
      <td className="px-4 py-4 text-emerald-300">
        {currency(row.totals.received)}
      </td>
      <td className="px-4 py-4 text-red-300">
        {currency(row.totals.deductions)}
      </td>
      <td className="px-4 py-4 font-bold text-amber-300">
        {currency(row.totals.payable)}
      </td>
      <td className="px-4 py-4">
        <Status payable={row.totals.payable} paid={row.totals.paid} />
      </td>
    </tr>
  );
}
function Status({ payable, paid }: { payable: number; paid: number }) {
  const value =
    payable <= 0 ? "Выплачено" : paid > 0 ? "Частично" : "К выплате";
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${payable <= 0 ? "bg-emerald-500/15 text-emerald-300" : paid > 0 ? "bg-amber-500/15 text-amber-300" : "bg-blue-500/15 text-blue-300"}`}
    >
      {value}
    </span>
  );
}
function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-950 p-2">
      <p className="truncate text-[11px] text-slate-500">{label}</p>
      <p
        className={`mt-1 truncate font-semibold ${accent ? "text-amber-300" : ""}`}
      >
        {currency(value)}
      </p>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 p-12 text-center text-slate-400">
      <CircleDollarSign className="mx-auto mb-3 text-slate-600" />
      <p>{text}</p>
    </div>
  );
}
function Action({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm font-medium hover:border-blue-500"
    >
      {label}
    </button>
  );
}

function EmployeeDrawer({
  row,
  director,
  accountant,
  closed,
  onClose,
  onOperation,
  onReview,
  onPayAdvance,
  onReversePayment,
}: {
  row: PayrollRow;
  director: boolean;
  accountant: boolean;
  closed: boolean;
  onClose: () => void;
  onOperation: (operation: Operation, row: PayrollRow) => void;
  onReview: (
    item: Advance,
    decision: "APPROVED" | "REJECTED",
  ) => Promise<unknown>;
  onPayAdvance: (item: Advance) => Promise<unknown>;
  onReversePayment: (item: Payment) => Promise<unknown>;
}) {
  const history = [
    ...row.accruals.map((item) => ({
      id: `a-${item.id}`,
      date: item.createdAt,
      title: labels[item.type] ?? item.type,
      amount: Number(item.amount) * (item.direction === "DECREASE" ? -1 : 1),
      reason: item.reason,
    })),
    ...row.payments.map((item) => ({
      id: `p-${item.id}`,
      date: item.paymentDate,
      title: labels[item.type] ?? item.type,
      amount:
        item.type === "EMPLOYEE_REFUND"
          ? Number(item.amount)
          : -Number(item.amount),
      reason: item.comment ?? "",
    })),
  ].sort((a, b) => +new Date(b.date) - +new Date(a.date));
  return (
    <div
      className="fixed inset-0 z-[80] flex justify-end bg-black/70"
      role="dialog"
      aria-modal="true"
    >
      <button
        className="absolute inset-0"
        aria-label="Закрыть"
        onClick={onClose}
      />
      <aside className="relative h-full w-full max-w-3xl overflow-y-auto border-l border-slate-700 bg-slate-950 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="grid size-12 place-items-center rounded-full bg-blue-500/15 text-blue-300">
              <UserRound />
            </div>
            <div>
              <h2 className="text-xl font-bold">{row.user.name}</h2>
              <p className="text-sm text-slate-400">
                {employeePosition(row)} · Оклад{" "}
                 {currency(row.currentSalary)} · действует с {dateLabel(row.salaryEffectiveFrom)}
              </p>
              <p className="text-sm text-slate-400">Гарантированный бонус: {currency(row.defaultGuaranteedBonus)}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Закрыть карточку"
            className="grid size-11 place-items-center rounded-xl border border-slate-700"
          >
            <X />
          </button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Начислено" value={row.totals.accrued} />
          <Metric label="Всего получено" value={row.totals.received} />
          <Metric label="Ожидает подтверждения" value={row.totals.pending} />
          <Metric label="К выплате" value={row.totals.payable} accent />
        </div>
        <section className="mt-5 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="font-semibold">Оклад</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {[
              ["Размер оклада", currency(row.currentSalary)],
              ["Плановые дни", String(row.plannedDays)],
              ["Отработанные дни", String(row.workedDays)],
              ["Рассчитанная окладная часть", currency(row.calculatedSalary)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between rounded-xl bg-slate-950 px-3 py-2 text-sm">
                <span className="text-slate-400">{label}</span>
                <b>{value}</b>
              </div>
            ))}
          </div>
        </section>
        <section className="mt-5 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="font-semibold">Структура зарплаты</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {[
              ["Оклад", row.breakdown.salaryAccrued],
              ["Бонусы по заказам", row.breakdown.bonusesAccrued],
              ["Премии", row.breakdown.premiumsAccrued],
              ["Другие начисления", row.breakdown.otherAccruals],
              ["Всего начислено", row.breakdown.totalAccrued],
              ["Авансы", row.breakdown.advancesPaid],
              ["Частичные выплаты", row.breakdown.partialPayments],
              ["Полные выплаты", row.breakdown.finalPayments],
              ["Всего получено", row.breakdown.totalPaid],
              ["Удержания и сторно", row.breakdown.deductions],
              ["Осталось выплатить", row.breakdown.payable],
            ].map(([label, amount]) => (
              <div
                key={String(label)}
                className="flex justify-between rounded-xl bg-slate-950 px-3 py-2 text-sm"
              >
                <span className="text-slate-400">{String(label)}</span>
                <b>{currency(amount as number)}</b>
              </div>
            ))}
          </div>
        </section>
        {(director || accountant) && !closed && (
          <section className="mt-5">
            <h3 className="mb-3 font-semibold">Действия</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {director && <>
                  <Action
                    label="Изменить оклад"
                    onClick={() => onOperation("salary", row)}
                  />
                  <Action
                    label="Гарантированный бонус"
                    onClick={() => onOperation("allowance", row)}
                  />
                  <Action
                    label="Добавить бонус"
                    onClick={() => onOperation("bonus", row)}
                  />
                  <Action
                    label="Назначить премию"
                    onClick={() => onOperation("premium", row)}
                  />
                  <Action
                    label="Удержание"
                    onClick={() => onOperation("deduction", row)}
                  />
                  <Action
                    label="Сторно"
                    onClick={() => onOperation("reversal", row)}
                  />
              </>}
              <Action
                label="Добавить выплату / аванс"
                onClick={() => onOperation("payment", row)}
              />
            </div>
          </section>
        )}
        {row.advanceRequests.length > 0 && (
          <section className="mt-5">
            <h3 className="font-semibold">Запросы на аванс</h3>
            <div className="mt-2 space-y-2">
              {row.advanceRequests.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-slate-800 bg-slate-900 p-3"
                >
                  <div className="flex justify-between">
                    <span>{currency(item.requestedAmount)}</span>
                    <span className="text-sm text-slate-400">
                      {labels[item.status]}
                    </span>
                  </div>
                  {!closed && (
                    <div className="mt-2 flex gap-2">
                      {(director || accountant) && item.status === "REQUESTED" && (
                        <>
                          <button
                            onClick={() => void onReview(item, "APPROVED")}
                            className="rounded-lg bg-emerald-700 px-3 py-2 text-sm"
                          >
                            Одобрить
                          </button>
                          <button
                            onClick={() => void onReview(item, "REJECTED")}
                            className="rounded-lg bg-red-900 px-3 py-2 text-sm"
                          >
                            Отклонить
                          </button>
                        </>
                      )}
                      {(director || accountant) && item.status === "APPROVED" && (
                        <button
                          onClick={() => void onPayAdvance(item)}
                          className="rounded-lg bg-blue-600 px-3 py-2 text-sm"
                        >
                          Зарегистрировать выплату
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        {row.bonusAccruals.length > 0 && (
          <section className="mt-5">
            <h3 className="font-semibold">Бонусы</h3>
            <div className="mt-2 space-y-2">
              {row.bonusAccruals.map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span>{labels[item.type] ?? item.type}</span>
                    <b>{currency(item.amount)}</b>
                  </div>
                  {item.order && (
                    <div className="mt-2 grid gap-1 text-slate-400 sm:grid-cols-2">
                      <Link href={`/orders/${item.order.id}`} className="font-medium text-blue-300 hover:text-blue-200">Заказ {item.order.number}</Link>
                      <span>Клиент: {item.order.client.name}</span>
                      <span>Сумма заказа: {currency(item.order.amount)}</span>
                      <span>Оплачено клиентом: {currency(item.order.paid)}</span>
                      <span>Договор: {item.order.contract?.number ?? "не сформирован"}</span>
                      <span>Правило: {item.rule === "FIXED" ? `фиксированная сумма ${currency(item.ruleValue)}` : `${item.rule === "PAID_PERCENT" ? "% от оплаченной суммы" : "% от реализованной прибыли"} · ${item.ruleValue}%`}</span>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap justify-between gap-2 text-slate-400">
                    <span>{item.status === "PAID" ? "Выплачено" : item.status === "PARTIALLY_PAID" ? "Частично выплачено" : "Начислено"}{item.approvedBy ? ` · подтвердил ${item.approvedBy.name}` : ""}</span>
                    <span>Выплачено {currency(item.paid)} · к выплате {currency(item.payable)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        {row.paymentConfirmations.length > 0 && (
          <section className="mt-5">
            <h3 className="font-semibold">Сообщения о получении</h3>
            <div className="mt-2 space-y-2">
              {row.paymentConfirmations.map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span>{labels[item.type] ?? item.type} · {dateLabel(item.claimedPaymentDate)}</span>
                    <b>{currency(item.amount)}</b>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">{labels[item.status] ?? item.status}{item.createdBy ? ` · внёс ${item.createdBy.name}` : ""}{item.reviewedBy ? ` · подтвердил ${item.reviewedBy.name}` : ""}{item.method ? ` · ${methodLabels[item.method] ?? item.method}` : ""}{item.comment ? ` · ${item.comment}` : ""}{item.reviewComment ? ` · ${item.reviewComment}` : ""}</p>
                </div>
              ))}
            </div>
          </section>
        )}
        {row.payments.length > 0 && (
          <section className="mt-5">
            <h3 className="font-semibold">Подтверждённые выплаты</h3>
            <div className="mt-2 space-y-2">
              {row.payments.map((item) => {
                const reversal = item.type === "EMPLOYEE_REFUND";
                const reversed = Boolean(item.reversedAt || item.reversal);
                return (
                  <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div><p>{labels[item.type] ?? item.type}</p><p className="text-xs text-slate-500">{dateLabel(item.paymentDate)}{item.method ? ` · ${methodLabels[item.method] ?? item.method}` : ""}{item.paidBy ? ` · провёл ${item.paidBy.name}` : ""}{item.comment ? ` · ${item.comment}` : ""}</p></div>
                      <b className={reversal ? "text-red-300" : "text-emerald-300"}>{reversal ? "−" : ""}{currency(item.amount)}</b>
                    </div>
                    {director && !closed && !reversal && !reversed && (
                      <button onClick={() => void onReversePayment(item)} className="mt-2 min-h-10 rounded-lg border border-red-500/40 px-3 text-sm text-red-200">Сторнировать выплату</button>
                    )}
                    {reversed && <p className="mt-2 text-xs text-red-300">Выплата сторнирована</p>}
                  </div>
                );
              })}
            </div>
          </section>
        )}
        <section className="mt-5">
          <div className="flex items-center gap-2">
            <History size={19} className="text-blue-300" />
            <h3 className="font-semibold">История операций</h3>
          </div>
          <div className="mt-3 space-y-2">
            {history.length ? (
              history.map((item) => (
                <div
                  key={item.id}
                  className="flex gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3"
                >
                  <div className="mt-1 size-2 rounded-full bg-blue-400" />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-3">
                      <p className="font-medium">{item.title}</p>
                      <b
                        className={
                          item.amount < 0 ? "text-red-300" : "text-emerald-300"
                        }
                      >
                        {item.amount < 0 ? "−" : "+"}
                        {currency(Math.abs(item.amount))}
                      </b>
                    </div>
                    <p className="text-xs text-slate-500">
                      {dateLabel(item.date)}
                      {item.reason ? ` · ${item.reason}` : ""}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">Операций пока нет</p>
            )}
          </div>
        </section>
        {row.salaryRates.length > 0 && (
          <section className="mt-5">
            <h3 className="font-semibold">История оклада</h3>
            <div className="mt-2 space-y-2">
              {row.salaryRates.map((rate) => (
                <div
                  key={rate.id}
                  className="flex justify-between rounded-xl bg-slate-900 p-3 text-sm"
                >
                  <span>
                    {dateLabel(rate.effectiveFrom)}
                    {rate.effectiveTo
                      ? ` — ${dateLabel(rate.effectiveTo)}`
                      : " — сейчас"}
                    <small className="block text-slate-500">{rate.approvedBy?.name ?? "Система"}{rate.comment ? ` · ${rate.comment}` : ""}</small>
                  </span>
                  <b>{currency(rate.amount)}</b>
                </div>
              ))}
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}

function OperationModal({
  operation,
  row,
  form,
  setForm,
  onClose,
  onSubmit,
}: {
  operation: Operation;
  row: PayrollRow;
  form: Form;
  setForm: (value: Form) => void;
  onClose: () => void;
  onSubmit: () => Promise<void>;
}) {
  const titles: Record<Operation, string> = {
      salary: "Назначить новый оклад",
      salaryAccrual: "Начислить оклад за период",
      allowance: "Изменить гарантированный бонус",
      bonus: "Добавить бонус",
      premium: "Назначить премию",
      deduction: "Добавить удержание",
      payment: "Зарегистрировать выплату",
      reversal: "Сторнировать начисление",
    },
    reversible = row.accruals.filter(
      (item) =>
        !item.reversalOfId &&
        !item.reversedBy &&
        item.type !== "BONUS_REVERSAL",
    );
  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-950 p-5">
        <div className="flex justify-between">
          <div>
            <h2 className="text-xl font-bold">{titles[operation]}</h2>
            <p className="text-sm text-slate-400">{row.user.name}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="grid size-11 place-items-center rounded-xl border border-slate-700"
          >
            <X />
          </button>
        </div>
        <div className="mt-5 space-y-4">
          {operation === "reversal" ? (
            <Field label="Начисление">
              <select
                value={form.accrualId}
                onChange={(e) =>
                  setForm({ ...form, accrualId: e.target.value })
                }
                className="control"
              >
                <option value="">Выберите операцию</option>
                {reversible.map((item) => (
                  <option key={item.id} value={item.id}>
                    {labels[item.type] ?? item.type} · {currency(item.amount)}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field
              label={
                operation === "bonus" &&
                form.orderId &&
                form.bonusRule !== "FIXED"
                  ? "Процент, %"
                  : "Сумма, ₸"
              }
            >
              <input
                autoFocus
                type="number"
                min="1"
                max={
                  operation === "bonus" && form.bonusRule !== "FIXED"
                    ? "100"
                    : undefined
                }
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="control"
              />
            </Field>
          )}
          {operation === "payment" && (
            <Field label="Тип выплаты">
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="control"
              >
                <option value="SALARY_PAYMENT">Зарплата</option>
                <option value="GUARANTEED_BONUS_PAYMENT">Гарантированный бонус</option>
                <option value="ORDER_BONUS_PAYMENT">Бонус за заказ</option>
                <option value="PREMIUM_PAYMENT">Премия</option>
                <option value="ADVANCE">Аванс</option>
                <option value="FINAL_SETTLEMENT">Окончательный расчёт</option>
                <option value="OTHER_PAYROLL_PAYMENT">Другая выплата</option>
              </select>
            </Field>
          )}
          {operation === "payment" && (
            <Field label="Способ выплаты">
              <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className="control">
                <option value="cash">Наличные</option>
                <option value="kaspi">Kaspi</option>
                <option value="bank_transfer">Банковский перевод</option>
                <option value="other">Другое</option>
              </select>
            </Field>
          )}
          {operation === "payment" && row.bonusAccruals.some((item) => item.payable > 0) && (
            <Field label="Начисление бонуса (необязательно)">
              <select value={form.accrualId} onChange={(e) => { const item = row.bonusAccruals.find((value) => value.id === Number(e.target.value)); setForm({ ...form, accrualId: e.target.value, amount: item ? String(item.payable) : form.amount, type: item ? "ORDER_BONUS_PAYMENT" : form.type }); }} className="control">
                <option value="">Общая выплата без привязки</option>
                {row.bonusAccruals.filter((item) => item.payable > 0).map((item) => <option key={item.id} value={item.id}>{labels[item.type] ?? item.type}{item.orderId ? ` · заказ ${item.orderId}` : ""} · {currency(item.payable)}</option>)}
              </select>
            </Field>
          )}
          {operation === "bonus" && (
            <Field label="Заказ (необязательно)">
              <input
                type="number"
                min="1"
                value={form.orderId}
                onChange={(e) => setForm({ ...form, orderId: e.target.value })}
                placeholder="ID заказа"
                className="control"
              />
            </Field>
          )}
          {operation === "bonus" && form.orderId && (
            <Field label="Правило бонуса">
              <select
                value={form.bonusRule}
                onChange={(event) =>
                  setForm({
                    ...form,
                    bonusRule: event.target.value as Form["bonusRule"],
                  })
                }
                className="control"
              >
                <option value="FIXED">Фиксированная сумма</option>
                <option value="PAID_PERCENT">Процент от оплаченной суммы</option>
                <option value="PROFIT_PERCENT">Процент от прибыли</option>
              </select>
            </Field>
          )}
          {(operation === "salary" || operation === "payment") && (
            <Field
              label={
                operation === "salary" ? "Дата начала действия" : "Дата выплаты"
              }
            >
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="control"
              />
            </Field>
          )}
          <Field
            label={
              operation === "reversal"
                ? "Причина сторно"
                : "Комментарий / основание"
            }
          >
            <textarea
              rows={3}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className="control resize-none"
            />
          </Field>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="min-h-11 rounded-xl px-4 text-slate-300"
          >
            Отмена
          </button>
          <button
            onClick={() => void onSubmit()}
            disabled={
              operation === "reversal"
                ? !form.accrualId || !form.reason.trim()
                : operation === "allowance"
                  ? form.amount === "" || Number(form.amount) < 0
                  : Number(form.amount) <= 0
            }
            className="min-h-11 rounded-xl bg-blue-600 px-5 font-semibold disabled:opacity-40"
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
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
    <label className="block text-sm text-slate-300">
      <span className="mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}
