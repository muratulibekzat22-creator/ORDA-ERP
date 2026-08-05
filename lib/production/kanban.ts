import { PRODUCTION_STAGES, type ProductionStage } from "./stage-policy";

export type ProductionKanbanFilter = {
  query: string;
  stage: "" | ProductionStage;
  assigneeId: "" | number;
  priority: "" | number;
  overdueOnly: boolean;
};

export type FilterableProduction = {
  stage: string;
  priority: number;
  masterUserId: number | null;
  plannedEndAt: string | Date | null;
  completedAt: string | Date | null;
  order: { number: string; client: { name: string } };
};

export const EMPTY_PRODUCTION_FILTERS: ProductionKanbanFilter = {
  query: "",
  stage: "",
  assigneeId: "",
  priority: "",
  overdueOnly: false,
};

export function isProductionOverdue(item: FilterableProduction, now = new Date()) {
  return Boolean(item.plannedEndAt && !item.completedAt && new Date(item.plannedEndAt).getTime() < now.getTime());
}

export function filterProductions<T extends FilterableProduction>(items: T[], filters: ProductionKanbanFilter, now = new Date()) {
  const query = filters.query.trim().toLocaleLowerCase("ru");
  return items.filter((item) => {
    if (filters.stage && item.stage !== filters.stage) return false;
    if (filters.assigneeId !== "" && item.masterUserId !== filters.assigneeId) return false;
    if (filters.priority !== "" && item.priority !== filters.priority) return false;
    if (filters.overdueOnly && !isProductionOverdue(item, now)) return false;
    if (query && !`${item.order.number} ${item.order.client.name}`.toLocaleLowerCase("ru").includes(query)) return false;
    return true;
  });
}

export function distributeProductions<T extends { stage: string }>(items: T[]) {
  return Object.fromEntries(PRODUCTION_STAGES.map((stage) => [stage, items.filter((item) => item.stage === stage)])) as Record<ProductionStage, T[]>;
}

export function optimisticProductionMove<T extends { id: number; stage: string }>(items: T[], id: number, stage: ProductionStage) {
  return items.map((item) => item.id === id ? { ...item, stage } : item);
}
