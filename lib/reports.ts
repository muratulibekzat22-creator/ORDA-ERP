export type ReportPeriodPreset = "today" | "week" | "month" | "quarter" | "year" | "custom";

export type ReportRange = {
  preset: ReportPeriodPreset;
  dateFrom: string;
  dateTo: string;
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  timezone: "Asia/Almaty";
};

export type ComparableMetric = { current: number; previous: number; changePercent: number | null };
export type ReportSummary = {
  leads: ComparableMetric;
  measurements: ComparableMetric;
  orders: ComparableMetric;
  salesAmount: ComparableMetric;
  received: ComparableMetric;
  remaining: number;
  conversion: number | null;
};

export type ManagerReportRow = {
  id: number;
  name: string;
  leads: number;
  measurements: number;
  orders: number;
  salesAmount: number;
  received: number;
  conversion: number | null;
};

export type ReportsReadModel = {
  generatedAt: string;
  role: "DIRECTOR" | "MANAGER" | "ACCOUNTANT";
  period: Omit<ReportRange, "start" | "end" | "previousStart" | "previousEnd"> & {
    start: string; end: string; previousStart: string; previousEnd: string;
  };
  summary: ReportSummary;
  sales: { count: number; amount: number; averageOrder: number; completed: number; cancelled: number; grossMargin?: number };
  payments: { received: number; remaining: number };
  finance?: {
    sales: number;
    customerReceived: number;
    customerRemaining: number;
    partnerAgreed: number;
    partnerPaid: number;
    partnerRemaining: number;
    grossMargin: number;
    payrollAccrued: number;
    payrollPaid: number;
    payrollPayable: number;
  };
  funnel: Array<{ key: string; label: string; value: number; conversionFromPrevious: number | null }>;
  managers: ManagerReportRow[];
  trend: Array<{ date: string; salesAmount: number; received: number }>;
  production: Array<{ stage: string; count: number }>;
  orders: Array<{ id: number; number: string; client: string; manager: string; amount: number; received: number; remaining: number; status: string }>;
};

const OFFSET = "+05:00";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const localDate = (value: string, end = false) => new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}${OFFSET}`);
const formatLocalDate = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
};

export function resolveReportRange(params: URLSearchParams, now = new Date()): ReportRange {
  const raw = params.get("period") ?? "month";
  if (!["today", "week", "month", "quarter", "year", "custom"].includes(raw)) throw new Error("INVALID_PERIOD");
  const preset = raw as ReportPeriodPreset;
  const today = formatLocalDate(now);
  let from = today, to = today;
  if (preset === "week") {
    const localNow = localDate(today);
    const weekdayName = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Almaty", weekday: "short" }).format(now);
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);
    const mondayOffset = (weekday + 6) % 7;
    const monday = new Date(localNow.getTime() - mondayOffset * 86_400_000);
    from = formatLocalDate(monday);
  } else if (preset === "month") {
    from = `${today.slice(0, 7)}-01`;
  } else if (preset === "quarter") {
    const month = Number(today.slice(5, 7));
    const quarterMonth = String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0");
    from = `${today.slice(0, 4)}-${quarterMonth}-01`;
  } else if (preset === "year") {
    from = `${today.slice(0, 4)}-01-01`;
  } else if (preset === "custom") {
    from = params.get("dateFrom") ?? "";
    to = params.get("dateTo") ?? "";
    if (!datePattern.test(from) || !datePattern.test(to)) throw new Error("INVALID_CUSTOM_RANGE");
  }
  const start = localDate(from), end = localDate(to, true);
  if (start > end) throw new Error("INVALID_CUSTOM_RANGE");
  const duration = end.getTime() - start.getTime() + 1;
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - duration + 1);
  return { preset, dateFrom: from, dateTo: to, start, end, previousStart, previousEnd, timezone: "Asia/Almaty" };
}

export const safePercent = (numerator: number, denominator: number) => denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 100 : null;
export const changePercent = (current: number, previous: number) => previous !== 0 ? Math.round(((current - previous) / Math.abs(previous)) * 10_000) / 100 : null;
export const money = (value: unknown) => Number(value ?? 0);
export const isClientPayment = (type: string) => ["CLIENT_PAYMENT", "payment", "PREPAYMENT", "ADDITIONAL_PAYMENT"].includes(type);
export const paymentEffect = (type: string, amount: unknown) => isClientPayment(type) ? money(amount) : type === "REFUND" ? -money(amount) : 0;
export const isCancelled = (lifecycle: string) => lifecycle === "CANCELLED";
