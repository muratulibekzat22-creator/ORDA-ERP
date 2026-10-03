-- The 12:00 migration was already recorded in production before its final
-- contents were restored. Apply the payroll payment reference defensively in
-- a new immutable migration so Prisma and the live schema cannot drift.
ALTER TABLE "PayrollPayment"
ADD COLUMN IF NOT EXISTS "externalReference" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "PayrollPayment_externalReference_key"
ON "PayrollPayment" ("externalReference")
WHERE "externalReference" IS NOT NULL;
