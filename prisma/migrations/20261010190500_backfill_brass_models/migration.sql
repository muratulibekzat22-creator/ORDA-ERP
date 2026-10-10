-- Preserve legacy single-quantity requests as the default oval-black model.
UPDATE "OrderBrassProcurement"
SET "modelQuantities" = jsonb_build_object(
  'OVAL_BLACK', "quantityPairs"::integer,
  'OVAL_WHITE', 0,
  'SQUARE_BLACK', 0
)
WHERE "modelQuantities" = '{}'::jsonb;
