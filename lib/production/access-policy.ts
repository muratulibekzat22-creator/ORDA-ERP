import { Role } from "@prisma/client";

import type { ProductionStage } from "./stage-policy";
import { canTransitionProductionStage } from "./stage-policy";

type ProductionAccessRecord = {
  masterUserId: number | null;
  stage: ProductionStage;
};

export function canCreateProduction(role: Role) {
  return role === Role.DIRECTOR;
}

export function canAccessProduction(role: Role, userId: number, production: ProductionAccessRecord) {
  if (role === Role.DIRECTOR) return true;
  if (production.masterUserId !== userId) return false;
  if (role === Role.PRODUCTION) return production.stage !== "Монтаж";
  return role === Role.INSTALLER && production.stage === "Монтаж";
}

export function canReassignProduction(role: Role) {
  return role === Role.DIRECTOR;
}

export function canTransitionProduction(
  role: Role,
  userId: number,
  production: ProductionAccessRecord,
  toStage: ProductionStage,
) {
  if (!canTransitionProductionStage(production.stage, toStage)) return false;
  if (role === Role.DIRECTOR) return true;
  if (!canAccessProduction(role, userId, production)) return false;
  if (role === Role.PRODUCTION) return toStage !== "Монтаж";
  return role === Role.INSTALLER && production.stage === "Монтаж" && toStage === "Сдано";
}

export function allowedAssigneeRoles(stage: ProductionStage): Role[] {
  return stage === "Монтаж" || stage === "Сдано" ? [Role.INSTALLER, Role.DIRECTOR] : [Role.PRODUCTION, Role.DIRECTOR];
}
