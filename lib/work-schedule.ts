export const DEFAULT_WEEKLY_DAY_OFF = 1;

export const WEEKDAY_OPTIONS = [
  { value: 1, label: "Понедельник" },
  { value: 2, label: "Вторник" },
  { value: 3, label: "Среда" },
  { value: 4, label: "Четверг" },
  { value: 5, label: "Пятница" },
  { value: 6, label: "Суббота" },
  { value: 0, label: "Воскресенье" },
] as const;

export function validWeeklyDayOff(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 6;
}

export function weekdayForDateKey(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error("INVALID_DATE_KEY");
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateKey)
    throw new Error("INVALID_DATE_KEY");
  return date.getUTCDay();
}

export function isWeeklyDayOff(dateKey: string, weeklyDayOff = DEFAULT_WEEKLY_DAY_OFF) {
  if (!validWeeklyDayOff(weeklyDayOff)) throw new Error("INVALID_WEEKLY_DAY_OFF");
  return weekdayForDateKey(dateKey) === weeklyDayOff;
}

export function weekdayLabel(value: number) {
  return WEEKDAY_OPTIONS.find((item) => item.value === value)?.label ?? "Не указан";
}
