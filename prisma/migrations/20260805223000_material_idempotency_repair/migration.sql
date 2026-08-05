ALTER TABLE "Material" ADD COLUMN "idempotencyKey" TEXT, ADD COLUMN "requestHash" TEXT;
CREATE UNIQUE INDEX "Material_idempotencyKey_key" ON "Material"("idempotencyKey");
