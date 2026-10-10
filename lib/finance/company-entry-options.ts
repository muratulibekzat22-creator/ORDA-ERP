export const COMPANY_INCOME_OPTIONS = [
  ["ADDITIONAL_INCOME", "Дополнительный доход"],
  ["OTHER_INCOME", "Другой доход"],
  ["INVESTMENT", "Инвестиции / пополнение"],
  ["REFUND_RECEIVED", "Возврат средств"],
  ["COMPANY_LOAN_INCOME", "Заём компании"],
  ["OTHER", "Прочее поступление"],
] as const;

export const COMPANY_EXPENSE_OPTIONS = [
  ["ADDITIONAL_EXPENSE", "Дополнительный расход"],
  ["OTHER_EXPENSE", "Прочие расходы"],
  ["SALARY", "Зарплата"],
  ["MANAGER_BONUS", "Бонус менеджеру"],
  ["ADVERTISING", "Реклама"],
  ["RENT", "Аренда"],
  ["FUEL", "Топливо"],
  ["DELIVERY", "Доставка"],
  ["TAX", "Налоги"],
  ["ACCOUNTING", "Бухгалтерия"],
  ["COMMUNICATION", "Связь / интернет"],
  ["OFFICE", "Офисные расходы"],
  ["SERVICES", "Услуги"],
  ["EQUIPMENT", "Оборудование"],
  ["COMPANY_LOAN", "Заём компании"],
  ["OTHER", "Прочее"],
] as const;

export const COMPANY_INCOME_CATEGORIES = COMPANY_INCOME_OPTIONS.map(([value]) => value);
export const COMPANY_EXPENSE_CATEGORIES = COMPANY_EXPENSE_OPTIONS.map(([value]) => value);
