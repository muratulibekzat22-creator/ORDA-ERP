"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Pencil,
  Search,
  UserRound,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { companyYearMonth } from "@/lib/company-calendar";
import { payrollRoleAccess } from "@/lib/payroll-policy";

type Accrual = {
  id: number;
  type: string;
  amount: string;
  direction: "INCREASE" | "DECREASE";
  reason: string;
  externalReference?: string | null;
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
  relatedAccrualId?: number | null;
  confirmationNumber?: string;
  paymentPurpose?: string;
};
type PaymentConfirmation = {
  id: number;
  confirmedPaymentId?: number | null;
  amount: string;
  type: string;
  claimedPaymentDate: string;
  method?: string | null;
  comment?: string | null;
  status: "PENDING" | "CONFIRMED" | "REJECTED";
  reviewComment?: string | null;
  createdAt: string;
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
type PayrollOrderBonusHistory = {
  id: number | string;
  createdAt: string;
  actorName: string;
  previousManualBonus: number | null;
  manualBonus: number | null;
  previousEffectiveBonus: number;
  effectiveBonus: number;
  reason?: string | null;
};
type PayrollOrderBonus = {
  orderId: number;
  employeeId: number;
  orderNumber: string;
  clientName: string;
  orderAmount: number;
  earnedAt: string;
  systemSuggestion: number;
  manualBonus: number | null;
  effectiveBonus: number;
  editable: boolean;
  history?: PayrollOrderBonusHistory[];
};
type PayrollRow = {
  id: number;
  userId: number | null;
  position: string;
  hasOrdaAccess: boolean;
  baseSalary: string;
  salaryPlanEnabled: boolean;
  defaultGuaranteedBonus: string;
  user: { id: number; name: string; role: string; active: boolean };
  salaryRates: Array<{
    id: number;
    amount: string;
    planEnabled: boolean;
    effectiveFrom: string;
    effectiveTo?: string | null;
    comment?: string | null;
    approvedBy?: { id: number; name: string };
  }>;
  employmentEnded: boolean;
  terminatedAt?: string | null;
  currentSalary: number;
  salaryEffectiveFrom: string;
  accruals: Accrual[];
  payments: Payment[];
  paymentConfirmations: PaymentConfirmation[];
  totals: { accrued: number; paid: number; pending: number; payable: number };
  breakdown: { salaryAccrued: number; bonusesAccrued: number; premiumsAccrued: number; advancesPaid: number; totalAccrued: number; totalPaid: number; payable: number };
  calculation: {
    salary: number;
    bonuses: number;
    premiums: number;
    deductions: number;
    advances: number;
    otherPayments: number;
    pendingAdvances: number;
    accrued: number;
    totalToAccrue: number;
    remainingToAccrue: number;
    amountToPay: number;
    amountToPayAfterPendingAdvances: number;
    prepared?: number;
    orderBonuses?: number;
    otherBonuses?: number;
    paid?: number;
    remaining?: number;
    priorDebt?: number;
    priorDebtBreakdown?: Array<{
      periodId: number | null;
      year: number;
      month: number;
      prepared: number;
      approvedAmount: number | null;
      paid: number;
      remaining: number;
      debt: number;
      incomplete: boolean;
      missingBonusCount: number;
      approvalStatus: "PRELIMINARY" | "CONFIRMED" | "NEEDS_CORRECTION";
    }>;
    incomplete?: boolean;
    missingBonusCount?: number;
    calculationHash?: string;
    approvalStatus?: "PRELIMINARY" | "CONFIRMED" | "NEEDS_CORRECTION";
    approvedAmount?: number | null;
    approvedAt?: string | null;
    approvedRevision?: number | null;
    hasActivity?: boolean;
  };
  bonusAccruals: Array<{ id: number; orderId?: number | null; order?: OrderOption | null; measurementId?: number | null; type: string; amount: number; accruedAt: string; paid: number; payable: number; status: "ACCRUED" | "PARTIALLY_PAID" | "PAID" }>;
  orderBonuses?: PayrollOrderBonus[];
  calculationHistory?: Array<{
    id: number;
    revision: number;
    preparedAmount: number;
    salaryAmount: number;
    orderBonusAmount: number;
    otherBonusAmount: number;
    premiumAmount: number;
    deductionAmount: number;
    reason: string;
    approvedAt: string;
    approvedBy: { id: number; name: string };
  }>;
  payrollAudit?: PayrollAudit | null;
};
type Payload = {
  period: { id: number; year: number; month: number; status: string } | null;
  rows: PayrollRow[];
  totals: { accrued: number; paid: number; pending: number; payable: number };
  breakdown: { salaryAccrued: number; bonusesAccrued: number; premiumsAccrued: number; advancesPaid: number; totalAccrued: number; totalPaid: number; payable: number };
  settings: { paydayDayOfMonth: number };
  unconfigured?: Array<{ id: number; name: string; role: string }>;
  summaryMode?: "compact" | "detail";
  detailsAvailable?: boolean;
};
type Operation =
  "salary" | "advancePayment" | "partialPayment" | "allowance" | "premium" | "deduction" | "payment" | "advanceReport" | "editAccrual" | "reversal";
type OrderOption = {
  id: number;
  number: string;
  amount?: number | string;
  orderReceivedAt?: string;
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
  new Date(value).toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty" });
const companyDateInput = (value = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: "year" | "month" | "day") =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};
const employeePosition = (row: PayrollRow) =>
  row.position || roleNames[row.user.role] || row.user.role || "Сотрудник";
const salaryPaymentTypes = new Set([
  "ADVANCE",
  "SALARY_PAYMENT",
  "FINAL_SETTLEMENT",
]);
const editablePayrollAccruals = (row: PayrollRow) =>
  row.accruals.filter(
    (item) =>
      !item.reversalOfId &&
      !item.reversedBy &&
      item.type !== "BONUS_REVERSAL" &&
      item.type !== "BASE_SALARY" &&
      item.type !== "ORDER_BONUS" &&
      item.type !== "GUARANTEED_ORDER_BONUS" &&
      !row.payments.some(
        (payment) =>
          payment.relatedAccrualId === item.id &&
          !payment.reversalOfId &&
          !payment.reversedAt,
      ),
  );
const reversiblePayrollAccruals = (row: PayrollRow) =>
  row.accruals.filter(
    (item) =>
      !item.reversalOfId &&
      !item.reversedBy &&
      item.type !== "BONUS_REVERSAL" &&
      item.type !== "BASE_SALARY" &&
      !row.payments.some(
        (payment) =>
          payment.relatedAccrualId === item.id &&
          !payment.reversalOfId &&
          !payment.reversedAt,
      ),
  );
const partialSalaryAvailable = (row: PayrollRow) => {
  if (!row.salaryPlanEnabled || row.employmentEnded) return 0;
  const paidTowardSalary = row.payments
    .filter(
      (item) =>
        !item.reversalOfId &&
        !item.reversedAt &&
        salaryPaymentTypes.has(item.type),
    )
    .reduce((sum, item) => sum + Number(item.amount), 0);
  return Math.max(
    Math.min(row.currentSalary - paidTowardSalary, statementPayable(row)),
    0,
  );
};
const statementAccrued = (row: PayrollRow) =>
  row.calculation.approvedAmount ?? row.calculation.accrued;
const savedOrderBonusTotal = (row: PayrollRow) =>
  (row.orderBonuses ?? []).reduce(
    (sum, item) => sum + (item.manualBonus == null ? 0 : item.manualBonus),
    0,
  );
const legacyOrderBonusTotal = (row: PayrollRow) =>
  (row.orderBonuses ?? []).reduce(
    (sum, item) => sum + Number(item.effectiveBonus || 0),
    0,
  );
const statementOrderBonuses = (row: PayrollRow) =>
  row.calculation.orderBonuses ?? savedOrderBonusTotal(row);
const statementOtherBonuses = (row: PayrollRow) =>
  row.calculation.otherBonuses ??
  Math.max(row.calculation.bonuses - legacyOrderBonusTotal(row), 0);
const statementPrepared = (row: PayrollRow) =>
  row.calculation.prepared ??
  Math.max(
    row.calculation.salary +
      statementOrderBonuses(row) +
      statementOtherBonuses(row) +
      row.calculation.premiums -
      row.calculation.deductions,
    0,
  );
const statementPaid = (row: PayrollRow) =>
  row.calculation.paid ?? row.totals.paid;
const statementPayable = (row: PayrollRow) =>
  row.calculation.remaining ??
  Math.max(statementPrepared(row) - statementPaid(row), 0);
const statementPriorDebt = (row: PayrollRow) =>
  Math.max(row.calculation.priorDebt ?? 0, 0);
const paymentLabel = (payment: Payment) =>
  payment.type === "ADVANCE" &&
  payment.comment?.startsWith("Частичная оплата зарплаты")
    ? "Частичная выплата зарплаты"
    : labels[payment.type] ?? payment.type;
const missingBonusCount = (row: PayrollRow) =>
  row.calculation.missingBonusCount ??
  (row.orderBonuses ?? []).filter((item) => item.manualBonus == null).length;
const calculationIncomplete = (row: PayrollRow) =>
  row.calculation.incomplete ?? missingBonusCount(row) > 0;
const calculationApprovalStatus = (row: PayrollRow) =>
  row.calculation.approvalStatus ??
  (statementAccrued(row) > 0 ? "CONFIRMED" : "PRELIMINARY");
const calculationConfirmed = (row: PayrollRow) =>
  calculationApprovalStatus(row) === "CONFIRMED";
const PAYROLL_PAGE_SIZE = 25;
const errorLabels: Record<string, string> = {
  FORBIDDEN: "Недостаточно прав для этой операции",
  PERIOD_CLOSED: "Закрытый месяц нельзя изменять",
  PERIOD_NOT_OPEN: "Период находится на проверке. Верните его в работу для изменений",
  PAYROLL_NOT_FULLY_PAID: "Закрыть месяц можно после всех выплат и подтверждения авансов. Верните месяц в работу и завершите расчёты.",
  REASON_REQUIRED: "Укажите обязательную причину",
  INVALID_DATE: "Укажите корректную дату",
  INVALID_EFFECTIVE_DATE: "Дата нового оклада пересекается с уже сохранённой историей ставок",
  INVALID_PERIOD_TRANSITION: "Этот переход статуса периода недоступен",
  INVALID_AMOUNT: "Введите сумму больше нуля",
  EMPLOYEE_NOT_FOUND: "Сотрудник не найден",
  ORDER_REQUIRED: "Для бонуса за заказ укажите заказ",
  ORDER_NOT_FOUND: "Заказ не найден",
  ORDER_OUTSIDE_PERIOD: "Выберите заказ из открытого расчётного месяца",
  ORDER_NOT_COMPLETED_FOR_TERMINATED_EMPLOYEE:
    "Для уволенного сотрудника бонус начисляется только после завершения заказа",
  ORDER_NOT_ELIGIBLE_FOR_BONUS: "Отменённый заказ не участвует в расчёте бонуса",
  ORDER_BONUS_ALREADY_EXISTS: "По этому заказу бонус уже начислен. Повторный бонус запрещён",
  BONUS_NOT_FOUND: "Бонус не найден или уже отменён",
  BONUS_PAYMENT_EXISTS: "Этот бонус уже выплачен. Сначала учредитель должен сторнировать выплату",
  BONUS_POLICY_ADJUSTED: "Этот бонус уже пересчитан системой и не требует повторной отмены",
  BONUS_OVERRIDE_REASON_REQUIRED: "Укажите причину ручного изменения суммы",
  INVALID_PERIOD: "Выберите текущий или прошедший расчётный месяц",
  SALARY_ALREADY_ACCRUED: "Оклад за этот месяц уже начислен",
  SALARY_AMOUNT_MISMATCH: "Сумма оклада изменилась. Обновите ведомость и повторите начисление",
  PAYROLL_PERIOD_NOT_STARTED: "Расчётный месяц ещё не начался",
  ACCRUAL_ALREADY_REVERSED: "Это начисление уже сторнировано",
  ACCRUAL_NOT_FOUND: "Начисление не найдено",
  ACCRUAL_NOT_EDITABLE: "Для этого начисления используйте отдельное исправление бонуса",
  ACCRUAL_PAYMENT_EXISTS: "Начисление уже связано с выплатой. Сначала сторнируйте выплату",
  DIRECTOR_CONFIRMATION_REQUIRED: "Финальную выплату зарплаты подтверждает директор",
  PAYROLL_POLICY_NOT_APPLICABLE: "Автоматическая проверка применяется только к зарплате менеджера",
  PAYMENT_EXCEEDS_PAYABLE: "Сумма выплаты превышает подтверждённый остаток к выплате",
  PAYMENT_EXCEEDS_ACCRUAL: "Сумма частичной оплаты превышает остаток начисленного оклада",
  PARTIAL_SALARY_ACCRUAL_REQUIRED: "Сначала начислите оклад за выбранный месяц",
  KASPI_METHOD_REQUIRED: "Финальная зарплата выплачивается через Kaspi",
  KASPI_REFERENCE_REQUIRED: "Если указываете референс Kaspi, введите не менее трёх символов",
  KASPI_REFERENCE_ALREADY_USED: "Этот референс Kaspi уже использован в другой выплате",
  PAYROLL_RECONCILIATION_REQUIRED: "Сначала директор начисляет оклад, а менеджер регистрирует все бонусы по заказам",
  PAYROLL_WORK_INCOMPLETE: "Выплата заблокирована: сначала закройте замечания по заказам, просроченные замеры и контрольные задачи",
  INVALID_ACTION: "Операция не поддерживается",
  PAYROLL_CALCULATION_INCOMPLETE:
    "Расчёт неполный: сначала укажите бонус по каждому подходящему заказу, в том числе 0 ₸.",
  CALCULATION_INCOMPLETE:
    "Расчёт неполный: сначала укажите бонус по каждому подходящему заказу, в том числе 0 ₸.",
  PAYROLL_CALCULATION_UNCHANGED:
    "Расчёт не изменился и уже подтверждён.",
  PAYROLL_CALCULATION_STALE:
    "Расчёт изменился после открытия карточки. Данные обновлены — проверьте сумму и подтвердите ещё раз.",
  PAYROLL_CALCULATION_NOT_CONFIRMED:
    "Сначала руководитель должен подтвердить расчёт зарплаты.",
  PAYROLL_CALCULATION_NEEDS_CORRECTION:
    "Состав зарплаты изменился после подтверждения. Сначала подтвердите новую версию расчёта.",
  ORDER_BONUS_DECISION_REQUIRED:
    "Бонус за заказ сохраняется в строке заказа, а не как отдельное начисление.",
  USE_CONFIRM_CALCULATION:
    "Подтвердите полный расчёт месяца кнопкой «Подтвердить начисление».",
  BONUS_PERIOD_MISMATCH:
    "Бонус уже закреплён за другим расчётным месяцем.",
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
  date: companyDateInput(),
  orderId: "",
  type: "SALARY_PAYMENT",
  accrualId: "",
  method: "kaspi",
  externalReference: "",
});

export default function PayrollPage() {
  const { data: session, status: sessionStatus } = useSession();
  const [selected, setSelected] = useState(() => companyYearMonth());
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
    [detailsLoading, setDetailsLoading] = useState(false),
    [operation, setOperation] = useState<Operation | null>(null),
    [target, setTarget] = useState<PayrollRow | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const loadRequest = useRef(0);
  const detailLoadRequest = useRef(0);
  const detailsIdRef = useRef<number | null>(null);
  const role = session?.user.accountRole || session?.user.role || "",
    roleAccess = payrollRoleAccess(role),
    founder = roleAccess.founder,
    operationsDirector = roleAccess.administrator,
    accountant = roleAccess.accountant,
    adminView = founder || operationsDirector || accountant,
    payrollAdministrator = founder || operationsDirector,
    salaryManager = payrollAdministrator,
    director = payrollAdministrator,
    managerSelfService = role === "MANAGER" && !adminView,
    canCorrectOrderBonuses =
      founder ||
      operationsDirector ||
      (role === "MANAGER" &&
        !(data.period && data.period.status !== "OPEN")),
    advanceSelfService = managerSelfService,
    closed = data.period?.status === "CLOSED",
    locked = Boolean(data.period && data.period.status !== "OPEN");
  const partialPaymentCandidates = data.rows.filter(
    (row) => partialSalaryAvailable(row) > 0,
  );
  const advancePaymentCandidates = data.rows.filter(
    (row) => statementPayable(row) > 0,
  );
  const accrualCorrectionCandidates = data.rows.filter(
    (row) => editablePayrollAccruals(row).length > 0,
  );

  const loadEmployeeDetails = useCallback(
    async (employeeId: number) => {
      const requestId = ++detailLoadRequest.current;
      setDetailsLoading(true);
      const query = new URLSearchParams({
        year: String(selected.year),
        month: String(selected.month),
      });
      if (adminView) query.set("employeeId", String(employeeId));
      try {
        const response = await fetch(
          `${adminView ? "/api/payroll" : "/api/payroll/self"}?${query}`,
        );
        const body = await response.json().catch(() => ({}));
        if (
          requestId !== detailLoadRequest.current ||
          detailsIdRef.current !== employeeId
        )
          return;
        if (!response.ok) {
          setError(
            errorLabels[body.error] ?? "Не удалось загрузить карточку сотрудника",
          );
          return;
        }
        const row = (body as Payload).rows.find(
          (item) => item.id === employeeId,
        );
        if (!row) {
          setError("Сотрудник отсутствует в выбранном расчётном периоде");
          return;
        }
        setDetails(row);
      } catch {
        if (requestId === detailLoadRequest.current)
          setError("Не удалось загрузить карточку сотрудника");
      } finally {
        if (requestId === detailLoadRequest.current) setDetailsLoading(false);
      }
    },
    [adminView, selected.month, selected.year],
  );

  const load = useCallback(async () => {
    if (sessionStatus !== "authenticated") return;
    const requestId = ++loadRequest.current;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({
      year: String(selected.year),
      month: String(selected.month),
    });
    try {
    const response = await fetch(`${adminView ? "/api/payroll" : "/api/payroll/self"}?${query}`);
    const body = await response.json().catch(() => ({}));
    if (requestId !== loadRequest.current) return;
    if (!response.ok)
      setError(errorLabels[body.error] ?? "Не удалось загрузить зарплату");
    else {
      setData(body as Payload);
      if (detailsIdRef.current != null)
        await loadEmployeeDetails(detailsIdRef.current);
    }
    } catch {
      if (requestId === loadRequest.current)
        setError("Не удалось загрузить ведомость. Повторите обновление страницы.");
    } finally {
      if (requestId === loadRequest.current) setLoading(false);
    }
  }, [adminView, loadEmployeeDetails, selected.month, selected.year, sessionStatus]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const changeMonth = (step: number) => {
    setLoading(true);
    loadRequest.current += 1;
    detailsIdRef.current = null;
    detailLoadRequest.current += 1;
    setDetails(null);
    setDetailsLoading(false);
    setPage(1);
    setSelected((value) => {
      const date = new Date(Date.UTC(value.year, value.month - 1 + step, 1));
      return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
    });
  };
  const openDetails = (row: PayrollRow) => {
    detailsIdRef.current = row.id;
    setDetails(row);
    void loadEmployeeDetails(row.id);
  };
  const closeDetails = () => {
    detailsIdRef.current = null;
    detailLoadRequest.current += 1;
    setDetails(null);
    setDetailsLoading(false);
  };
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
      const message =
        errorLabels[result.error] ?? "Не удалось выполнить операцию";
      if (result.error === "PAYROLL_CALCULATION_STALE") await load();
      setError(message);
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
  const saveOrderBonus = async (
    employee: PayrollRow,
    item: PayrollOrderBonus,
    manualBonus: number | null,
  ) => {
    setError("");
    setNotice("");
    const response = await fetch("/api/payroll/bonus-corrections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          action: "save",
          year: selected.year,
          month: selected.month,
          orderId: item.orderId,
          employeeId: employee.id,
          manualBonus,
          reason:
            manualBonus === null
              ? "Бонус не указан в зарплатной карточке"
              : "Изменение бонуса сотруднику в зарплатной карточке",
        }),
      }),
      result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(errorLabels[result.error] ?? "Не удалось сохранить бонус");
      return false;
    }
    setNotice(
      manualBonus === null
        ? "Бонус не указан и не участвует в расчёте"
        : `Бонус сотруднику сохранён: ${currency(manualBonus)}`,
    );
    await load();
    return true;
  };
  const confirmCalculation = async (row: PayrollRow) => {
    if (!data.period) return false;
    if (calculationIncomplete(row)) {
      setError(errorLabels.PAYROLL_CALCULATION_INCOMPLETE);
      return false;
    }
    const correction = calculationApprovalStatus(row) === "NEEDS_CORRECTION";
    return run(
      {
        action: "confirm-calculation",
        employeeId: row.id,
        periodId: data.period.id,
        expectedCalculationHash: row.calculation.calculationHash,
        reason: correction
          ? "Подтверждение корректировки расчёта в зарплатной карточке"
          : "Подтверждение расчёта зарплаты в зарплатной карточке",
      },
      correction
        ? "Корректировка расчёта подтверждена"
        : "Начисление зарплаты подтверждено",
    );
  };
  const openOperation = (
    next: Operation,
    row?: PayrollRow,
    accrual?: Accrual,
  ) => {
    const employee = row ?? details ?? data.rows[0] ?? null;
    const editableAccrual =
      accrual ??
      (employee ? editablePayrollAccruals(employee)[0] : undefined);
    setOperation(next);
    setTarget(employee);
    setForm(next === "salary" && employee
      ? {
          ...emptyForm(),
          amount: String(employee.currentSalary),
          date: `${selected.year}-${String(selected.month).padStart(2, "0")}-01`,
          reason: "Изменение оклада",
        }
      : next === "advancePayment" && employee
        ? {
            ...emptyForm(),
            type: "ADVANCE",
            method: "kaspi",
            reason: `Аванс за ${months[selected.month - 1].toLowerCase()} ${selected.year}`,
          }
      : next === "partialPayment" && employee
        ? {
            ...emptyForm(),
            type: "ADVANCE",
            method: "kaspi",
            reason: `Частичная оплата зарплаты за ${months[selected.month - 1].toLowerCase()} ${selected.year}`,
          }
      : next === "advanceReport"
        ? {
            ...emptyForm(),
            type: "ADVANCE",
            reason: `Заявка на аванс за ${months[selected.month - 1].toLowerCase()} ${selected.year}`,
          }
      : next === "payment" && employee
        ? {
            ...emptyForm(),
            amount: String(Math.max(statementPayable(employee), 0)),
            method: "kaspi",
            reason: `Заработная плата за ${months[selected.month - 1].toLowerCase()} ${selected.year}`,
          }
        : next === "allowance" && employee
          ? {
              ...emptyForm(),
              amount: String(employee.defaultGuaranteedBonus),
              reason: "Изменение гарантированного бонуса",
            }
        : next === "editAccrual" && editableAccrual
          ? {
              ...emptyForm(),
              amount: String(editableAccrual.amount),
              accrualId: String(editableAccrual.id),
              reason: "",
            }
        : emptyForm());
  };
  const submitOperation = async () => {
    if (!target || !operation || !data.period) return;
    const amount = Number(form.amount);
    let body: Record<string, unknown>;
    if (operation === "advanceReport")
      body = {
        action: "request-advance",
        periodId: data.period.id,
        amount,
        claimedPaymentDate: form.date,
        method: form.method,
        comment: form.reason,
      };
    else if (operation === "salary")
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
    else if (
      operation === "payment" ||
      operation === "advancePayment" ||
      operation === "partialPayment"
    )
      body = {
        action: "payment",
        employeeId: target.id,
        periodId: data.period.id,
        amount,
        type:
          operation === "advancePayment" || operation === "partialPayment"
            ? "ADVANCE"
            : form.type,
        paymentDate: form.date,
        method: form.method,
        externalReference: form.externalReference,
        comment: form.reason,
        relatedAccrualId: form.accrualId ? Number(form.accrualId) : undefined,
        partialSalary:
          operation === "advancePayment" || operation === "partialPayment",
      };
    else if (operation === "editAccrual")
      body = {
        action: "correct-accrual",
        id: Number(form.accrualId),
        amount,
        reason: form.reason,
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
        reason: form.reason ||
          labels[
            operation === "premium"
              ? "PREMIUM"
              : operation === "deduction"
                ? "DEDUCTION"
                : "PREMIUM"
          ],
        type:
          operation === "premium"
            ? "PREMIUM"
            : operation === "deduction"
              ? "DEDUCTION"
              : "PREMIUM",
        orderId: form.orderId ? Number(form.orderId) : undefined,
      };
    const saved = operation === "advanceReport"
      ? await runSelf(body, "Заявка на аванс отправлена и ожидает подтверждения")
      : operation === "advancePayment"
        ? await run(
            body,
            `Аванс ${currency(amount)} учтён. Осталось к выплате ${currency(Math.max(statementPayable(target) - amount, 0))}`,
          )
      : operation === "partialPayment"
      ? await run(
          body,
          `Частичная оплата ${currency(amount)} учтена. Осталось к выплате ${currency(Math.max(partialSalaryAvailable(target) - amount, 0))}`,
        )
      : await run(body);
    if (saved) {
      setOperation(null);
      closeDetails();
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
  const reviewPaymentReport = async (
    item: PaymentConfirmation,
    decision: "CONFIRM" | "REJECT",
  ) => {
    const comment = decision === "REJECT"
      ? window.prompt("Причина отклонения заявки на аванс", "Сумма или дата не подтверждены")?.trim()
      : "Аванс подтверждён учредителем";
    if (decision === "REJECT" && !comment) return;
    await run(
      {
        action: "review-payment-confirmation",
        id: item.id,
        decision,
        comment,
      },
      decision === "CONFIRM" ? "Заявка на аванс подтверждена и учтена в расчёте" : "Заявка на аванс отклонена",
    );
  };
  const statementRows = useMemo(
    () => (loading ? [] : data.rows),
    [data.rows, loading],
  );
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase("ru-RU");
  const filteredRows = useMemo(
    () =>
      normalizedSearch
        ? statementRows.filter((row) =>
            `${row.user.name} ${employeePosition(row)}`
              .toLocaleLowerCase("ru-RU")
              .includes(normalizedSearch),
          )
        : statementRows,
    [statementRows, normalizedSearch],
  );
  const pageCount = Math.max(
    1,
    Math.ceil(filteredRows.length / PAYROLL_PAGE_SIZE),
  );
  const currentPage = Math.min(page, pageCount);
  const visibleRows = filteredRows.slice(
    (currentPage - 1) * PAYROLL_PAGE_SIZE,
    currentPage * PAYROLL_PAGE_SIZE,
  );
  const statementPreparedTotal = statementRows.reduce(
    (sum, row) => sum + statementPrepared(row),
    0,
  );
  const statementAccruedTotal = statementRows.reduce(
    (sum, row) => sum + statementAccrued(row),
    0,
  );
  const statementPayableTotal = statementRows.reduce(
    (sum, row) => sum + statementPayable(row),
    0,
  );
  const statementPaidTotal = statementRows.reduce(
    (sum, row) => sum + statementPaid(row),
    0,
  );
  const unsettledRows = data.rows.filter((row) => {
    const hasCalculationActivity =
      row.calculation.hasActivity ??
      (Math.abs(statementPrepared(row)) > 0.01 ||
        Math.abs(statementPaid(row)) > 0.01 ||
        calculationIncomplete(row));
    return (
      statementPayable(row) > 0.01 ||
      row.totals.pending > 0.01 ||
      calculationIncomplete(row) ||
      (hasCalculationActivity &&
        calculationApprovalStatus(row) !== "CONFIRMED")
    );
  });
  const stats: Array<[string, number, LucideIcon, string]> = [
    ["К начислению", statementPreparedTotal, CircleDollarSign, "text-blue-200"],
    ["Начислено", statementAccruedTotal, CircleDollarSign, "text-white"],
    ["Выплачено", statementPaidTotal, Check, "text-emerald-300"],
    ["Осталось выплатить", statementPayableTotal, Banknote, "text-amber-300"],
  ];

  if (sessionStatus === "loading")
    return <div className="p-8 text-slate-400">Загрузка…</div>;
  return (
    <main className="min-h-full bg-slate-950 p-4 text-white md:p-6 xl:p-8">
      <div className="mx-auto max-w-[1500px]">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-blue-400">
              Финансы · Payroll
            </p>
            <h1 className="mt-1 text-2xl font-bold md:text-3xl">
              {adminView ? "Зарплаты" : "Моя зарплата"}
            </h1>
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
            {!loading && data.period && (
              <span
                className={`rounded-full px-3 py-2 text-sm font-semibold ${closed ? "bg-slate-700" : data.period.status === "REVIEW" ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"}`}
              >
                {labels[data.period.status]}
              </span>
            )}
          </div>
        </header>
        {salaryManager && !loading && (
          <details className="mt-3 w-fit max-w-full rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold text-slate-300">Управление месяцем</summary>
            <div className="mt-3 flex flex-wrap gap-2">
              {!data.period && <button onClick={() => void run({ action: "create-period", ...selected }, "Месяц открыт")} className="min-h-11 rounded-xl bg-blue-600 px-4 font-semibold">Открыть месяц</button>}
              {data.period?.status === "OPEN" && <button onClick={() => void transitionPeriod("REVIEW")} className="min-h-11 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 font-semibold text-amber-200">На проверку</button>}
              {data.period?.status === "REVIEW" && <><button onClick={() => void transitionPeriod("OPEN")} className="min-h-11 rounded-xl border border-slate-600 px-4 font-semibold">Вернуть в работу</button><button onClick={() => void transitionPeriod("CLOSED")} disabled={unsettledRows.length > 0} className="min-h-11 rounded-xl border border-red-500/40 bg-red-500/10 px-4 font-semibold text-red-300 disabled:cursor-not-allowed disabled:opacity-40">Закрыть месяц</button>{unsettledRows.length > 0 && <span className="self-center text-sm text-amber-200">Есть незавершённые расчёты, выплаты или авансы: {unsettledRows.length} сотрудник(а). Сначала верните месяц в работу.</span>}</>}
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
        {salaryManager && (
          <section className="mt-4 rounded-2xl border border-blue-500/25 bg-blue-500/5 p-4 text-sm text-slate-200">
            <h2 className="font-bold text-white">Порядок начисления зарплаты</h2>
            <p className="mt-2 leading-6">Система предлагает бонус: до 3 000 000 ₸ включительно — 30 000 ₸, выше — 50 000 ₸. Итоговую сумму за заказ вводят менеджер, директор или основатель. Заказы с ответственным «Компания» не дают менеджерский бонус. Расчётный месяц всегда определяется фактической датой заказа; уволенному менеджеру бонус становится доступен только после завершения заказа.</p>
            <p className="mt-2 leading-6">«Начислено» — только сохранённый и подтверждённый руководителем расчёт. Предложенные бонусы сюда не входят. «Выплачено» — подтверждённые выплаты. «К выплате» — остаток подтверждённого расчёта после выплат. Оклад без назначения не создаёт долг.</p>
            <p className="mt-2 text-amber-100">Данные о зарплате, клиентах, ценах и доступах конфиденциальны и используются только внутри компании согласно NDA.</p>
          </section>
        )}
        <section className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3">
          {stats.map(([label, value, Icon, color]) => (
            <article
              key={label}
              className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/70 p-3 sm:p-4"
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
        {adminView && !loading && Boolean(data.unconfigured?.length) && (
          <details className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-amber-100">
              Оклад не настроен: {data.unconfigured!.length}
            </summary>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {data.unconfigured!.map((user) => (
                <div key={user.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-900 p-3">
                  <span><b>{user.name}</b><small className="block text-slate-400">{roleNames[user.role] ?? user.role}</small></span>
                  {salaryManager && (
                    <Link
                      href="/employees"
                      className="flex min-h-10 items-center rounded-lg bg-blue-600 px-3 font-semibold"
                    >
                      Открыть профиль
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
        <section className="mt-5" aria-labelledby="payroll-table-title">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="payroll-table-title" className="font-semibold">
                Сотрудники
              </h2>
              <p className="mt-1 max-w-2xl text-xs text-slate-400">
                «К начислению» — полный расчёт выбранного месяца до вычета
                выплат. «Начислено» показывает только сумму, подтверждённую
                руководителем. До подтверждения расчёт предварительный.
              </p>
            </div>
            {data.rows.length > 0 && (
              <label className="relative block w-full sm:w-72">
                <span className="sr-only">Найти сотрудника</span>
                <Search
                  size={17}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Найти сотрудника"
                  className="control min-h-11 pl-10"
                />
              </label>
            )}
          </div>
          {loading ? (
            <Empty text="Загружаем ведомость…" />
          ) : !data.period ? (
            <Empty
              text={
                salaryManager
                  ? "Период ещё не открыт. Откройте месяц, чтобы начать работу."
                  : "За выбранный месяц расчётный период ещё не открыт."
              }
            />
          ) : !data.rows.length ? (
            <Empty text="Сотрудников в расчётном периоде пока нет." />
          ) : !filteredRows.length ? (
            <Empty text="Поиск не нашёл сотрудников." />
          ) : (
            <>
              <div className="hidden overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 lg:block">
                <table className="w-full min-w-[940px] text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      {[
                        "Сотрудник",
                        "К начислению",
                        "Начислено",
                        "Выплачено",
                        "Осталось выплатить",
                        "Статус",
                        "",
                      ].map((title) => (
                        <th key={title || "actions"} className="px-3 py-3 xl:px-4">
                          {title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <PayrollTableRow
                        key={row.id}
                        row={row}
                        onOpen={() => openDetails(row)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 lg:hidden">
                {visibleRows.map((row) => (
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
                      <Status row={row} />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-sm min-[520px]:grid-cols-4">
                      <Metric
                        label="К начислению"
                        value={statementPrepared(row)}
                      />
                      <Metric label="Начислено" value={statementAccrued(row)} />
                      <Metric label="Выплачено" value={statementPaid(row)} />
                      <Metric
                        label="Осталось"
                        value={statementPayable(row)}
                        accent
                      />
                    </div>
                    <button
                      onClick={() => openDetails(row)}
                      className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 font-medium"
                    >
                      Открыть <ChevronRight size={17} />
                    </button>
                  </article>
                ))}
              </div>
              {pageCount > 1 && (
                <nav
                  className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"
                  aria-label="Страницы сотрудников"
                >
                  <span className="text-slate-400">
                    {Math.min((currentPage - 1) * PAYROLL_PAGE_SIZE + 1, filteredRows.length)}–
                    {Math.min(currentPage * PAYROLL_PAGE_SIZE, filteredRows.length)} из{" "}
                    {filteredRows.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPage(Math.max(currentPage - 1, 1))}
                      disabled={currentPage <= 1}
                      className="min-h-10 rounded-lg border border-slate-700 px-3 font-medium disabled:opacity-40"
                    >
                      Назад
                    </button>
                    <span className="min-w-16 text-center tabular-nums text-slate-300">
                      {currentPage} / {pageCount}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setPage(Math.min(currentPage + 1, pageCount))
                      }
                      disabled={currentPage >= pageCount}
                      className="min-h-10 rounded-lg border border-slate-700 px-3 font-medium disabled:opacity-40"
                    >
                      Далее
                    </button>
                  </div>
                </nav>
              )}
            </>
          )}
        </section>
      </div>
      {details && (
        <EmployeeDrawer
          row={details}
          loading={detailsLoading}
          director={director}
          canManageSalary={salaryManager}
          canManageAccruals={payrollAdministrator}
          canReviewPayments={payrollAdministrator}
          canConfirmCalculation={payrollAdministrator}
          canReportAdvance={advanceSelfService && Boolean(data.period) && !locked}
          orderBonuses={details.orderBonuses ?? []}
          canCorrectOrderBonuses={canCorrectOrderBonuses}
          canPay={director && !closed}
          closed={locked}
          period={selected}
          onClose={closeDetails}
          onOperation={openOperation}
          onReversePayment={reversePayrollPayment}
          onReviewPayment={reviewPaymentReport}
          onSaveOrderBonus={saveOrderBonus}
          onConfirmCalculation={confirmCalculation}
        />
      )}{" "}
      {operation && target && data.period && (
        <OperationModal
          operation={operation}
          row={target}
          rows={
            operation === "advancePayment"
              ? advancePaymentCandidates
              : operation === "partialPayment"
                ? partialPaymentCandidates
                : operation === "editAccrual"
                  ? accrualCorrectionCandidates
                : data.rows
          }
          onRowChange={(row) => {
            setTarget(row);
            const firstEditableAccrual = editablePayrollAccruals(row)[0];
            setForm(operation === "salary"
              ? {
                  ...emptyForm(),
                  amount: String(row.currentSalary),
                  date: `${selected.year}-${String(selected.month).padStart(2, "0")}-01`,
                  reason: "Изменение оклада",
                }
              : operation === "advancePayment"
                ? {
                    ...emptyForm(),
                    type: "ADVANCE",
                    method: "kaspi",
                    reason: `Аванс за ${months[selected.month - 1].toLowerCase()} ${selected.year}`,
                  }
              : operation === "partialPayment"
                ? {
                    ...emptyForm(),
                    type: "ADVANCE",
                    method: "kaspi",
                    reason: `Частичная оплата зарплаты за ${months[selected.month - 1].toLowerCase()} ${selected.year}`,
                  }
              : operation === "advanceReport"
                ? {
                    ...emptyForm(),
                    type: "ADVANCE",
                    reason: `Заявка на аванс за ${months[selected.month - 1].toLowerCase()} ${selected.year}`,
                  }
              : operation === "payment"
                ? {
                    ...emptyForm(),
                    amount: String(Math.max(statementPayable(row), 0)),
                    method: "kaspi",
                    reason: `Заработная плата за ${months[selected.month - 1].toLowerCase()} ${selected.year}`,
                  }
              : operation === "allowance"
                ? {
                    ...emptyForm(),
                    amount: String(row.defaultGuaranteedBonus),
                    reason: "Изменение гарантированного бонуса",
                  }
              : operation === "editAccrual" && firstEditableAccrual
                ? {
                    ...emptyForm(),
                    amount: String(firstEditableAccrual.amount),
                    accrualId: String(firstEditableAccrual.id),
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
      <td className="px-3 py-4 tabular-nums xl:px-4">
        {currency(statementPrepared(row))}
      </td>
      <td className="px-3 py-4 tabular-nums xl:px-4">
        {currency(statementAccrued(row))}
      </td>
      <td className="px-3 py-4 tabular-nums text-emerald-300 xl:px-4">
        {currency(statementPaid(row))}
      </td>
      <td className="px-3 py-4 font-bold tabular-nums text-amber-300 xl:px-4">
        {currency(statementPayable(row))}
      </td>
      <td className="px-3 py-4 xl:px-4">
        <Status row={row} />
      </td>
      <td className="px-3 py-4 xl:px-4">
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
function Status({ row }: { row: PayrollRow }) {
  const payable = statementPayable(row);
  const paid = statementPaid(row);
  const prepared = statementPrepared(row);
  const approval = calculationApprovalStatus(row);
  const value = calculationIncomplete(row)
    ? "Расчёт неполный"
    : approval === "NEEDS_CORRECTION"
      ? "Нужна корректировка"
      : approval !== "CONFIRMED"
        ? "Предварительный"
        : payable > 0 && paid > 0
          ? "Частично выплачено"
          : payable > 0
            ? "Начислено"
            : prepared > 0 && paid > 0
              ? "Выплачено"
              : "Подтверждено";
  const tone =
    value === "Расчёт неполный" || value === "Нужна корректировка"
      ? "bg-amber-500/15 text-amber-200"
      : value === "Выплачено"
        ? "bg-emerald-500/15 text-emerald-300"
        : value === "Предварительный"
          ? "bg-slate-700/60 text-slate-200"
          : "bg-blue-500/15 text-blue-300";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}
    >
      {value}
    </span>
  );
}
function Metric({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: number;
  accent?: boolean;
  hint?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-950 p-2">
      <p className="text-[11px] leading-tight text-slate-500">{label}</p>
      <p
        className={`mt-1 break-words text-sm font-semibold tabular-nums sm:text-base ${accent ? "text-amber-300" : ""}`}
      >
        {currency(value)}
      </p>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function OrderBonusEditorList({
  items,
  canEdit,
  onSave,
}: {
  items: PayrollOrderBonus[];
  canEdit: boolean;
  onSave: (item: PayrollOrderBonus, manualBonus: number | null) => Promise<boolean>;
}) {
  if (items.length === 0)
    return (
      <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
        Подходящих заказов сотрудника в выбранном месяце нет.
      </p>
    );
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <OrderBonusEditorRow
          key={`${item.orderId}-${item.manualBonus ?? "missing"}-${item.history?.length ?? 0}`}
          item={item}
          canEdit={canEdit && item.editable}
          onSave={onSave}
        />
      ))}
    </div>
  );
}

function OrderBonusEditorRow({
  item,
  canEdit,
  onSave,
}: {
  item: PayrollOrderBonus;
  canEdit: boolean;
  onSave: (item: PayrollOrderBonus, manualBonus: number | null) => Promise<boolean>;
}) {
  const [value, setValue] = useState(
    item.manualBonus === null ? "" : String(item.manualBonus),
  );
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");
  const save = async (nextValue = value) => {
    const trimmed = nextValue.trim();
    const manualBonus = trimmed === "" ? null : Number(trimmed);
    if (
      manualBonus !== null &&
      (!Number.isFinite(manualBonus) || manualBonus < 0)
    ) {
      setLocalError("Укажите сумму от 0 ₸ или оставьте поле пустым.");
      return;
    }
    setSaving(true);
    setLocalError("");
    try {
      const saved = await onSave(item, manualBonus);
      if (!saved) setLocalError("Не удалось сохранить бонус. Проверьте данные.");
    } catch {
      setLocalError("Не удалось сохранить бонус. Повторите попытку.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <article className="min-w-0 rounded-xl border border-slate-800 bg-slate-950 p-3 sm:p-4">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words font-semibold text-white">
            {item.orderNumber} · {item.clientName}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Факт заказа {dateLabel(item.earnedAt)}
          </p>
        </div>
        <b className="shrink-0 tabular-nums text-slate-200">
          {currency(item.orderAmount)}
        </b>
      </div>
      <div className="mt-3 grid gap-2 min-[480px]:grid-cols-2">
        <div className="rounded-lg bg-slate-900 px-3 py-2">
          <p className="text-xs text-slate-500">Подсказка системы</p>
          <b className="mt-1 block tabular-nums text-blue-200">
            {currency(item.systemSuggestion)}
          </b>
        </div>
        <div className="rounded-lg bg-slate-900 px-3 py-2">
          <p className="text-xs text-slate-500">Сохранённый бонус</p>
          <b
            className={`mt-1 block tabular-nums ${item.manualBonus == null ? "text-amber-200" : "text-emerald-200"}`}
          >
            {item.manualBonus == null
              ? "Не указан"
              : currency(item.manualBonus)}
          </b>
        </div>
      </div>
      <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="min-w-0 text-sm text-slate-300">
          <span className="mb-1.5 block font-medium">Бонус сотруднику</span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={value}
            disabled={!canEdit || saving}
            onChange={(event) => {
              setValue(event.target.value);
              setLocalError("");
            }}
            placeholder="Не указан"
            aria-label={`Бонус сотруднику за заказ ${item.orderNumber}`}
            className="control tabular-nums disabled:opacity-60"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Пустое поле не участвует в расчёте. Значение 0 ₸ — сохранённое
            решение.
          </span>
        </label>
        <div className="grid gap-2 min-[420px]:grid-cols-2 sm:flex">
          <button
            type="button"
            disabled={!canEdit || saving}
            onClick={() => {
              const suggestion = String(item.systemSuggestion);
              setValue(suggestion);
              void save(suggestion);
            }}
            className="min-h-11 rounded-xl border border-blue-500/50 px-3 font-semibold text-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Применить {currency(item.systemSuggestion)}
          </button>
          <button
            type="button"
            disabled={!canEdit || saving}
            onClick={() => void save()}
            className="min-h-11 rounded-xl bg-blue-600 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      </div>
      {localError && <p className="mt-2 text-sm text-red-300">{localError}</p>}
      {!canEdit && (
        <p className="mt-2 text-xs text-slate-500">
          Изменение недоступно для вашей роли или текущего ответственного заказа.
        </p>
      )}
    </article>
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
  loading,
  director,
  canManageSalary,
  canManageAccruals,
  canReviewPayments,
  canConfirmCalculation,
  canReportAdvance,
  canPay,
  orderBonuses,
  canCorrectOrderBonuses,
  closed,
  period,
  onClose,
  onOperation,
  onReversePayment,
  onReviewPayment,
  onSaveOrderBonus,
  onConfirmCalculation,
}: {
  row: PayrollRow;
  loading: boolean;
  director: boolean;
  canManageSalary: boolean;
  canManageAccruals: boolean;
  canReviewPayments: boolean;
  canConfirmCalculation: boolean;
  canReportAdvance: boolean;
  canPay: boolean;
  orderBonuses: PayrollOrderBonus[];
  canCorrectOrderBonuses: boolean;
  closed: boolean;
  period: { year: number; month: number };
  onClose: () => void;
  onOperation: (
    operation: Operation,
    row: PayrollRow,
    accrual?: Accrual,
  ) => void;
  onReversePayment: (item: Payment) => Promise<unknown>;
  onReviewPayment: (item: PaymentConfirmation, decision: "CONFIRM" | "REJECT") => Promise<unknown>;
  onSaveOrderBonus: (
    employee: PayrollRow,
    item: PayrollOrderBonus,
    manualBonus: number | null,
  ) => Promise<boolean>;
  onConfirmCalculation: (row: PayrollRow) => Promise<unknown>;
}) {
  type DrawerHistoryItem = {
    id: string;
    date: string;
    title: string;
    amount: number;
    reason: string;
    accrual: Accrual | null;
    payment: Payment | null;
    displayAsSnapshot?: boolean;
  };
  const history: DrawerHistoryItem[] = [
    ...row.accruals.map((item) => ({
      id: `a-${item.id}`,
      date: item.createdAt,
      title: `${labels[item.type] ?? item.type}${item.order ? ` · ${item.order.number}` : ""}`,
      amount: Number(item.amount) * (item.direction === "DECREASE" ? -1 : 1),
      reason: `${item.reason}${item.externalReference ? ` · Референс: ${item.externalReference}` : ""}`,
      accrual: item,
      payment: null,
    })),
    ...row.payments.map((item) => ({
      id: `p-${item.id}`,
      date: item.paymentDate,
      title: paymentLabel(item),
      amount:
        item.type === "EMPLOYEE_REFUND"
          ? Number(item.amount)
          : -Number(item.amount),
      reason: `${item.paidBy?.name ? `Автор: ${item.paidBy.name}` : ""}${item.comment ? `${item.paidBy?.name ? " · " : ""}${item.comment}` : ""}`,
      accrual: null,
      payment: item,
    })),
    ...orderBonuses.flatMap((bonus) =>
      (bonus.history ?? []).map((item) => {
        const previous = item.previousEffectiveBonus;
        const next = item.effectiveBonus;
        return {
          id: `b-${bonus.orderId}-${item.id}`,
          date: item.createdAt,
          title: `Бонус за заказ · ${bonus.orderNumber}`,
          amount: next - previous,
          reason: `${item.actorName} · ${currency(previous)} → ${currency(next)}${item.reason ? ` · ${item.reason}` : ""}`,
          accrual: null,
          payment: null,
        };
      }),
    ),
    ...row.salaryRates.map((rate) => ({
      id: `s-${rate.id}`,
      date: rate.effectiveFrom,
      title: "Изменение оклада",
      amount: rate.planEnabled ? Number(rate.amount) : 0,
      reason: `${rate.approvedBy?.name ?? "Система"}${rate.comment ? ` · ${rate.comment}` : ""}`,
      accrual: null,
      payment: null,
    })),
    ...(row.calculationHistory ?? []).map((item) => ({
      id: `c-${item.id}`,
      date: item.approvedAt,
      title:
        item.revision === 1
          ? "Подтверждение начисления"
          : `Корректировка расчёта · версия ${item.revision}`,
      amount: item.preparedAmount,
      reason: `${item.approvedBy.name} · ${item.reason} · оклад ${currency(item.salaryAmount)}, заказы ${currency(item.orderBonusAmount)}, прочие бонусы ${currency(item.otherBonusAmount)}, премии ${currency(item.premiumAmount)}, удержания ${currency(item.deductionAmount)}`,
      accrual: null,
      payment: null,
      displayAsSnapshot: true,
    })),
  ].sort((a, b) => +new Date(b.date) - +new Date(a.date));
  const editableAccruals = editablePayrollAccruals(row);
  const reversibleAccruals = reversiblePayrollAccruals(row);
  const prepared = statementPrepared(row);
  const accrued = statementAccrued(row);
  const paid = statementPaid(row);
  const remaining = statementPayable(row);
  const priorDebt = statementPriorDebt(row);
  const orderBonusTotal = statementOrderBonuses(row);
  const otherBonuses = statementOtherBonuses(row);
  const incomplete = calculationIncomplete(row);
  const approvalStatus = calculationApprovalStatus(row);
  const confirmed = calculationConfirmed(row);
  const needsCorrection = approvalStatus === "NEEDS_CORRECTION";
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
      <aside
        className="relative h-dvh min-w-0 w-full max-w-3xl overflow-x-hidden overflow-y-auto border-l border-slate-700 bg-slate-950 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6"
        data-scroll-region
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-full bg-blue-500/15 text-blue-300 sm:size-12">
              <UserRound />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold">{row.user.name}</h2>
                {row.employmentEnded && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-1 text-xs font-semibold text-amber-200">
                    Уволен · бонус после завершения заказа
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-400">
                {employeePosition(row)} · {months[period.month - 1]}{" "}
                {period.year}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {row.salaryPlanEnabled
                  ? `Условие оплаты: ${currency(row.currentSalary)} с ${dateLabel(row.salaryEffectiveFrom)}`
                  : "Оклад не задан"}
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
        {loading && (
          <div
            className="mt-4 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-100"
            role="status"
          >
            Обновляем расчёт, заказы и историю сотрудника…
          </div>
        )}
        <div className="mt-5 grid gap-2 min-[480px]:grid-cols-3">
          <Metric label="Начислено" value={accrued} />
          <Metric label="Выплачено" value={paid} />
          <Metric
            label="Осталось выплатить"
            value={remaining}
            accent
            hint={confirmed ? "По утверждённому расчёту" : "Предварительно"}
          />
        </div>
        <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Состав зарплаты</h3>
            <Status row={row} />
          </div>
          <div className="mt-3 space-y-1.5 text-sm">
            <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-slate-950 px-3 py-2">
              <span className="min-w-0 text-slate-400">Оклад</span>
              <b className="shrink-0 tabular-nums">
                {row.salaryPlanEnabled
                  ? currency(row.calculation.salary)
                  : "Не задан"}
              </b>
            </div>
            {[
              ["Сохранённые бонусы за заказы", orderBonusTotal],
              ["Другие бонусы", otherBonuses],
              ["Премии", row.calculation.premiums],
              [
                "Удержания",
                row.calculation.deductions > 0
                  ? -row.calculation.deductions
                  : 0,
              ],
            ].map(([label, amount]) => (
              <div
                key={String(label)}
                className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-slate-950 px-3 py-2"
              >
                <span className="min-w-0 text-slate-400">{String(label)}</span>
                <b className="shrink-0 tabular-nums">{currency(amount as number)}</b>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 rounded-xl bg-blue-500/10 px-3 py-2 text-blue-100">
              <span className="font-semibold">К начислению</span>
              <b className="shrink-0 tabular-nums">{currency(prepared)}</b>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-950 px-3 py-2">
              <span className="text-slate-400">Авансы и выплаты</span>
              <b className="shrink-0 tabular-nums text-emerald-300">
                {paid > 0 ? `−${currency(paid)}` : currency(0)}
              </b>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-amber-100">
              <span className="font-semibold">Осталось выплатить</span>
              <b className="shrink-0 tabular-nums">{currency(remaining)}</b>
            </div>
          </div>
          {incomplete && (
            <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              Расчёт неполный: бонус не указан по {missingBonusCount(row)}{" "}
              {missingBonusCount(row) === 1 ? "заказу" : "заказам"}. Укажите
              сумму или сохраните 0 ₸.
            </p>
          )}
          {confirmed && (
            <p className="mt-3 text-xs text-emerald-300">
              Подтверждено{row.calculation.approvedAt ? ` ${dateLabel(row.calculation.approvedAt)}` : ""}
              {row.calculation.approvedRevision
                ? ` · версия ${row.calculation.approvedRevision}`
                : ""}
              .
            </p>
          )}
          {canConfirmCalculation && (!confirmed || needsCorrection) && (
            <button
              type="button"
              disabled={incomplete}
              onClick={() => void onConfirmCalculation(row)}
              className="mt-3 min-h-11 w-full rounded-xl bg-blue-600 px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            >
              {needsCorrection
                ? "Подтвердить корректировку"
                : "Подтвердить начисление"}
            </button>
          )}
          {priorDebt > 0 && (
            <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-amber-100">Долг за прошлые месяцы</span>
                <b className="shrink-0 tabular-nums text-amber-200">
                  {currency(priorDebt)}
                </b>
              </div>
              {(row.calculation.priorDebtBreakdown ?? []).map((item) => (
                <div
                  key={`${item.year}-${item.month}`}
                  className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-amber-500/20 pt-2 text-xs"
                >
                  <span className="text-slate-300">
                    {months[item.month - 1]} {item.year}
                    {item.approvalStatus === "PRELIMINARY"
                      ? " · предварительно"
                      : item.approvalStatus === "NEEDS_CORRECTION"
                        ? " · требуется корректировка"
                        : " · подтверждено"}
                    {item.incomplete
                      ? ` · не указано бонусов: ${item.missingBonusCount}`
                      : ""}
                  </span>
                  <b className="tabular-nums text-amber-200">
                    {currency(item.debt)}
                  </b>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="font-semibold">Заказы и бонусы</h3>
          <p className="mt-1 text-xs text-slate-400">
            Система предлагает бонус только как подсказку и не включает его в
            расчёт сама. Пустой бонус означает «Не указан»; 0 ₸ — сохранённое
            решение.
          </p>
          <div className="mt-3">
            <OrderBonusEditorList
              items={orderBonuses}
              canEdit={
                canCorrectOrderBonuses &&
                (canManageSalary || approvalStatus === "PRELIMINARY")
              }
              onSave={(item, manualBonus) =>
                onSaveOrderBonus(row, item, manualBonus)
              }
            />
          </div>
        </section>
        <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Авансы и выплаты</h3>
            <div className="flex flex-wrap gap-2">
              {canReportAdvance && (
                <button
                  type="button"
                  onClick={() => onOperation("advanceReport", row)}
                  className="min-h-10 rounded-lg border border-emerald-500/40 px-3 text-sm font-semibold text-emerald-200"
                >
                  Запросить аванс
                </button>
              )}
              {canPay && remaining > 0 && (
                <button
                  type="button"
                  onClick={() => onOperation("advancePayment", row)}
                  className="min-h-10 rounded-lg border border-blue-500/40 px-3 text-sm font-semibold text-blue-200"
                >
                  Выдать аванс
                </button>
              )}
              {canPay && partialSalaryAvailable(row) > 0 && (
                <button
                  type="button"
                  onClick={() => onOperation("partialPayment", row)}
                  className="min-h-10 rounded-lg border border-emerald-500/40 px-3 text-sm font-semibold text-emerald-200"
                >
                  Частичная выплата
                </button>
              )}
              {canPay && remaining > 0 && (
                <button
                  type="button"
                  onClick={() => onOperation("payment", row)}
                  className="min-h-10 rounded-lg bg-emerald-600 px-3 text-sm font-semibold"
                >
                  Выплатить остаток
                </button>
              )}
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {row.payments.length === 0 &&
              row.paymentConfirmations.length === 0 && (
                <p className="rounded-xl border border-dashed border-slate-700 p-3 text-sm text-slate-400">
                  Авансов и выплат за выбранный месяц нет.
                </p>
              )}
            {row.payments.map((item) => (
              <div
                key={`payment-${item.id}`}
                className="flex flex-wrap items-start justify-between gap-2 rounded-xl bg-slate-950 p-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {paymentLabel(item)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {dateLabel(item.paymentDate)}
                    {item.method
                      ? ` · ${methodLabels[item.method] ?? item.method}`
                      : ""}
                    {item.confirmationNumber
                      ? ` · ${item.confirmationNumber}`
                      : ""}
                  </p>
                </div>
                <b className="tabular-nums text-emerald-200">
                  {currency(item.amount)}
                </b>
              </div>
            ))}
            {row.paymentConfirmations
              .filter(
                (item) =>
                  item.status !== "CONFIRMED" || !item.confirmedPaymentId,
              )
              .map((item) => (
              <div key={`confirmation-${item.id}`} className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{labels[item.type] ?? item.type} · {labels[item.status] ?? item.status}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {dateLabel(item.claimedPaymentDate)}{item.method ? ` · ${methodLabels[item.method] ?? item.method}` : ""}{item.comment ? ` · ${item.comment}` : ""}
                    </p>
                  </div>
                  <b className="text-blue-200">{currency(item.amount)}</b>
                </div>
                {item.reviewComment && <p className="mt-2 text-xs text-slate-400">Решение: {item.reviewComment}</p>}
                {canReviewPayments && !closed && item.status === "PENDING" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={() => void onReviewPayment(item, "CONFIRM")} className="min-h-10 rounded-lg bg-emerald-600 px-3 font-semibold">Подтвердить аванс</button>
                    <button onClick={() => void onReviewPayment(item, "REJECT")} className="min-h-10 rounded-lg border border-red-500/40 px-3 font-semibold text-red-200">Отклонить</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {row.calculation.pendingAdvances > 0 && (
            <p className="mt-3 text-xs text-blue-200/80">
              Ожидает подтверждения: {currency(row.calculation.pendingAdvances)}.
              Эта сумма ещё не считается выплатой.
            </p>
          )}
        </section>
        {(canManageSalary || canManageAccruals) && (
          <details className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <summary className="cursor-pointer font-semibold text-slate-300">
              Настройки и корректировки
            </summary>
            <div className="mt-3 grid gap-2 min-[420px]:grid-cols-2 sm:grid-cols-3">
              {canManageSalary && (
                <Action label="Изменить оклад" onClick={() => onOperation("salary", row)} />
              )}
              {canManageSalary && (
                <Action label="Условие бонуса" onClick={() => onOperation("allowance", row)} />
              )}
              {canManageAccruals && !closed && (
                <Action label="Добавить премию" onClick={() => onOperation("premium", row)} />
              )}
              {canManageAccruals && !closed && (
                <Action label="Добавить удержание" onClick={() => onOperation("deduction", row)} />
              )}
              {canManageAccruals && !closed && editableAccruals.length > 0 && (
                <Action label="Редактировать начисление" onClick={() => onOperation("editAccrual", row, editableAccruals[0])} />
              )}
              {canManageAccruals && !closed && reversibleAccruals.length > 0 && (
                <Action label="Сторно" onClick={() => onOperation("reversal", row)} />
              )}
            </div>
          </details>
        )}
        <details className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <summary className="flex cursor-pointer list-none items-center gap-2">
            <History size={19} className="text-blue-300" />
            <span className="font-semibold">История операций</span>
            <span className="ml-auto rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
              {history.length}
            </span>
          </summary>
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
                          item.displayAsSnapshot
                            ? "text-blue-200"
                            : item.amount < 0
                              ? "text-red-300"
                              : "text-emerald-300"
                        }
                      >
                        {item.displayAsSnapshot
                          ? currency(item.amount)
                          : `${item.amount < 0 ? "−" : "+"}${currency(Math.abs(item.amount))}`}
                      </b>
                    </div>
                    <p className="text-xs text-slate-500">
                      {dateLabel(item.date)}
                      {item.reason ? ` · ${item.reason}` : ""}
                    </p>
                    {item.payment?.paymentPurpose && (
                      <button
                        type="button"
                        onClick={() =>
                          void navigator.clipboard.writeText(
                            item.payment!.paymentPurpose!,
                          )
                        }
                        className="mt-2 min-h-10 rounded-lg border border-slate-700 px-3 text-sm text-slate-200"
                      >
                        Копировать подтверждение ЗП
                      </button>
                    )}
                    {item.payment &&
                      director &&
                      !closed &&
                      item.payment.type !== "EMPLOYEE_REFUND" &&
                      !item.payment.reversedAt &&
                      !item.payment.reversal && (
                        <button
                          type="button"
                          onClick={() => void onReversePayment(item.payment!)}
                          className="mt-2 min-h-10 rounded-lg border border-red-500/40 px-3 text-sm text-red-200"
                        >
                          Сторнировать выплату
                        </button>
                      )}
                    {item.payment &&
                      Boolean(item.payment.reversedAt || item.payment.reversal) && (
                        <p className="mt-2 text-xs text-red-300">
                          Выплата сторнирована
                        </p>
                      )}
                    {canManageAccruals &&
                      !closed &&
                      item.accrual &&
                      editableAccruals.some(
                        (accrual) => accrual.id === item.accrual!.id,
                      ) && (
                        <button
                          type="button"
                          onClick={() =>
                            onOperation("editAccrual", row, item.accrual!)
                          }
                          className="mt-2 flex min-h-10 items-center gap-2 rounded-lg border border-blue-500/40 px-3 text-sm font-semibold text-blue-200"
                        >
                          <Pencil size={15} /> Редактировать начисление
                        </button>
                      )}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">Операций пока нет</p>
            )}
          </div>
        </details>
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
      salary: "Изменить оклад",
      advancePayment: "Выдать аванс",
      partialPayment: "Частичная оплата зарплаты",
      allowance: "Изменить гарантированный бонус",
      premium: "Назначить премию",
      deduction: "Добавить штраф / удержание",
      payment: "Зарегистрировать выплату",
      advanceReport: "Заявка на аванс",
      editAccrual: "Редактировать начисление",
      reversal: "Сторнировать начисление",
    },
    reversible = reversiblePayrollAccruals(row);
  const editableAccruals = editablePayrollAccruals(row);
  const orderOperation = operation === "deduction";
  const [orderQuery, setOrderQuery] = useState("");
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const availablePartialSalary = partialSalaryAvailable(row);
  const availableAdvance = statementPayable(row);
  const requestedPartialSalary = Number(form.amount) || 0;
  const remainingAfterPartialSalary = Math.max(
    availablePartialSalary - requestedPartialSalary,
    0,
  );
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
          payrollBonus: "true",
        });
        const response = await fetch(`/api/orders/search?${params}`, {
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (response.ok) {
          const loaded = Array.isArray(body.items)
            ? (body.items as OrderOption[])
            : [];
          setOrders(loaded);
        }
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
          ) : operation === "editAccrual" ? (
            <>
              <Field label="Начисление">
                <select
                  value={form.accrualId}
                  onChange={(event) => {
                    const selected = editableAccruals.find(
                      (item) => item.id === Number(event.target.value),
                    );
                    setForm({
                      ...form,
                      accrualId: event.target.value,
                      amount: selected ? String(selected.amount) : "",
                    });
                  }}
                  className="control"
                >
                  <option value="">Выберите начисление</option>
                  {editableAccruals.map((item) => (
                    <option key={item.id} value={item.id}>
                      {labels[item.type] ?? item.type} · {currency(item.amount)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Новая сумма, ₸">
                <input
                  autoFocus
                  type="number"
                  min="1"
                  value={form.amount}
                  onChange={(event) =>
                    setForm({ ...form, amount: event.target.value })
                  }
                  className="control"
                />
                <span className="mt-1.5 block text-xs text-blue-300">
                  Исходная запись не удалится: система создаст сторно и новое начисление.
                </span>
              </Field>
            </>
          ) : (
            <Field label={operation === "salary" ? "Новый оклад, ₸ (0 — без оклада)" : "Сумма, ₸"}>
              <input
                autoFocus
                type="number"
                min={operation === "salary" ? "0" : "1"}
                max={
                  operation === "advancePayment"
                    ? availableAdvance
                    : operation === "partialPayment"
                      ? availablePartialSalary
                      : undefined
                }
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="control"
              />
              {operation === "partialPayment" && (
                <span className="mt-1.5 block text-xs text-blue-300">
                  Доступно для частичной оплаты: {currency(availablePartialSalary)}.
                </span>
              )}
              {operation === "advancePayment" && (
                <span className="mt-1.5 block text-xs text-blue-300">
                  Доступно для аванса: {currency(availableAdvance)}. После сохранения сумма сразу попадёт в «Выплачено» и уменьшит «Осталось выплатить».
                </span>
              )}
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
          {(operation === "payment" || operation === "advancePayment" || operation === "partialPayment" || operation === "advanceReport") && (
            <Field label="Способ выплаты">
              <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className="control" disabled={operation === "payment" && (form.type === "SALARY_PAYMENT" || form.type === "FINAL_SETTLEMENT")}>
                <option value="kaspi">Kaspi</option>
                {(operation === "advancePayment" || operation === "partialPayment" || operation === "advanceReport" || (form.type !== "SALARY_PAYMENT" && form.type !== "FINAL_SETTLEMENT")) && <option value="cash">Наличные</option>}
                {(operation === "advancePayment" || operation === "partialPayment" || operation === "advanceReport" || (form.type !== "SALARY_PAYMENT" && form.type !== "FINAL_SETTLEMENT")) && <option value="bank_transfer">Банковский перевод</option>}
                {(operation === "advancePayment" || operation === "partialPayment" || operation === "advanceReport" || (form.type !== "SALARY_PAYMENT" && form.type !== "FINAL_SETTLEMENT")) && <option value="other">Другое</option>}
              </select>
            </Field>
          )}
          {operation === "partialPayment" && (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm text-emerald-100">
              <p className="font-semibold">Остаток после оплаты</p>
              <p className="mt-1 text-xs text-emerald-200/80">
                {currency(availablePartialSalary)} − {currency(requestedPartialSalary)} = {currency(remainingAfterPartialSalary)}. Оклад сотрудника не изменится; сумма будет учтена как подтверждённая выплата и уменьшит остаток к выплате. Начисление при этом не создаётся.
              </p>
            </div>
          )}
          {operation === "payment" &&
              (form.type === "SALARY_PAYMENT" ||
                form.type === "FINAL_SETTLEMENT") && (
            <Field label="Референс / номер перевода (необязательно)">
              <input
                value={form.externalReference}
                onChange={(e) => setForm({ ...form, externalReference: e.target.value })}
                placeholder="Например: KASPI-02102026-123456"
                maxLength={120}
                className="control"
              />
              <span className="mt-1.5 block text-xs text-blue-300">
                Желательно указать для быстрой сверки перевода, но выплату можно сохранить и без него.
              </span>
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
          {operation === "advanceReport" && (
            <div className="rounded-xl border border-blue-500/25 bg-blue-500/5 p-3 text-sm text-blue-100">
              Заявка останется ожидающей подтверждения и не считается выплатой. После подтверждения учредителем аванс уменьшит сумму к выплате.
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
            <Field label="Заказ (необязательно)">
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
                  onChange={(e) =>
                    setForm({ ...form, orderId: e.target.value })
                  }
                  className="control"
                >
                  <option value="">{ordersLoading ? "Загрузка заказов…" : "Без привязки к заказу"}</option>
                  {orders.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.number} · {item.client.name}{item.client.phone ? ` · ${item.client.phone}` : ""}{item.orderReceivedAt ? ` · факт ${dateLabel(item.orderReceivedAt)}` : ""}
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
          {(operation === "salary" || operation === "payment" || operation === "advancePayment" || operation === "partialPayment" || operation === "advanceReport") && (
            <Field
              label={
                operation === "salary"
                  ? "Дата начала действия"
                  : operation === "advanceReport"
                    ? "Желаемая дата"
                    : "Дата выплаты"
              }
            >
              <input
                type="date"
                value={form.date}
                onInput={(e) =>
                  setForm({
                    ...form,
                    date: e.currentTarget.value,
                  })
                }
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="control"
              />
            </Field>
          )}
          <Field
            label={
              operation === "reversal"
                ? "Причина сторно"
                : operation === "editAccrual"
                  ? "Причина изменения"
                  : "Комментарий / основание"
            }
          >
            <textarea
              rows={3}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder={
                operation === "deduction"
                  ? "Например: не выполнена работа или замечание по заказу"
                  : undefined
              }
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
                : operation === "editAccrual"
                  ? !form.accrualId || Number(form.amount) <= 0 || !form.reason.trim()
                : operation === "salary"
                  ? form.amount === "" || Number(form.amount) < 0 || !form.date || !form.reason.trim()
                : operation === "allowance"
                  ? form.amount === "" || Number(form.amount) < 0
                  : Number(form.amount) <= 0 ||
                    (operation === "partialPayment" &&
                      Number(form.amount) > availablePartialSalary) ||
                    (operation === "advancePayment" &&
                      Number(form.amount) > availableAdvance) ||
                    (operation === "payment" &&
                      (form.type === "SALARY_PAYMENT" || form.type === "FINAL_SETTLEMENT") &&
                      (form.method !== "kaspi" ||
                        (form.externalReference.trim().length > 0 &&
                          form.externalReference.trim().length < 3))) ||
                    (operation === "deduction" && !form.reason.trim())
            }
            className="min-h-11 rounded-xl bg-blue-600 px-5 font-semibold disabled:opacity-40"
          >
            {operation === "advancePayment"
              ? "Выдать аванс"
              : operation === "partialPayment"
                ? "Учесть частичную оплату"
                : operation === "advanceReport"
                  ? "Запросить аванс"
                : operation === "editAccrual"
                  ? "Сохранить исправление"
                : "Сохранить"}
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
