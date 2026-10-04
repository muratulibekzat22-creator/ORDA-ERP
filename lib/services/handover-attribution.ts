import { prisma } from "@/lib/prisma";
import { type OwnershipChange } from "@/lib/services/handover-owner-at";
export { ownerAt } from "@/lib/services/handover-owner-at";


export async function loadOwnershipChanges(companyId: number, kind: "clients" | "orders", entityIds: number[]) {
  if (!entityIds.length) return new Map<number, OwnershipChange[]>();
  const items = await prisma.employeeHandoverItem.findMany({
    where: { kind, entityId: { in: entityIds }, handover: { companyId, status: "COMPLETED" } },
    select: { entityId: true, handover: { select: { fromUserId: true, toUserId: true, confirmedAt: true } } },
  });
  const changes = new Map<number, OwnershipChange[]>();
  for (const item of items) {
    if (!item.handover.confirmedAt) continue;
    const list = changes.get(item.entityId) ?? [];
    list.push({ entityId: item.entityId, fromUserId: item.handover.fromUserId, toUserId: item.handover.toUserId, at: item.handover.confirmedAt });
    changes.set(item.entityId, list);
  }
  for (const list of changes.values()) list.sort((a, b) => b.at.getTime() - a.at.getTime());
  return changes;
}
