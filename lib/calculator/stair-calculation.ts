export const STAIR_RATES = {
  "Дуб ламель": { workshopRate: 60_000, saleRate: 85_000 },
  Карагач: { workshopRate: 55_000, saleRate: 80_000 },
  Сосна: { workshopRate: 45_000, saleRate: 65_000 },
} as const;

export type StairMaterial = keyof typeof STAIR_RATES;

export const DELIVERY_CHARGES = {
  NONE: 0,
  OPTION_1: 300_000,
  OPTION_2: 500_000,
} as const;
export type DeliveryOption = keyof typeof DELIVERY_CHARGES;

export type StairCalculationInput = {
  material: StairMaterial;
  regularSteps: number;
  platformEquivalents: number[];
  clientPrice?: number;
  workshopCost?: number;
  installationRequired?: boolean;
  deliveryRequired?: boolean;
  measurementRequired?: boolean;
  otherCity?: boolean;
  pickup?: boolean;
  deliveryOption?: DeliveryOption;
  lines?: CalculationLineInput[];
};

export type StairRates = Record<StairMaterial, { workshopRate: number; saleRate: number }>;

export const CALCULATION_LINE_KINDS = ["INSTALLATION", "DELIVERY", "MEASUREMENT", "METAL_FRAME", "RISERS", "LIGHTING", "PAINTING", "GLASS", "BRASS_BALUSTERS", "BAROQUE_BALUSTERS", "WOOD_BALUSTERS", "METAL_RAILING", "HANDRAIL", "MATERIAL", "OTHER_WORK", "DISCOUNT", "MARKUP"] as const;
export type CalculationLineKind = (typeof CALCULATION_LINE_KINDS)[number];
export type CalculationLineInput = { code?: string; kind: CalculationLineKind; name: string; quantity: number; unit: string; unitCost: number; unitSale: number; comment?: string; enabled?: boolean };

function normalizedLines(lines: CalculationLineInput[] = [], installationRequired = true, deliveryRequired = true, measurementRequired = true) {
  if (lines.length > 100) throw new Error("В расчёте может быть не более 100 позиций");
  return lines.map((line) => {
    if (!CALCULATION_LINE_KINDS.includes(line.kind) || !line.name.trim() || !line.unit.trim()) throw new Error("Некорректная позиция расчёта");
    if (![line.quantity, line.unitCost, line.unitSale].every((value) => Number.isFinite(value) && value >= 0) || line.quantity > 1_000_000 || line.unitCost > 9_999_999_999.99 || line.unitSale > 9_999_999_999.99) throw new Error("Количество или цена позиции превышает допустимое значение");
    const enabled = line.enabled !== false && (line.kind !== "INSTALLATION" || installationRequired) && (line.kind !== "DELIVERY" || deliveryRequired) && (line.kind !== "MEASUREMENT" || measurementRequired);
    const sign = line.kind === "DISCOUNT" ? -1 : 1;
    return { ...line, name: line.name.trim().slice(0, 200), unit: line.unit.trim().slice(0, 30), comment: line.comment?.trim().slice(0, 1000), enabled, totalCost: enabled ? line.quantity * line.unitCost : 0, totalSale: enabled ? sign * line.quantity * line.unitSale : 0 };
  });
}

export function calculateStair(input: StairCalculationInput, configuredRates: StairRates = STAIR_RATES) {
  if (!(input.material in configuredRates)) throw new Error("Выберите материал");
  if (!Number.isInteger(input.regularSteps) || input.regularSteps < 0)
    throw new Error(
      "Количество ступеней должно быть целым неотрицательным числом",
    );
  if (
    !Array.isArray(input.platformEquivalents) ||
    input.platformEquivalents.some((value) => value !== 2 && value !== 3)
  )
    throw new Error("Каждая площадка должна равняться 2 или 3 ступеням");
  const equivalentSteps =
    input.regularSteps +
    input.platformEquivalents.reduce((sum, value) => sum + value, 0);
  const rates = configuredRates[input.material];
  const baseWorkshopCost = equivalentSteps * rates.workshopRate;
  const baseClientPrice = equivalentSteps * rates.saleRate;
  const workshopCost = input.workshopCost ?? baseWorkshopCost;
  const clientPrice = input.clientPrice ?? baseClientPrice;
  if (
    ![workshopCost, clientPrice].every(
      (value) => Number.isFinite(value) && value >= 0,
    )
  )
    throw new Error("Итоговые суммы должны быть неотрицательными числами");
  const installationRequired = input.installationRequired !== false;
  const requestedDeliveryOption = input.deliveryOption ?? "NONE";
  if (!(requestedDeliveryOption in DELIVERY_CHARGES))
    throw new Error("Некорректный вариант доставки");
  const deliveryOption: DeliveryOption = input.otherCity === true ? requestedDeliveryOption : "NONE";
  const deliveryCharge = DELIVERY_CHARGES[deliveryOption];
  const deliveryRequired = deliveryOption !== "NONE" || (input.deliveryRequired !== false && input.pickup !== true);
  const measurementRequired = input.measurementRequired !== false;
  const lines = normalizedLines(input.lines, installationRequired, deliveryRequired, measurementRequired);
  const lineCost = lines.reduce((sum, line) => sum + line.totalCost, 0);
  const lineSale = lines.reduce((sum, line) => sum + line.totalSale, 0);
  const calculatedClientPrice = input.clientPrice ?? baseClientPrice + lineSale + deliveryCharge;
  const calculatedWorkshopCost = input.workshopCost ?? baseWorkshopCost;
  const materialCost = lines.filter((line) => line.kind === "MATERIAL").reduce((sum, line) => sum + line.totalCost, 0);
  const installationCost = lines.filter((line) => line.kind === "INSTALLATION").reduce((sum, line) => sum + line.totalCost, 0);
  const deliveryCost = lines.filter((line) => line.kind === "DELIVERY").reduce((sum, line) => sum + line.totalCost, 0);
  const otherDirectCosts = lineCost - materialCost - installationCost - deliveryCost;
  const totalCost = calculatedWorkshopCost + lineCost;
  if (![calculatedClientPrice, totalCost].every((value) => Number.isFinite(value) && value >= 0 && value <= 9_999_999_999.99)) throw new Error("Итоговая сумма выходит за допустимые пределы");
  return {
    ...input,
    equivalentSteps,
    workshopRate: rates.workshopRate,
    saleRate: rates.saleRate,
    baseWorkshopCost,
    workshopCost: calculatedWorkshopCost,
    baseClientPrice,
    clientPrice: calculatedClientPrice,
    grossDifference: calculatedClientPrice - calculatedWorkshopCost,
    workshopAdjustment: calculatedWorkshopCost - baseWorkshopCost,
    clientAdjustment: calculatedClientPrice - (baseClientPrice + lineSale),
    installationRequired,
    deliveryRequired,
    deliveryOption,
    deliveryCharge,
    measurementRequired,
    otherCity: input.otherCity === true,
    pickup: input.pickup === true,
    lines,
    materialCost,
    installationCost,
    deliveryCost,
    otherDirectCosts,
    totalCost,
    grossProfit: calculatedClientPrice - totalCost,
  };
}
