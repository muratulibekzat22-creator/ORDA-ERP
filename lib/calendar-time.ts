export const BUSINESS_TIME_ZONE = "Asia/Almaty";
const BUSINESS_OFFSET = "+05:00";

export function parseBusinessDateTime(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const [date, time] = value.split("T");
  const parsed = new Date(`${date}T${time}:00+05:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatBusinessInput(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export type CalendarViewMode = "day" | "week" | "month" | "period";
export type CalendarDateRange = { from: Date; to: Date };

export function businessDateKey(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function businessDateFromKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error("INVALID_BUSINESS_DATE");
  const result = new Date(`${value}T00:00:00${BUSINESS_OFFSET}`);
  if (Number.isNaN(result.getTime()) || businessDateKey(result) !== value)
    throw new Error("INVALID_BUSINESS_DATE");
  return result;
}

export function addBusinessDays(value: Date | string, days: number) {
  const key = businessDateKey(value);
  const utc = new Date(`${key}T12:00:00.000Z`);
  utc.setUTCDate(utc.getUTCDate() + days);
  return businessDateFromKey(utc.toISOString().slice(0, 10));
}

export function addBusinessMonths(value: Date | string, months: number) {
  const [year, month, day] = businessDateKey(value).split("-").map(Number);
  const monthIndex = year * 12 + month - 1 + months;
  const nextYear = Math.floor(monthIndex / 12);
  const nextMonthIndex = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(nextYear, nextMonthIndex + 1, 0)).getUTCDate();
  return businessDateFromKey(
    `${nextYear}-${String(nextMonthIndex + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`,
  );
}

export function startOfBusinessWeek(value: Date | string) {
  const key = businessDateKey(value);
  const weekday = new Date(`${key}T12:00:00.000Z`).getUTCDay();
  return addBusinessDays(value, -((weekday + 6) % 7));
}

export function startOfBusinessMonth(value: Date | string) {
  return businessDateFromKey(`${businessDateKey(value).slice(0, 7)}-01`);
}

export function calendarMonthGrid(value: Date | string) {
  const first = startOfBusinessWeek(startOfBusinessMonth(value));
  return Array.from({ length: 42 }, (_, index) => addBusinessDays(first, index));
}

export function calendarViewRange(
  anchor: Date,
  mode: CalendarViewMode,
  period?: { start: string; end: string },
): CalendarDateRange {
  if (mode === "period") {
    if (!period?.start || !period.end) throw new Error("INVALID_CALENDAR_PERIOD");
    const start = businessDateFromKey(period.start);
    const end = businessDateFromKey(period.end);
    const from = start <= end ? start : end;
    const last = start <= end ? end : start;
    return { from, to: addBusinessDays(last, 1) };
  }
  if (mode === "week") {
    const from = startOfBusinessWeek(anchor);
    return { from, to: addBusinessDays(from, 7) };
  }
  if (mode === "month") {
    const from = startOfBusinessMonth(anchor);
    return { from, to: addBusinessMonths(from, 1) };
  }
  const from = businessDateFromKey(businessDateKey(anchor));
  return { from, to: addBusinessDays(from, 1) };
}

export function splitCalendarRange(range: CalendarDateRange, maximumDays = 62) {
  if (maximumDays < 1 || range.from >= range.to) throw new Error("INVALID_CALENDAR_RANGE");
  const chunks: CalendarDateRange[] = [];
  let from = range.from;
  while (from < range.to) {
    const candidate = addBusinessDays(from, maximumDays);
    const to = candidate < range.to ? candidate : range.to;
    chunks.push({ from, to });
    from = to;
  }
  return chunks;
}
