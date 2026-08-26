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
  partnerAssigned: boolean;
  installationCompleted?: boolean;
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
};

const activeWorkshopLifecycles = new Set([
  "READY_FOR_PRODUCTION",
  "IN_PRODUCTION",
  "READY_FOR_INSTALLATION",
  "INSTALLATION",
  "ACCEPTANCE",
]);

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
  partnerAssigned: boolean;
  installationCompleted?: boolean;
}) {
  if (input.lifecycle === "COMPLETED") return "Заказ завершён";
  if (input.lifecycle === "ACCEPTANCE" || input.installationCompleted)
    return "Уточните: заказ завершён?";
  if (
    input.partnerAssigned &&
    workshopInProgressLifecycles.has(input.lifecycle)
  )
    return "В работе у цеха";
  if (
    input.partnerAssigned ||
    activeWorkshopLifecycles.has(input.lifecycle)
  )
    return "Передан в цех";
  if (input.contractConfirmed) return "Договор подписан";
  return "Заказ оформлен";
}

export function buildManagerOrderAttention(
  input: ManagerOrderAttentionSource,
  now = new Date(),
): ManagerOrderAttention {
  const missing = [
    blank(input.client.name) ? "имя клиента" : null,
    blank(input.client.phone) ? "телефон" : null,
    blank(input.client.city) ? "город" : null,
    blank(input.address) && blank(input.client.address) ? "адрес" : null,
    blank(input.staircase) ? "тип лестницы" : null,
    blank(input.material) ? "материал" : null,
    input.amount <= 0 ? "стоимость заказа" : null,
    !input.promisedAt ? "срок заказа" : null,
  ].filter((item): item is string => Boolean(item));
  const promisedAt = input.promisedAt ? new Date(input.promisedAt) : null;
  const overdue = Boolean(
    promisedAt &&
      !Number.isNaN(promisedAt.getTime()) &&
      promisedAt.getTime() < now.getTime(),
  );
  const needsCompletionReview =
    input.lifecycle === "ACCEPTANCE" || input.installationCompleted === true;

  let actionLabel = "Открыть заказ";
  let href = `/orders/${input.id}`;
  let priority = 5;
  if (missing.length) {
    actionLabel = "Заполнить данные";
    href = `/orders/${input.id}?action=edit`;
    priority = 0;
  } else if (!input.contractConfirmed) {
    actionLabel = "Уточнить договор";
    href = `/orders/${input.id}#process`;
    priority = 1;
  } else if (!input.partnerAssigned) {
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
      !input.contractConfirmed ||
      !input.partnerAssigned ||
      needsCompletionReview ||
      overdue,
    actionLabel,
    href,
    priority,
  };
}
