CREATE TABLE "FinanceCategory" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FinanceCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinanceCategory_direction_code_key" ON "FinanceCategory"("direction", "code");
CREATE INDEX "FinanceCategory_direction_active_name_idx" ON "FinanceCategory"("direction", "active", "name");

ALTER TABLE "CompanyLedgerEntry"
    ADD COLUMN "categoryId" INTEGER,
    ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN "method" TEXT,
    ADD COLUMN "counterparty" TEXT,
    ADD COLUMN "clientId" INTEGER,
    ADD COLUMN "partnerId" INTEGER,
    ADD COLUMN "employeeId" INTEGER,
    ADD COLUMN "voidedAt" TIMESTAMP(3),
    ADD COLUMN "voidReason" TEXT,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "CompanyLedgerEntry_categoryId_operationDate_idx" ON "CompanyLedgerEntry"("categoryId", "operationDate");
CREATE INDEX "CompanyLedgerEntry_source_operationDate_idx" ON "CompanyLedgerEntry"("source", "operationDate");
CREATE INDEX "CompanyLedgerEntry_clientId_idx" ON "CompanyLedgerEntry"("clientId");
CREATE INDEX "CompanyLedgerEntry_partnerId_idx" ON "CompanyLedgerEntry"("partnerId");
CREATE INDEX "CompanyLedgerEntry_employeeId_idx" ON "CompanyLedgerEntry"("employeeId");

ALTER TABLE "CompanyLedgerEntry" ADD CONSTRAINT "CompanyLedgerEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinanceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanyLedgerEntry" ADD CONSTRAINT "CompanyLedgerEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanyLedgerEntry" ADD CONSTRAINT "CompanyLedgerEntry_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanyLedgerEntry" ADD CONSTRAINT "CompanyLedgerEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeePayrollProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "FinanceCategory" ("code", "name", "direction", "system", "active", "updatedAt") VALUES
    ('CLIENT_PAYMENT', 'Оплата клиента', 'INCOME', true, true, CURRENT_TIMESTAMP),
    ('ADDITIONAL_PAYMENT', 'Доплата клиента', 'INCOME', true, true, CURRENT_TIMESTAMP),
    ('OTHER_INCOME', 'Другой доход', 'INCOME', true, true, CURRENT_TIMESTAMP),
    ('REFUND_RECEIVED', 'Возврат средств', 'INCOME', true, true, CURRENT_TIMESTAMP),
    ('INVESTMENT', 'Инвестиции / пополнение', 'INCOME', true, true, CURRENT_TIMESTAMP),
    ('OTHER', 'Прочее', 'INCOME', true, true, CURRENT_TIMESTAMP),
    ('PARTNER_PAYOUT', 'Цех / партнёр', 'EXPENSE', true, true, CURRENT_TIMESTAMP),
    ('SALARY', 'Зарплата', 'EXPENSE', true, true, CURRENT_TIMESTAMP),
    ('EMPLOYEE_BONUS', 'Бонус сотруднику', 'EXPENSE', true, true, CURRENT_TIMESTAMP),
    ('ADVANCE', 'Аванс', 'EXPENSE', true, true, CURRENT_TIMESTAMP),
    ('ADVERTISING', 'Реклама', 'EXPENSE', true, true, CURRENT_TIMESTAMP),
    ('RENT', 'Аренда', 'EXPENSE', true, true, CURRENT_TIMESTAMP),
    ('UTILITIES', 'Коммунальные услуги', 'EXPENSE', true, true, CURRENT_TIMESTAMP),
    ('DELIVERY', 'Доставка', 'EXPENSE', true, true, CURRENT_TIMESTAMP),
    ('MATERIALS', 'Материалы', 'EXPENSE', true, true, CURRENT_TIMESTAMP),
    ('TRANSPORT', 'Транспорт', 'EXPENSE', true, true, CURRENT_TIMESTAMP),
    ('TAX', 'Налоги', 'EXPENSE', true, true, CURRENT_TIMESTAMP),
    ('COMMUNICATION', 'Связь / интернет', 'EXPENSE', true, true, CURRENT_TIMESTAMP),
    ('SMS_SERVICES', 'SMS / сервисы', 'EXPENSE', true, true, CURRENT_TIMESTAMP),
    ('SOFTWARE', 'Программное обеспечение', 'EXPENSE', true, true, CURRENT_TIMESTAMP),
    ('OFFICE', 'Офисные расходы', 'EXPENSE', true, true, CURRENT_TIMESTAMP),
    ('EQUIPMENT', 'Оборудование', 'EXPENSE', true, true, CURRENT_TIMESTAMP),
    ('CLIENT_REFUND', 'Возврат клиенту', 'EXPENSE', true, true, CURRENT_TIMESTAMP),
    ('OTHER', 'Прочее', 'EXPENSE', true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("direction", "code") DO NOTHING;

UPDATE "CompanyLedgerEntry"
SET "source" = CASE
    WHEN "payrollPaymentId" IS NOT NULL THEN 'PAYROLL_PAYMENT'
    WHEN "payrollAccrualId" IS NOT NULL THEN 'OTHER_SYSTEM'
    ELSE 'MANUAL'
END;

UPDATE "CompanyLedgerEntry" AS entry
SET "categoryId" = category."id"
FROM "FinanceCategory" AS category
WHERE category."direction" = entry."direction"
  AND category."code" = entry."category";
