export type OwnershipChange = { entityId: number; fromUserId: number; toUserId: number; at: Date };

/** A fact belongs to whoever owned the record when it happened. */
export function ownerAt(currentOwnerId: number | null, happenedAt: Date, changes: OwnershipChange[] | undefined) {
  let owner = currentOwnerId;
  for (const change of changes ?? []) if (happenedAt < change.at && owner === change.toUserId) owner = change.fromUserId;
  return owner;
}
