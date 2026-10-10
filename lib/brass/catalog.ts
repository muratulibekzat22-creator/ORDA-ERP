export const BRASS_MODEL_OPTIONS = [
  { key: "OVAL_BLACK", label: "Овальный · чёрный" },
  { key: "OVAL_WHITE", label: "Овальный · белый" },
  { key: "SQUARE_BLACK", label: "Квадратный · чёрный" },
] as const;

export type BrassModelKey = (typeof BRASS_MODEL_OPTIONS)[number]["key"];
export type BrassModelQuantities = Record<BrassModelKey, number>;
export type BrassCostBearer = "COMPANY" | "CONTRACTOR";

export const EMPTY_BRASS_MODEL_QUANTITIES: BrassModelQuantities = {
  OVAL_BLACK: 0,
  OVAL_WHITE: 0,
  SQUARE_BLACK: 0,
};

export const BRASS_COST_BEARER_LABELS: Record<BrassCostBearer, string> = {
  COMPANY: "Компания",
  CONTRACTOR: "Подрядчик / цех",
};

export function normalizeBrassModelQuantities(
  value: unknown,
): BrassModelQuantities {
  const source = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return Object.fromEntries(
    BRASS_MODEL_OPTIONS.map(({ key }) => {
      const quantity = Number(source[key] ?? 0);
      return [
        key,
        Number.isInteger(quantity) && quantity > 0 && quantity <= 10_000
          ? quantity
          : 0,
      ];
    }),
  ) as unknown as BrassModelQuantities;
}

export function totalBrassPairs(value: unknown) {
  return Object.values(normalizeBrassModelQuantities(value)).reduce(
    (total, quantity) => total + quantity,
    0,
  );
}

export function brassModelSummary(value: unknown) {
  const quantities = normalizeBrassModelQuantities(value);
  return BRASS_MODEL_OPTIONS
    .filter(({ key }) => quantities[key] > 0)
    .map(({ key, label }) => `${label} — ${quantities[key]} пар`)
    .join("; ");
}

export function normalizeBrassCostBearer(value: unknown): BrassCostBearer {
  return value === "CONTRACTOR" ? "CONTRACTOR" : "COMPANY";
}
