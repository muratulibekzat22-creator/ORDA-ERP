-- The legacy index allowed only one document type per order. Payment receipts
-- are immutable documents per payment, so an order with several payments must
-- be able to own several PAYMENT_RECEIPT documents. The canonical Prisma model
-- has not declared this uniqueness since 20260809120000; this repairs database
-- drift without changing or deleting any document rows.
DROP INDEX IF EXISTS "Document_orderId_type_key";
