-- Keep the already-applied 12:00 migration immutable. Move future concurrency
-- protection to a nullable deterministic key so legacy history remains intact.
ALTER TABLE "PayrollAccrual"
ADD COLUMN IF NOT EXISTS "orderBonusUniquenessKey" TEXT;

DROP INDEX IF EXISTS "PayrollAccrual_one_order_bonus";

CREATE UNIQUE INDEX IF NOT EXISTS "PayrollAccrual_orderBonusUniquenessKey_key"
ON "PayrollAccrual" ("orderBonusUniquenessKey");
