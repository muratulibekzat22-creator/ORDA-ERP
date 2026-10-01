const COMPANY_OFFSET_MS = 5 * 60 * 60 * 1000;

export function companyMonthRange(year: number, month: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12)
    throw new Error("INVALID_MONTH");
  const start = new Date(Date.UTC(year, month - 1, 1) - COMPANY_OFFSET_MS);
  const end = new Date(Date.UTC(year, month, 1) - COMPANY_OFFSET_MS);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
    throw new Error("INVALID_MONTH");
  return { start, end };
}
