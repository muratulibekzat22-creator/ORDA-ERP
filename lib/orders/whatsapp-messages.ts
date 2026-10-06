export type OrderPaymentPromise = {
  amount: number;
  dueAt: Date | string;
};

export type OrderWhatsAppMessageInput = {
  clientName: string;
  phone: string;
  mapUrl: string;
  address: string;
  staircase: string;
  material: string;
  railingType: string;
  supportType: string;
  lighting: boolean;
  lightingDetails: string;
  cladding: boolean;
  claddingDetails: string;
  additionalDetails: string;
  orderReceivedAt: Date | string;
  promisedAt: Date | string | null;
  manager: string;
  amount: number;
  received: number;
  balance: number;
  paymentMethod: string;
  paymentPromises?: OrderPaymentPromise[];
};

const timeZone = "Asia/Almaty";

function value(value: string | null | undefined) {
  return value?.trim() || "—";
}

function yesNoDetails(enabled: boolean, details: string) {
  if (!enabled) return "нет";
  return details.trim() || "да";
}

export function orderMessageAmount(amount: number) {
  return Math.max(0, amount).toLocaleString("ru-RU", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function orderMessageDate(date: Date | string | null) {
  if (!date) return "—";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
}

function dayKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function paymentPromiseDayLabel(date: Date | string, now = new Date()) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "Күні нақтыланады";
  const today = dayKey(now);
  const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const promiseDay = dayKey(parsed);
  if (promiseDay === today) return "Бүгін";
  if (promiseDay === dayKey(tomorrowDate)) return "Ертең";
  return orderMessageDate(parsed);
}

export function buildOrderWhatsAppMessages(input: OrderWhatsAppMessageInput, now = new Date()) {
  const promises = (input.paymentPromises ?? [])
    .filter((item) => Number.isFinite(item.amount) && item.amount > 0)
    .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime());
  const promisedTotal = promises.reduce((sum, item) => sum + item.amount, 0);
  const plannedBalance = Math.max(0, input.balance - promisedTotal);
  const lighting = yesNoDetails(input.lighting, input.lightingDetails);
  const cladding = yesNoDetails(input.cladding, input.claddingDetails);

  const orderText = [
    value(input.clientName),
    `Номер: ${value(input.phone)}`,
    `Улица: ${value(input.mapUrl)}`,
    "",
    `Адрес: ${value(input.address)}`,
    `Каркас: ${value(input.staircase)}`,
    `Материал: ${value(input.material)}`,
    `Балясины: ${value(input.railingType)}`,
    `Стойка: ${value(input.supportType)}`,
    `Подсветка: ${lighting}`,
    `Обшивка: ${cladding}`,
    `Дополнительно: ${value(input.additionalDetails)}`,
    `Заказ алынды: ${orderMessageDate(input.orderReceivedAt)}`,
    `Срок заказа: ${orderMessageDate(input.promisedAt)}`,
    `Менеджер: ${value(input.manager)}`,
    `Остаток: ${orderMessageAmount(plannedBalance)} тг`,
  ].join("\n");

  const financeText = [
    `Общая сумма: ${orderMessageAmount(input.amount)} тг`,
    `Полученная сумма: ${orderMessageAmount(input.received)} тг`,
    ...promises.map((item) => `(${paymentPromiseDayLabel(item.dueAt, now)} ${orderMessageAmount(item.amount)} салады)`),
    `ОСТАТОК: ${orderMessageAmount(plannedBalance)} тг`,
    `Способ оплаты: ${value(input.paymentMethod)}`,
  ].join("\n");

  return { orderText, financeText, plannedBalance, promisedTotal };
}
