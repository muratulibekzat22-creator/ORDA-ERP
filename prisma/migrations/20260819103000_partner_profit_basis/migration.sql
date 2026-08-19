ALTER TABLE "PartnerOrderRelation"
  ADD COLUMN IF NOT EXISTS "profitBasis" DECIMAL(14,2);

UPDATE "PartnerOrderRelation" relation
SET "profitBasis" = orders."companyProfit"
FROM "Order" orders
WHERE relation."orderId" = orders.id
  AND relation."profitBasis" IS NULL;

ALTER TABLE "PartnerOrderRelation"
  ALTER COLUMN "profitBasis" SET NOT NULL;
