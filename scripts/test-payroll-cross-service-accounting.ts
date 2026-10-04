import "./require-test-database";

import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  PayrollAccrualType,
  PayrollDirection,
  PayrollPaymentType,
  Prisma,
  Role,
} from "@prisma/client";

import { prisma } from "../lib/prisma";
import { runWithSystemAccess } from "../lib/tenant-context";
import { getDashboardSummary } from "../lib/services/dashboard.service";
import { getFinanceDashboard } from "../lib/services/payment.service";
import {
  approvedPayrollAccountingTotals,
  latestApprovedPayrollSnapshots,
} from "../lib/services/payroll-accounting-read";
import { getReportsReadModel } from "../lib/services/report.service";

if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
  throw new Error("Payroll cross-service integration requires TEST_DATABASE_URL");

const tag = `payroll-cross-service-${Date.now()}`;
const year = 2198;
const month = 9;
const start = new Date("2198-08-31T19:00:00.000Z");
const end = new Date("2198-09-30T18:59:59.999Z");
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

async function main() {
  const unitSnapshots = [
    { id: 1, employeeId: 1, periodId: 1, revision: 1, preparedAmount: new Prisma.Decimal(100) },
    { id: 2, employeeId: 1, periodId: 1, revision: 2, preparedAmount: new Prisma.Decimal(120) },
    { id: 3, employeeId: 2, periodId: 1, revision: 1, preparedAmount: new Prisma.Decimal(80) },
  ];
  const unitPayments = [
    { employeeId: 1, periodId: 1, amount: new Prisma.Decimal(20), type: PayrollPaymentType.ADVANCE },
    { employeeId: 2, periodId: 1, amount: new Prisma.Decimal(100), type: PayrollPaymentType.SALARY_PAYMENT },
  ];
  assert.deepEqual(latestApprovedPayrollSnapshots(unitSnapshots).map((row) => row.id).sort(), [2, 3]);
  assert.deepEqual(
    approvedPayrollAccountingTotals(unitSnapshots, unitPayments),
    { accrued: 200, paid: 120, payable: 100 },
    "payable must be capped per employee-period, not after company-wide netting",
  );

  const ids = {
    users: [] as number[],
    profiles: [] as number[],
    periods: [] as number[],
    snapshots: [] as number[],
    payments: [] as number[],
    accruals: [] as number[],
    ledgers: [] as number[],
    clients: [] as number[],
    orders: [] as number[],
  };
  const foreignIds = {
    company: 0,
    user: 0,
    profile: 0,
    period: 0,
    snapshot: 0,
    payment: 0,
  };
  let createdTestCompany = false;
  try {
    if (!await prisma.company.findUnique({ where: { id: 1 }, select: { id: true } })) {
      await prisma.company.create({
        data: { id: 1, slug: "test-company", name: "ORDA TEST" },
      });
      createdTestCompany = true;
    }
    const director = await prisma.user.create({
      data: {
        name: `${tag}-director`,
        email: `${tag}@test.local`,
        password: "not-used",
        role: Role.DIRECTOR,
      },
    });
    ids.users.push(director.id);
    const [employeeA, employeeB] = await Promise.all([
      prisma.employeePayrollProfile.create({
        data: {
          userId: director.id,
          name: `${tag}-employee-a`,
          position: "Director",
          hiredAt: start,
        },
      }),
      prisma.employeePayrollProfile.create({
        data: {
          name: `${tag}-employee-b`,
          position: "Former employee without account",
          hiredAt: start,
          active: false,
        },
      }),
    ]);
    ids.profiles.push(employeeA.id, employeeB.id);
    const period = await prisma.payrollPeriod.upsert({
      where: { companyId_year_month: { companyId: 1, year, month } },
      update: {},
      create: { companyId: 1, year, month },
    });
    ids.periods.push(period.id);
    const baselineReport = await getReportsReadModel(
      new URLSearchParams("period=custom&dateFrom=2198-09-01&dateTo=2198-09-30"),
      { id: director.id, role: Role.DIRECTOR },
    );
    const baselineFinance = await getFinanceDashboard({ from: start, to: end });
    const baselineDashboard = await getDashboardSummary({
      role: Role.DIRECTOR,
      userId: director.id,
      month: `${year}-${String(month).padStart(2, "0")}`,
    }) as { finance: { payrollAccrued: number; payrollPaid: number; operatingExpenses: number; netProfit: number } };

    const createSnapshot = async (input: {
      employeeId: number;
      revision: number;
      preparedAmount: number;
      previousSnapshotId?: number;
    }) => prisma.payrollCalculationSnapshot.create({
      data: {
        employeeId: input.employeeId,
        periodId: period.id,
        revision: input.revision,
        salaryAmount: input.preparedAmount,
        orderBonusAmount: 0,
        otherBonusAmount: 0,
        premiumAmount: 0,
        deductionAmount: 0,
        preparedAmount: input.preparedAmount,
        calculationHash: hash(`${tag}:calculation:${input.employeeId}:${input.revision}`),
        source: { test: tag },
        reason: "Cross-service accounting test",
        approvedById: director.id,
        previousSnapshotId: input.previousSnapshotId,
        idempotencyKey: `${tag}:snapshot:${input.employeeId}:${input.revision}`,
        requestHash: hash(`${tag}:request:${input.employeeId}:${input.revision}`),
      },
    });
    const a1 = await createSnapshot({ employeeId: employeeA.id, revision: 1, preparedAmount: 100 });
    const a2 = await createSnapshot({ employeeId: employeeA.id, revision: 2, preparedAmount: 120, previousSnapshotId: a1.id });
    const b1 = await createSnapshot({ employeeId: employeeB.id, revision: 1, preparedAmount: 80 });
    ids.snapshots.push(a1.id, a2.id, b1.id);

    for (const [snapshot, amount] of [[a1, 100], [a2, 20], [b1, 80]] as const) {
      const ledger = await prisma.companyLedgerEntry.create({
        data: {
          type: "PAYROLL_ACCRUAL",
          category: "SALARY",
          source: "PAYROLL_CALCULATION",
          direction: "EXPENSE",
          amount,
          operationDate: end,
          employeeId: snapshot.employeeId,
          authorId: director.id,
          affectsProfit: true,
          comment: `${tag}:snapshot-recognition`,
          payrollCalculationSnapshotId: snapshot.id,
          idempotencyKey: `${tag}:snapshot-ledger:${snapshot.id}`,
          requestHash: hash(`${tag}:snapshot-ledger:${snapshot.id}`),
        },
      });
      ids.ledgers.push(ledger.id);
    }

    const createPayrollPayment = async (employeeId: number, amount: number, type: PayrollPaymentType) => {
      const payment = await prisma.payrollPayment.create({
        data: {
          employeeId,
          periodId: period.id,
          amount,
          paymentDate: new Date("2198-09-15T07:00:00.000Z"),
          type,
          paidById: director.id,
          idempotencyKey: `${tag}:payment:${employeeId}`,
          requestHash: hash(`${tag}:payment:${employeeId}`),
        },
      });
      ids.payments.push(payment.id);
      const ledger = await prisma.companyLedgerEntry.create({
        data: {
          type: "PAYROLL_PAYMENT",
          category: "SALARY",
          source: "PAYROLL_PAYMENT",
          direction: "EXPENSE",
          amount,
          operationDate: payment.paymentDate,
          employeeId,
          authorId: director.id,
          affectsProfit: false,
          payrollPaymentId: payment.id,
          idempotencyKey: `${tag}:payment-ledger:${payment.id}`,
          requestHash: hash(`${tag}:payment-ledger:${payment.id}`),
        },
      });
      ids.ledgers.push(ledger.id);
    };
    await createPayrollPayment(employeeA.id, 20, PayrollPaymentType.ADVANCE);
    await createPayrollPayment(employeeB.id, 100, PayrollPaymentType.SALARY_PAYMENT);
    await runWithSystemAccess(async () => {
      const foreignCompanyId = 2_000_000_000 - Number(String(Date.now()).slice(-6));
      const company = await prisma.company.create({
        data: { id: foreignCompanyId, slug: `${tag}-foreign`, name: `${tag}-foreign` },
      });
      foreignIds.company = company.id;
      const user = await prisma.user.create({
        data: {
          companyId: company.id,
          name: `${tag}-foreign-director`,
          email: `${tag}-foreign@test.local`,
          password: "not-used",
          role: Role.DIRECTOR,
        },
      });
      foreignIds.user = user.id;
      const profile = await prisma.employeePayrollProfile.create({
        data: {
          companyId: company.id,
          userId: user.id,
          name: user.name,
          position: "Director",
          hiredAt: start,
        },
      });
      foreignIds.profile = profile.id;
      const foreignPeriod = await prisma.payrollPeriod.create({
        data: { companyId: company.id, year, month },
      });
      foreignIds.period = foreignPeriod.id;
      const snapshot = await prisma.payrollCalculationSnapshot.create({
        data: {
          companyId: company.id,
          employeeId: profile.id,
          periodId: foreignPeriod.id,
          revision: 1,
          salaryAmount: 900_000,
          orderBonusAmount: 0,
          otherBonusAmount: 0,
          premiumAmount: 0,
          deductionAmount: 0,
          preparedAmount: 900_000,
          calculationHash: hash(`${tag}:foreign-calculation`),
          source: { test: tag },
          reason: "Tenant boundary fixture",
          approvedById: user.id,
          idempotencyKey: `${tag}:foreign-snapshot`,
          requestHash: hash(`${tag}:foreign-snapshot`),
        },
      });
      foreignIds.snapshot = snapshot.id;
      const payment = await prisma.payrollPayment.create({
        data: {
          employeeId: profile.id,
          periodId: foreignPeriod.id,
          amount: 400_000,
          paymentDate: new Date("2198-09-15T07:00:00.000Z"),
          type: PayrollPaymentType.SALARY_PAYMENT,
          paidById: user.id,
          idempotencyKey: `${tag}:foreign-payment`,
          requestHash: hash(`${tag}:foreign-payment`),
        },
      });
      foreignIds.payment = payment.id;
    });

    const client = await prisma.client.create({
      data: {
        name: `${tag}-client`,
        phone: `+7${String(Date.now()).slice(-10)}`,
        city: "TEST",
        manager: director.name,
        managerUserId: director.id,
        amount: "1000",
        status: "WON",
      },
    });
    ids.clients.push(client.id);
    const order = await prisma.order.create({
      data: {
        number: `${tag}-order`,
        clientId: client.id,
        manager: director.name,
        managerUserId: director.id,
        address: "TEST",
        staircase: "Straight",
        material: "Oak",
        amount: 1_000,
        balance: 1_000,
        orderReceivedAt: new Date("2198-09-10T07:00:00.000Z"),
        orderDateNeedsReview: false,
        status: "New",
      },
    });
    ids.orders.push(order.id);
    const legacyAccrual = await prisma.payrollAccrual.create({
      data: {
        employeeId: employeeA.id,
        periodId: period.id,
        type: PayrollAccrualType.ORDER_BONUS,
        direction: PayrollDirection.INCREASE,
        amount: 999,
        orderId: order.id,
        reason: "Legacy row must not enter the approved read model",
        approvedById: director.id,
        createdById: director.id,
        idempotencyKey: `${tag}:legacy-accrual`,
        requestHash: hash(`${tag}:legacy-accrual`),
      },
    });
    ids.accruals.push(legacyAccrual.id);

    const dashboard = await getDashboardSummary({
      role: Role.DIRECTOR,
      userId: director.id,
      month: `${year}-${String(month).padStart(2, "0")}`,
    }) as { finance: { payrollAccrued: number; payrollPaid: number; operatingExpenses: number; netProfit: number } };
    assert.equal(dashboard.finance.payrollAccrued - baselineDashboard.finance.payrollAccrued, 200, "dashboard used legacy accruals or summed snapshot revisions");
    assert.equal(dashboard.finance.payrollPaid - baselineDashboard.finance.payrollPaid, 120, "dashboard payroll cash is not sourced from confirmed payments");
    assert.equal(dashboard.finance.operatingExpenses - baselineDashboard.finance.operatingExpenses, 0, "snapshot ledger was counted as a second payroll expense");
    assert.equal(dashboard.finance.netProfit - baselineDashboard.finance.netProfit, -200, "dashboard P&L counted approved payroll more than once");

    const report = await getReportsReadModel(
      new URLSearchParams("period=custom&dateFrom=2198-09-01&dateTo=2198-09-30"),
      { id: director.id, role: Role.DIRECTOR },
    );
    assert.equal(report.finance?.payrollAccrued, 200, "report used legacy accruals or an obsolete snapshot revision");
    assert.equal(report.finance?.payrollPaid, 120, "report payroll paid is not confirmed cash by payment date");
    assert.equal(report.finance?.payrollPayable, (baselineReport.finance?.payrollPayable ?? 0) + 100, "report payable netted one employee's overpayment against another employee");
    assert.equal(report.orders.find((row) => row.id === order.id)?.payrollAccrued, null, "report invented an order allocation from a legacy accrual");

    const finance = await getFinanceDashboard({ from: start, to: end });
    assert.equal(finance.cards.payrollPayable, baselineFinance.cards.payrollPayable + 100, "finance dashboard payable is not based on latest approved snapshots");
    assert.equal(finance.cards.expenses - baselineFinance.cards.expenses, 120, "approved accrual ledger was mixed into cash expenses");
    assert(!finance.operations.some((row) => row.comment === `${tag}:snapshot-recognition`), "snapshot ledger leaked into cash operations");
    const financeOrder = await getFinanceDashboard({ orderId: order.id, from: start, to: end });
    assert.equal(financeOrder.rows[0]?.managerBonusPayable, null, "finance dashboard exposed a legacy order bonus as approved payable");
    assert.equal(financeOrder.rows[0]?.measurerBonusPayable, null, "finance dashboard invented a measurement allocation");
    assert.equal(financeOrder.rows[0]?.payrollBonusAttribution, "NOT_AVAILABLE_FROM_APPROVED_CALCULATION");

    console.log("Payroll cross-service accounting: latest snapshots, confirmed payments, tenant period totals, row-level payable and no double P&L passed");
  } finally {
    if (ids.ledgers.length) await prisma.companyLedgerEntry.deleteMany({ where: { id: { in: ids.ledgers } } });
    if (ids.accruals.length) await prisma.payrollAccrual.deleteMany({ where: { id: { in: ids.accruals } } });
    if (ids.payments.length) await prisma.payrollPayment.deleteMany({ where: { id: { in: ids.payments } } });
    if (ids.snapshots.length) await prisma.payrollCalculationSnapshot.deleteMany({ where: { id: { in: ids.snapshots } } });
    if (ids.orders.length) await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
    if (ids.clients.length) await prisma.client.deleteMany({ where: { id: { in: ids.clients } } });
    if (ids.profiles.length) await prisma.employeePayrollProfile.deleteMany({ where: { id: { in: ids.profiles } } });
    if (ids.periods.length) await prisma.payrollPeriod.deleteMany({ where: { id: { in: ids.periods }, accruals: { none: {} }, payments: { none: {} }, calculationSnapshots: { none: {} } } });
    if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    if (createdTestCompany) await prisma.company.deleteMany({ where: { id: 1 } });
    await runWithSystemAccess(async () => {
      if (foreignIds.payment) await prisma.payrollPayment.deleteMany({ where: { id: foreignIds.payment } });
      if (foreignIds.snapshot) await prisma.payrollCalculationSnapshot.deleteMany({ where: { id: foreignIds.snapshot } });
      if (foreignIds.profile) await prisma.employeePayrollProfile.deleteMany({ where: { id: foreignIds.profile } });
      if (foreignIds.period) await prisma.payrollPeriod.deleteMany({ where: { id: foreignIds.period } });
      if (foreignIds.user) await prisma.user.deleteMany({ where: { id: foreignIds.user } });
      if (foreignIds.company) await prisma.company.deleteMany({ where: { id: foreignIds.company } });
    });
  }
}

void main().finally(() => prisma.$disconnect());
