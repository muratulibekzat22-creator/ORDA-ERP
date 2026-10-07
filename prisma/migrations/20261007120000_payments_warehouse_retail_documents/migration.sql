-- Extend the existing ORDA accounting model without rewriting historic operations.
-- All catalogue rows inserted below have unknown quantity and prices by design.

ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'GOODS_RECEIPT';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'OUTGOING_INVOICE';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'GOODS_RETURN';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'STOCK_TRANSFER';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'REFUND_CONFIRMATION';
ALTER TYPE "DocumentSource" ADD VALUE IF NOT EXISTS 'GENERATED_WAREHOUSE';

DO $$
BEGIN
  CREATE TYPE "ProductKind" AS ENUM ('STOCK', 'CUSTOM', 'SERVICE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "WarehouseShipmentStatus" AS ENUM ('POSTED', 'RETURNED_PARTIALLY', 'RETURNED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "StockCondition" AS ENUM ('SELLABLE', 'DAMAGED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Client"
  ADD COLUMN IF NOT EXISTS "isWalkIn" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "orderKind" TEXT NOT NULL DEFAULT 'CUSTOM',
  ADD COLUMN IF NOT EXISTS "fulfillmentStatus" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE';

DROP INDEX IF EXISTS "Document_type_number_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Document_companyId_type_number_key"
  ON "Document"("companyId", "type", "number");

DROP INDEX IF EXISTS "Material_lookupKey_key";
DROP INDEX IF EXISTS "Material_code_key";
DROP INDEX IF EXISTS "Material_code_idx";

ALTER TABLE "Material"
  ALTER COLUMN "purchasePrice" DROP DEFAULT,
  ALTER COLUMN "purchasePrice" DROP NOT NULL,
  ALTER COLUMN "sellingPrice" DROP DEFAULT,
  ALTER COLUMN "sellingPrice" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "productKind" "ProductKind" NOT NULL DEFAULT 'STOCK',
  ADD COLUMN IF NOT EXISTS "variantGroup" TEXT,
  ADD COLUMN IF NOT EXISTS "color" TEXT,
  ADD COLUMN IF NOT EXISTS "finish" TEXT,
  ADD COLUMN IF NOT EXISTS "materialSpec" TEXT,
  ADD COLUMN IF NOT EXISTS "dimensions" TEXT,
  ADD COLUMN IF NOT EXISTS "applicability" TEXT,
  ADD COLUMN IF NOT EXISTS "searchAliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "quantityPrecision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "availabilityConfirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "quantityKnown" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS "Material_companyId_lookupKey_key"
  ON "Material"("companyId", "lookupKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Material_companyId_code_key"
  ON "Material"("companyId", "code");

ALTER TABLE "Payment"
  ADD COLUMN "refundOfId" INTEGER;

ALTER TABLE "PaymentReceipt"
  ADD COLUMN "companyId" INTEGER,
  ADD COLUMN "displayNumber" TEXT,
  ADD COLUMN "publicAccessEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "MaterialMovement"
  ADD COLUMN "documentId" INTEGER,
  ADD COLUMN "locationId" INTEGER,
  ADD COLUMN "fromLocationId" INTEGER,
  ADD COLUMN "toLocationId" INTEGER;

DROP INDEX IF EXISTS "MaterialReservation_orderId_materialId_key";
ALTER TABLE "MaterialReservation"
  ADD COLUMN "locationId" INTEGER,
  ADD COLUMN "orderItemId" INTEGER;

CREATE TABLE "BusinessDocumentCounter" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "prefix" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "value" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessDocumentCounter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WarehouseLocation" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'OFFICE',
  "address" TEXT NOT NULL DEFAULT '',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WarehouseLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WarehouseLocationAccess" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "locationId" INTEGER NOT NULL,
  "canSell" BOOLEAN NOT NULL DEFAULT true,
  "canReceive" BOOLEAN NOT NULL DEFAULT false,
  "canAdjust" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WarehouseLocationAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WarehouseBalance" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "materialId" INTEGER NOT NULL,
  "locationId" INTEGER NOT NULL,
  "stock" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "reserved" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WarehouseBalance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MaterialChangeAudit" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "materialId" INTEGER NOT NULL,
  "field" TEXT NOT NULL,
  "oldValue" TEXT,
  "newValue" TEXT,
  "reason" TEXT,
  "actorId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaterialChangeAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderItem" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "orderId" INTEGER NOT NULL,
  "materialId" INTEGER,
  "skuSnapshot" TEXT NOT NULL,
  "nameSnapshot" TEXT NOT NULL,
  "variantSnapshot" TEXT,
  "unitSnapshot" TEXT NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL,
  "unitPrice" DECIMAL(14,2) NOT NULL,
  "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "lineTotal" DECIMAL(14,2) NOT NULL,
  "unitCostSnapshot" DECIMAL(18,6),
  "stockTracked" BOOLEAN NOT NULL DEFAULT true,
  "reservedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "issuedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "returnedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentPart" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "paymentId" INTEGER NOT NULL,
  "method" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "reference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentPart_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WarehouseShipment" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "number" TEXT NOT NULL,
  "orderId" INTEGER NOT NULL,
  "locationId" INTEGER NOT NULL,
  "issuedById" INTEGER NOT NULL,
  "recipientName" TEXT,
  "status" "WarehouseShipmentStatus" NOT NULL DEFAULT 'POSTED',
  "shippedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "documentId" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WarehouseShipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WarehouseShipmentLine" (
  "id" SERIAL NOT NULL,
  "shipmentId" INTEGER NOT NULL,
  "orderItemId" INTEGER NOT NULL,
  "materialId" INTEGER NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL,
  "unitPriceSnapshot" DECIMAL(14,2) NOT NULL,
  "lineTotal" DECIMAL(14,2) NOT NULL,
  "movementId" INTEGER NOT NULL,
  CONSTRAINT "WarehouseShipmentLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WarehouseReturn" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "number" TEXT NOT NULL,
  "orderId" INTEGER NOT NULL,
  "shipmentId" INTEGER NOT NULL,
  "locationId" INTEGER NOT NULL,
  "acceptedById" INTEGER NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reason" TEXT NOT NULL,
  "documentId" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WarehouseReturn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WarehouseReturnLine" (
  "id" SERIAL NOT NULL,
  "returnId" INTEGER NOT NULL,
  "shipmentLineId" INTEGER NOT NULL,
  "orderItemId" INTEGER NOT NULL,
  "materialId" INTEGER NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL,
  "condition" "StockCondition" NOT NULL DEFAULT 'SELLABLE',
  "movementId" INTEGER NOT NULL,
  CONSTRAINT "WarehouseReturnLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseReceipt" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "number" TEXT NOT NULL,
  "batchId" INTEGER NOT NULL,
  "locationId" INTEGER NOT NULL,
  "acceptedById" INTEGER NOT NULL,
  "supplierDocumentNumber" TEXT,
  "supplierDocumentDate" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT,
  "documentId" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseReceiptLine" (
  "id" SERIAL NOT NULL,
  "receiptId" INTEGER NOT NULL,
  "purchaseBatchLineId" INTEGER NOT NULL,
  "materialId" INTEGER NOT NULL,
  "receivedQuantity" DECIMAL(18,3) NOT NULL,
  "acceptedQuantity" DECIMAL(18,3) NOT NULL,
  "rejectedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "unitCostSnapshot" DECIMAL(18,6),
  "movementId" INTEGER NOT NULL,
  CONSTRAINT "PurchaseReceiptLine_pkey" PRIMARY KEY ("id")
);

-- Each company receives one neutral default location. An existing configured address
-- is reused, but the reference address from the supplied design is never injected.
INSERT INTO "WarehouseLocation" (
  "companyId", "code", "name", "type", "address", "active", "isDefault", "updatedAt"
)
SELECT
  c."id",
  'DEFAULT',
  'Офис / Шоурум',
  'OFFICE',
  COALESCE(NULLIF(cs."actualAddress", ''), NULLIF(cs."legalAddress", ''), ''),
  true,
  true,
  CURRENT_TIMESTAMP
FROM "Company" c
LEFT JOIN "CompanySettings" cs ON cs."companyId" = c."id"
;

-- Historic aggregate stock is preserved at the new default location.
INSERT INTO "WarehouseBalance" (
  "companyId", "materialId", "locationId", "stock", "reserved", "updatedAt"
)
SELECT
  m."companyId",
  m."id",
  wl."id",
  m."stock"::DECIMAL(18,3),
  m."reserved"::DECIMAL(18,3),
  CURRENT_TIMESTAMP
FROM "Material" m
JOIN "WarehouseLocation" wl
  ON wl."companyId" = m."companyId" AND wl."isDefault" = true
;

UPDATE "MaterialMovement" mm
SET "locationId" = wl."id"
FROM "WarehouseLocation" wl
WHERE wl."companyId" = mm."companyId"
  AND wl."isDefault" = true
  AND mm."locationId" IS NULL;

UPDATE "MaterialReservation" mr
SET "locationId" = wl."id"
FROM "WarehouseLocation" wl
WHERE wl."companyId" = mr."companyId"
  AND wl."isDefault" = true
  AND mr."locationId" IS NULL;

-- Keep the globally unique legacy receipt sequence and add a stable client-facing
-- number. The payment date, not the migration date, determines the year.
UPDATE "PaymentReceipt" pr
SET
  "companyId" = p."companyId",
  "displayNumber" = 'PAY-' || EXTRACT(YEAR FROM p."operationDate" + INTERVAL '5 hours')::INTEGER::TEXT || '-' || LPAD(pr."receiptNumber"::TEXT, 6, '0')
FROM "Payment" p
WHERE p."id" = pr."paymentId";

ALTER TABLE "PaymentReceipt"
  ALTER COLUMN "companyId" SET NOT NULL,
  ALTER COLUMN "displayNumber" SET NOT NULL;

INSERT INTO "BusinessDocumentCounter" (
  "companyId", "prefix", "year", "value", "updatedAt"
)
SELECT
  pr."companyId",
  'PAY',
  EXTRACT(YEAR FROM p."operationDate" + INTERVAL '5 hours')::INTEGER,
  MAX(pr."receiptNumber"),
  CURRENT_TIMESTAMP
FROM "PaymentReceipt" pr
JOIN "Payment" p ON p."id" = pr."paymentId"
GROUP BY pr."companyId", EXTRACT(YEAR FROM p."operationDate" + INTERVAL '5 hours')::INTEGER;

-- Four real variants confirmed by the owner. Quantity, cost, sale price and a
-- private photo upload remain unset. The UI serves bundled source-derived catalog
-- images by material code until a director/founder uploads a replacement.
INSERT INTO "Material" (
  "companyId", "name", "category", "unit", "minimumStock", "stock",
  "purchasePrice", "active", "lookupKey", "reserved", "averageCost",
  "inventoryValue", "valuationVersion", "costStatus", "code", "model",
  "description", "sellingPrice", "locationName", "productKind", "variantGroup",
  "color", "finish", "dimensions", "applicability", "searchAliases",
  "quantityPrecision", "availabilityConfirmed", "quantityKnown", "updatedAt"
)
SELECT
  c."id",
  v."name",
  'Мини-стойки',
  'шт.',
  0,
  0,
  NULL,
  true,
  v."lookupKey",
  0,
  0,
  0,
  1,
  'LEGACY_UNVERIFIED'::"InventoryCostStatus",
  v."code",
  '200 мм',
  'Мини-стойка для стеклянного ограждения, высота 200 мм',
  NULL,
  'Офис / Шоурум',
  'STOCK'::"ProductKind",
  'MINI_SPIGOT_200',
  v."color",
  v."finish",
  '200 мм',
  'Стеклянные ограждения',
  ARRAY['мини-стойка', 'ножка для стекла', 'стеклодержатель', 'спигот', '20 см', v."color"]::TEXT[],
  0,
  true,
  false,
  CURRENT_TIMESTAMP
FROM "Company" c
CROSS JOIN (
  VALUES
    ('Мини-стойка для стеклянного ограждения, 200 мм — золотистая', 'mini-spigot-200-gold', 'MSP-200-GOLD', 'Золотистая', NULL::TEXT),
    ('Мини-стойка для стеклянного ограждения, 200 мм — розовое золото', 'mini-spigot-200-rose-gold', 'MSP-200-ROSE-GOLD', 'Розовое золото', NULL::TEXT),
    ('Мини-стойка для стеклянного ограждения, 200 мм — белая', 'mini-spigot-200-white', 'MSP-200-WHITE', 'Белая', NULL::TEXT),
    ('Мини-стойка для стеклянного ограждения, 200 мм — чёрная матовая', 'mini-spigot-200-black-matte', 'MSP-200-BLACK-MATTE', 'Чёрная', 'Матовая')
) AS v("name", "lookupKey", "code", "color", "finish")
ON CONFLICT ("companyId", "lookupKey") DO NOTHING;

INSERT INTO "WarehouseBalance" (
  "companyId", "materialId", "locationId", "stock", "reserved", "updatedAt"
)
SELECT m."companyId", m."id", wl."id", 0, 0, CURRENT_TIMESTAMP
FROM "Material" m
JOIN "WarehouseLocation" wl
  ON wl."companyId" = m."companyId" AND wl."isDefault" = true
WHERE m."variantGroup" = 'MINI_SPIGOT_200'
  AND NOT EXISTS (
    SELECT 1
    FROM "WarehouseBalance" wb
    WHERE wb."materialId" = m."id" AND wb."locationId" = wl."id"
  );

CREATE UNIQUE INDEX "BusinessDocumentCounter_companyId_prefix_year_key"
  ON "BusinessDocumentCounter"("companyId", "prefix", "year");
CREATE UNIQUE INDEX "WarehouseLocation_companyId_code_key"
  ON "WarehouseLocation"("companyId", "code");
CREATE UNIQUE INDEX "WarehouseLocation_companyId_name_key"
  ON "WarehouseLocation"("companyId", "name");
CREATE INDEX "WarehouseLocation_companyId_active_idx"
  ON "WarehouseLocation"("companyId", "active");
CREATE UNIQUE INDEX "WarehouseLocationAccess_userId_locationId_key"
  ON "WarehouseLocationAccess"("userId", "locationId");
CREATE INDEX "WarehouseLocationAccess_companyId_locationId_idx"
  ON "WarehouseLocationAccess"("companyId", "locationId");
CREATE UNIQUE INDEX "WarehouseBalance_materialId_locationId_key"
  ON "WarehouseBalance"("materialId", "locationId");
CREATE INDEX "WarehouseBalance_companyId_locationId_idx"
  ON "WarehouseBalance"("companyId", "locationId");
CREATE INDEX "MaterialChangeAudit_companyId_materialId_createdAt_idx"
  ON "MaterialChangeAudit"("companyId", "materialId", "createdAt");
CREATE INDEX "OrderItem_companyId_orderId_position_idx"
  ON "OrderItem"("companyId", "orderId", "position");
CREATE INDEX "OrderItem_materialId_createdAt_idx"
  ON "OrderItem"("materialId", "createdAt");
CREATE INDEX "PaymentPart_companyId_paymentId_idx"
  ON "PaymentPart"("companyId", "paymentId");
CREATE UNIQUE INDEX "WarehouseShipment_documentId_key" ON "WarehouseShipment"("documentId");
CREATE UNIQUE INDEX "WarehouseShipment_idempotencyKey_key" ON "WarehouseShipment"("idempotencyKey");
CREATE UNIQUE INDEX "WarehouseShipment_companyId_number_key" ON "WarehouseShipment"("companyId", "number");
CREATE INDEX "WarehouseShipment_companyId_orderId_shippedAt_idx" ON "WarehouseShipment"("companyId", "orderId", "shippedAt");
CREATE UNIQUE INDEX "WarehouseShipmentLine_movementId_key" ON "WarehouseShipmentLine"("movementId");
CREATE UNIQUE INDEX "WarehouseShipmentLine_shipmentId_orderItemId_key" ON "WarehouseShipmentLine"("shipmentId", "orderItemId");
CREATE UNIQUE INDEX "WarehouseReturn_documentId_key" ON "WarehouseReturn"("documentId");
CREATE UNIQUE INDEX "WarehouseReturn_idempotencyKey_key" ON "WarehouseReturn"("idempotencyKey");
CREATE UNIQUE INDEX "WarehouseReturn_companyId_number_key" ON "WarehouseReturn"("companyId", "number");
CREATE INDEX "WarehouseReturn_companyId_orderId_acceptedAt_idx" ON "WarehouseReturn"("companyId", "orderId", "acceptedAt");
CREATE UNIQUE INDEX "WarehouseReturnLine_movementId_key" ON "WarehouseReturnLine"("movementId");
CREATE INDEX "WarehouseReturnLine_returnId_materialId_idx" ON "WarehouseReturnLine"("returnId", "materialId");
CREATE UNIQUE INDEX "PurchaseReceipt_documentId_key" ON "PurchaseReceipt"("documentId");
CREATE UNIQUE INDEX "MaterialMovement_documentId_key" ON "MaterialMovement"("documentId");
CREATE UNIQUE INDEX "PurchaseReceipt_idempotencyKey_key" ON "PurchaseReceipt"("idempotencyKey");
CREATE UNIQUE INDEX "PurchaseReceipt_companyId_number_key" ON "PurchaseReceipt"("companyId", "number");
CREATE INDEX "PurchaseReceipt_companyId_batchId_receivedAt_idx" ON "PurchaseReceipt"("companyId", "batchId", "receivedAt");
CREATE UNIQUE INDEX "PurchaseReceiptLine_movementId_key" ON "PurchaseReceiptLine"("movementId");
CREATE UNIQUE INDEX "PurchaseReceiptLine_receiptId_purchaseBatchLineId_key" ON "PurchaseReceiptLine"("receiptId", "purchaseBatchLineId");
CREATE UNIQUE INDEX "MaterialReservation_orderId_materialId_locationId_key"
  ON "MaterialReservation"("orderId", "materialId", "locationId");
CREATE INDEX "Payment_refundOfId_operationDate_idx" ON "Payment"("refundOfId", "operationDate");
CREATE UNIQUE INDEX "PaymentReceipt_companyId_displayNumber_key" ON "PaymentReceipt"("companyId", "displayNumber");

ALTER TABLE "BusinessDocumentCounter" ADD CONSTRAINT "BusinessDocumentCounter_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseLocationAccess" ADD CONSTRAINT "WarehouseLocationAccess_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseLocationAccess" ADD CONSTRAINT "WarehouseLocationAccess_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarehouseLocationAccess" ADD CONSTRAINT "WarehouseLocationAccess_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarehouseBalance" ADD CONSTRAINT "WarehouseBalance_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseBalance" ADD CONSTRAINT "WarehouseBalance_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseBalance" ADD CONSTRAINT "WarehouseBalance_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialChangeAudit" ADD CONSTRAINT "MaterialChangeAudit_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialChangeAudit" ADD CONSTRAINT "MaterialChangeAudit_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialChangeAudit" ADD CONSTRAINT "MaterialChangeAudit_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentPart" ADD CONSTRAINT "PaymentPart_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentPart" ADD CONSTRAINT "PaymentPart_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_refundOfId_fkey"
  FOREIGN KEY ("refundOfId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialMovement" ADD CONSTRAINT "MaterialMovement_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialMovement" ADD CONSTRAINT "MaterialMovement_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialMovement" ADD CONSTRAINT "MaterialMovement_fromLocationId_fkey"
  FOREIGN KEY ("fromLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialMovement" ADD CONSTRAINT "MaterialMovement_toLocationId_fkey"
  FOREIGN KEY ("toLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialReservation" ADD CONSTRAINT "MaterialReservation_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaterialReservation" ADD CONSTRAINT "MaterialReservation_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseShipment" ADD CONSTRAINT "WarehouseShipment_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseShipment" ADD CONSTRAINT "WarehouseShipment_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseShipment" ADD CONSTRAINT "WarehouseShipment_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseShipment" ADD CONSTRAINT "WarehouseShipment_issuedById_fkey"
  FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseShipment" ADD CONSTRAINT "WarehouseShipment_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseShipmentLine" ADD CONSTRAINT "WarehouseShipmentLine_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "WarehouseShipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseShipmentLine" ADD CONSTRAINT "WarehouseShipmentLine_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseShipmentLine" ADD CONSTRAINT "WarehouseShipmentLine_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseShipmentLine" ADD CONSTRAINT "WarehouseShipmentLine_movementId_fkey"
  FOREIGN KEY ("movementId") REFERENCES "MaterialMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseReturn" ADD CONSTRAINT "WarehouseReturn_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseReturn" ADD CONSTRAINT "WarehouseReturn_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseReturn" ADD CONSTRAINT "WarehouseReturn_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "WarehouseShipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseReturn" ADD CONSTRAINT "WarehouseReturn_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseReturn" ADD CONSTRAINT "WarehouseReturn_acceptedById_fkey"
  FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseReturn" ADD CONSTRAINT "WarehouseReturn_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseReturnLine" ADD CONSTRAINT "WarehouseReturnLine_returnId_fkey"
  FOREIGN KEY ("returnId") REFERENCES "WarehouseReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseReturnLine" ADD CONSTRAINT "WarehouseReturnLine_shipmentLineId_fkey"
  FOREIGN KEY ("shipmentLineId") REFERENCES "WarehouseShipmentLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseReturnLine" ADD CONSTRAINT "WarehouseReturnLine_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseReturnLine" ADD CONSTRAINT "WarehouseReturnLine_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseReturnLine" ADD CONSTRAINT "WarehouseReturnLine_movementId_fkey"
  FOREIGN KEY ("movementId") REFERENCES "MaterialMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "PurchaseBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "WarehouseLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_acceptedById_fkey"
  FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "PurchaseReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_purchaseBatchLineId_fkey"
  FOREIGN KEY ("purchaseBatchLineId") REFERENCES "PurchaseBatchLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_movementId_fkey"
  FOREIGN KEY ("movementId") REFERENCES "MaterialMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ORDA uses password-only employee login. Clear stale temporary lock and
-- forced-password flags for active accounts during this release; disabled
-- accounts stay disabled and passwords are not changed.
UPDATE "User"
SET
  "failedLoginAttempts" = 0,
  "lockedUntil" = NULL,
  "mustChangePassword" = false
WHERE "active" = true;
