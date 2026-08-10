import "./require-test-database";

import assert from "node:assert/strict";

import { Role } from "@prisma/client";

import { createRequestHash } from "../lib/idempotency";
import { prisma } from "../lib/prisma";
import {
  createFinanceCategory,
  createManualFinanceEntry,
  getFinanceJournal,
  updateFinanceCategory,
  updateManualFinanceEntry,
  voidManualFinanceEntry,
} from "../lib/services/finance-journal.service";
import { createFinanceOperation } from "../lib/services/payment.service";

const tag = `finance-journal-${Date.now()}`;
const operationDate = new Date("2094-08-10T10:00:00.000Z");
const from = new Date("2094-08-10T00:00:00.000Z");
const to = new Date("2094-08-10T23:59:59.999Z");

async function main() {
  const director = await prisma.user.create({
    data: {
      name: tag,
      email: `${tag}@test.local`,
      password: "test",
      role: Role.DIRECTOR,
    },
  });
  let clientId = 0;
  let partnerId = 0;
  let orderId = 0;
  let customCategoryId = 0;
  try {
    const [incomeCategory, advertisingCategory, salaryCategory] =
      await Promise.all([
        prisma.financeCategory.findFirstOrThrow({
          where: { direction: "INCOME", code: "OTHER_INCOME" },
        }),
        prisma.financeCategory.findFirstOrThrow({
          where: { direction: "EXPENSE", code: "ADVERTISING" },
        }),
        prisma.financeCategory.findFirstOrThrow({
          where: { direction: "EXPENSE", code: "SALARY" },
        }),
      ]);
    const client = await prisma.client.create({
      data: {
        name: tag,
        phone: "+77000000000",
        city: "Test",
        manager: tag,
        amount: "1000000",
        status: "WON",
      },
    });
    clientId = client.id;
    const partner = await prisma.partner.create({ data: { name: tag } });
    partnerId = partner.id;
    const order = await prisma.order.create({
      data: {
        number: `FJ-${Date.now()}`,
        clientId,
        partnerId,
        address: "Test",
        staircase: "Test",
        material: "Test",
        amount: 1_000_000,
        balance: 1_000_000,
        partnerPrice: 300_000,
        partnerBalance: 300_000,
        partnerAgreedAt: operationDate,
        manager: tag,
      },
    });
    orderId = order.id;

    const incomeHash = createRequestHash({ tag, kind: "income" });
    const manualIncome = await createManualFinanceEntry({
      direction: "INCOME",
      categoryId: incomeCategory.id,
      amount: 1_000_000,
      operationDate,
      method: "kaspi",
      clientId,
      orderId,
      authorId: director.id,
      idempotencyKey: `${tag}:income`,
      requestHash: incomeHash,
    });
    const replay = await createManualFinanceEntry({
      direction: "INCOME",
      categoryId: incomeCategory.id,
      amount: 1_000_000,
      operationDate,
      method: "kaspi",
      clientId,
      orderId,
      authorId: director.id,
      idempotencyKey: `${tag}:income`,
      requestHash: incomeHash,
    });
    assert.equal(replay.created, false, "manual operation is idempotent");

    const advertising = await createManualFinanceEntry({
      direction: "EXPENSE",
      categoryId: advertisingCategory.id,
      amount: 200_000,
      operationDate,
      method: "bank_transfer",
      counterparty: "Рекламная площадка",
      authorId: director.id,
      idempotencyKey: `${tag}:advertising`,
      requestHash: createRequestHash({ tag, kind: "advertising" }),
    });
    await createFinanceOperation({
      type: "PARTNER_PAYOUT",
      amount: 300_000,
      method: "bank_transfer",
      orderId,
      partnerId,
      operationDate,
      author: tag,
      authorId: director.id,
      idempotencyKey: `${tag}:partner`,
      requestHash: createRequestHash({ tag, kind: "partner" }),
    });
    const payrollLedger = await prisma.companyLedgerEntry.create({
      data: {
        type: "PAYROLL_PAYMENT",
        category: salaryCategory.code,
        categoryId: salaryCategory.id,
        direction: "EXPENSE",
        source: "PAYROLL_PAYMENT",
        amount: 100_000,
        operationDate,
        method: "bank_transfer",
        authorId: director.id,
        idempotencyKey: `${tag}:payroll`,
      },
    });

    const journal = await getFinanceJournal({ from, to });
    assert.deepEqual(journal.totals, {
      income: 1_000_000,
      expense: 600_000,
      cashResult: 400_000,
    });
    assert.equal(
      journal.operations.filter((item) => item.source === "PARTNER_PAYOUT")
        .length,
      1,
      "partner payout is not duplicated",
    );
    assert.equal(
      journal.operations.filter((item) => item.source === "PAYROLL_PAYMENT")
        .length,
      1,
      "payroll payment is not duplicated",
    );
    assert.equal(
      journal.expenseByCategory.find((item) => item.code === "ADVERTISING")
        ?.amount,
      200_000,
    );

    await updateManualFinanceEntry(advertising.entry.id, {
      direction: "EXPENSE",
      categoryId: advertisingCategory.id,
      amount: 210_000,
      operationDate,
      method: "bank_transfer",
      counterparty: "Рекламная площадка",
      authorId: director.id,
      reason: "Уточнение счёта",
    });
    assert.equal(
      await prisma.financeAuditEvent.count({
        where: {
          entityType: "CompanyLedgerEntry",
          entityId: advertising.entry.id,
          action: "MANUAL_FINANCE_UPDATED",
        },
      }),
      1,
    );
    await voidManualFinanceEntry(
      advertising.entry.id,
      "Ошибочная проводка",
      director.id,
    );
    assert.equal(
      (await getFinanceJournal({ from, to })).totals.expense,
      400_000,
      "voided operation does not affect totals",
    );
    await assert.rejects(
      () =>
        updateManualFinanceEntry(payrollLedger.id, {
          direction: "EXPENSE",
          categoryId: salaryCategory.id,
          amount: 1,
          operationDate,
          method: "cash",
          authorId: director.id,
        }),
      /SYSTEM_ENTRY_IMMUTABLE/,
    );

    const custom = await createFinanceCategory(`${tag} категория`, "EXPENSE");
    customCategoryId = custom.id;
    await updateFinanceCategory(custom.id, {
      name: `${tag} новая`,
      active: false,
    });
    assert.equal(
      (
        await prisma.financeCategory.findUniqueOrThrow({
          where: { id: custom.id },
        })
      ).active,
      false,
    );
    assert.equal(manualIncome.created, true);
    console.log("Finance journal integration passed");
  } finally {
    await prisma.financeAuditEvent.deleteMany({
      where: { authorId: director.id },
    });
    await prisma.companyLedgerEntry.deleteMany({
      where: { authorId: director.id },
    });
    if (orderId) await prisma.payment.deleteMany({ where: { orderId } });
    if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
    if (clientId) await prisma.client.deleteMany({ where: { id: clientId } });
    if (partnerId) await prisma.partner.deleteMany({ where: { id: partnerId } });
    if (customCategoryId)
      await prisma.financeCategory.deleteMany({
        where: { id: customCategoryId },
      });
    await prisma.user.deleteMany({ where: { id: director.id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
