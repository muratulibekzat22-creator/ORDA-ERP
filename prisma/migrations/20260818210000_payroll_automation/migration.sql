DO $$
BEGIN
  CREATE TYPE "PayrollBonusRule" AS ENUM ('FIXED', 'PAID_PERCENT', 'PROFIT_PERCENT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "PayrollAccrual"
  ADD COLUMN IF NOT EXISTS "bonusRule" "PayrollBonusRule",
  ADD COLUMN IF NOT EXISTS "bonusValue" DECIMAL(14,4),
  ADD COLUMN IF NOT EXISTS "bonusBasisAmount" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "bonusSnapshot" JSONB;

ALTER TABLE "PayrollAdvanceRequest"
  ADD COLUMN IF NOT EXISTS "method" TEXT;
