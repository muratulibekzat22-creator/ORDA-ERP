export type ManagerOrderAttentionSource = {
  id: number;
  number: string;
  lifecycle: string;
  amount: number;
  promisedAt: Date | string | null;
  address: string;
  staircase: string;
  material: string;
  contractConfirmed: boolean;
  contractStatus?: string | null;
  partnerAssigned: boolean;
  installationCompleted?: boolean;
  financialClosedAt?: Date | string | null;
  nextActionAt?: Date | string | null;
  client: {
    name: string;
    phone: string;
    city: string;
    address: string;
  };
};

export type ManagerOrderAttention = {
  id: number;
  number: string;
  client: string;
  phone: string;
  city: string;
  amount: number;
  promisedAt: string | null;
  status: string;
  missing: string[];
  overdue: boolean;
  requiresAction: boolean;
  actionLabel: string;
  href: string;
  priority: number;
  statusOrder: number;
};

const workshopInProgressLifecycles = new Set([
  "IN_PRODUCTION",
  "READY_FOR_INSTALLATION",
  "INSTALLATION",
]);

function blank(value: string | null | undefined) {
  return !value?.trim();
}

export function managerOrderBusinessStatus(input: {
  lifecycle: string;
  contractConfirmed: boolean;
  contractStatus?: string | null;
  partnerAssigned: boolean;
  installationCompleted?: boolean;
  financialClosedAt?: Date | string | null;
}) {
  if (input.financialClosedAt) return "Финансово закрыт";
  if (input.lifecycle === "COMPLETED") return "Объект сдан";
  if (input.lifecycle === "INSTALLATION" || input.lifecycle === "ACCEPTANCE" || input.installationCompleted)
    return "Установка";
  if (input.lifecycle === "READY_FOR_INSTALLATION") return "Готов к установке";
  if (input.partnerAssigned && workshopInProgressLifecycles.has(input.lifecycle))
    return "Заказ у цеха";
  if (input.partnerAssigned || input.lifecycle === "IN_PRODUCTION")
    return "Заказ у цеха";
  if (input.lifecycle === "READY_FOR_PRODUCTION")
    return input.partnerAssigned ? "Заказ у цеха" : "Ожидает передачи в цех";
  if (input.contractConfirmed) return "Договор подписан";
  if (input.contractStatus === "SIGNED") return "Договор подписан";
  if (input.contractStatus === "READY") return "Договор отправлен";
  if (input.contractStatus === "DRAFT") return "Договор подготовлен";
  return "Заказ оформлен";
}

const statusOrder: Record<string, number> = {
  "Заказ оформлен": 0,
  "Договор подготовлен": 1,
  "Договор отправлен": 2,
  "Договор подписан": 3,
  "Ожидает передачи в цех": 4,
  "Заказ у цеха": 5,
  "Готов к установке": 6,
  "Установка": 7,
  "Объект сдан": 8,
  "Финансово закрыт": 9,
};

export function buildManagerOrderAttention(
  input: ManagerOrderAttentionSource,
  now = new Date(),
): ManagerOrderAttention {
  const workflowCompleted = input.lifecycle === "COMPLETED" || Boolean(input.financialClosedAt);
  const missing = (workflowCompleted ? [] : [
    blank(input.client.name) ? "имя клиента" : null,
    blank(input.client.phone) ? "телефон" : null,
    blank(input.client.city) ? "город" : null,
    blank(input.address) && blank(input.client.address) ? "адрес" : null,
    blank(input.staircase) ? "тип лестницы" : null,
    blank(input.material) ? "материал" : null,
    input.amount <= 0 ? "стоимость заказа" : null,
    !input.promisedAt ? "срок заказа" : null,
  ]).filter((item): item is string => Boolean(item));
  const detailsMissing = missing.length > 0;
  const promisedAt = input.promisedAt ? new Date(input.promisedAt) : null;
  const overdue = Boolean(
    promisedAt &&
      !Number.isNaN(promisedAt.getTime()) &&
      promisedAt.getTime() < now.getTime(),
  );
  const needsCompletionReview =
    !workflowCompleted &&
    (input.lifecycle === "ACCEPTANCE" || input.installationCompleted === true);
  const contractReady = workflowCompleted || input.contractConfirmed || input.contractStatus === "SIGNED";
  const workshopStatusMissing = !workflowCompleted && contractReady && !input.partnerAssigned;
  const nextActionMissing = !workflowCompleted && !input.nextActionAt;
  if (!workflowCompleted && !input.contractStatus && !input.contractConfirmed)
    missing.push("статус договора");
  if (workshopStatusMissing) missing.push("статус цеха");
  if (nextActionMissing) missing.push("следующее действие");

  let actionLabel = "Открыть заказ";
  let href = `/orders/${input.id}`;
  let priority = 5;
  if (detailsMissing) {
    actionLabel = "Заполнить данные";
    href = `/orders/${input.id}?action=edit`;
    priority = 0;
  } else if (!contractReady) {
    actionLabel = "Уточнить договор";
    href = `/orders/${input.id}#process`;
    priority = 1;
  } else if (!workflowCompleted && !input.partnerAssigned) {
    actionLabel = "Передать в цех";
    href = `/orders/${input.id}?action=assign-workshop#settlements`;
    priority = 2;
  } else if (needsCompletionReview) {
    actionLabel = "Уточнить завершение";
    href = `/orders/${input.id}?action=complete#completion`;
    priority = 3;
  } else if (overdue) {
    actionLabel = "Уточнить статус";
    priority = 4;
  } else if (nextActionMissing) {
    actionLabel = "Добавить следующее действие";
    href = `/calendar?orderId=${input.id}`;
    priority = 4;
  }

  return {
    id: input.id,
    number: input.number,
    client: input.client.name.trim() || "Клиент не указан",
    phone: input.client.phone,
    city: input.client.city,
    amount: input.amount,
    promisedAt:
      promisedAt && !Number.isNaN(promisedAt.getTime())
        ? promisedAt.toISOString()
        : null,
    status: managerOrderBusinessStatus(input),
    missing,
    overdue,
    requiresAction:
      missing.length > 0 ||
      !contractReady ||
      (!workflowCompleted && !input.partnerAssigned) ||
      needsCompletionReview ||
      overdue ||
      nextActionMissing,
    actionLabel,
    href,
    priority,
    statusOrder: statusOrder[managerOrderBusinessStatus(input)] ?? 99,
  };
}
