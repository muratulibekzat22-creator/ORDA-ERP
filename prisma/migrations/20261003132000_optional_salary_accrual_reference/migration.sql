-- A salary accrual may carry the transfer reference used by the founder for
-- reconciliation. It is deliberately optional because accrual and payment are
-- separate business events.
ALTER TABLE "PayrollAccrual"
ADD COLUMN IF NOT EXISTS "externalReference" TEXT;
