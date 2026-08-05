import { type Prisma, type Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type CalculatorTariffValue = {
  code: string;
  uiName: string;
  kind: string;
  unit: string;
  salePrice: number;
  internalPrice: number;
  defaultQuantity: number;
  manualPriceAllowed: boolean;
  active: boolean;
  sortOrder: number;
};

export const MATERIAL_CODES = {
  "Сосна": "PINE_STEP",
  "Карагач": "ELM_STEP",
  "Дуб ламель": "OAK_LAMELLA_STEP",
} as const;

export type StairMaterial = keyof typeof MATERIAL_CODES;

const number = (value: Prisma.Decimal | number) => Number(value);

export async function getCalculatorTariffs(activeOnly = true): Promise<CalculatorTariffValue[]> {
  const rows = await prisma.calculatorTariff.findMany({
    where: activeOnly ? { active: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    ...row,
    salePrice: number(row.salePrice),
    internalPrice: number(row.internalPrice),
    defaultQuantity: number(row.defaultQuantity),
  }));
}

export function redactTariffs(tariffs: CalculatorTariffValue[], role: Role) {
  if (role === "DIRECTOR" || role === "ACCOUNTANT") return tariffs;
  return tariffs.map((tariff) => {
    const result: Partial<CalculatorTariffValue> = { ...tariff };
    delete result.internalPrice;
    return result;
  });
}

export function tariffMap(tariffs: CalculatorTariffValue[]) {
  return new Map(tariffs.map((tariff) => [tariff.code, tariff]));
}
