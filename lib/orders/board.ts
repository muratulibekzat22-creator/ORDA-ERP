import { OrderLifecycle } from "@prisma/client";

export const ORDER_BOARD_COLUMNS = [
  {
    key: "ORDERED",
    label: "Заказ оформлен",
    description: "Заказ создан, данные клиента проверяются",
  },
  {
    key: "CONTRACT",
    label: "Договор",
    description: "Договор и подготовка к передаче в цех",
  },
  {
    key: "WORKSHOP",
    label: "Передан в цех",
    description: "Передан, в работе, готов к монтажу или на монтаже",
  },
  {
    key: "COMPLETED",
    label: "Заказ завершён",
    description: "Работы завершены и заказ закрыт",
  },
] as const;

export type OrderBoardColumn = (typeof ORDER_BOARD_COLUMNS)[number]["key"];

export const WORKSHOP_REGION_GROUPS = [
  { key: "ALMATY_CITY", label: "Алматы" },
  { key: "ALMATY_REGION", label: "Алматинская область" },
  { key: "OTHER", label: "Другие города" },
] as const;

export type WorkshopRegionGroup = (typeof WORKSHOP_REGION_GROUPS)[number]["key"];

const ALMATY_REGION_MARKERS = [
  "алматинская область",
  "алматы облысы",
  "almaty region",
  "almaty oblast",
  "каскелен",
  "қаскелең",
  "талгар",
  "талғар",
  "есик",
  "есік",
  "конаев",
  "қонаев",
  "капчагай",
  "боралдай",
  "отеген батыр",
  "өтеген батыр",
  "бесагаш",
  "бесағаш",
  "иргели",
  "іргелі",
] as const;

export function workshopRegionGroup(city: string | null | undefined): WorkshopRegionGroup {
  let normalized = (city ?? "").trim().toLocaleLowerCase("ru-RU");
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep malformed legacy addresses readable and classify them by the raw value.
  }
  if (ALMATY_REGION_MARKERS.some((marker) => normalized.includes(marker))) return "ALMATY_REGION";
  if (normalized.includes("алматы") || normalized.includes("алма-ата") || normalized.includes("almaty")) return "ALMATY_CITY";
  return "OTHER";
}

// Completion remains available in the order card; the daily board is active work only.
export const ACTIVE_ORDER_BOARD_COLUMNS = ORDER_BOARD_COLUMNS.filter(column => column.key !== "COMPLETED");

export const ORDER_BOARD_TARGET_LIFECYCLE: Record<
  OrderBoardColumn,
  OrderLifecycle
> = {
  ORDERED: OrderLifecycle.CREATED,
  CONTRACT: OrderLifecycle.PREPARATION,
  WORKSHOP: OrderLifecycle.READY_FOR_PRODUCTION,
  COMPLETED: OrderLifecycle.COMPLETED,
};

export const ORDER_BOARD_LABELS = Object.fromEntries(
  ORDER_BOARD_COLUMNS.map((column) => [column.key, column.label]),
) as Record<OrderBoardColumn, string>;

export function orderBoardColumn(lifecycle: OrderLifecycle | string): OrderBoardColumn | null {
  if (lifecycle === OrderLifecycle.CREATED) return "ORDERED";
  if (lifecycle === OrderLifecycle.PREPARATION) return "CONTRACT";
  if (
    lifecycle === OrderLifecycle.READY_FOR_PRODUCTION ||
    lifecycle === OrderLifecycle.IN_PRODUCTION ||
    lifecycle === OrderLifecycle.READY_FOR_INSTALLATION ||
    lifecycle === OrderLifecycle.INSTALLATION ||
    lifecycle === OrderLifecycle.ACCEPTANCE
  ) return "WORKSHOP";
  if (lifecycle === OrderLifecycle.COMPLETED) return "COMPLETED";
  return null;
}

export function orderBoardLabel(lifecycle: OrderLifecycle | string) {
  const column = orderBoardColumn(lifecycle);
  return column ? ORDER_BOARD_LABELS[column] : "Отменён";
}
