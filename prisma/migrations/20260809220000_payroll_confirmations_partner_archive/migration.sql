CREATE TYPE "PayrollConfirmationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

ALTER TYPE "PayrollPaymentType" ADD VALUE 'GUARANTEED_BONUS_PAYMENT';
ALTER TYPE "PayrollPaymentType" ADD VALUE 'ORDER_BONUS_PAYMENT';
ALTER TYPE "PayrollPaymentType" ADD VALUE 'PREMIUM_PAYMENT';

ALTER TABLE "Partner"
ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Order" ADD COLUMN "partnerAgreedAt" TIMESTAMP(3);

-- Existing orders assigned to a partner are already reviewed agreements.
-- Calculated workshop cost without an assigned partner remains explicitly unset.
UPDATE "Order"
SET "partnerAgreedAt" = "updatedAt"
WHERE "partnerId" IS NOT NULL;

UPDATE "Partner"
SET "archived" = true
WHERE "active" = false;

UPDATE "Partner"
SET "isTest" = true
WHERE "name" ~* '(api-security|contract manager|test|demo|e2e|rbac|acceptance)';

ALTER TABLE "PayrollPayment"
ADD COLUMN "reversalOfId" INTEGER,
ADD COLUMN "reversalReason" TEXT;

CREATE TABLE "PayrollPaymentConfirmation" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "periodId" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "type" "PayrollPaymentType" NOT NULL,
    "claimedPaymentDate" TIMESTAMP(3) NOT NULL,
    "method" TEXT,
    "comment" TEXT,
    "status" "PayrollConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" INTEGER NOT NULL,
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "reviewComment" TEXT,
    "confirmedPaymentId" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayrollPaymentConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollPayment_reversalOfId_key" ON "PayrollPayment"("reversalOfId");
CREATE UNIQUE INDEX "PayrollPaymentConfirmation_confirmedPaymentId_key" ON "PayrollPaymentConfirmation"("confirmedPaymentId");
CREATE UNIQUE INDEX "PayrollPaymentConfirmation_idempotencyKey_key" ON "PayrollPaymentConfirmation"("idempotencyKey");
CREATE INDEX "PayrollPaymentConfirmation_periodId_status_createdAt_idx" ON "PayrollPaymentConfirmation"("periodId", "status", "createdAt");
CREATE INDEX "PayrollPaymentConfirmation_employeeId_status_createdAt_idx" ON "PayrollPaymentConfirmation"("employeeId", "status", "createdAt");
CREATE INDEX "Order_partnerId_partnerAgreedAt_idx" ON "Order"("partnerId", "partnerAgreedAt");

ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "PayrollPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollPaymentConfirmation" ADD CONSTRAINT "PayrollPaymentConfirmation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeePayrollProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollPaymentConfirmation" ADD CONSTRAINT "PayrollPaymentConfirmation_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollPaymentConfirmation" ADD CONSTRAINT "PayrollPaymentConfirmation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollPaymentConfirmation" ADD CONSTRAINT "PayrollPaymentConfirmation_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollPaymentConfirmation" ADD CONSTRAINT "PayrollPaymentConfirmation_confirmedPaymentId_fkey" FOREIGN KEY ("confirmedPaymentId") REFERENCES "PayrollPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
