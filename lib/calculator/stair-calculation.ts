export const STAIR_RATES = {
  "Дуб ламель": { workshopRate: 60_000, saleRate: 85_000 },
  Карагач: { workshopRate: 55_000, saleRate: 80_000 },
  Сосна: { workshopRate: 45_000, saleRate: 65_000 },
} as const;

export type StairMaterial = keyof typeof STAIR_RATES;

export type StairCalculationInput = {
  material: StairMaterial;
  regularSteps: number;
  platformEquivalents: number[];
  clientPrice?: number;
  workshopCost?: number;
};

export function calculateStair(input: StairCalculationInput) {
  if (!(input.material in STAIR_RATES)) throw new Error("Выберите материал");
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
  const rates = STAIR_RATES[input.material];
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
  return {
    ...input,
    equivalentSteps,
    workshopRate: rates.workshopRate,
    saleRate: rates.saleRate,
    baseWorkshopCost,
    workshopCost,
    baseClientPrice,
    clientPrice,
    grossDifference: clientPrice - workshopCost,
    workshopAdjustment: workshopCost - baseWorkshopCost,
    clientAdjustment: clientPrice - baseClientPrice,
  };
}
