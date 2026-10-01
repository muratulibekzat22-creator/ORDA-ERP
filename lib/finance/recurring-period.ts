export function recurringJournalMonth(period: string, from: string, to: string, now = new Date()): string | null {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Qyzylorda", year: "numeric", month: "2-digit" }).format(now);
  if (period === "month" || period === "today") return key;
  if (period === "previous_month") {
    const [year, month] = key.split("-").map(Number);
    return `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, "0")}`;
  }
  if (period === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to && from.slice(0, 7) === to.slice(0, 7)) return from.slice(0, 7);
  return null;
}
