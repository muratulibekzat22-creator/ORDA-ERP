-- Sales, plans and manager bonuses must use the actual order date, not the
-- technical timestamp when an old order was entered into ORDA.
ALTER TABLE "Order"
ADD COLUMN "orderDateNeedsReview" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Order_orderDateNeedsReview_orderReceivedAt_idx"
ON "Order"("orderDateNeedsReview", "orderReceivedAt");

-- These orders were entered on 1 October as a September backfill.  Their exact
-- contract dates must be confirmed by the responsible manager before they are
-- included in a monthly sales report or payroll calculation.
UPDATE "Order"
SET "orderDateNeedsReview" = true
WHERE "number" IN (
  'ORD-20261001-D96AB9A511B9',
  'ORD-20261001-D3A27853D493',
  'ORD-20261001-7473D05C9A3F',
  'ORD-20261001-9EA057BCDDC7',
  'ORD-20261001-1179639FDF86',
  'ORD-20261001-2AE5286F4EA1',
  'ORD-20261001-CC896F279436',
  'ORD-20261001-D0305D5FA920',
  'ORD-20261001-61A4261657EF'
);
