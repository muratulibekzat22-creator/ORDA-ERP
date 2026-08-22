import "./require-test-database";

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { Role } from "@prisma/client";

import { prisma } from "../lib/prisma";
import { getFinanceJournal } from "../lib/services/finance-journal.service";
import { createFinanceOperation, getFinanceDashboard } from "../lib/services/payment.service";
import { assignPartnerToOrder, getPartner, getPartners } from "../lib/services/partner.service";
import { getReportsReadModel } from "../lib/services/report.service";

if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
  throw new Error("Partner/Finance integration requires TEST_DATABASE_URL");

const tag = `partner-finance-${Date.now()}`;
const requestHash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const amounts = [3_000_000, 2_000_000, 1_000_000, 500_000, 750_000, 1_250_000];
const received = [2_000_000, 1_000_000, 500_000, 100_000, 250_000, 500_000];
const agreed = [1_500_000, 1_000_000, 400_000, 200_000, 250_000, 500_000];
const paid = [800_000, 400_000, 100_000, 50_000, 100_000, 200_000];
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

async function main() {
  const financeUi = readFileSync("components/finance/FinanceJournalPage.tsx", "utf8");
  const financeService = readFileSync("lib/services/payment.service.ts", "utf8");
  for (const field of ["+ Доход", "+ Расход", "Денежный результат", "фактическое движение денег, а не чистая прибыль", "Доходы по категориям", "Расходы по категориям"])
    assert(financeUi.includes(field), `Finance journal UI is missing ${field}`);
  for (const field of ["managerBonusPayable", "measurerBonusPayable"])
    assert(financeService.includes(field), `Finance aggregation is missing ${field}`);
  const ids = { users: [] as number[], clients: [] as number[], orders: [] as number[], partners: [] as number[] };
  try {
    const [director, manager] = await Promise.all([
      prisma.user.create({ data: { name: `${tag}-director`, email: `${tag}-director@test.local`, password: "not-used", role: Role.DIRECTOR } }),
      prisma.user.create({ data: { name: `${tag}-manager`, email: `${tag}-manager@test.local`, password: "not-used", role: Role.MANAGER } }),
    ]);
    ids.users.push(director.id, manager.id);
    const [partner, archived, testPartner] = await Promise.all([
      prisma.partner.create({ data: { name: `${tag}-workshop` } }),
      prisma.partner.create({ data: { name: `${tag}-archive`, active: false, archived: true } }),
      prisma.partner.create({ data: { name: `${tag}-test`, isTest: true } }),
    ]);
    ids.partners.push(partner.id, archived.id, testPartner.id);

    for (let index = 0; index < amounts.length; index += 1) {
      const client = await prisma.client.create({
        data: { name: `${tag}-client-${index}`, phone: `7700001${String(index).padStart(4, "0")}`, city: "TEST", manager: manager.name, managerUserId: manager.id, amount: String(amounts[index]), status: "WON" },
      });
      ids.clients.push(client.id);
      const order = await prisma.order.create({
        data: { number: `${tag}-order-${index}`, clientId: client.id, address: "TEST", staircase: "Straight", material: "Oak", amount: amounts[index], balance: amounts[index], manager: manager.name, managerUserId: manager.id, status: "New" },
      });
      ids.orders.push(order.id);
      await assignPartnerToOrder({ orderId: order.id, partnerId: partner.id, partnerPrice: agreed[index], manager: manager.name, authorId: director.id, reason: "Signed workshop agreement" });
      await createFinanceOperation({ type: "CLIENT_PAYMENT", orderId: order.id, amount: received[index], method: "bank_transfer", author: director.name, authorId: director.id, idempotencyKey: `${tag}-client-${index}`, requestHash: requestHash(`client-${index}`) });
      await createFinanceOperation({ type: "PARTNER_PAYOUT", orderId: order.id, amount: paid[index], method: "bank_transfer", author: director.name, authorId: director.id, idempotencyKey: `${tag}-partner-${index}`, requestHash: requestHash(`partner-${index}`) });
    }

    const activePartners = await getPartners();
    assert(activePartners.some((item) => item.id === partner.id), "active workshop missing from selector");
    assert(!activePartners.some((item) => item.id === archived.id || item.id === testPartner.id), "selector leaked archived or TEST partner");
    const directoryPartners = await getPartners({ includeArchived: true });
    assert(directoryPartners.some((item) => item.id === archived.id), "archive partner missing from Director directory");
    assert(!directoryPartners.some((item) => item.id === testPartner.id), "TEST partner leaked into Director directory");
    assert.equal(await getPartner(testPartner.id), null, "TEST partner leaked through direct lookup");

    const dashboard = await getFinanceDashboard({ manager: manager.name, period: "month" });
    assert.equal(dashboard.totals.turnover, sum(amounts), "sales aggregation");
    assert.equal(dashboard.totals.received, sum(received), "customer received aggregation");
    assert.equal(dashboard.totals.clientBalance, sum(amounts) - sum(received), "customer remaining aggregation");
    assert.equal(dashboard.totals.partnerAgreed, sum(agreed), "partner agreed aggregation");
    assert.equal(dashboard.totals.partnerPaid, sum(paid), "partner paid aggregation");
    assert.equal(dashboard.totals.partnerBalance, sum(agreed) - sum(paid), "partner remaining aggregation");
    assert.equal(dashboard.totals.profit, sum(amounts) - sum(agreed), "gross margin aggregation");
    assert.equal(dashboard.cards.receipts, sum(received), "order creation was incorrectly counted as cash");
    assert.equal(dashboard.cards.expenses, sum(paid), "partner agreement was incorrectly counted as cash expense");
    assert.equal(dashboard.partnerBreakdown[0]?.remaining, sum(agreed) - sum(paid), "partner dashboard remaining");
    const journal = await getFinanceJournal({ period: "month" });
    const orderOperations = journal.operations.filter((item) => item.order && ids.orders.includes(item.order.id));
    assert.equal(orderOperations.filter((item) => item.source === "CLIENT_PAYMENT" && item.direction === "INCOME").length, amounts.length, "client payments are not canonical income");
    assert.equal(orderOperations.filter((item) => item.source === "PARTNER_PAYOUT" && item.direction === "EXPENSE").length, amounts.length, "partner payouts are not canonical expense");

    const future = await getFinanceDashboard({ manager: manager.name, from: new Date("2030-01-01"), to: new Date("2030-01-31") });
    assert.equal(future.cards.receipts, 0, "future period has customer cash");
    assert.equal(future.cards.expenses, 0, "future period has partner cash");
    assert.equal(future.cards.customerReceivable, sum(amounts) - sum(received), "current receivable was incorrectly limited by period");
    assert.equal(future.cards.partnerPayable, sum(agreed) - sum(paid), "current partner payable was incorrectly limited by period");

    const directorReport = await getReportsReadModel(new URLSearchParams(`period=month&managerId=${manager.id}`), { id: director.id, role: Role.DIRECTOR });
    assert(directorReport.finance, "Director report is missing internal finance aggregates");
    assert.equal(directorReport.finance.customerRemaining, sum(amounts) - sum(received));
    assert.equal(directorReport.finance.partnerRemaining, sum(agreed) - sum(paid));
    assert.equal(directorReport.finance.grossMargin, sum(amounts) - sum(agreed));
    const managerReport = await getReportsReadModel(new URLSearchParams("period=month"), { id: manager.id, role: Role.MANAGER });
    assert.equal(managerReport.finance, undefined, "Manager report leaked partner/payroll finance");

    console.log("PARTNER FINANCE SUMMARY: 6 orders; sales/receivables/partner payable/gross margin=passed; cash-vs-accrual=passed; archive/test filtering=passed; Reports RBAC=passed");
  } finally {
    if (ids.orders.length) {
      const cashShiftIds = (await prisma.payment.findMany({
        where: { orderId: { in: ids.orders }, cashShiftId: { not: null } },
        select: { cashShiftId: true },
      })).flatMap((item) => item.cashShiftId == null ? [] : [item.cashShiftId]);
      const receiptDocumentIds = (await prisma.paymentReceipt.findMany({
        where: { orderId: { in: ids.orders } },
        select: { documentId: true },
      })).map((item) => item.documentId);
      if (receiptDocumentIds.length) {
        await prisma.documentAudit.deleteMany({ where: { documentId: { in: receiptDocumentIds } } });
        await prisma.documentVersion.deleteMany({ where: { documentId: { in: receiptDocumentIds } } });
        await prisma.paymentReceipt.deleteMany({ where: { orderId: { in: ids.orders } } });
        await prisma.document.deleteMany({ where: { id: { in: receiptDocumentIds } } });
      }
      await prisma.financeAuditEvent.deleteMany({ where: { orderId: { in: ids.orders } } });
      await prisma.companyLedgerEntry.deleteMany({ where: { orderId: { in: ids.orders } } });
      await prisma.partnerAssignmentHistory.deleteMany({ where: { orderId: { in: ids.orders } } });
      await prisma.orderEvent.deleteMany({ where: { orderId: { in: ids.orders } } });
      await prisma.production.deleteMany({ where: { orderId: { in: ids.orders } } });
      await prisma.payment.deleteMany({ where: { orderId: { in: ids.orders } } });
      if (cashShiftIds.length) {
        await prisma.cashShift.deleteMany({
          where: { id: { in: cashShiftIds }, payments: { none: {} }, receipts: { none: {} } },
        });
      }
      await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
    }
    if (ids.clients.length) await prisma.client.deleteMany({ where: { id: { in: ids.clients } } });
    if (ids.partners.length) await prisma.partner.deleteMany({ where: { id: { in: ids.partners } } });
    if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.$disconnect();
  }
}

void main();
