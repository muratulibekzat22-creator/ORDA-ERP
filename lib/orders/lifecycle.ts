import { Role } from "@prisma/client";

export const ORDER_STATUSES = [
  "Новая заявка",
  "Коммерческое предложение отправлено",
  "Замер назначен",
  "Договор подписан",
  "Контрольный замер",
  "Заготовка",
  "Покраска",
  "Заказ готов",
  "Ожидает установки",
  "Установка",
  "Заказ завершён",
  "Отказ / отменён",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const legacy: Record<string, OrderStatus> = {
  Замер: "Замер назначен",
  Проектирование: "Контрольный замер",
  Каркас: "Заготовка",
  Дерево: "Заготовка",
  Монтаж: "Установка",
  Сдано: "Заказ завершён",
};

export function normalizeOrderStatus(value: string): OrderStatus | null {
  const normalized = legacy[value] ?? value;
  return ORDER_STATUSES.includes(normalized as OrderStatus)
    ? (normalized as OrderStatus)
    : null;
}

export function canTransitionOrderStatus(
  role: Role,
  fromValue: string,
  toValue: string,
) {
  const from = normalizeOrderStatus(fromValue);
  const to = normalizeOrderStatus(toValue);
  if (!from || !to || from === to) return false;
  if (role === Role.DIRECTOR) return true;
  if (role === Role.MANAGER) {
    if (to === "Отказ / отменён") return from !== "Заказ завершён";
    return ORDER_STATUSES.indexOf(to) === ORDER_STATUSES.indexOf(from) + 1;
  }
  if (role === Role.PARTNER) {
    const allowed: OrderStatus[] = [
      "Заготовка",
      "Покраска",
      "Заказ готов",
      "Ожидает установки",
      "Установка",
      "Заказ завершён",
    ];
    return (
      allowed.includes(from) &&
      allowed.indexOf(to) === allowed.indexOf(from) + 1
    );
  }
  return false;
}
