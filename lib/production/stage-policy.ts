export const PRODUCTION_STAGES = [
  "Подготовка",
  "Каркас",
  "Дерево",
  "Покраска",
  "Комплектация",
  "Готово к монтажу",
  "Монтаж",
  "Сдано",
] as const;

export type ProductionStage = (typeof PRODUCTION_STAGES)[number];

export const INITIAL_PRODUCTION_STAGE: ProductionStage = PRODUCTION_STAGES[0];
export const COMPLETED_PRODUCTION_STAGE: ProductionStage = PRODUCTION_STAGES.at(-1)!;

const stageSet = new Set<string>(PRODUCTION_STAGES);

export function isProductionStage(value: unknown): value is ProductionStage {
  return typeof value === "string" && stageSet.has(value);
}

export function getProductionStageIndex(stage: ProductionStage) {
  return PRODUCTION_STAGES.indexOf(stage);
}

export function getNextProductionStage(stage: ProductionStage): ProductionStage | null {
  return PRODUCTION_STAGES[getProductionStageIndex(stage) + 1] ?? null;
}

export function getPreviousProductionStage(stage: ProductionStage): ProductionStage | null {
  return PRODUCTION_STAGES[getProductionStageIndex(stage) - 1] ?? null;
}

export function canTransitionProductionStage(from: ProductionStage, to: ProductionStage) {
  return getNextProductionStage(from) === to;
}

export function canTransitionProductionStageEitherDirection(from: ProductionStage, to: ProductionStage) {
  return getNextProductionStage(from) === to || getPreviousProductionStage(from) === to;
}

export function getAllowedProductionStageTransitions(role: string, from: ProductionStage) {
  const next = getNextProductionStage(from);
  const previous = getPreviousProductionStage(from);
  if (role === "DIRECTOR" || role === "MANAGER")
    return [previous, next].filter((stage): stage is ProductionStage => stage !== null);
  if (role === "PRODUCTION")
    return next && next !== "Монтаж" ? [next] : [];
  if (role === "INSTALLER" && from === "Монтаж" && next === "Сдано") return [next];
  return [];
}

export function isCompletedProductionStage(stage: ProductionStage) {
  return stage === COMPLETED_PRODUCTION_STAGE;
}

export function assertProductionStage(value: unknown): asserts value is ProductionStage {
  if (!isProductionStage(value)) {
    throw new Error("INVALID_PRODUCTION_STAGE");
  }
}
