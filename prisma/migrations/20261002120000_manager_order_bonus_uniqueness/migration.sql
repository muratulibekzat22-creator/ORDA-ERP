-- One manager order may produce one guaranteed order-bonus submission only.
-- Corrections are separate ADJUSTMENT_* rows, so the original fact remains auditable.
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollAccrual_one_order_bonus"
ON "PayrollAccrual" ("orderId")
WHERE "orderId" IS NOT NULL
  AND "type" IN ('ORDER_BONUS', 'GUARANTEED_ORDER_BONUS')
  AND "direction" = 'INCREASE'
  AND "reversalOfId" IS NULL;

ALTER TABLE "PayrollPayment"
ADD COLUMN IF NOT EXISTS "externalReference" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "PayrollPayment_externalReference_key"
ON "PayrollPayment" ("externalReference")
WHERE "externalReference" IS NOT NULL;
