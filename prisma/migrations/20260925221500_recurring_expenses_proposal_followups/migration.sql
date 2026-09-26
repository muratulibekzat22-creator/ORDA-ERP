ALTER TABLE "CompanySettings"
  ADD COLUMN "kaspiGoldName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "kaspiGoldPhone" TEXT NOT NULL DEFAULT '';

ALTER TABLE "LeadNextAction"
  ADD COLUMN "proposalId" INTEGER,
  ADD COLUMN "mandatory" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "followUpStep" INTEGER,
  ADD COLUMN "workflowKey" TEXT;

CREATE UNIQUE INDEX "LeadNextAction_workflowKey_key" ON "LeadNextAction"("workflowKey");
CREATE INDEX "LeadNextAction_mandatory_completedAt_nextActionAt_idx" ON "LeadNextAction"("mandatory", "completedAt", "nextActionAt");
CREATE INDEX "LeadNextAction_proposalId_followUpStep_idx" ON "LeadNextAction"("proposalId", "followUpStep");
ALTER TABLE "LeadNextAction" ADD CONSTRAINT "LeadNextAction_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CommercialProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "RecurringExpensePlan" (
  "id" SERIAL NOT NULL,
  "companyId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "categoryId" INTEGER NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "dayOfMonth" INTEGER NOT NULL DEFAULT 1,
  "method" TEXT NOT NULL DEFAULT 'bank_transfer',
  "counterparty" TEXT,
  "comment" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecurringExpensePlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecurringExpensePlan_companyId_name_key" ON "RecurringExpensePlan"("companyId", "name");
CREATE INDEX "RecurringExpensePlan_companyId_active_dayOfMonth_idx" ON "RecurringExpensePlan"("companyId", "active", "dayOfMonth");
CREATE INDEX "RecurringExpensePlan_categoryId_active_idx" ON "RecurringExpensePlan"("categoryId", "active");
ALTER TABLE "RecurringExpensePlan" ADD CONSTRAINT "RecurringExpensePlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecurringExpensePlan" ADD CONSTRAINT "RecurringExpensePlan_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinanceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompanyLedgerEntry"
  ADD COLUMN "recurringExpensePlanId" INTEGER,
  ADD COLUMN "recurringPeriod" TEXT;

CREATE UNIQUE INDEX "CompanyLedgerEntry_recurringExpensePlanId_recurringPeriod_key" ON "CompanyLedgerEntry"("recurringExpensePlanId", "recurringPeriod");
ALTER TABLE "CompanyLedgerEntry" ADD CONSTRAINT "CompanyLedgerEntry_recurringExpensePlanId_fkey" FOREIGN KEY ("recurringExpensePlanId") REFERENCES "RecurringExpensePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "FinanceCategory" ("companyId", "code", "name", "direction", "system", "active", "createdAt", "updatedAt")
SELECT company."id", preset."code", preset."name", 'EXPENSE', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Company" company
CROSS JOIN (VALUES
  ('CLEANING', 'Уборка офиса'),
  ('CONTENT_PRODUCTION', 'Съёмки и контент'),
  ('FUEL', 'Бензин'),
  ('SUBSCRIPTIONS', 'Подписки и онлайн-сервисы')
) AS preset("code", "name")
ON CONFLICT ("companyId", "direction", "code") DO UPDATE SET "name" = EXCLUDED."name", "active" = true, "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "FinanceCategory"
SET "name" = 'Программное обеспечение'
WHERE "direction" = 'EXPENSE' AND "code" = 'SOFTWARE';

INSERT INTO "RecurringExpensePlan" ("companyId", "name", "categoryId", "amount", "dayOfMonth", "method", "comment", "updatedAt")
SELECT company."id", preset."name", category."id", preset."amount", 1, preset."method", 'Ежемесячный постоянный расход', CURRENT_TIMESTAMP
FROM "Company" company
JOIN (VALUES
  ('Аренда офиса', 'RENT', 250000.00::decimal, 'bank_transfer'),
  ('Уборка офиса', 'CLEANING', 20000.00::decimal, 'cash'),
  ('Интернет', 'COMMUNICATION', 10000.00::decimal, 'kaspi')
) AS preset("name", "code", "amount", "method") ON true
JOIN "FinanceCategory" category ON category."companyId" = company."id" AND category."direction" = 'EXPENSE' AND category."code" = preset."code"
WHERE company."active" = true AND company."isDemo" = false
ON CONFLICT ("companyId", "name") DO NOTHING;
