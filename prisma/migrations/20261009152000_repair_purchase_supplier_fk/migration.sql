-- Production drift repair: the historical FK was left pointing at
-- LegacySupplier after Supplier was replaced. Abort before changing the
-- constraint if even one existing purchase batch cannot be matched.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PurchaseBatch" batch
    LEFT JOIN "Supplier" supplier ON supplier."id" = batch."supplierId"
    WHERE supplier."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'PurchaseBatch contains supplier IDs missing from Supplier';
  END IF;
END $$;

ALTER TABLE "PurchaseBatch"
  DROP CONSTRAINT IF EXISTS "PurchaseBatch_supplierId_fkey";

ALTER TABLE "PurchaseBatch"
  ADD CONSTRAINT "PurchaseBatch_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "PurchaseBatch"
  VALIDATE CONSTRAINT "PurchaseBatch_supplierId_fkey";
