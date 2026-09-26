import { OrderLifecycle } from "@prisma/client";

export const USER_ORDER_STATUSES = [
  "BEFORE_WORKSHOP",
  "TRANSFERRED_TO_WORKSHOP",
  "IN_WORK",
  "READY_FOR_INSTALLATION",
  "INSTALLATION",
  "COMPLETED",
  "CANCELLED",
] as const;

export type UserOrderStatus = (typeof USER_ORDER_STATUSES)[number];

export const USER_ORDER_STATUS_LABELS: Record<UserOrderStatus, string> = {
  BEFORE_WORKSHOP: "До цеха",
  TRANSFERRED_TO_WORKSHOP: "Передано в цех",
  IN_WORK: "В работе",
  READY_FOR_INSTALLATION: "Готов к монтажу",
  INSTALLATION: "Монтаж",
  COMPLETED: "Завершено",
  CANCELLED: "Отменено",
};

export const LIFECYCLE_USER_STATUS: Record<OrderLifecycle, UserOrderStatus> = {
  CREATED: "BEFORE_WORKSHOP",
  PREPARATION: "BEFORE_WORKSHOP",
  READY_FOR_PRODUCTION: "TRANSFERRED_TO_WORKSHOP",
  IN_PRODUCTION: "IN_WORK",
  READY_FOR_INSTALLATION: "READY_FOR_INSTALLATION",
  INSTALLATION: "INSTALLATION",
  ACCEPTANCE: "INSTALLATION",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

/** The only system-lifecycle to user-status projection used by the product UI. */
export function projectOrderStatus(
  lifecycle: OrderLifecycle | keyof typeof LIFECYCLE_USER_STATUS | string,
): UserOrderStatus {
  return LIFECYCLE_USER_STATUS[lifecycle as OrderLifecycle] ?? "BEFORE_WORKSHOP";
}

export function orderDeadline(input: {
  promisedAt?: Date | string | null;
  productionDeadline?: Date | string | null;
  installation?: { scheduledAt?: Date | string | null } | null;
}) {
  return input.promisedAt ?? input.productionDeadline ?? input.installation?.scheduledAt ?? null;
}

export function isOrderOverdue(
  deadline: Date | string | null | undefined,
  lifecycle: OrderLifecycle | string,
  now = new Date(),
) {
  if (
    !deadline ||
    lifecycle === OrderLifecycle.COMPLETED ||
    lifecycle === OrderLifecycle.CANCELLED
  )
    return false;
  const parsed = new Date(deadline);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() < now.getTime();
}

export function lifecycleEventLabel(type: string, to?: string | null) {
  if (type === "ORDER_COMPLETED") return "Заказ завершён";
  if (type === "BLOCKER_OPENED") return "Добавлена проблема";
  if (type === "BLOCKER_RESOLVED") return "Проблема решена";
  if (
    type === "COMPLETE_MEASUREMENT" ||
    type === "CONTROL_MEASUREMENT_COMPLETED"
  )
    return "Контрольный замер выполнен";
  if (type === "INSTALLATION_COMPLETED") return "Монтаж завершён";
  if (type === "LIFECYCLE_TRANSITION" && to)
    return `Этап изменён: ${USER_ORDER_STATUS_LABELS[projectOrderStatus(to)]}`;
  return type.toLowerCase().replaceAll("_", " ");
}
