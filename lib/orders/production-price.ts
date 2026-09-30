// 1 ₸ is the legacy placeholder used by old forms, not an agreed workshop price.
export const MIN_PRODUCTION_PRICE = 2;

export function isProductionPriceAmount(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= MIN_PRODUCTION_PRICE;
}

export function hasProductionPrice(
  value: unknown,
  agreedAt: unknown,
) {
  return Boolean(agreedAt) && isProductionPriceAmount(value);
}
