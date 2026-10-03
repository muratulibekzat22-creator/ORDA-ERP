export function stripPartnerAllocation(settlement: unknown) {
  if (!settlement || typeof settlement !== "object") return settlement;
  const safe = { ...(settlement as Record<string, unknown>) };
  if (safe.partner && typeof safe.partner === "object") {
    const partner = { ...(safe.partner as Record<string, unknown>) };
    delete partner.allocation;
    safe.partner = partner;
  }
  return safe;
}

export function partnerOnlySettlement(settlement: unknown, partnerId: unknown) {
  const safe = stripPartnerAllocation(settlement);
  if (!safe || typeof safe !== "object") return { partner: null };
  const source = (safe as Record<string, unknown>).partner;
  if (!source || typeof source !== "object") return { partner: null };
  const partner = source as Record<string, unknown>;
  const allowed = [
    "partnerId", "partnerName", "priceSet", "agreed", "paid", "remaining", "overpayment", "status",
  ];
  return {
    partner: {
      ...Object.fromEntries(allowed.map((key) => [key, partner[key]])),
      payouts: Array.isArray(partner.payouts)
        ? partner.payouts.filter((item) =>
            item && typeof item === "object" && (item as Record<string, unknown>).partnerId === partnerId)
        : [],
      assignments: [],
    },
  };
}
