CREATE TABLE "BankStatementImport" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'KASPI',
  "accountLabel" TEXT,
  "fileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "fileHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REVIEW',
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "importedRows" INTEGER NOT NULL DEFAULT 0,
  "duplicateRows" INTEGER NOT NULL DEFAULT 0,
  "createdById" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BankStatementImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BankStatementTransaction" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "importId" INTEGER NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "operationDate" TIMESTAMP(3) NOT NULL,
  "direction" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'KZT',
  "counterparty" TEXT,
  "description" TEXT,
  "reference" TEXT,
  "raw" JSONB,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "suggestedKind" TEXT NOT NULL DEFAULT 'REVIEW',
  "suggestedCategoryId" INTEGER,
  "suggestedOrderId" INTEGER,
  "suggestedClientId" INTEGER,
  "suggestedRecurringExpensePlanId" INTEGER,
  "confidence" INTEGER NOT NULL DEFAULT 0,
  "matchReason" TEXT,
  "selected" BOOLEAN NOT NULL DEFAULT false,
  "postedPaymentId" INTEGER,
  "postedLedgerEntryId" INTEGER,
  "resolvedById" INTEGER,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BankStatementTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BankStatementRule" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "normalizedCounterparty" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "categoryId" INTEGER,
  "clientId" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "updatedById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BankStatementRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BankStatementImport_companyId_fileHash_key" ON "BankStatementImport"("companyId", "fileHash");
CREATE INDEX "BankStatementImport_companyId_createdAt_idx" ON "BankStatementImport"("companyId", "createdAt");
CREATE INDEX "BankStatementImport_companyId_status_createdAt_idx" ON "BankStatementImport"("companyId", "status", "createdAt");

CREATE UNIQUE INDEX "BankStatementTransaction_companyId_fingerprint_key" ON "BankStatementTransaction"("companyId", "fingerprint");
CREATE UNIQUE INDEX "BankStatementTransaction_postedPaymentId_key" ON "BankStatementTransaction"("postedPaymentId");
CREATE UNIQUE INDEX "BankStatementTransaction_postedLedgerEntryId_key" ON "BankStatementTransaction"("postedLedgerEntryId");
CREATE INDEX "BankStatementTransaction_companyId_status_operationDate_idx" ON "BankStatementTransaction"("companyId", "status", "operationDate");
CREATE INDEX "BankStatementTransaction_importId_rowNumber_idx" ON "BankStatementTransaction"("importId", "rowNumber");
CREATE INDEX "BankStatementTransaction_suggestedOrderId_status_idx" ON "BankStatementTransaction"("suggestedOrderId", "status");
CREATE INDEX "BankStatementTransaction_suggestedCategoryId_status_idx" ON "BankStatementTransaction"("suggestedCategoryId", "status");
CREATE INDEX "BankStatementTransaction_suggestedRecurringExpensePlanId_status_idx" ON "BankStatementTransaction"("suggestedRecurringExpensePlanId", "status");

CREATE UNIQUE INDEX "BankStatementRule_companyId_normalizedCounterparty_direction_key" ON "BankStatementRule"("companyId", "normalizedCounterparty", "direction");
CREATE INDEX "BankStatementRule_companyId_active_direction_idx" ON "BankStatementRule"("companyId", "active", "direction");
CREATE INDEX "BankStatementRule_categoryId_active_idx" ON "BankStatementRule"("categoryId", "active");
CREATE INDEX "BankStatementRule_clientId_active_idx" ON "BankStatementRule"("clientId", "active");

ALTER TABLE "BankStatementImport" ADD CONSTRAINT "BankStatementImport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankStatementImport" ADD CONSTRAINT "BankStatementImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BankStatementTransaction" ADD CONSTRAINT "BankStatementTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankStatementTransaction" ADD CONSTRAINT "BankStatementTransaction_importId_fkey" FOREIGN KEY ("importId") REFERENCES "BankStatementImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankStatementTransaction" ADD CONSTRAINT "BankStatementTransaction_suggestedCategoryId_fkey" FOREIGN KEY ("suggestedCategoryId") REFERENCES "FinanceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BankStatementTransaction" ADD CONSTRAINT "BankStatementTransaction_suggestedOrderId_fkey" FOREIGN KEY ("suggestedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BankStatementTransaction" ADD CONSTRAINT "BankStatementTransaction_suggestedClientId_fkey" FOREIGN KEY ("suggestedClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BankStatementTransaction" ADD CONSTRAINT "BankStatementTransaction_suggestedRecurringExpensePlanId_fkey" FOREIGN KEY ("suggestedRecurringExpensePlanId") REFERENCES "RecurringExpensePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BankStatementTransaction" ADD CONSTRAINT "BankStatementTransaction_postedPaymentId_fkey" FOREIGN KEY ("postedPaymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankStatementTransaction" ADD CONSTRAINT "BankStatementTransaction_postedLedgerEntryId_fkey" FOREIGN KEY ("postedLedgerEntryId") REFERENCES "CompanyLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankStatementTransaction" ADD CONSTRAINT "BankStatementTransaction_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BankStatementRule" ADD CONSTRAINT "BankStatementRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankStatementRule" ADD CONSTRAINT "BankStatementRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinanceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BankStatementRule" ADD CONSTRAINT "BankStatementRule_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BankStatementRule" ADD CONSTRAINT "BankStatementRule_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
