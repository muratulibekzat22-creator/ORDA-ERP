import assert from "node:assert/strict";

import { selectedFinanceJournalRange } from "../lib/services/finance-journal.service";

const now = new Date("2026-10-01T20:30:00.000Z");

const today = selectedFinanceJournalRange({ period: "today" }, now);
assert.equal(today.from?.toISOString(), "2026-10-01T19:00:00.000Z");
assert.equal(today.to?.toISOString(), now.toISOString());

const month = selectedFinanceJournalRange({ period: "month" }, now);
assert.equal(month.from?.toISOString(), "2026-09-30T19:00:00.000Z");
assert.equal(month.to?.toISOString(), now.toISOString());

const previous = selectedFinanceJournalRange({ period: "previous_month" }, now);
assert.equal(previous.from?.toISOString(), "2026-08-31T19:00:00.000Z");
assert.equal(previous.to?.toISOString(), "2026-09-30T18:59:59.999Z");

const year = selectedFinanceJournalRange({ period: "year" }, now);
assert.equal(year.from?.toISOString(), "2025-12-31T19:00:00.000Z");

const explicitFrom = new Date("2026-08-31T19:00:00.000Z");
const explicitTo = new Date("2026-09-30T18:59:59.999Z");
const explicit = selectedFinanceJournalRange(
  { period: "all", from: explicitFrom, to: explicitTo },
  now,
);
assert.equal(explicit.from, explicitFrom);
assert.equal(explicit.to, explicitTo);

console.log("Finance journal ranges follow the Asia/Almaty business day and month boundaries");
