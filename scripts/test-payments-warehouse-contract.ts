import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const read = (path: string) => readFile(path, "utf8");

async function main() {
  const [
    schema,
    migration,
    paymentService,
    receiptPdf,
    refundService,
    retailService,
    warehouseService,
    retailPanel,
    routeShell,
    invoicePdf,
  ] = await Promise.all([
    read("prisma/schema.prisma"),
    read("prisma/migrations/20261007120000_payments_warehouse_retail_documents/migration.sql"),
    read("lib/services/payment.service.ts"),
    read("lib/documents/payment-receipt-pdf.ts"),
    read("lib/services/refund.service.ts"),
    read("lib/services/warehouse-retail.service.ts"),
    read("lib/services/warehouse.service.ts"),
    read("components/warehouse/WarehouseRetailPanel.tsx"),
    read("components/layout/RouteShell.tsx"),
    read("lib/documents/warehouse-shipment-pdf.ts"),
  ]);

  for (const type of ["GOODS_RECEIPT", "OUTGOING_INVOICE", "GOODS_RETURN", "REFUND_CONFIRMATION"]) {
    assert.match(schema, new RegExp(`\\b${type}\\b`), `DocumentType ${type} is missing`);
  }
  for (const model of ["BusinessDocumentCounter", "WarehouseLocation", "WarehouseBalance", "OrderItem", "WarehouseShipment", "WarehouseReturn", "PurchaseReceipt", "PaymentPart"]) {
    assert.match(schema, new RegExp(`model ${model}\\b`), `model ${model} is missing`);
  }
  assert.match(schema, /refundOfId\s+Int\?/u, "refunds must link back to the original payment");

  const variantKeys = migration.match(/'mini-spigot-200-(?:gold|rose-gold|white|black-matte)'/g) ?? [];
  assert.equal(variantKeys.length, 4, "the migration must seed exactly four confirmed mini-spigot variants");
  assert.equal(new Set(variantKeys).size, 4, "mini-spigot variants must be unique");
  assert.doesNotMatch(migration, /mini-spigot-200-(?:gray|grey)|(?:серая|серый)/iu, "a gray variant must not be invented");
  assert.match(migration, /Quantity, cost, sale price and a[\s\S]*private photo upload remain unset/u);
  assert.match(migration, /'MINI_SPIGOT_200'[\s\S]*?false,[\s\S]*?CURRENT_TIMESTAMP/u, "seeded quantity must remain unknown");
  assert.doesNotMatch(retailPanel, /Фото будет добавлено из исходного IMG_3166\.jpeg/u, "the supplied product photos must replace the temporary source-image placeholder");
  assert.match(retailPanel, /Фото не загружено/u, "other products without a photo still need an explicit placeholder");
  assert.match(retailPanel, /Цена не задана/u, "missing prices must be explicit");
  for (const asset of ["gold.webp", "rose-gold.webp", "white.webp", "black-matte.webp"]) {
    await access(`public/catalog/warehouse/mini-spigots/${asset}`);
    assert.match(warehouseService, new RegExp(`/catalog/warehouse/mini-spigots/${asset.replace(".", "\\.")}`), `default photo mapping is missing for ${asset}`);
  }
  assert.match(routeShell, /if \(role === "MANAGER"\)[\s\S]{0,400}"\/warehouse"/u, "managers must have Warehouse in their navigation");

  assert.match(paymentService, /parts\.length > 1 \? "MIXED"/u);
  assert.match(paymentService, /TransactionIsolationLevel\.Serializable/u);
  assert.match(paymentService, /createPaymentReceiptRecord/u, "one receipt must be created in the payment transaction");
  assert.match(receiptPdf, /ТОВАРЫ И УСЛУГИ/u);
  assert.match(receiptPdf, /Оплату принял/u);
  assert.match(receiptPdf, /ПРИНЯТО:/u);
  assert.match(receiptPdf, /QRCode\.toBuffer/u);
  assert.doesNotMatch(receiptPdf, /\b(?:ККМ|ОФД|фискальн)/iu, "the management receipt must not imitate a fiscal receipt");

  assert.match(refundService, /Role\.DIRECTOR/u);
  assert.match(refundService, /Role\.OPERATIONS_DIRECTOR/u);
  assert.match(refundService, /REFUND_CONFIRMATION/u);
  assert.match(refundService, /refundOfId/u, "money refund must remain a separate linked operation");

  assert.match(retailService, /pg_advisory_xact_lock/u, "stock mutations must lock balances");
  assert.match(retailService, /TransactionIsolationLevel\.Serializable/u);
  assert.match(retailService, /IDEMPOTENCY_CONFLICT/u);
  assert.match(retailService, /sale-reserve:/u);
  assert.match(retailService, /shipment-movement:/u);
  assert.match(retailService, /warehouse-return-movement:/u);
  assert.match(retailService, /warehouse-transfer-movement:/u);
  assert.match(retailService, /type: \{ not: "QUARANTINE" \}/u, "damaged returns must not become sellable stock");
  assert.match(retailService, /const orderFullyReturned = allOrderItems\.length > 0/u, "one returned partial shipment must not close the whole order");
  assert.match(invoicePdf, /Расходная накладная/u);
  assert.match(invoicePdf, /Страница \$\{index \+ 1\} из \$\{range\.count\}/u);
  assert.match(invoicePdf, /amountWords\(snapshot\.totals\.amount\)/u);

  assert.match(warehouseService, /const canSeeCost = isInternalWarehouseRole\(actor\.role\)/u);
  assert.match(warehouseService, /\.\.\.\(canSeeCost \? \{ purchasePrice: true, averageCost: true, inventoryValue: true/u, "cost fields must be selected only for internal employees");

  await Promise.all([
    "app/api/payments/route.ts",
    "app/api/warehouse/locations/route.ts",
    "app/api/warehouse/opening-stock/route.ts",
    "app/api/warehouse/sales/route.ts",
    "app/api/warehouse/shipments/route.ts",
    "app/api/warehouse/transfers/route.ts",
    "app/api/warehouse/returns/route.ts",
    "app/api/warehouse/reservations/release/route.ts",
    "app/api/payments/[id]/refund/route.ts",
    "app/verify/payment-receipt/[token]/page.tsx",
  ].map((path) => access(path)));

  console.log("Payments and warehouse static contract: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
