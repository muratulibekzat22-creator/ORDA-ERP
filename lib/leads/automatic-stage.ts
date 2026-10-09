import { LeadStage } from "@prisma/client";

export const REQUIRED_PROPOSAL_MATERIALS = [
  "Сосна",
  "Карагач",
  "Дуб ламель",
] as const;

const BEFORE_CALCULATION = new Set<LeadStage>([
  LeadStage.NEW,
  LeadStage.QUALIFIED,
]);

export function hasRequiredProposalMaterials(materials: readonly string[]) {
  const available = new Set(materials);
  return REQUIRED_PROPOSAL_MATERIALS.every((material) => available.has(material));
}

export function calculationProgress(
  currentStage: LeadStage,
  currentStatus: string,
  calculationComplete: boolean,
) {
  if (!calculationComplete) {
    return BEFORE_CALCULATION.has(currentStage)
      ? { stage: currentStage, status: "Нужен расчёт" }
      : { stage: currentStage, status: currentStatus };
  }
  return BEFORE_CALCULATION.has(currentStage)
    ? { stage: LeadStage.CALCULATION_READY, status: "Расчёт готов" }
    : currentStage === LeadStage.CALCULATION_READY
      ? { stage: currentStage, status: "Расчёт готов" }
      : { stage: currentStage, status: currentStatus };
}

export function proposalProgress(
  currentStage: LeadStage,
  currentStatus: string,
) {
  return BEFORE_CALCULATION.has(currentStage) ||
    currentStage === LeadStage.CALCULATION_READY
    ? { stage: LeadStage.CALCULATION_READY, status: "КП подготовлено" }
    : { stage: currentStage, status: currentStatus };
}
