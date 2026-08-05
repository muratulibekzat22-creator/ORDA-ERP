import { Role } from "@prisma/client";

import type { ProductionStage } from "./stage-policy";
import { canTransitionProductionStage, canTransitionProductionStageEitherDirection } from "./stage-policy";

type ProductionAccessRecord = {
  masterUserId: number | null;
  stage: ProductionStage;
};

export function canCreateProduction(role: Role) {
  return role === Role.DIRECTOR || role === Role.MANAGER;
}

export function canAccessProduction(role: Role, userId: number, production: ProductionAccessRecord) {
  if (role === Role.DIRECTOR || role === Role.MANAGER) return true;
  if (production.masterUserId !== userId) return false;
  if (role === Role.PRODUCTION) return production.stage !== "Монтаж" && production.stage !== "Сдано";
  return role === Role.INSTALLER && production.stage === "Монтаж";
}

export function canReassignProduction(role: Role) {
  return role === Role.DIRECTOR || role === Role.MANAGER;
}

export function canTransitionProduction(
  role: Role,
  userId: number,
  production: ProductionAccessRecord,
  toStage: ProductionStage,
) {
  if (role === Role.DIRECTOR || role === Role.MANAGER) {
    return canTransitionProductionStageEitherDirection(production.stage, toStage);
  }
  if (!canTransitionProductionStage(production.stage, toStage)) return false;
  if (!canAccessProduction(role, userId, production)) return false;
  if (role === Role.PRODUCTION) return toStage !== "Монтаж";
  return role === Role.INSTALLER && production.stage === "Монтаж" && toStage === "Сдано";
}

export function allowedAssigneeRoles(stage: ProductionStage): Role[] {
  void stage;
  return [Role.PRODUCTION, Role.INSTALLER];
}
