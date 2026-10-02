const COMPANY_OFFSET_MS = 5 * 60 * 60 * 1000;

export function companyYearMonth(now = new Date()) {
  const local = new Date(now.getTime() + COMPANY_OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
  };
}

export function isCompanyMonthStarted(
  year: number,
  month: number,
  now = new Date(),
) {
  const current = companyYearMonth(now);
  return year * 12 + month <= current.year * 12 + current.month;
}

export function isCompanyMonthComplete(
  year: number,
  month: number,
  now = new Date(),
) {
  const current = companyYearMonth(now);
  return year * 12 + month < current.year * 12 + current.month;
}

export function companyMonthRange(year: number, month: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12)
    throw new Error("INVALID_MONTH");
  const start = new Date(Date.UTC(year, month - 1, 1) - COMPANY_OFFSET_MS);
  const end = new Date(Date.UTC(year, month, 1) - COMPANY_OFFSET_MS);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
    throw new Error("INVALID_MONTH");
  return { start, end };
}
