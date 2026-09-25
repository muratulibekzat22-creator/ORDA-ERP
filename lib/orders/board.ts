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
