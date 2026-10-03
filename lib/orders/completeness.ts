import { hasProductionPrice } from "@/lib/orders/production-price";

type OrderCompletenessSource = {
  orderDateNeedsReview?: boolean | null;
  managerUserId?: number | null;
  partnerId?: number | null;
  partnerPrice?: unknown;
  partnerAgreedAt?: Date | string | null;
  promisedAt?: Date | string | null;
  productionDeadline?: Date | string | null;
  installation?: { scheduledAt?: Date | string | null } | null;
  client?: { phone?: string | null; city?: string | null } | null;
};

export function orderDataGaps(order: OrderCompletenessSource) {
  const gaps: string[] = [];
  if (order.orderDateNeedsReview)
    gaps.push("Подтвердить фактическую дату заказа");
  if (!order.managerUserId) gaps.push("Назначить ответственного менеджера");
  if (!order.client?.phone?.trim()) gaps.push("Телефон клиента");
  if (!order.client?.city?.trim()) gaps.push("Город клиента");
  if (!order.promisedAt && !order.productionDeadline && !order.installation?.scheduledAt)
    gaps.push("Срок заказа");
  if (!order.partnerId) gaps.push("Назначить цех");
  if (!hasProductionPrice(order.partnerPrice, order.partnerAgreedAt))
    gaps.push("Цена производства");
  return gaps;
}
