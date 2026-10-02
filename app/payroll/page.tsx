"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  History,
  Plus,
  UserRound,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { payrollRoleAccess } from "@/lib/payroll-policy";

type Accrual = {
  id: number;
  type: string;
  amount: string;
  direction: "INCREASE" | "DECREASE";
  reason: string;
  orderId?: number | null;
  order?: OrderOption | null;
  createdAt: string;
  reversalOfId?: number | null;
  reversedBy?: { id: number } | null;
};
type Payment = {
  id: number;
  type: string;
  amount: string;
  paymentDate: string;
  comment?: string | null;
  method?: string | null;
  externalReference?: string | null;
  paidBy?: { id: number; name: string } | null;
  reversalOfId?: number | null;
  reversedAt?: string | null;
  reversal?: { id: number } | null;
  confirmationNumber?: string;
  paymentPurpose?: string;
};
type PayrollAuditOrder = {
  accrualId: number;
  orderId: number;
  orderNumber: string;
  clientName: string;
  orderAmount: number;
  orderStatus: string;
  earnedAt: string;
  earnedEvent: string;
  eligible: boolean;
  submitted: number;
  expected: number;
  appliedAdjustment: number;
  recorded: number;
  managerDifference: number;
  ledgerDifference: number;
  status: "MATCH" | "OVER" | "UNDER" | "NOT_ELIGIBLE";
  reconciled: boolean;
};
type PayrollAudit = {
  policy: { threshold: number; belowOrEqual: number; above: number; earnedEvent: string };
  linkedOrders: number;
  submittedOrderBonus: number;
  requiredOrderBonus: number;
  managerDifference: number;
  salaryRequired: number;
  salaryPosted: number;
  salaryDifference: number;
  premiums: number;
  deductions: number;
  advances: number;
  alreadyPaid: number;
  ledgerDifference: number;
  auditedAccrued: number;
  auditedPayable: number;
  approvedAccrued: number;
  approvedPayable: number;
  unreconciledOrders: number;
  calculationReady: boolean;
  manualApproved: boolean;
  workReadiness: { ready: boolean; orderIssues: number; measurementsToClose: number; openTasks: number };
  readyToPay: boolean;
  mismatches: PayrollAuditOrder[];
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
  accruals: Accrual[];
  payments: Payment[];
  totals: { accrued: number; paid: number; pending: number; payable: number };
  breakdown: { salaryAccrued: number; bonusesAccrued: number; premiumsAccrued: number; advancesPaid: number; totalAccrued: number; totalPaid: number; payable: number };
  bonusAccruals: Array<{ id: number; orderId?: number | null; order?: OrderOption | null; measurementId?: number | null; type: string; amount: number; accruedAt: string; paid: number; payable: number; status: "ACCRUED" | "PARTIALLY_PAID" | "PAID" }>;
  payrollAudit?: PayrollAudit | null;
};
type Payload = {
  period: { id: number; year: number; month: number; status: string } | null;
  rows: PayrollRow[];
  totals: { accrued: number; paid: number; pending: number; payable: number };
  breakdown: { salaryAccrued: number; bonusesAccrued: number; premiumsAccrued: number; advancesPaid: number; totalAccrued: number; totalPaid: number; payable: number };
  settings: { paydayDayOfMonth: number };
  unconfigured?: Array<{ id: number; name: string; role: string }>;
};
type Operation =
  "salary" | "salaryAccrual" | "allowance" | "bonus" | "premium" | "deduction" | "payment" | "reversal";
type OrderOption = {
  id: number;
  number: string;
  amount?: number | string;
  client: { id?: number; name: string; phone?: string | null };
};
type Form = {
  amount: string;
  reason: string;
  date: string;
  orderId: string;
  type: string;
  accrualId: string;
  method: string;
  externalReference: string;
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
  OPERATIONS_DIRECTOR: "Директор",
  MARKETER: "Маркетолог",
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
  DEDUCTION: "Штраф / удержание",
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
  ORDER_OUTSIDE_PERIOD: "Выберите заказ из открытого расчётного месяца",
  ORDER_BONUS_ALREADY_EXISTS: "По этому заказу бонус уже начислен. Повторный бонус запрещён",
  FOUNDER_CONFIRMATION_REQUIRED: "Финальную выплату зарплаты подтверждает только основатель",
  PAYROLL_POLICY_NOT_APPLICABLE: "Автоматическая проверка применяется только к зарплате менеджера",
  PAYMENT_EXCEEDS_PAYABLE: "Сумма выплаты превышает подтверждённый остаток к выплате",
  KASPI_METHOD_REQUIRED: "Финальная зарплата выплачивается через Kaspi",
  KASPI_REFERENCE_REQUIRED: "Укажите реальный номер или референс перевода Kaspi",
  KASPI_REFERENCE_ALREADY_USED: "Этот референс Kaspi уже использован в другой выплате",
  PAYROLL_RECONCILIATION_REQUIRED: "Сначала примените проверку системы: оклад или бонусы по заказам ещё не сверены",
  PAYROLL_WORK_INCOMPLETE: "Выплата заблокирована: сначала закройте замечания по заказам, просроченные замеры и контрольные задачи",
  INVALID_ACTION: "Операция не поддерживается",
};
const methodLabels: Record<string, string> = {
  cash: "Наличные",
  kaspi: "Kaspi",
  bank_transfer: "Банковский перевод",
  other: "Другое",
};
const emptyForm = (): Form => ({
  amount: "",
  reason: "",
  date: new Date().toISOString().slice(0, 10),
  orderId: "",
  type: "SALARY_PAYMENT",
  accrualId: "",
  method: "kaspi",
  externalReference: "",
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
    totals: { accrued: 0, paid: 0, pending: 0, payable: 0 },
    breakdown: { salaryAccrued: 0, bonusesAccrued: 0, premiumsAccrued: 0, advancesPaid: 0, totalAccrued: 0, totalPaid: 0, payable: 0 },
    settings: { paydayDayOfMonth: 1 },
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [details, setDetails] = useState<PayrollRow | null>(null),
    [operation, setOperation] = useState<Operation | null>(null),
    [target, setTarget] = useState<PayrollRow | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const role = session?.user.accountRole || session?.user.role || "",
    roleAccess = payrollRoleAccess(role),
    founder = roleAccess.founder,
    director = roleAccess.administrator,
    accountant = roleAccess.accountant,
    adminView = director || accountant,
    managerSelfService = role === "MANAGER" && !adminView,
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
    setNotice(
      result.confirmationNumber
        ? `${success}. Подтверждение ${result.confirmationNumber}`
        : success,
    );
    await load();
    return result || true;
  };
  const runSelf = async (
    body: Record<string, unknown>,
    success: string,
  ) => {
    setError("");
    setNotice("");
    const response = await fetch("/api/payroll/self", {
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
    if (next === "payment" && employee?.payrollAudit && !employee.payrollAudit.readyToPay) {
      setDetails(employee);
      setError(employee.payrollAudit.workReadiness.ready
        ? "Сначала выберите расчёт системы или подтвердите ручной расчёт"
        : "Сначала закройте замечания по заказам, просроченные замеры и контрольные задачи");
      return;
    }
    setOperation(next);
    setTarget(employee);
    setForm(next === "salaryAccrual" && employee
      ? { ...emptyForm(), amount: String(employee.currentSalary), reason: "Оклад за расчётный период" }
      : next === "payment" && employee
        ? {
            ...emptyForm(),
            amount: String(Math.max(employee.payrollAudit?.approvedPayable ?? employee.totals.payable, 0)),
            method: "kaspi",
            reason: `Заработная плата за ${months[selected.month - 1].toLowerCase()} ${selected.year}`,
          }
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
        externalReference: form.externalReference,
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
                : "ORDER_BONUS"
          ],
        type:
          operation === "salaryAccrual"
            ? "BASE_SALARY"
            : operation === "premium"
            ? "PREMIUM"
            : operation === "deduction"
              ? "DEDUCTION"
              : "ORDER_BONUS",
        orderId: form.orderId ? Number(form.orderId) : undefined,
      };
    const saved = managerSelfService && (operation === "bonus" || operation === "deduction")
      ? await runSelf(body, operation === "bonus" ? "Бонус за заказ добавлен" : "Штраф добавлен")
      : await run(body);
    if (saved) {
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
  const reversePayrollPayment = async (item: Payment) => {
    const reason = window.prompt("Обязательная причина сторно")?.trim();
    if (!reason) return;
    await run({ action: "reverse-payment", id: item.id, reason }, "Выплата сторнирована");
  };
  const reconcilePayroll = async (row: PayrollRow) => {
    if (!data.period || !row.payrollAudit) return;
    const audit = row.payrollAudit;
    const approved = window.confirm(
      `Применить расчёт системы для ${row.user.name}?\n\n` +
        `Оклад: ${currency(audit.salaryRequired)}\n` +
        `Бонусы по ${audit.linkedOrders} заказам: ${currency(audit.requiredOrderBonus)}\n` +
        `Корректировка учёта: ${audit.ledgerDifference >= 0 ? "+" : "−"}${currency(Math.abs(audit.ledgerDifference))}\n` +
        `После проверки к выплате: ${currency(audit.auditedPayable)}`,
    );
    if (!approved) return;
    await run(
      {
        action: "reconcile-manager-payroll",
        employeeId: row.id,
        periodId: data.period.id,
      },
      "Расчёт системы применён, исходные записи сохранены в истории",
    );
  };
  const approveManualPayroll = async (row: PayrollRow) => {
    if (!data.period || !row.payrollAudit) return;
    const reason = window.prompt(
      `Почему оставляем ручной расчёт ${row.user.name}?`,
      "Подтверждено основателем после сверки заказов",
    )?.trim();
    if (!reason) return;
    await run(
      {
        action: "approve-manager-payroll-manual",
        employeeId: row.id,
        periodId: data.period.id,
        reason,
      },
      "Ручной расчёт подтверждён основателем",
    );
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
  const auditedPayableTotal = data.rows.reduce(
    (sum, row) => sum + (row.payrollAudit?.approvedPayable ?? row.totals.payable),
    0,
  );
  const stats: Array<[string, number, LucideIcon, string]> = [
    ["Начислено", data.breakdown.totalAccrued, CircleDollarSign, "text-white"],
    ["Выплачено", data.breakdown.totalPaid, Check, "text-emerald-300"],
    ["К выплате по проверке", auditedPayableTotal, Banknote, "text-amber-300"],
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
            {director && data.period && !locked && (
              <button
                onClick={() => openOperation("salaryAccrual")}
                disabled={!data.rows.length}
                className="flex min-h-11 items-center gap-2 rounded-xl border border-blue-500/50 bg-blue-500/10 px-4 font-semibold text-blue-100 disabled:opacity-40"
              >
                <Plus size={18} /> Начислить
              </button>
            )}
            {founder && data.period && !locked && (
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
        {director && (
          <details className="mt-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-300">Действия с месяцем</summary>
            <div className="mt-3 flex flex-wrap gap-2">
              {!data.period && <button onClick={() => void run({ action: "create-period", ...selected }, "Месяц открыт")} className="min-h-11 rounded-xl bg-blue-600 px-4 font-semibold">Открыть месяц</button>}
              {data.period?.status === "OPEN" && <button onClick={() => void transitionPeriod("REVIEW")} className="min-h-11 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 font-semibold text-amber-200">На проверку</button>}
              {data.period?.status === "REVIEW" && <><button onClick={() => void transitionPeriod("OPEN")} className="min-h-11 rounded-xl border border-slate-600 px-4 font-semibold">Вернуть в работу</button><button onClick={() => void transitionPeriod("CLOSED")} className="min-h-11 rounded-xl border border-red-500/40 bg-red-500/10 px-4 font-semibold text-red-300">Закрыть месяц</button></>}
              {data.period?.status === "CLOSED" && <button onClick={() => void transitionPeriod("OPEN")} className="min-h-11 rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 font-semibold text-blue-200">Открыть месяц снова</button>}
            </div>
          </details>
        )}
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
        <section className="mt-5 grid gap-3 sm:grid-cols-3">
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
        {!adminView && data.rows[0] && (
          <section className="mt-5 rounded-2xl border border-blue-500/25 bg-blue-500/5 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold">Мой расчёт за месяц</h2>
                <p className="mt-1 text-sm text-slate-300">
                  Оклад: <b>{currency(data.rows[0].currentSalary)}</b> · бонусы: <b>{currency(data.rows[0].breakdown.bonusesAccrued)}</b> · штрафы: <b>{currency(data.rows[0].accruals.filter((item) => item.type === "DEDUCTION").reduce((sum, item) => sum + Number(item.amount), 0))}</b> · авансы: <b>{currency(data.rows[0].breakdown.advancesPaid)}</b>
                </p>
              </div>
              {managerSelfService && data.period && !locked && (
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => openOperation("bonus", data.rows[0])} className="min-h-11 rounded-xl bg-blue-600 px-4 font-semibold">+ Бонус за заказ</button>
                  <button onClick={() => openOperation("deduction", data.rows[0])} className="min-h-11 rounded-xl border border-red-500/40 bg-red-500/10 px-4 font-semibold text-red-200">+ Штраф</button>
                </div>
              )}
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
                        "Начислено",
                        "Расчёт системы",
                        "Выплачено",
                        "К выплате",
                        "Статус",
                        "Действия",
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
                        payable={row.payrollAudit?.approvedPayable ?? row.totals.payable}
                        paid={row.totals.paid}
                      />
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                      <Metric label="Начислено" value={row.totals.accrued} />
                      <Metric label="Расчёт системы" value={row.payrollAudit?.auditedAccrued ?? row.totals.accrued} />
                      <Metric
                        label="Точно к выплате"
                        value={row.payrollAudit?.approvedPayable ?? row.totals.payable}
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
          canPay={founder}
          closed={locked}
          onClose={() => setDetails(null)}
          onOperation={openOperation}
          onReversePayment={reversePayrollPayment}
          onReconcile={reconcilePayroll}
          onApproveManual={approveManualPayroll}
        />
      )}{" "}
      {operation && target && data.period && (
        <OperationModal
          operation={operation}
          row={target}
          rows={data.rows}
          onRowChange={(row) => {
            setTarget(row);
            setForm(operation === "salaryAccrual"
              ? { ...emptyForm(), amount: String(row.currentSalary), reason: "Оклад за расчётный период" }
              : operation === "payment"
                ? {
                    ...emptyForm(),
                    amount: String(Math.max(row.payrollAudit?.approvedPayable ?? row.totals.payable, 0)),
                    method: "kaspi",
                    reason: `Заработная плата за ${months[selected.month - 1].toLowerCase()} ${selected.year}`,
                  }
              : emptyForm());
          }}
          form={form}
          setForm={setForm}
          period={selected}
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
      <td className="px-4 py-4 font-semibold">
        {row.user.name}
        <span className="mt-0.5 block text-xs font-normal text-slate-500">
          {employeePosition(row)}
        </span>
      </td>
      <td className="px-4 py-4">{currency(row.totals.accrued)}</td>
      <td className="px-4 py-4">
        <b>{currency(row.payrollAudit?.approvedAccrued ?? row.totals.accrued)}</b>
        {row.payrollAudit && row.payrollAudit.ledgerDifference !== 0 && (
          <span className="mt-0.5 block text-xs text-amber-300">
            учесть {row.payrollAudit.ledgerDifference > 0 ? "+" : "−"}{currency(Math.abs(row.payrollAudit.ledgerDifference))}
          </span>
        )}
      </td>
      <td className="px-4 py-4 text-emerald-300">
        {currency(row.totals.paid)}
      </td>
      <td className="px-4 py-4 font-bold text-amber-300">
        {currency(row.payrollAudit?.approvedPayable ?? row.totals.payable)}
      </td>
      <td className="px-4 py-4">
        <Status payable={row.payrollAudit?.approvedPayable ?? row.totals.payable} paid={row.totals.paid} />
      </td>
      <td className="px-4 py-4">
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onOpen(); }}
          className="min-h-10 rounded-lg border border-slate-700 px-3 text-sm font-semibold hover:border-blue-500"
        >
          Открыть
        </button>
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
  canPay,
  closed,
  onClose,
  onOperation,
  onReversePayment,
  onReconcile,
  onApproveManual,
}: {
  row: PayrollRow;
  director: boolean;
  canPay: boolean;
  closed: boolean;
  onClose: () => void;
  onOperation: (operation: Operation, row: PayrollRow) => void;
  onReversePayment: (item: Payment) => Promise<unknown>;
  onReconcile: (row: PayrollRow) => Promise<unknown>;
  onApproveManual: (row: PayrollRow) => Promise<unknown>;
}) {
  const accrualTotal = (types: string[]) =>
    row.accruals
      .filter((x) => types.includes(x.type))
      .reduce(
        (s, x) => s + Number(x.amount) * (x.direction === "DECREASE" ? -1 : 1),
        0,
      );
  const history = [
    ...row.accruals.map((item) => ({
      id: `a-${item.id}`,
      date: item.createdAt,
      title: `${labels[item.type] ?? item.type}${item.order ? ` · ${item.order.number}` : ""}`,
      amount: Number(item.amount) * (item.direction === "DECREASE" ? -1 : 1),
      reason: item.reason,
    })),
    ...row.payments.map((item) => ({
      id: `p-${item.id}`,
      date: item.paymentDate,
      title: labels[item.type] ?? item.type,
      amount: -Number(item.amount),
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
              <p className="text-sm text-slate-400">
                {row.payrollAudit
                  ? "Гарантированный бонус рассчитывается по сумме каждого заказа"
                  : `Гарантированный бонус: ${currency(row.defaultGuaranteedBonus)}`}
              </p>
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
        <div className="mt-5 grid grid-cols-3 gap-2">
          <Metric label="Начислено" value={row.totals.accrued} />
          <Metric label="Выплачено" value={row.totals.paid} />
          <Metric label="Точно к выплате" value={row.payrollAudit?.approvedPayable ?? row.totals.payable} accent />
        </div>
        {row.payrollAudit && (
          <section className="mt-5 rounded-2xl border border-blue-500/30 bg-blue-500/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">Автоматическая проверка зарплаты</h3>
                <p className="mt-1 text-xs text-slate-400">
                  До {currency(row.payrollAudit.policy.threshold)} включительно — {currency(row.payrollAudit.policy.belowOrEqual)}, выше — {currency(row.payrollAudit.policy.above)} за заказ. Момент начисления: заказ принят в выбранном месяце.
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${row.payrollAudit.readyToPay ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-200"}`}>
                {row.payrollAudit.readyToPay ? (row.payrollAudit.manualApproved ? "Ручной расчёт подтверждён" : "Проверено системой") : row.payrollAudit.calculationReady ? "Работа не закрыта" : "Нужно выбрать расчёт"}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl bg-slate-950 p-2"><p className="text-[11px] text-slate-500">Заказов проверено</p><p className="mt-1 font-semibold">{row.payrollAudit.linkedOrders}</p></div>
              <Metric label="Внесено менеджером" value={row.payrollAudit.submittedOrderBonus} />
              <Metric label="Требует система" value={row.payrollAudit.requiredOrderBonus} />
              <Metric label="Расхождение" value={row.payrollAudit.managerDifference} accent={row.payrollAudit.managerDifference !== 0} />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {[
                ["Оклад по профилю", row.payrollAudit.salaryRequired],
                ["Гарантированные бонусы", row.payrollAudit.requiredOrderBonus],
                ["Дополнительная премия", row.payrollAudit.premiums],
                ["Штрафы / удержания", -row.payrollAudit.deductions],
                ["Авансы", -row.payrollAudit.advances],
                ["Другие выплаты", -(row.payrollAudit.alreadyPaid - row.payrollAudit.advances)],
                [row.payrollAudit.manualApproved ? "К выплате по ручному расчёту" : "Точно к выплате", row.payrollAudit.approvedPayable],
              ].map(([label, amount], index) => (
                <div key={String(label)} className={`flex justify-between rounded-xl px-3 py-2 text-sm ${index === 6 ? "bg-emerald-500/10 text-emerald-200" : "bg-slate-950"}`}>
                  <span>{String(label)}</span>
                  <b>{currency(amount as number)}</b>
                </div>
              ))}
            </div>
            {!row.payrollAudit.calculationReady && (
              <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-100">
                Нужно выбрать решение по {row.payrollAudit.unreconciledOrders} заказам. Система предлагает корректировку {row.payrollAudit.ledgerDifference >= 0 ? "+" : "−"}{currency(Math.abs(row.payrollAudit.ledgerDifference))}. Основатель может применить расчёт системы либо оставить ручные суммы с обязательной причиной.
              </div>
            )}
            {!row.payrollAudit.workReadiness.ready && <div className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-100"><b>Расчётный лист и выплата заблокированы до завершения работы.</b><p className="mt-1">Заказы с замечаниями: {row.payrollAudit.workReadiness.orderIssues} · замеры требуют закрытия: {row.payrollAudit.workReadiness.measurementsToClose} · открытые контрольные задачи: {row.payrollAudit.workReadiness.openTasks}.</p><div className="mt-2 flex flex-wrap gap-3"><Link href="/orders?attention=missing-production-price" className="font-semibold text-blue-200">Открыть заказы</Link><Link href="/measurements?filter=needs-closing" className="font-semibold text-blue-200">Открыть замеры</Link><Link href="/calendar" className="font-semibold text-blue-200">Открыть задачи</Link></div></div>}
            <div className="mt-3 space-y-2">
              {row.payrollAudit.mismatches.map((item) => {
                const difference = item.managerDifference;
                const mismatch = difference > 0
                  ? `лишнее ${currency(difference)}`
                  : difference < 0
                    ? `не хватает ${currency(Math.abs(difference))}`
                    : "верно";
                return (
                  <div key={item.accrualId} className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span><b>{item.orderNumber}</b> · {item.clientName}</span>
                      <b>{currency(item.orderAmount)}</b>
                    </div>
                    <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-slate-400">
                      <span>Внесено {currency(item.submitted)} · система {currency(item.expected)}</span>
                      <span className={difference === 0 ? "text-emerald-300" : "text-amber-300"}>
                        {item.eligible ? mismatch : "не участвует в этом расчётном периоде"}{item.appliedAdjustment ? ` · исправлено ${currency(item.appliedAdjustment)}` : ""}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {director && !closed && !row.payrollAudit.calculationReady && <div className="mt-4 grid gap-2 sm:grid-cols-2"><button onClick={() => void onReconcile(row)} className="min-h-11 rounded-xl bg-blue-600 px-4 font-semibold">Применить расчёт системы</button><button onClick={() => void onApproveManual(row)} className="min-h-11 rounded-xl border border-slate-600 px-4 font-semibold">Оставить ручной расчёт</button></div>}
          </section>
        )}
        <section className="mt-5 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="font-semibold">Структура зарплаты</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {[
              ["Оклад", accrualTotal(["BASE_SALARY"])],
              [
                "Гарантированный бонус",
                accrualTotal(["GUARANTEED_ORDER_BONUS"]),
              ],
              ["Бонусы за заказы", accrualTotal(["ORDER_BONUS"])],
              ["Премии и бонусы", accrualTotal(["PREMIUM", "EXTRA_BONUS"])],
              [
                "Авансы",
                row.payments
                  .filter((x) => x.type === "ADVANCE")
                  .reduce((s, x) => s + Number(x.amount), 0),
              ],
              [
                "Удержания и сторно",
                Math.abs(
                  accrualTotal([
                    "DEDUCTION",
                    "ADJUSTMENT_DECREASE",
                    "BONUS_REVERSAL",
                  ]),
                ),
              ],
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
        {director && !closed && (
          <section className="mt-5">
            <h3 className="mb-3 font-semibold">Действия</h3>
            <div className="grid grid-cols-2 gap-2">
              {director && (
                <Action label="Начислить" onClick={() => onOperation("salaryAccrual", row)} />
              )}
              {canPay && <Action label="Выплатить" onClick={() => onOperation("payment", row)} />}
            </div>
            {director && (
              <details className="mt-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-300">Дополнительные операции</summary>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
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
                    label="Штраф / удержание"
                    onClick={() => onOperation("deduction", row)}
                  />
                  <Action
                    label="Сторно"
                    onClick={() => onOperation("reversal", row)}
                  />
                </div>
              </details>
            )}
          </section>
        )}
        {row.bonusAccruals.length > 0 && (
          <section className="mt-5">
            <h3 className="font-semibold">Бонусы</h3>
            <div className="mt-2 space-y-2">
              {row.bonusAccruals.map((item) => <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><span>{labels[item.type] ?? item.type}{item.order ? ` · ${item.order.number} · ${item.order.client.name}` : item.orderId ? ` · заказ ${item.orderId}` : ""}</span><b>{currency(item.amount)}</b></div><div className="mt-1 flex flex-wrap justify-between gap-2 text-slate-400"><span>{item.status === "PAID" ? "Выплачено" : item.status === "PARTIALLY_PAID" ? "Частично выплачено" : "Начислено"}</span><span>Выплачено {currency(item.paid)} · к выплате {currency(item.payable)}</span></div></div>)}
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
                      <div>
                        <p>{labels[item.type] ?? item.type}{item.confirmationNumber ? ` · ${item.confirmationNumber}` : ""}</p>
                        <p className="text-xs text-slate-500">{dateLabel(item.paymentDate)}{item.method ? ` · ${methodLabels[item.method] ?? item.method}` : ""}{item.externalReference ? ` · Kaspi: ${item.externalReference}` : ""}{item.paidBy?.name ? ` · выдал(а): ${item.paidBy.name}` : ""}{item.comment ? ` · ${item.comment}` : ""}</p>
                      </div>
                      <b className={reversal ? "text-red-300" : "text-emerald-300"}>{reversal ? "−" : ""}{currency(item.amount)}</b>
                    </div>
                    {item.paymentPurpose && (
                      <button
                        type="button"
                        onClick={() => void navigator.clipboard.writeText(item.paymentPurpose!)}
                        className="mt-2 min-h-10 rounded-lg border border-slate-700 px-3 text-sm text-slate-200"
                      >
                        Копировать подтверждение ЗП
                      </button>
                    )}
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
  rows,
  onRowChange,
  form,
  setForm,
  period,
  onClose,
  onSubmit,
}: {
  operation: Operation;
  row: PayrollRow;
  rows: PayrollRow[];
  onRowChange: (row: PayrollRow) => void;
  form: Form;
  setForm: (value: Form) => void;
  period: { year: number; month: number };
  onClose: () => void;
  onSubmit: () => Promise<void>;
}) {
  const titles: Record<Operation, string> = {
      salary: "Назначить новый оклад",
      salaryAccrual: "Начислить оклад за период",
      allowance: "Изменить гарантированный бонус",
      bonus: "Добавить бонус за заказ",
      premium: "Назначить премию",
      deduction: "Добавить штраф / удержание",
      payment: "Зарегистрировать выплату",
      reversal: "Сторнировать начисление",
    },
    reversible = row.accruals.filter(
      (item) =>
        !item.reversalOfId &&
        !item.reversedBy &&
        item.type !== "BONUS_REVERSAL",
    );
  const orderOperation = operation === "bonus" || operation === "deduction";
  const [orderQuery, setOrderQuery] = useState("");
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  useEffect(() => {
    if (!orderOperation) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setOrdersLoading(true);
      try {
        const params = new URLSearchParams({
          q: orderQuery,
          limit: "30",
          year: String(period.year),
          month: String(period.month),
        });
        const response = await fetch(`/api/orders/search?${params}`, {
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (response.ok) setOrders(Array.isArray(body.items) ? body.items : []);
      } finally {
        if (!controller.signal.aborted) setOrdersLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [orderOperation, orderQuery, period.month, period.year]);
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
          {rows.length > 1 && (
            <Field label="Сотрудник">
              <select
                value={row.id}
                onChange={(event) => {
                  const selected = rows.find((item) => item.id === Number(event.target.value));
                  if (selected) onRowChange(selected);
                }}
                className="control"
              >
                {rows.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.user.name} · {employeePosition(item)}
                  </option>
                ))}
              </select>
            </Field>
          )}
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
            <Field label="Сумма, ₸">
              <input
                autoFocus
                type="number"
                min="1"
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
                onChange={(e) => {
                  const type = e.target.value;
                  setForm({
                    ...form,
                    type,
                    method:
                      type === "SALARY_PAYMENT" || type === "FINAL_SETTLEMENT"
                        ? "kaspi"
                        : form.method,
                  });
                }}
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
              <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className="control" disabled={form.type === "SALARY_PAYMENT" || form.type === "FINAL_SETTLEMENT"}>
                <option value="kaspi">Kaspi</option>
                {form.type !== "SALARY_PAYMENT" && form.type !== "FINAL_SETTLEMENT" && <option value="cash">Наличные</option>}
                {form.type !== "SALARY_PAYMENT" && form.type !== "FINAL_SETTLEMENT" && <option value="bank_transfer">Банковский перевод</option>}
                {form.type !== "SALARY_PAYMENT" && form.type !== "FINAL_SETTLEMENT" && <option value="other">Другое</option>}
              </select>
            </Field>
          )}
          {operation === "payment" && (form.type === "SALARY_PAYMENT" || form.type === "FINAL_SETTLEMENT") && (
            <Field label="Референс / номер перевода Kaspi">
              <input
                value={form.externalReference}
                onChange={(e) => setForm({ ...form, externalReference: e.target.value })}
                placeholder="Например: KASPI-02102026-123456"
                maxLength={120}
                className="control"
              />
            </Field>
          )}
          {operation === "payment" && (
            <div className="rounded-xl border border-blue-500/25 bg-blue-500/5 p-3 text-sm text-blue-100">
              <p className="font-semibold">Подтверждение выплаты</p>
              <p className="mt-1 text-xs text-blue-200/80">
                Назначение: {form.reason || `Заработная плата за ${months[period.month - 1].toLowerCase()} ${period.year}`}. После сохранения система присвоит неизменяемый номер документа ЗП-{period.year}{String(period.month).padStart(2, "0")}-XXXXXX.
              </p>
            </div>
          )}
          {operation === "payment" && row.bonusAccruals.some((item) => item.payable > 0) && (
            <Field label="Начисление бонуса (необязательно)">
              <select value={form.accrualId} onChange={(e) => { const item = row.bonusAccruals.find((value) => value.id === Number(e.target.value)); setForm({ ...form, accrualId: e.target.value, amount: item ? String(item.payable) : form.amount, type: item ? "ORDER_BONUS_PAYMENT" : form.type }); }} className="control">
                <option value="">Общая выплата без привязки</option>
                {row.bonusAccruals.filter((item) => item.payable > 0).map((item) => <option key={item.id} value={item.id}>{labels[item.type] ?? item.type}{item.order ? ` · ${item.order.number}` : item.orderId ? ` · заказ ${item.orderId}` : ""} · {currency(item.payable)}</option>)}
              </select>
            </Field>
          )}
          {orderOperation && (
            <Field label={operation === "bonus" ? "Заказ (обязательно)" : "Заказ (необязательно)"}>
              <div className="space-y-2">
                <p className="text-xs text-blue-300">
                  Только заказы за {months[period.month - 1].toLowerCase()} {period.year} года
                </p>
                <input
                  value={orderQuery}
                  onChange={(e) => setOrderQuery(e.target.value)}
                  placeholder="Поиск по номеру заказа, клиенту или телефону"
                  className="control"
                />
                <select
                  value={form.orderId}
                  onChange={(e) => setForm({ ...form, orderId: e.target.value })}
                  className="control"
                >
                  <option value="">{ordersLoading ? "Загрузка заказов…" : operation === "bonus" ? "Выберите заказ" : "Без привязки к заказу"}</option>
                  {orders.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.number} · {item.client.name}{item.client.phone ? ` · ${item.client.phone}` : ""}
                    </option>
                  ))}
                </select>
                {!ordersLoading && orders.length === 0 && (
                  orderQuery ? (
                    <p className="text-sm text-slate-400">Поиск ничего не нашёл в выбранном месяце.</p>
                  ) : (
                    <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-100">
                      За выбранный месяц заказов нет. {" "}
                      <Link href="/orders/new" className="font-semibold underline">
                        Сначала оформите заказ
                      </Link>
                      .
                    </p>
                  )
                )}
              </div>
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
              placeholder={operation === "deduction" ? "Например: не выполнена работа или замечание по заказу" : undefined}
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
                  : Number(form.amount) <= 0 ||
                    (operation === "payment" &&
                      (form.type === "SALARY_PAYMENT" || form.type === "FINAL_SETTLEMENT") &&
                      (form.method !== "kaspi" || form.externalReference.trim().length < 3)) ||
                    (operation === "bonus" && !form.orderId) ||
                    (operation === "deduction" && !form.reason.trim())
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
