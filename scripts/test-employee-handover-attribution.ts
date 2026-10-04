import assert from "node:assert/strict";
import { ownerAt, type OwnershipChange } from "../lib/services/handover-owner-at";

const first = new Date("2026-10-12T05:00:00Z");
const second = new Date("2026-11-01T05:00:00Z");
const changes: OwnershipChange[] = [
  { entityId: 7, fromUserId: 2, toUserId: 3, at: second },
  { entityId: 7, fromUserId: 1, toUserId: 2, at: first },
];

assert.equal(ownerAt(3, new Date("2026-10-01T00:00:00Z"), changes), 1, "sale before first handover belongs to original manager");
assert.equal(ownerAt(3, first, changes), 2, "fact at handover belongs to new manager");
assert.equal(ownerAt(3, new Date("2026-10-20T00:00:00Z"), changes), 2, "fact between handovers belongs to interim manager");
assert.equal(ownerAt(3, second, changes), 3, "fact after second handover belongs to current manager");
assert.equal(ownerAt(null, first, changes), null, "unassigned record stays unassigned");
assert.equal(ownerAt(1, first, undefined), 1, "record without handover retains owner");
console.log("Employee handover attribution: 6 scenarios passed");
