export type MeasurerServiceArea = {
  city: string;
  estimatedMinutes: number;
  approvalRequired: boolean;
};

export type MeasurerTerritoryProfile = {
  homeCity?: string | null;
  maxTravelMinutes?: number | null;
  serviceAreas?: MeasurerServiceArea[] | null;
};

const cityAliases: Record<string, string> = {
  "семипалатинск": "семей",
  "oskemen": "усть-каменогорск",
  "өскемен": "усть-каменогорск",
  "усть каменогорск": "усть-каменогорск",
  "устькаменогорск": "усть-каменогорск",
  "ust kamenogorsk": "усть-каменогорск",
  "экибастуз": "экибастуз",
  "екібастұз": "экибастуз",
  "аягөз": "аягоз",
};

export function normalizeTerritoryCity(value: string) {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cityAliases[normalized] ?? normalized;
}

export function sanitizeMeasurerServiceAreas(value: unknown): MeasurerServiceArea[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: MeasurerServiceArea[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const city = typeof source.city === "string" ? source.city.trim().slice(0, 100) : "";
    const key = normalizeTerritoryCity(city);
    const estimatedMinutes = Math.round(Number(source.estimatedMinutes));
    if (!city || !key || !Number.isInteger(estimatedMinutes) || estimatedMinutes < 0 || estimatedMinutes > 900 || seen.has(key)) continue;
    seen.add(key);
    result.push({ city, estimatedMinutes, approvalRequired: source.approvalRequired === true });
  }
  return result.slice(0, 50);
}

export const SEMEY_MEASURER_TERRITORY: MeasurerServiceArea[] = [
  { city: "Семей", estimatedMinutes: 0, approvalRequired: false },
  { city: "Усть-Каменогорск", estimatedMinutes: 180, approvalRequired: false },
  { city: "Павлодар", estimatedMinutes: 258, approvalRequired: true },
  { city: "Аягоз", estimatedMinutes: 291, approvalRequired: true },
  { city: "Экибастуз", estimatedMinutes: 321, approvalRequired: true },
  { city: "Зайсан", estimatedMinutes: 439, approvalRequired: true },
];

export type TerritoryMatch =
  | { status: "AVAILABLE"; area: MeasurerServiceArea }
  | { status: "APPROVAL_REQUIRED"; area: MeasurerServiceArea }
  | { status: "OUTSIDE_AREA"; area: null }
  | { status: "UNCONFIGURED"; area: null };

export function measurerTerritoryMatch(profile: MeasurerTerritoryProfile, city: string): TerritoryMatch {
  const areas = sanitizeMeasurerServiceAreas(profile.serviceAreas);
  if (!areas.length) return { status: "UNCONFIGURED", area: null };
  const target = normalizeTerritoryCity(city);
  const area = areas.find((item) => normalizeTerritoryCity(item.city) === target);
  if (!area) return { status: "OUTSIDE_AREA", area: null };
  const limit = Number.isInteger(profile.maxTravelMinutes) ? Number(profile.maxTravelMinutes) : 240;
  return area.approvalRequired || area.estimatedMinutes > limit
    ? { status: "APPROVAL_REQUIRED", area }
    : { status: "AVAILABLE", area };
}

export function travelTimeLabel(minutes: number) {
  if (minutes <= 0) return "в городе";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours ? `${hours} ч` : ""}${rest ? ` ${rest} мин` : ""}`.trim();
}
