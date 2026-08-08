const INTERNAL_KEYS = new Set([
  "internalCost", "purchaseCost", "costPrice", "workshopCost", "workshopPrice", "baseWorkshopCost", "workshopRate", "managerMinimumPrice", "margin", "markup", "internalCoefficient",
  "workshopAdjustment", "grossDifference", "companyProfit", "partnerPrice",
  "partnerBalance", "materialCost", "installationCost", "deliveryCost",
  "otherDirectCosts", "totalCost", "grossProfit", "unitCost", "saleRate",
  "baseClientPrice", "equivalentSteps", "clientAdjustment",
]);

export function publicCalculationSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicCalculationSnapshot);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !INTERNAL_KEYS.has(key))
    .map(([key, child]) => [key, publicCalculationSnapshot(child)]));
}
