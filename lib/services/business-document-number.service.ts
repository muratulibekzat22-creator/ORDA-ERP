import type { Prisma } from "@prisma/client";

import { requireTenantIdentity } from "@/lib/tenant-context";

export type BusinessDocumentPrefix = "PAY" | "OUT" | "IN" | "RET" | "MOV" | "REF";

/**
 * Allocates a non-reusable, company-scoped business document number inside the
 * caller's transaction. PostgreSQL serializes the upsert/update of one counter.
 */
export async function nextBusinessDocumentNumber(
  tx: Prisma.TransactionClient,
  prefix: BusinessDocumentPrefix,
  documentDate = new Date(),
) {
  const { companyId } = requireTenantIdentity();
  const year = Number(
    new Intl.DateTimeFormat("en", {
      year: "numeric",
      timeZone: "Asia/Almaty",
    }).format(documentDate),
  );
  const counter = await tx.businessDocumentCounter.upsert({
    where: { companyId_prefix_year: { companyId, prefix, year } },
    create: { companyId, prefix, year, value: 1 },
    update: { value: { increment: 1 } },
    select: { value: true },
  });
  return `${prefix}-${year}-${String(counter.value).padStart(6, "0")}`;
}
