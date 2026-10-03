-- Supports the Director dashboard and active-order counters without changing data.
CREATE INDEX IF NOT EXISTS "Order_companyId_deletedAt_lifecycle_promisedAt_idx"
ON "Order"("companyId", "deletedAt", "lifecycle", "promisedAt");
