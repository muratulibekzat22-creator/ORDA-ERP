-- Additive contract package domain: PDF representations, customer memo,
-- non-fiscal payment receipts, internal payment shifts, and employee codes.

ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'CUSTOMER_MEMO';

ALTER TABLE "CompanySettings" ALTER COLUMN "bin" SET DEFAULT '220540017969';
UPDATE "CompanySettings" SET "bin" = '220540017969' WHERE btrim("bin") = '';

CREATE TYPE "PdfGenerationStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'READY', 'FAILED');
CREATE TYPE "CashShiftStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "PaymentReceiptStatus" AS ENUM ('ACTIVE', 'VOID');

ALTER TABLE "User" ADD COLUMN "employeeCode" TEXT;
CREATE UNIQUE INDEX "User_employeeCode_key" ON "User"("employeeCode");

CREATE SEQUENCE "employee_code_dir_seq" START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE "employee_code_mgr_seq" START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE "employee_code_acc_seq" START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE "employee_code_mea_seq" START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE "employee_code_des_seq" START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE "employee_code_par_seq" START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE "employee_code_pro_seq" START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE "employee_code_ins_seq" START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

WITH ranked AS (
  SELECT id, role, row_number() OVER (PARTITION BY role ORDER BY id) AS role_number
  FROM "User"
  WHERE active = TRUE
)
UPDATE "User" AS users
SET "employeeCode" = CASE ranked.role::text
  WHEN 'DIRECTOR' THEN 'DIR-'
  WHEN 'MANAGER' THEN 'MGR-'
  WHEN 'ACCOUNTANT' THEN 'ACC-'
  WHEN 'MEASURER' THEN 'MEA-'
  WHEN 'DESIGNER' THEN 'DES-'
  WHEN 'PARTNER' THEN 'PAR-'
  WHEN 'PRODUCTION' THEN 'PRO-'
  WHEN 'INSTALLER' THEN 'INS-'
END || lpad(ranked.role_number::text, 4, '0')
FROM ranked
WHERE users.id = ranked.id AND users."employeeCode" IS NULL;

DO $$
DECLARE
  row_value RECORD;
BEGIN
  FOR row_value IN
    SELECT * FROM (VALUES
      ('DIRECTOR', 'employee_code_dir_seq'),
      ('MANAGER', 'employee_code_mgr_seq'),
      ('ACCOUNTANT', 'employee_code_acc_seq'),
      ('MEASURER', 'employee_code_mea_seq'),
      ('DESIGNER', 'employee_code_des_seq'),
      ('PARTNER', 'employee_code_par_seq'),
      ('PRODUCTION', 'employee_code_pro_seq'),
      ('INSTALLER', 'employee_code_ins_seq')
    ) AS role_sequences(role_name, sequence_name)
  LOOP
    PERFORM setval(
      row_value.sequence_name::regclass,
      GREATEST((SELECT count(*) FROM "User" WHERE active = TRUE AND role::text = row_value.role_name), 1),
      (SELECT count(*) > 0 FROM "User" WHERE active = TRUE AND role::text = row_value.role_name)
    );
  END LOOP;
END $$;

ALTER TABLE "DocumentVersion"
  ADD COLUMN "pdfFileName" TEXT,
  ADD COLUMN "pdfPathname" TEXT,
  ADD COLUMN "pdfContentType" TEXT,
  ADD COLUMN "pdfSize" INTEGER,
  ADD COLUMN "pdfChecksum" TEXT,
  ADD COLUMN "pdfStatus" "PdfGenerationStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN "pdfGeneratedAt" TIMESTAMP(3),
  ADD COLUMN "pdfErrorCode" TEXT;

CREATE UNIQUE INDEX "DocumentVersion_pdfPathname_key" ON "DocumentVersion"("pdfPathname");

CREATE TABLE "CustomerMemoAcknowledgement" (
  "id" SERIAL NOT NULL,
  "contractDocumentId" INTEGER NOT NULL,
  "memoDocumentId" INTEGER NOT NULL,
  "memoVersion" INTEGER NOT NULL,
  "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedByUserId" INTEGER NOT NULL,
  CONSTRAINT "CustomerMemoAcknowledgement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerMemoAcknowledgement_contractDocumentId_memoVersion_key"
  ON "CustomerMemoAcknowledgement"("contractDocumentId", "memoVersion");
CREATE INDEX "CustomerMemoAcknowledgement_memoDocumentId_memoVersion_idx"
  ON "CustomerMemoAcknowledgement"("memoDocumentId", "memoVersion");
CREATE INDEX "CustomerMemoAcknowledgement_acknowledgedByUserId_acknowledgedAt_idx"
  ON "CustomerMemoAcknowledgement"("acknowledgedByUserId", "acknowledgedAt");

CREATE SEQUENCE "CashShift_shiftNumber_seq" START WITH 8001 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE "CashShift" (
  "id" SERIAL NOT NULL,
  "shiftNumber" INTEGER NOT NULL DEFAULT nextval('"CashShift_shiftNumber_seq"'),
  "businessDate" DATE NOT NULL,
  "responsibleManagerId" INTEGER NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "closedById" INTEGER,
  "status" "CashShiftStatus" NOT NULL DEFAULT 'OPEN',
  CONSTRAINT "CashShift_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CashShift_shiftNumber_key" ON "CashShift"("shiftNumber");
CREATE UNIQUE INDEX "CashShift_one_open_manager_idx" ON "CashShift"("responsibleManagerId") WHERE "status" = 'OPEN';
CREATE INDEX "CashShift_responsibleManagerId_businessDate_status_idx" ON "CashShift"("responsibleManagerId", "businessDate", "status");
CREATE INDEX "CashShift_businessDate_status_idx" ON "CashShift"("businessDate", "status");

ALTER TABLE "Payment"
  ADD COLUMN "cashShiftId" INTEGER,
  ADD COLUMN "registeredByUserId" INTEGER;

CREATE INDEX "Payment_cashShiftId_operationDate_idx" ON "Payment"("cashShiftId", "operationDate");
CREATE INDEX "Payment_registeredByUserId_operationDate_idx" ON "Payment"("registeredByUserId", "operationDate");

CREATE SEQUENCE "PaymentReceipt_receiptNumber_seq" START WITH 10256 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE "PaymentReceipt" (
  "id" SERIAL NOT NULL,
  "receiptNumber" INTEGER NOT NULL DEFAULT nextval('"PaymentReceipt_receiptNumber_seq"'),
  "paymentId" INTEGER NOT NULL,
  "documentId" INTEGER NOT NULL,
  "orderId" INTEGER NOT NULL,
  "contractDocumentId" INTEGER,
  "cashShiftId" INTEGER NOT NULL,
  "verificationToken" TEXT NOT NULL,
  "status" "PaymentReceiptStatus" NOT NULL DEFAULT 'ACTIVE',
  "snapshot" JSONB NOT NULL,
  "snapshotChecksum" TEXT NOT NULL,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "voidedByPaymentId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentReceipt_receiptNumber_key" ON "PaymentReceipt"("receiptNumber");
CREATE UNIQUE INDEX "PaymentReceipt_paymentId_key" ON "PaymentReceipt"("paymentId");
CREATE UNIQUE INDEX "PaymentReceipt_documentId_key" ON "PaymentReceipt"("documentId");
CREATE UNIQUE INDEX "PaymentReceipt_verificationToken_key" ON "PaymentReceipt"("verificationToken");
CREATE UNIQUE INDEX "PaymentReceipt_voidedByPaymentId_key" ON "PaymentReceipt"("voidedByPaymentId");
CREATE INDEX "PaymentReceipt_orderId_createdAt_idx" ON "PaymentReceipt"("orderId", "createdAt");
CREATE INDEX "PaymentReceipt_cashShiftId_createdAt_idx" ON "PaymentReceipt"("cashShiftId", "createdAt");
CREATE INDEX "PaymentReceipt_status_createdAt_idx" ON "PaymentReceipt"("status", "createdAt");

ALTER TABLE "CustomerMemoAcknowledgement"
  ADD CONSTRAINT "CustomerMemoAcknowledgement_contractDocumentId_fkey" FOREIGN KEY ("contractDocumentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomerMemoAcknowledgement_memoDocumentId_fkey" FOREIGN KEY ("memoDocumentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomerMemoAcknowledgement_acknowledgedByUserId_fkey" FOREIGN KEY ("acknowledgedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CashShift"
  ADD CONSTRAINT "CashShift_responsibleManagerId_fkey" FOREIGN KEY ("responsibleManagerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CashShift_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Payment_registeredByUserId_fkey" FOREIGN KEY ("registeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentReceipt"
  ADD CONSTRAINT "PaymentReceipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentReceipt_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentReceipt_contractDocumentId_fkey" FOREIGN KEY ("contractDocumentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentReceipt_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentReceipt_voidedByPaymentId_fkey" FOREIGN KEY ("voidedByPaymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Guard against lowering counters if this migration is replayed against a
-- pre-populated compatible database during controlled adoption.
SELECT setval(
  '"PaymentReceipt_receiptNumber_seq"',
  GREATEST(10255, COALESCE((SELECT MAX("receiptNumber") FROM "PaymentReceipt"), 10255)),
  TRUE
);
SELECT setval(
  '"CashShift_shiftNumber_seq"',
  GREATEST(8000, COALESCE((SELECT MAX("shiftNumber") FROM "CashShift"), 8000)),
  TRUE
);
