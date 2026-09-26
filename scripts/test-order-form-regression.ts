import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { runSingleFlight } from "@/lib/async-single-flight";
import { followUpGateMode } from "@/lib/clients/follow-up-gate-state";
import {
  clearNewOrderDraft,
  EMPTY_NEW_ORDER_FORM,
  newOrderDraftKey,
  readNewOrderDraft,
  resolveOrderSubmission,
  writeNewOrderDraft,
} from "@/lib/orders/new-order-draft";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

async function main() {
  const gateSource = readFileSync("components/clients/ManagerFollowUpGate.tsx", "utf8");
  const formSource = readFileSync("components/orders/NewOrderForm.tsx", "utf8");
  assert.doesNotMatch(gateSource, /loading\s*&&\s*items\.length\s*===\s*0/);
  assert.match(gateSource, /runSingleFlight\(inFlight/);
  assert.match(gateSource, /\{children\}[\s\S]*mode === "overlay"/);
  assert.match(formSource, /resolveOrderSubmission\(submission, payloadText/);
  assert.match(formSource, /clearNewOrderDraft\(window\.localStorage/);
  assert.match(formSource, /if \(submitting\.current\) return/);

  assert.equal(
    followUpGateMode({ sessionLoading: false, manager: true, checked: false, itemCount: 0 }),
    "initial-loading",
    "the first mandatory-contact check may show the blocking loader",
  );
  assert.equal(
    followUpGateMode({ sessionLoading: false, manager: true, checked: true, itemCount: 0 }),
    "passthrough",
    "a completed check must keep the route mounted during later refreshes",
  );
  assert.equal(
    followUpGateMode({ sessionLoading: false, manager: true, checked: true, itemCount: 1 }),
    "overlay",
    "a newly mandatory contact must be displayed over the mounted route",
  );

  let calls = 0;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const ref = { current: null as Promise<void> | null };
  const first = runSingleFlight(ref, async () => { calls += 1; await pending; });
  const second = runSingleFlight(ref, async () => { calls += 1; });
  assert.equal(first, second, "parallel follow-up checks must share one request");
  assert.equal(calls, 1, "parallel follow-up checks must not duplicate the request");
  finish();
  await Promise.all([first, second]);
  await runSingleFlight(ref, async () => { calls += 1; });
  assert.equal(calls, 2, "a completed check must allow the next polling cycle");

  const storage = new MemoryStorage();
  const draft = {
    version: 1 as const,
    userId: 17,
    form: { ...EMPTY_NEW_ORDER_FORM, clientName: "Synthetic Client", phone: "+77000000000", amount: "125000" },
    existingClient: null,
    submission: null,
    updatedAt: new Date(0).toISOString(),
  };
  writeNewOrderDraft(storage, draft);
  assert.deepEqual(readNewOrderDraft(storage, 17), draft, "a user's draft must round-trip");
  assert.equal(readNewOrderDraft(storage, 18), null, "drafts must be isolated by user id");

  const firstSubmission = resolveOrderSubmission(null, "payload-a", () => "stable-key");
  const retry = resolveOrderSubmission(firstSubmission, "payload-a", () => "wrong-key");
  assert.equal(retry.key, "stable-key", "a network retry must reuse the idempotency key");
  const changed = resolveOrderSubmission(firstSubmission, "payload-b", () => "new-key");
  assert.equal(changed.key, "new-key", "a changed payload must receive a new idempotency key");

  clearNewOrderDraft(storage, 17);
  assert.equal(storage.getItem(newOrderDraftKey(17)), null, "a successful order must clear its draft");
  storage.setItem(newOrderDraftKey(17), "not-json");
  assert.equal(readNewOrderDraft(storage, 17), null, "a corrupt draft must never block the form");

  console.log("order form regression scenarios passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
