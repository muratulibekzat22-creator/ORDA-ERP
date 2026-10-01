const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

export function marketingMonthRange(value?: string | Date) {
  const now = typeof value === "string" && /^\d{4}-\d{2}$/.test(value)
    ? new Date(`${value}-01T00:00:00+05:00`)
    : value instanceof Date
      ? value
      : new Date();
  const local = new Date(now.getTime() + ALMATY_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  return {
    key: `${year}-${String(month + 1).padStart(2, "0")}`,
    start: new Date(Date.UTC(year, month, 1) - ALMATY_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 1, 1) - ALMATY_OFFSET_MS),
  };
}
