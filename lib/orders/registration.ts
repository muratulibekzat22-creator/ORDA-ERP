export const FRAME_TYPES = [
  "Металлический каркас",
  "Бетон",
  "Без каркаса",
  "Другое",
] as const;

export const RAILING_TYPES = [
  "Классика",
  "Барокко",
  "Латунь",
  "Стекло",
  "Без ограждения",
  "Другое",
] as const;

export const PAYMENT_METHODS = [
  { value: "CASH", label: "Наличные" },
  { value: "BANK_TRANSFER", label: "Банковский перевод" },
  { value: "KASPI_INSTALLMENT", label: "Kaspi / рассрочка" },
  { value: "OTHER", label: "Другое" },
] as const;

export function paymentMethodLabel(value: string) {
  return PAYMENT_METHODS.find((item) => item.value === value)?.label ?? value;
}
