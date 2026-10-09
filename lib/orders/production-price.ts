// Tiny amounts (1 ₸, 111 ₸ and similar) are legacy/test placeholders, not an
// agreed workshop price for an Altyn Sapa production order.
export const MIN_PRODUCTION_PRICE = 10_000;

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
