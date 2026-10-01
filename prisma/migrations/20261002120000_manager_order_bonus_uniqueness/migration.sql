-- Existing history stays untouched. Every new primary order bonus receives the
-- same deterministic key, making concurrent submissions race-safe.
ALTER TABLE "PayrollAccrual"
ADD COLUMN IF NOT EXISTS "orderBonusUniquenessKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "PayrollAccrual_orderBonusUniquenessKey_key"
ON "PayrollAccrual" ("orderBonusUniquenessKey")
WHERE "orderBonusUniquenessKey" IS NOT NULL;

ALTER TABLE "PayrollPayment"
ADD COLUMN IF NOT EXISTS "externalReference" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "PayrollPayment_externalReference_key"
ON "PayrollPayment" ("externalReference")
WHERE "externalReference" IS NOT NULL;
