import "./require-test-database";

import assert from "node:assert/strict";

import { Role } from "@prisma/client";

import { parseKaspiStatement } from "@/lib/bank-statements/parser";
import { prisma } from "@/lib/prisma";
import { applyStatementDecisions, importKaspiStatement } from "@/lib/services/bank-statement.service";

process.env.NEXTAUTH_URL ||= "http://127.0.0.1:3219";

const tag = `bank-statement-${Date.now()}`;
const statement = [
  "Дата;Поступление;Списание;Контрагент;Назначение платежа;Номер документа",
  `25.09.2097;500000;;${tag} Клиент;Оплата заказа;IN-1`,
  "25.09.2097;;250000;Арендодатель;Аренда офиса;OUT-1",
].join("\n");

async function main() {
  const parsed = await parseKaspiStatement({ fileName: "kaspi.csv", contentType: "text/csv", bytes: Buffer.from(statement, "utf8") });
  assert.equal(parsed.transactions.length, 2);
  assert.equal(parsed.transactions[0].direction, "INCOME");
  assert.equal(parsed.transactions[1].direction, "EXPENSE");

  const company = await prisma.company.findUniqueOrThrow({ where: { id: 1 } });
  const director = await prisma.user.create({ data: { companyId: company.id, name: `${tag} Директор`, email: `${tag}-director@test.local`, password: "test", role: Role.DIRECTOR } });
  const manager = await prisma.user.create({ data: { companyId: company.id, name: `${tag} Менеджер`, email: `${tag}-manager@test.local`, password: "test", role: Role.MANAGER } });
  const actor = { userId: director.id, name: director.name };
  let clientId = 0;
  let orderId = 0;
  const importIds: number[] = [];
  try {
    const client = await prisma.client.create({ data: { companyId: company.id, name: `${tag} Клиент`, phone: "+77001112233", city: "Алматы", manager: manager.name, managerUserId: manager.id, amount: "500000", status: "WON" } });
    clientId = client.id;
    const order = await prisma.order.create({ data: {
      companyId: company.id,
      number: `BS-${Date.now()}`,
      clientId,
      address: "Алматы",
      staircase: "Тест",
      material: "Тест",
      amount: 500_000,
      balance: 500_000,
      requiredPrepayment: 500_000,
      paymentMethod: "KASPI_TRANSFER",
      manager: manager.name,
      managerUserId: manager.id,
      orderReceivedAt: new Date("2097-09-25T06:00:00.000Z"),
    } });
    orderId = order.id;
    const rentPlan = await prisma.recurringExpensePlan.findFirstOrThrow({ where: { active: true, amount: 250_000, category: { code: "RENT", direction: "EXPENSE" } } });

    const imported = await importKaspiStatement({ fileName: "kaspi-september.csv", contentType: "text/csv", size: Buffer.byteLength(statement), bytes: Buffer.from(statement) }, actor);
    assert.equal(imported.replay, false);
    const workspace = imported.workspace;
    assert(workspace.selectedImportId);
    importIds.push(workspace.selectedImportId);
    assert.equal(workspace.transactions.length, 2);
    const income = workspace.transactions.find((item) => item.direction === "INCOME")!;
    const expense = workspace.transactions.find((item) => item.direction === "EXPENSE")!;
    assert.equal(income.suggestedKind, "CLIENT_PAYMENT");
    assert.equal(income.suggestedOrderId, order.id);
    assert.equal(income.selected, true);
    assert.equal(expense.suggestedCategory?.direction, "EXPENSE");
    assert.equal(expense.suggestedRecurringExpensePlanId, rentPlan.id);
    assert.equal(expense.selected, true);

    const posted = await applyStatementDecisions(workspace.selectedImportId, [
      { transactionId: income.id, action: "POST", kind: "CLIENT_PAYMENT", orderId: order.id, rememberRule: true },
      { transactionId: expense.id, action: "POST", kind: "EXPENSE", categoryId: expense.suggestedCategoryId, recurringExpensePlanId: rentPlan.id, rememberRule: true },
    ], actor);
    assert(posted.results.every((item) => item.ok), JSON.stringify(posted.results));
    const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(Number(updatedOrder.prepayment), 500_000);
    assert.equal(Number(updatedOrder.balance), 0);
    assert.equal(await prisma.payment.count({ where: { orderId: order.id, type: "CLIENT_PAYMENT", amount: 500_000 } }), 1);
    const ledger = await prisma.companyLedgerEntry.findFirstOrThrow({ where: { source: "BANK_STATEMENT", recurringExpensePlanId: rentPlan.id, recurringPeriod: "2097-09" } });
    assert.equal(Number(ledger.amount), 250_000);
    assert.equal(await prisma.bankStatementRule.count({ where: { updatedById: director.id, active: true } }), 2);

    const replay = await importKaspiStatement({ fileName: "renamed.csv", contentType: "text/csv", size: Buffer.byteLength(statement), bytes: Buffer.from(statement) }, actor);
    assert.equal(replay.replay, true);
    assert.equal(replay.workspace.selectedImportId, workspace.selectedImportId);
    assert.equal(await prisma.payment.count({ where: { orderId: order.id, type: "CLIENT_PAYMENT" } }), 1, "repeated statement duplicated client payment");
    assert.equal(await prisma.companyLedgerEntry.count({ where: { source: "BANK_STATEMENT", recurringExpensePlanId: rentPlan.id, recurringPeriod: "2097-09" } }), 1, "repeated statement duplicated recurring expense");

    const overlapText = `${statement}\n25.09.2097;;100000;Meta Ads;Реклама таргет;OUT-2`;
    const overlap = await importKaspiStatement({ fileName: "kaspi-overlap.csv", contentType: "text/csv", size: Buffer.byteLength(overlapText), bytes: Buffer.from(overlapText) }, actor);
    assert.equal(overlap.replay, false);
    assert(overlap.workspace.selectedImportId);
    importIds.push(overlap.workspace.selectedImportId);
    const overlapImport = overlap.workspace.imports.find((item) => item.id === overlap.workspace.selectedImportId)!;
    assert.equal(overlapImport.importedRows, 1);
    assert.equal(overlapImport.duplicateRows, 2);
    const advertising = overlap.workspace.transactions[0];
    assert.equal(advertising.suggestedCategory?.name, "Реклама");
    assert.equal(advertising.selected, true);
    console.log("Kaspi statement parsing, matching, posting and deduplication passed");
  } finally {
    const statementRows = await prisma.bankStatementTransaction.findMany({ where: { importId: { in: importIds } }, select: { postedPaymentId: true, postedLedgerEntryId: true } });
    const paymentIds = statementRows.flatMap((item) => item.postedPaymentId ? [item.postedPaymentId] : []);
    const ledgerIds = statementRows.flatMap((item) => item.postedLedgerEntryId ? [item.postedLedgerEntryId] : []);
    await prisma.bankStatementImport.deleteMany({ where: { id: { in: importIds } } });
    await prisma.bankStatementRule.deleteMany({ where: { updatedById: director.id } });
    if (paymentIds.length) {
      const receipts = await prisma.paymentReceipt.findMany({ where: { paymentId: { in: paymentIds } }, select: { id: true, documentId: true, cashShiftId: true } });
      const documentIds = receipts.map((item) => item.documentId);
      if (documentIds.length) {
        await prisma.documentAudit.deleteMany({ where: { documentId: { in: documentIds } } });
        await prisma.documentVersion.deleteMany({ where: { documentId: { in: documentIds } } });
      }
      await prisma.paymentReceipt.deleteMany({ where: { paymentId: { in: paymentIds } } });
      if (documentIds.length) await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
      const shiftIds = receipts.map((item) => item.cashShiftId);
      if (shiftIds.length) await prisma.cashShift.deleteMany({ where: { id: { in: shiftIds } } });
    }
    if (ledgerIds.length) await prisma.companyLedgerEntry.deleteMany({ where: { id: { in: ledgerIds } } });
    await prisma.financeAuditEvent.deleteMany({ where: { authorId: director.id } });
    if (orderId) await prisma.orderEvent.deleteMany({ where: { orderId } });
    if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
    if (clientId) await prisma.client.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: { in: [director.id, manager.id] } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
