import { OrderLifecycle } from "@prisma/client";

export const ORDER_STAGE_KEYS = [
  "measurement",
  "preparation",
  "painting",
  "ready",
  "installation",
  "completed",
] as const;

export type OrderStageKey = (typeof ORDER_STAGE_KEYS)[number];

export const ORDER_STAGE_LABELS: Record<OrderStageKey, string> = {
  measurement: "Контрольный замер",
  preparation: "Заготовка",
  painting: "Покраска",
  ready: "Готов к установке",
  installation: "Установка",
  completed: "Завершён",
};

export function projectOrderStage(
  lifecycle: OrderLifecycle | string,
  productionStage?: string | null,
): OrderStageKey {
  if (lifecycle === OrderLifecycle.COMPLETED) return "completed";
  if (
    lifecycle === OrderLifecycle.INSTALLATION ||
    lifecycle === OrderLifecycle.ACCEPTANCE
  ) return "installation";
  if (lifecycle === OrderLifecycle.READY_FOR_INSTALLATION) return "ready";
  if (lifecycle === OrderLifecycle.IN_PRODUCTION) {
    const value = productionStage?.toUpperCase() ?? "";
    return value.includes("PAINT") || value.includes("ПОКРАС")
      ? "painting"
      : "preparation";
  }
  if (lifecycle === OrderLifecycle.READY_FOR_PRODUCTION) return "preparation";
  return "measurement";
}

export function orderDeadline(input: {
  lifecycle: OrderLifecycle | string;
  productionDeadline?: Date | string | null;
  installation?: { scheduledAt?: Date | string | null } | null;
}) {
  return input.lifecycle === OrderLifecycle.READY_FOR_INSTALLATION ||
    input.lifecycle === OrderLifecycle.INSTALLATION
    ? input.installation?.scheduledAt ?? input.productionDeadline ?? null
    : input.productionDeadline ?? input.installation?.scheduledAt ?? null;
}

export function isOrderOverdue(
  deadline: Date | string | null | undefined,
  lifecycle: OrderLifecycle | string,
  now = new Date(),
) {
  if (!deadline || lifecycle === OrderLifecycle.COMPLETED) return false;
  const parsed = new Date(deadline);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() < now.getTime();
}

export function lifecycleEventLabel(type: string, to?: string | null) {
  if (type === "ORDER_COMPLETED") return "Заказ завершён";
  if (type === "BLOCKER_OPENED") return "Добавлена проблема";
  if (type === "BLOCKER_RESOLVED") return "Проблема решена";
  if (type === "COMPLETE_MEASUREMENT" || type === "CONTROL_MEASUREMENT_COMPLETED") return "Контрольный замер выполнен";
  if (type === "INSTALLATION_COMPLETED") return "Установка завершена";
  if (type === "LIFECYCLE_TRANSITION" && to)
    return `Этап изменён: ${ORDER_STAGE_LABELS[projectOrderStage(to)]}`;
  return type.toLowerCase().replaceAll("_", " ");
}
