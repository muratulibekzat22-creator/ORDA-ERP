import assert from "node:assert/strict";
import {
  AdvanceRequestStatus,
  BonusPaymentMode,
  PayrollAccrualType,
  Role,
} from "@prisma/client";
import { createRequestHash } from "../lib/idempotency";
import { prisma } from "../lib/prisma";
import {
  closePeriod,
  createAccrual,
  ensurePeriod,
  payAdvance,
  payrollSummary,
  PayrollError,
  requestAdvance,
  reviewAdvance,
  reverseAccrual,
  upsertPayrollProfile,
} from "../lib/services/payroll.service";

if (
  !process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL
)
  throw new Error("Payroll integration requires TEST_DATABASE_URL");
const tag = `payroll-${Date.now()}`;
const key = (name: string) => `${tag}:${name}`;

async function expectCode(run: () => Promise<unknown>, code: string) {
  await assert.rejects(
    run,
    (error) => error instanceof PayrollError && error.message === code,
  );
}

async function main() {
  const ids: { users: number[]; client?: number; order?: number } = {
    users: [],
  };
  try {
    const [director, manager, accountant, partner] = await Promise.all([
      prisma.user.create({
        data: {
          name: `${tag}-director`,
          email: `${tag}-director@test.local`,
          password: "test",
          role: Role.DIRECTOR,
        },
      }),
      prisma.user.create({
        data: {
          name: `${tag}-manager`,
          email: `${tag}-manager@test.local`,
          password: "test",
          role: Role.MANAGER,
        },
      }),
      prisma.user.create({
        data: {
          name: `${tag}-accountant`,
          email: `${tag}-accountant@test.local`,
          password: "test",
          role: Role.ACCOUNTANT,
        },
      }),
      prisma.user.create({
        data: {
          name: `${tag}-partner`,
          email: `${tag}-partner@test.local`,
          password: "test",
          role: Role.PARTNER,
        },
      }),
    ]);
    ids.users.push(director.id, manager.id, accountant.id, partner.id);
    const directorActor = {
      userId: director.id,
      role: Role.DIRECTOR,
      name: director.name,
    };
    const managerActor = {
      userId: manager.id,
      role: Role.MANAGER,
      name: manager.name,
    };
    const accountantActor = {
      userId: accountant.id,
      role: Role.ACCOUNTANT,
      name: accountant.name,
    };
    const partnerActor = {
      userId: partner.id,
      role: Role.PARTNER,
      name: partner.name,
    };
    const profile = await upsertPayrollProfile(
      {
        userId: manager.id,
        hiredAt: new Date("2026-01-01"),
        baseSalary: 200000,
        defaultGuaranteedBonus: 20000,
      },
      directorActor,
    );
    assert.equal(Number(profile.baseSalary), 200000);
    assert.equal(Number(profile.defaultGuaranteedBonus), 20000);
    await upsertPayrollProfile(
      {
        userId: manager.id,
        hiredAt: new Date("2026-07-01"),
        baseSalary: 200000,
        defaultGuaranteedBonus: 30000,
      },
      directorActor,
    );
    const changed = await prisma.employeePayrollProfile.findUniqueOrThrow({
      where: { id: profile.id },
    });
    assert.equal(
      Number(changed.defaultGuaranteedBonus),
      30000,
      "director guaranteed bonus change",
    );
    const period = await ensurePeriod(2026, 8);
    const nextPeriod = await ensurePeriod(2026, 9);
    const client = await prisma.client.create({
      data: {
        name: tag,
        phone: "77000000000",
        city: "Test",
        manager: manager.name,
        amount: "0",
        status: "WON",
        managerUserId: manager.id,
      },
    });
    ids.client = client.id;
    const order = await prisma.order.create({
      data: {
        number: `PAY-${Date.now()}`,
        clientId: client.id,
        address: "Test",
        staircase: "Test",
        material: "Test",
        amount: 100000,
        manager: manager.name,
        status: "Оформлен",
      },
    });
    ids.order = order.id;
    const base = { employeeId: profile.id, periodId: period.id };
    await createAccrual(
      {
        ...base,
        type: PayrollAccrualType.BASE_SALARY,
        amount: 200000,
        reason: "Оклад",
        key: key("salary"),
        requestHash: "salary",
      },
      directorActor,
    );
    const guaranteed = await createAccrual(
      {
        ...base,
        type: PayrollAccrualType.GUARANTEED_ORDER_BONUS,
        amount: 20000,
        orderId: order.id,
        reason: "Гарантированный бонус",
        paymentMode: BonusPaymentMode.IMMEDIATE,
        key: key("guaranteed"),
        requestHash: "guaranteed",
      },
      directorActor,
    );
    assert(guaranteed.payment, "immediate bonus payment missing");
    const orderBonus = await createAccrual(
      {
        ...base,
        type: PayrollAccrualType.ORDER_BONUS,
        amount: 30000,
        orderId: order.id,
        reason: "Бонус за заказ",
        paymentMode: BonusPaymentMode.ACCUMULATE,
        key: key("order-bonus"),
        requestHash: "order-bonus",
      },
      directorActor,
    );
    await createAccrual(
      {
        ...base,
        type: PayrollAccrualType.PREMIUM,
        amount: 20000,
        reason: "Премия",
        key: key("premium"),
        requestHash: "premium",
      },
      directorActor,
    );
    const requestPayload = {
      periodId: period.id,
      amount: 70000,
      comment: "Аванс",
    };
    const advance = await requestAdvance(
      {
        ...requestPayload,
        key: key("advance"),
        requestHash: createRequestHash(requestPayload),
      },
      managerActor,
    );
    await expectCode(
      () =>
        reviewAdvance(
          advance.id,
          { status: AdvanceRequestStatus.APPROVED },
          managerActor,
        ),
      "FORBIDDEN",
    );
    const approved = await reviewAdvance(
      advance.id,
      { status: AdvanceRequestStatus.APPROVED, approvedAmount: 70000 },
      directorActor,
    );
    assert.equal(Number(approved.approvedAmount), 70000);
    const advancePayment = await payAdvance(
      advance.id,
      { key: key("advance-payment"), requestHash: "advance-payment" },
      accountantActor,
    );
    const replay = await payAdvance(
      advance.id,
      { key: key("advance-payment"), requestHash: "advance-payment" },
      accountantActor,
    );
    assert.equal(replay.id, advancePayment.id, "payment idempotency");
    const rejected = await requestAdvance(
      {
        periodId: period.id,
        amount: 10000,
        key: key("advance-rejected"),
        requestHash: "advance-rejected",
      },
      managerActor,
    );
    await reviewAdvance(
      rejected.id,
      { status: AdvanceRequestStatus.REJECTED, comment: "Не согласовано" },
      directorActor,
    );
    const summary = await payrollSummary(period.id, directorActor);
    assert.deepEqual(summary.totals, {
      accrued: 270000,
      paid: 90000,
      payable: 180000,
    });
    const self = await payrollSummary(period.id, managerActor, 999999);
    assert.equal(self.rows.length, 1);
    assert.equal(
      self.rows[0].user.id,
      manager.id,
      "foreign employee selector bypassed self scope",
    );
    await expectCode(
      () => payrollSummary(period.id, partnerActor),
      "FORBIDDEN",
    );
    await expectCode(
      () =>
        createAccrual(
          {
            ...base,
            type: PayrollAccrualType.PREMIUM,
            amount: 1,
            reason: "Forbidden",
            key: key("accountant-premium"),
            requestHash: "x",
          },
          accountantActor,
        ),
      "FORBIDDEN",
    );
    const ledger = await prisma.companyLedgerEntry.findMany({
      where: {
        OR: [
          { payrollAccrualId: { not: null } },
          { payrollPaymentId: { not: null } },
        ],
      },
    });
    assert.equal(
      ledger
        .filter((row) => row.affectsProfit)
        .reduce(
          (sum, row) =>
            sum +
            (row.direction === "EXPENSE"
              ? Number(row.amount)
              : -Number(row.amount)),
          0,
        ),
      270000,
      "payroll P&L expense duplicated",
    );
    assert.equal(
      ledger
        .filter((row) => !row.affectsProfit)
        .reduce((sum, row) => sum + Number(row.amount), 0),
      90000,
      "cash payroll total",
    );
    await closePeriod(period.id, key("close"), directorActor);
    await expectCode(
      () =>
        createAccrual(
          {
            ...base,
            type: PayrollAccrualType.EXTRA_BONUS,
            amount: 1,
            reason: "Closed",
            key: key("closed"),
            requestHash: "closed",
          },
          directorActor,
        ),
      "PERIOD_CLOSED",
    );
    await createAccrual(
      {
        employeeId: profile.id,
        periodId: nextPeriod.id,
        earnedPeriodId: period.id,
        type: PayrollAccrualType.EXTRA_BONUS,
        amount: 10000,
        reason: "Поздний бонус августа",
        key: key("late"),
        requestHash: "late",
      },
      directorActor,
    );
    await reverseAccrual(
      orderBonus.accrual.id,
      nextPeriod.id,
      "Сторно бонуса",
      key("reversal"),
      "reversal",
      directorActor,
    );
    const next = await payrollSummary(nextPeriod.id, directorActor);
    assert.equal(
      next.totals.accrued,
      -20000,
      "late bonus and reversal formula",
    );
    await prisma.order.update({
      where: { id: order.id },
      data: { status: "Отменён" },
    });
    const warning = await createAccrual(
      {
        employeeId: profile.id,
        periodId: nextPeriod.id,
        type: PayrollAccrualType.ORDER_BONUS,
        amount: 1000,
        orderId: order.id,
        reason: "Решение директора",
        key: key("cancelled-warning"),
        requestHash: "cancelled-warning",
      },
      directorActor,
    );
    assert.equal(warning.cancelledOrderWarning, true);
    const duplicate = await createAccrual(
      {
        employeeId: profile.id,
        periodId: nextPeriod.id,
        type: PayrollAccrualType.ORDER_BONUS,
        amount: 1000,
        orderId: order.id,
        reason: "Решение директора",
        key: key("cancelled-warning"),
        requestHash: "cancelled-warning",
      },
      directorActor,
    );
    assert.equal(duplicate.created, false);
    await prisma.user.update({
      where: { id: manager.id },
      data: { active: false },
    });
    assert.equal(
      (await payrollSummary(period.id, directorActor, profile.id)).rows.length,
      1,
      "deactivation removed payroll history",
    );
    console.log(
      "payroll profile, approvals, formula, RBAC, period lock and finance checks passed",
    );
  } finally {
    if (ids.users.length) {
      const profiles = await prisma.employeePayrollProfile.findMany({
        where: { userId: { in: ids.users } },
        select: { id: true },
      });
      const employeeIds = profiles.map((row) => row.id);
      const accruals = await prisma.payrollAccrual.findMany({
        where: { employeeId: { in: employeeIds } },
        select: { id: true },
      });
      const payments = await prisma.payrollPayment.findMany({
        where: { employeeId: { in: employeeIds } },
        select: { id: true },
      });
      await prisma.payrollAdvanceRequest.deleteMany({
        where: { employeeId: { in: employeeIds } },
      });
      await prisma.companyLedgerEntry.deleteMany({
        where: {
          OR: [
            { payrollAccrualId: { in: accruals.map((r) => r.id) } },
            { payrollPaymentId: { in: payments.map((r) => r.id) } },
          ],
        },
      });
      await prisma.payrollPayment.deleteMany({
        where: { employeeId: { in: employeeIds } },
      });
      await prisma.payrollAccrual.updateMany({
        where: { employeeId: { in: employeeIds } },
        data: { reversalOfId: null },
      });
      await prisma.payrollAccrual.deleteMany({
        where: { employeeId: { in: employeeIds } },
      });
      await prisma.employeeSalaryRate.deleteMany({
        where: { employeeId: { in: employeeIds } },
      });
      await prisma.employeePayrollProfile.deleteMany({
        where: { id: { in: employeeIds } },
      });
      if (ids.order)
        await prisma.order.deleteMany({ where: { id: ids.order } });
      if (ids.client)
        await prisma.client.deleteMany({ where: { id: ids.client } });
      await prisma.payrollPeriod.deleteMany({
        where: {
          year: 2026,
          month: { in: [8, 9] },
          accruals: { none: {} },
          payments: { none: {} },
        },
      });
      await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    }
    await prisma.$disconnect();
  }
}
void main();
