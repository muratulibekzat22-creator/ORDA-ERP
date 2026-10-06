import {
  getCalculatorTariffs,
  tariffMap,
  type CalculatorTariffValue,
} from "@/lib/calculator/tariffs";

export type WhatsappStairMaterial = "pine" | "karagach" | "oak_lamella";

const MATERIALS: Array<{
  key: WhatsappStairMaterial;
  code: "PINE_STEP" | "ELM_STEP" | "OAK_LAMELLA_STEP";
  labelRu: string;
  labelKk: string;
}> = [
  { key: "pine", code: "PINE_STEP", labelRu: "Сосна", labelKk: "Қарағай" },
  { key: "karagach", code: "ELM_STEP", labelRu: "Карагач", labelKk: "Қарағаш" },
  { key: "oak_lamella", code: "OAK_LAMELLA_STEP", labelRu: "Дуб (ламель)", labelKk: "Емен (ламель)" },
];

export interface WhatsappStairPriceInput {
  regularSteps: number;
  landingCount: number;
  material?: WhatsappStairMaterial;
}

export interface WhatsappStairPriceVariant {
  material: WhatsappStairMaterial;
  labelRu: string;
  labelKk: string;
  salePricePerEquivalentStep: number;
  equivalentStepsMin: number;
  equivalentStepsMax: number;
  priceMin: number;
  priceMax: number;
}

export interface WhatsappStairPriceEstimate {
  regularSteps: number;
  landingCount: number;
  landingEquivalentRange: [2, 3];
  variants: WhatsappStairPriceVariant[];
  basis: "steps_only";
}

function wholeNumber(value: number, minimum: number, maximum: number, field: string) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`INVALID_${field.toUpperCase()}`);
  }
  return value;
}

export function buildWhatsappStairPriceEstimate(
  input: WhatsappStairPriceInput,
  configuredTariffs: CalculatorTariffValue[],
): WhatsappStairPriceEstimate {
  const regularSteps = wholeNumber(input.regularSteps, 1, 200, "regular_steps");
  const landingCount = wholeNumber(input.landingCount, 0, 20, "landing_count");
  const tariffs = tariffMap(configuredTariffs);
  const selected = input.material ? MATERIALS.filter((item) => item.key === input.material) : MATERIALS;
  if (selected.length === 0) throw new Error("INVALID_MATERIAL");

  const equivalentStepsMin = regularSteps + landingCount * 2;
  const equivalentStepsMax = regularSteps + landingCount * 3;
  const variants = selected.map((item) => {
    const tariff = tariffs.get(item.code);
    if (!tariff || !tariff.active || tariff.salePrice <= 0) throw new Error("STAIR_TARIFF_NOT_CONFIGURED");
    return {
      material: item.key,
      labelRu: item.labelRu,
      labelKk: item.labelKk,
      salePricePerEquivalentStep: tariff.salePrice,
      equivalentStepsMin,
      equivalentStepsMax,
      priceMin: equivalentStepsMin * tariff.salePrice,
      priceMax: equivalentStepsMax * tariff.salePrice,
    };
  });

  return {
    regularSteps,
    landingCount,
    landingEquivalentRange: [2, 3],
    variants,
    basis: "steps_only",
  };
}

export async function getWhatsappStairPriceEstimate(
  input: WhatsappStairPriceInput,
): Promise<WhatsappStairPriceEstimate> {
  return buildWhatsappStairPriceEstimate(input, await getCalculatorTariffs());
}
