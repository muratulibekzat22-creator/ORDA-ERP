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
  "алма ата": "алматы",
  "алма-ата": "алматы",
  "нур султан": "астана",
  "нур-султан": "астана",
  "ақмола": "астана",
  "акмола": "астана",
  "қосшы": "косшы",
  "көкшетау": "кокшетау",
  "кокчетав": "кокшетау",
  "петропавл": "петропавловск",
  "теміртау": "темиртау",
  "қарағанды": "караганда",
  "арқалық": "аркалык",
  "түркістан": "туркестан",
  "чимкент": "шымкент",
  "тараз": "тараз",
  "джамбул": "тараз",
  "қызылорда": "кызылорда",
  "кзыл орда": "кызылорда",
  "кзыл-орда": "кызылорда",
  "чу": "шу",
  "қонаев": "конаев",
  "капчагай": "конаев",
  "капшагай": "конаев",
  "талдықорған": "талдыкорган",
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

export const ASTANA_MEASURER_TERRITORY: MeasurerServiceArea[] = [
  { city: "Астана", estimatedMinutes: 0, approvalRequired: false },
  { city: "Косшы", estimatedMinutes: 40, approvalRequired: false },
  { city: "Темиртау", estimatedMinutes: 138, approvalRequired: false },
  { city: "Караганда", estimatedMinutes: 156, approvalRequired: false },
  { city: "Кокшетау", estimatedMinutes: 213, approvalRequired: false },
  { city: "Петропавловск", estimatedMinutes: 325, approvalRequired: true },
  { city: "Аркалык", estimatedMinutes: 423, approvalRequired: true },
];

export const SHYMKENT_MEASURER_TERRITORY: MeasurerServiceArea[] = [
  { city: "Шымкент", estimatedMinutes: 0, approvalRequired: false },
  { city: "Туркестан", estimatedMinutes: 143, approvalRequired: false },
  { city: "Тараз", estimatedMinutes: 155, approvalRequired: false },
  { city: "Кызылорда", estimatedMinutes: 426, approvalRequired: true },
];

export const ALMATY_MEASURER_TERRITORY: MeasurerServiceArea[] = [
  { city: "Алматы", estimatedMinutes: 0, approvalRequired: false },
  { city: "Каскелен", estimatedMinutes: 50, approvalRequired: false },
  { city: "Талгар", estimatedMinutes: 50, approvalRequired: false },
  { city: "Есик", estimatedMinutes: 75, approvalRequired: false },
  { city: "Конаев", estimatedMinutes: 85, approvalRequired: false },
  { city: "Талдыкорган", estimatedMinutes: 214, approvalRequired: false },
  { city: "Шу", estimatedMinutes: 280, approvalRequired: true },
];

export type MeasurerTerritoryTemplate = {
  id: "SEMEY" | "ASTANA" | "SHYMKENT" | "ALMATY";
  label: string;
  description: string;
  homeCity: string;
  maxTravelMinutes: number;
  serviceAreas: MeasurerServiceArea[];
};

export const MEASURER_TERRITORY_TEMPLATES: MeasurerTerritoryTemplate[] = [
  {
    id: "SEMEY",
    label: "Семей · восток",
    description: "Семей, Усть-Каменогорск и дальние выезды восточного направления.",
    homeCity: "Семей",
    maxTravelMinutes: 240,
    serviceAreas: SEMEY_MEASURER_TERRITORY,
  },
  {
    id: "ASTANA",
    label: "Астана · центр и север",
    description: "Астана, Караганда, Темиртау, Кокшетау; Петропавловск и Аркалык — по согласованию.",
    homeCity: "Астана",
    maxTravelMinutes: 240,
    serviceAreas: ASTANA_MEASURER_TERRITORY,
  },
  {
    id: "SHYMKENT",
    label: "Шымкент · юг",
    description: "Шымкент, Туркестан и Тараз; Кызылорда — отдельный дальний выезд.",
    homeCity: "Шымкент",
    maxTravelMinutes: 240,
    serviceAreas: SHYMKENT_MEASURER_TERRITORY,
  },
  {
    id: "ALMATY",
    label: "Алматы · юго-восток",
    description: "Алматы и область, Талдыкорган; Шу закреплён за Алматы по согласованию.",
    homeCity: "Алматы",
    maxTravelMinutes: 240,
    serviceAreas: ALMATY_MEASURER_TERRITORY,
  },
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
