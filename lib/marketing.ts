const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

export function marketingMonthRange(now = new Date()) {
  const local = new Date(now.getTime() + ALMATY_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1) - ALMATY_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 1, 1) - ALMATY_OFFSET_MS),
  };
}
