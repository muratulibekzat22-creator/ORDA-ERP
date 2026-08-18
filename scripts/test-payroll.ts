import "./require-test-database";

import assert from "node:assert/strict";
import {
  AdvanceRequestStatus,
  BonusPaymentMode,
  PayrollAccrualType,
  PayrollBonusRule,
  PayrollPaymentType,
  PayrollPeriodStatus,
  Role,
} from "@prisma/client";
import { createRequestHash } from "../lib/idempotency";
import { prisma } from "../lib/prisma";
import { getFinanceDashboard } from "../lib/services/payment.service";
import {
  changeAllowance,
  changeSalary,
  closePeriod,
  createAccrual,
  createPayment,
  ensurePeriod,
  payrollSummary,
  PayrollError,
  requestAdvance,
  requestPaymentConfirmation,
  reviewAdvance,
  reviewPaymentConfirmation,
  reverseAccrual,
  reversePayment,
  transitionPeriod,
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
  const ids: { users: number[]; periods: number[]; client?: number; order?: number } = {
    users: [],
    periods: [],
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
    await expectCode(
      () =>
        changeSalary(
          profile.id,
          205000,
          new Date("2026-05-01"),
          "",
          directorActor,
        ),
      "REASON_REQUIRED",
    );
    await changeSalary(profile.id, 210000, new Date("2026-06-01"), "Индексация", directorActor);
    await changeSalary(profile.id, 200000, new Date("2026-07-01"), "Тестовая ставка", directorActor);
    await changeAllowance(profile.id, 20000, "Гарантированный бонус", directorActor);
    assert.equal((await prisma.employeeSalaryRate.count({ where: { employeeId: profile.id } })), 3, "salary history preserved");
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
    await changeAllowance(profile.id, 20000, "Возврат гарантированного бонуса", directorActor);
    assert.equal(Number((await prisma.employeePayrollProfile.findUniqueOrThrow({ where: { id: profile.id } })).defaultGuaranteedBonus), 20000);
    const periodYear = 3000 + (Date.now() % 100000);
    const automaticSalaryPeriod = await ensurePeriod(periodYear, 7, directorActor);
    ids.periods.push(automaticSalaryPeriod.id);
    await ensurePeriod(periodYear, 7, directorActor);
    const automaticSalaryAccruals = await prisma.payrollAccrual.findMany({
      where: {
        employeeId: profile.id,
        periodId: automaticSalaryPeriod.id,
        type: PayrollAccrualType.BASE_SALARY,
      },
    });
    assert.equal(automaticSalaryAccruals.length, 1, "automatic salary accrual duplicated");
    assert.equal(Number(automaticSalaryAccruals[0].amount), 200000, "automatic salary amount");
    assert.equal(
      await prisma.companyLedgerEntry.count({
        where: { payrollAccrualId: automaticSalaryAccruals[0].id },
      }),
      0,
      "automatic salary accrual became a Finance expense",
    );
    const period = await ensurePeriod(periodYear, 8);
    const nextPeriod = await ensurePeriod(periodYear, 9);
    const formulaPeriod = await ensurePeriod(periodYear, 10);
    const confirmationPeriod = await ensurePeriod(periodYear, 11);
    const bonusStatusPeriod = await ensurePeriod(periodYear, 12);
    ids.periods.push(period.id, nextPeriod.id, formulaPeriod.id, confirmationPeriod.id, bonusStatusPeriod.id);
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
        balance: 100000,
        companyProfit: 40000,
        manager: manager.name,
        managerUserId: manager.id,
        status: "Оформлен",
      },
    });
    ids.order = order.id;
    const base = { employeeId: profile.id, periodId: period.id };
    await expectCode(
      () =>
        createAccrual(
          {
            ...base,
            type: PayrollAccrualType.MEASUREMENT_BONUS,
            amount: 1,
            reason: "Manual measurement bonus",
            key: key("manual-measurement-bonus"),
            requestHash: "manual-measurement-bonus",
          },
          directorActor,
        ),
      "MEASUREMENT_BONUS_AUTOMATIC_ONLY",
    );
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
          {
            status: AdvanceRequestStatus.APPROVED,
            key: key("manager-review-advance"),
            requestHash: "manager-review-advance",
          },
          managerActor,
        ),
      "FORBIDDEN",
    );
    await expectCode(
      () =>
        createAccrual(
          {
            ...base,
            type: PayrollAccrualType.PREMIUM,
            amount: 1,
            reason: "Forbidden manager premium",
            key: key("manager-premium"),
            requestHash: "manager-premium",
          },
          managerActor,
        ),
      "FORBIDDEN",
    );
    await expectCode(
      () =>
        requestPaymentConfirmation(
          {
            periodId: formulaPeriod.id,
            amount: 1,
            type: PayrollPaymentType.ORDER_BONUS_PAYMENT,
            claimedPaymentDate: new Date(),
            key: key("manager-bonus-report"),
            requestHash: "manager-bonus-report",
          },
          managerActor,
        ),
      "FORBIDDEN",
    );
    const approved = await reviewAdvance(
      advance.id,
      {
        status: AdvanceRequestStatus.APPROVED,
        key: key("advance-review"),
        requestHash: "advance-review",
      },
      directorActor,
    );
    assert.equal(Number(approved.request.approvedAmount), 70000);
    assert(approved.payment, "advance confirmation did not create payment");
    const replay = await reviewAdvance(
      advance.id,
      {
        status: AdvanceRequestStatus.APPROVED,
        key: key("advance-review-replay"),
        requestHash: "advance-review-replay",
      },
      directorActor,
    );
    assert.equal(replay.payment?.id, approved.payment.id, "payment idempotency");
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
      {
        status: AdvanceRequestStatus.REJECTED,
        comment: "Не согласовано",
        key: key("advance-rejected-review"),
        requestHash: "advance-rejected-review",
      },
      directorActor,
    );
    const summary = await payrollSummary(period.id, directorActor);
    assert.deepEqual(summary.totals, {
      accrued: 270000,
      paid: 90000,
      received: 90000,
      deductions: 0,
      pending: 0,
      payable: 180000,
    });
    assert.deepEqual(summary.breakdown, {
      salaryAccrued: 200000,
      bonusesAccrued: 50000,
      premiumsAccrued: 20000,
      otherAccruals: 0,
      advancesPaid: 70000,
      partialPayments: 20000,
      finalPayments: 0,
      salaryPayments: 20000,
      deductions: 0,
      totalAccrued: 270000,
      totalPaid: 90000,
      payable: 180000,
    });
    assert.equal(summary.settings.paydayDayOfMonth, 1);
    assert(summary.rows[0].bonusAccruals.some((item) => item.id === guaranteed.accrual.id && item.status === "PAID"));
    assert(summary.rows[0].bonusAccruals.some((item) => item.id === orderBonus.accrual.id && item.status === "ACCRUED"));
    await createAccrual({ employeeId: profile.id, periodId: formulaPeriod.id, type: PayrollAccrualType.BASE_SALARY, amount: 200000, reason: "Оклад", key: key("formula-salary"), requestHash: "formula-salary" }, directorActor);
    await createAccrual({ employeeId: profile.id, periodId: formulaPeriod.id, type: PayrollAccrualType.ORDER_BONUS, amount: 120000, orderId: order.id, bonusRule: PayrollBonusRule.FIXED, bonusValue: 120000, reason: "Бонус по заказу №1", key: key("formula-bonus-1"), requestHash: "formula-bonus-1" }, directorActor);
    await createAccrual({ employeeId: profile.id, periodId: formulaPeriod.id, type: PayrollAccrualType.ORDER_BONUS, amount: 80000, orderId: order.id, bonusRule: PayrollBonusRule.FIXED, bonusValue: 80000, reason: "Бонус по заказу №2", key: key("formula-bonus-2"), requestHash: "formula-bonus-2" }, directorActor);
    await createAccrual({ employeeId: profile.id, periodId: formulaPeriod.id, type: PayrollAccrualType.PREMIUM, amount: 50000, reason: "Премия директора", key: key("formula-premium"), requestHash: "formula-premium" }, directorActor);
    const formulaAdvanceOne = await requestAdvance({ periodId: formulaPeriod.id, amount: 20000, method: "cash", comment: "Аванс №1", key: key("formula-advance-1"), requestHash: "formula-advance-1" }, managerActor);
    const pendingFormula = await payrollSummary(formulaPeriod.id, directorActor);
    assert.equal(pendingFormula.totals.received, 0, "pending advance reduced payable");
    assert.equal(pendingFormula.totals.payable, 450000, "pending advance changed formula");
    await reviewAdvance(formulaAdvanceOne.id, { status: AdvanceRequestStatus.APPROVED, key: key("formula-advance-review-1"), requestHash: "formula-advance-review-1" }, accountantActor);
    const formulaAdvanceTwo = await requestAdvance({ periodId: formulaPeriod.id, amount: 20000, method: "bank_transfer", comment: "Аванс №2", key: key("formula-advance-2"), requestHash: "formula-advance-2" }, managerActor);
    await reviewAdvance(formulaAdvanceTwo.id, { status: AdvanceRequestStatus.APPROVED, key: key("formula-advance-review-2"), requestHash: "formula-advance-review-2" }, directorActor);
    let formulaSummary = await payrollSummary(formulaPeriod.id, directorActor);
    assert.deepEqual(formulaSummary.totals, { accrued: 450000, paid: 40000, received: 40000, deductions: 0, pending: 0, payable: 410000 }, "required payroll formula before partial payment");
    assert.equal(formulaSummary.breakdown.salaryAccrued, 200000);
    assert.equal(formulaSummary.breakdown.bonusesAccrued, 200000);
    assert.equal(formulaSummary.breakdown.premiumsAccrued, 50000);
    assert.equal(formulaSummary.breakdown.advancesPaid, 40000);
    assert.equal(formulaSummary.breakdown.salaryPayments, 0, "advance was counted as salary payment");
    await createPayment({ employeeId: profile.id, periodId: formulaPeriod.id, amount: 100000, type: PayrollPaymentType.SALARY_PAYMENT, paymentDate: new Date("2026-10-25"), method: "bank_transfer", comment: "Частичная выплата", key: key("formula-partial-payment"), requestHash: "formula-partial-payment" }, accountantActor);
    formulaSummary = await payrollSummary(formulaPeriod.id, directorActor);
    assert.deepEqual(formulaSummary.totals, { accrued: 450000, paid: 140000, received: 140000, deductions: 0, pending: 0, payable: 310000 }, "required payroll formula after partial payment");
    assert.equal(formulaSummary.breakdown.partialPayments, 100000);
    assert.equal(formulaSummary.breakdown.salaryPayments, 100000);
    await createAccrual({ employeeId: profile.id, periodId: confirmationPeriod.id, type: PayrollAccrualType.BASE_SALARY, amount: 100000, reason: "Оклад", key: key("confirmation-salary"), requestHash: "confirmation-salary" }, directorActor);
    const confirmationPayload = { periodId: confirmationPeriod.id, amount: 30000, type: PayrollPaymentType.SALARY_PAYMENT, claimedPaymentDate: new Date("2026-11-15"), method: "bank_transfer", comment: "Получено" };
    const confirmation = await requestPaymentConfirmation({ ...confirmationPayload, key: key("confirmation-request"), requestHash: createRequestHash(confirmationPayload) }, managerActor);
    let confirmationSummary = await payrollSummary(confirmationPeriod.id, directorActor);
    assert.deepEqual(confirmationSummary.totals, { accrued: 100000, paid: 0, received: 0, deductions: 0, pending: 30000, payable: 100000 }, "pending confirmation must not become paid");
    assert.equal(await prisma.companyLedgerEntry.count({ where: { payrollPayment: { periodId: confirmationPeriod.id } } }), 0, "pending confirmation created cash outflow");
    const confirmationRejected = await requestPaymentConfirmation({ ...confirmationPayload, amount: 10000, key: key("confirmation-reject"), requestHash: "confirmation-reject" }, managerActor);
    await reviewPaymentConfirmation(confirmationRejected.id, { decision: "REJECT", comment: "Не подтверждено", key: key("confirmation-rejected-review"), requestHash: "confirmation-rejected-review" }, directorActor);
    assert.equal(await prisma.payrollPayment.count({ where: { periodId: confirmationPeriod.id } }), 0, "rejected confirmation created payment");
    const confirmed = await reviewPaymentConfirmation(confirmation.id, { decision: "CONFIRM", key: key("accountant-confirm"), requestHash: "accountant-confirm" }, accountantActor);
    const confirmedReplay = await reviewPaymentConfirmation(confirmation.id, { decision: "CONFIRM", key: key("director-confirm-replay"), requestHash: "director-confirm-replay" }, directorActor);
    assert.equal(confirmed.payment?.id, confirmedReplay.payment?.id, "double confirmation duplicated payment");
    assert.equal(await prisma.payrollPayment.count({ where: { periodId: confirmationPeriod.id } }), 1, "confirmation payment count");
    confirmationSummary = await payrollSummary(confirmationPeriod.id, directorActor);
    assert.deepEqual(confirmationSummary.totals, { accrued: 100000, paid: 30000, received: 30000, deductions: 0, pending: 0, payable: 70000 }, "confirmed payment totals");
    const confirmationCash = await prisma.companyLedgerEntry.aggregate({ where: { payrollPayment: { periodId: confirmationPeriod.id }, direction: "EXPENSE" }, _sum: { amount: true } });
    assert.equal(Number(confirmationCash._sum.amount ?? 0), 30000, "confirmed payment cash outflow");
    const confirmationFinance = await getFinanceDashboard({ from: new Date("2026-11-15T00:00:00.000Z"), to: new Date("2026-11-15T23:59:59.999Z") });
    assert.equal(confirmationFinance.operations.filter((item) => item.type === "PAYROLL_PAYMENT").length, 1, "Payroll payment missing from canonical Finance journal");
    assert.equal(confirmationFinance.cards.expenses, 30000, "Finance did not include confirmed Payroll cash outflow");
    await expectCode(
      () => createPayment({ employeeId: profile.id, periodId: confirmationPeriod.id, amount: 1, type: PayrollPaymentType.SALARY_PAYMENT, paymentDate: new Date(), key: key("manager-direct-payment"), requestHash: "manager-direct-payment" }, managerActor),
      "FORBIDDEN",
    );
    const reversal = await reversePayment(confirmed.payment!.id, { reason: "Ошибочная выплата", key: key("payment-reversal"), requestHash: "payment-reversal" }, directorActor);
    const reversalReplay = await reversePayment(confirmed.payment!.id, { reason: "Ошибочная выплата", key: key("payment-reversal"), requestHash: "payment-reversal" }, directorActor);
    assert.equal(reversal.id, reversalReplay.id, "payment reversal idempotency");
    assert.deepEqual((await payrollSummary(confirmationPeriod.id, directorActor)).totals, { accrued: 100000, paid: 0, received: 0, deductions: 0, pending: 0, payable: 100000 }, "reversal totals");
    assert.equal(await prisma.payrollAuditEvent.count({ where: { employeeId: profile.id, action: "PAYROLL_PAYMENT_REVERSED" } }), 1, "payment reversal audit");
    const employeeAuditActions = new Set((await prisma.payrollAuditEvent.findMany({ where: { employeeId: profile.id }, select: { action: true } })).map((event) => event.action));
    for (const action of ["SALARY_CHANGED", "ALLOWANCE_CHANGED", "PREMIUM_ACCRUED", "ADVANCE_CONFIRMED_AND_PAID"])
      assert(employeeAuditActions.has(action), `payroll audit missing: ${action}`);
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
    const payrollAccrualIds = (await prisma.payrollAccrual.findMany({
      where: { employeeId: profile.id },
      select: { id: true },
    })).map((row) => row.id);
    const payrollPaymentIds = (await prisma.payrollPayment.findMany({
      where: { employeeId: profile.id },
      select: { id: true },
    })).map((row) => row.id);
    const ledger = await prisma.companyLedgerEntry.findMany({
      where: {
        OR: [
          { payrollAccrualId: { in: payrollAccrualIds } },
          { payrollPaymentId: { in: payrollPaymentIds } },
        ],
      },
    });
    assert.equal(
      ledger.filter((row) => row.payrollAccrualId !== null).length,
      0,
      "accrual created a Finance ledger operation",
    );
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
      0,
      "payroll accrual was counted as a Finance expense",
    );
    assert.equal(
      ledger
        .filter((row) => !row.affectsProfit)
        .reduce(
          (sum, row) =>
            sum +
            (row.direction === "EXPENSE"
              ? Number(row.amount)
              : -Number(row.amount)),
          0,
        ),
      230000,
      "cash payroll total",
    );
    const paidPercent = await createAccrual(
      {
        employeeId: profile.id,
        periodId: bonusStatusPeriod.id,
        type: PayrollAccrualType.ORDER_BONUS,
        amount: 10,
        orderId: order.id,
        bonusRule: PayrollBonusRule.PAID_PERCENT,
        bonusValue: 10,
        reason: "10% от оплаченной суммы",
        key: key("paid-percent-bonus"),
        requestHash: "paid-percent-bonus",
      },
      directorActor,
    );
    const profitPercent = await createAccrual(
      {
        employeeId: profile.id,
        periodId: bonusStatusPeriod.id,
        type: PayrollAccrualType.ORDER_BONUS,
        amount: 10,
        orderId: order.id,
        bonusRule: PayrollBonusRule.PROFIT_PERCENT,
        bonusValue: 10,
        reason: "10% от реализованной прибыли",
        key: key("profit-percent-bonus"),
        requestHash: "profit-percent-bonus",
      },
      directorActor,
    );
    assert.equal(Number(paidPercent.accrual.amount), 0);
    assert.equal(Number(profitPercent.accrual.amount), 0);
    await prisma.order.update({ where: { id: order.id }, data: { prepayment: 50000, balance: 50000 } });
    let recalculated = await payrollSummary(bonusStatusPeriod.id, directorActor);
    assert.equal(recalculated.rows[0].bonusAccruals.find((item) => item.id === paidPercent.accrual.id)?.amount, 5000, "paid percent bonus did not recalculate");
    assert.equal(recalculated.rows[0].bonusAccruals.find((item) => item.id === profitPercent.accrual.id)?.amount, 2000, "profit percent bonus did not use realized profit");
    await prisma.order.update({ where: { id: order.id }, data: { prepayment: 100000, balance: 0 } });
    recalculated = await payrollSummary(bonusStatusPeriod.id, directorActor);
    assert.equal(recalculated.rows[0].bonusAccruals.find((item) => item.id === paidPercent.accrual.id)?.amount, 10000, "paid percent bonus stayed stale after client payment change");
    assert.equal(recalculated.rows[0].bonusAccruals.find((item) => item.id === profitPercent.accrual.id)?.amount, 4000, "profit percent bonus stayed stale after client payment change");
    const trackedBonus = await createAccrual(
      {
        employeeId: profile.id,
        periodId: bonusStatusPeriod.id,
        type: PayrollAccrualType.ORDER_BONUS,
        amount: 30000,
        orderId: order.id,
        reason: "Tracked order bonus",
        key: key("tracked-order-bonus"),
        requestHash: "tracked-order-bonus",
      },
      directorActor,
    );
    await createPayment(
      {
        employeeId: profile.id,
        periodId: bonusStatusPeriod.id,
        amount: 10000,
        type: PayrollPaymentType.ORDER_BONUS_PAYMENT,
        paymentDate: new Date(),
        relatedAccrualId: trackedBonus.accrual.id,
        key: key("tracked-order-bonus-partial"),
        requestHash: "tracked-order-bonus-partial",
      },
      accountantActor,
    );
    let bonusStatusSummary = await payrollSummary(bonusStatusPeriod.id, directorActor);
    assert.equal(
      bonusStatusSummary.rows[0].bonusAccruals.find(
        (item) => item.id === trackedBonus.accrual.id,
      )?.status,
      "PARTIALLY_PAID",
    );
    await assert.rejects(
      () =>
        createPayment(
          {
            employeeId: profile.id,
            periodId: bonusStatusPeriod.id,
            amount: 20001,
            type: PayrollPaymentType.ORDER_BONUS_PAYMENT,
            paymentDate: new Date(),
            relatedAccrualId: trackedBonus.accrual.id,
            key: key("tracked-order-bonus-overpay"),
            requestHash: "tracked-order-bonus-overpay",
          },
          directorActor,
        ),
      (error) =>
        error instanceof PayrollError &&
        error.message === "PAYMENT_EXCEEDS_ACCRUAL",
    );
    await createPayment(
      {
        employeeId: profile.id,
        periodId: bonusStatusPeriod.id,
        amount: 20000,
        type: PayrollPaymentType.ORDER_BONUS_PAYMENT,
        paymentDate: new Date(),
        relatedAccrualId: trackedBonus.accrual.id,
        key: key("tracked-order-bonus-paid"),
        requestHash: "tracked-order-bonus-paid",
      },
      directorActor,
    );
    bonusStatusSummary = await payrollSummary(bonusStatusPeriod.id, directorActor);
    assert.equal(
      bonusStatusSummary.rows[0].bonusAccruals.find(
        (item) => item.id === trackedBonus.accrual.id,
      )?.status,
      "PAID",
    );
    await transitionPeriod(period.id, PayrollPeriodStatus.REVIEW, "Проверка", key("review"), directorActor);
    await expectCode(
      () => createAccrual({ ...base, type: PayrollAccrualType.EXTRA_BONUS, amount: 1, reason: "Review", key: key("review-locked"), requestHash: "review-locked" }, directorActor),
      "PERIOD_NOT_OPEN",
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
    await expectCode(
      () => transitionPeriod(period.id, PayrollPeriodStatus.OPEN, "Accountant reopen", key("accountant-reopen"), accountantActor),
      "FORBIDDEN",
    );
    await expectCode(
      () => transitionPeriod(period.id, PayrollPeriodStatus.OPEN, "Manager reopen", key("manager-reopen"), managerActor),
      "FORBIDDEN",
    );
    await expectCode(
      () => transitionPeriod(period.id, PayrollPeriodStatus.OPEN, "", key("empty-reason"), directorActor),
      "REASON_REQUIRED",
    );
    await transitionPeriod(period.id, PayrollPeriodStatus.OPEN, "Исправление начисления сотрудника", key("reopen"), directorActor);
    await createAccrual(
      { ...base, type: PayrollAccrualType.EXTRA_BONUS, amount: 1, reason: "После открытия", key: key("after-reopen"), requestHash: "after-reopen" },
      directorActor,
    );
    const periodAudit = await prisma.payrollAuditEvent.findMany({ where: { periodId: period.id } });
    assert(periodAudit.some((event) => event.action === "PERIOD_CLOSED"));
    assert(periodAudit.some((event) => event.action === "PERIOD_REOPENED" && event.reason === "Исправление начисления сотрудника"));
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
    assert.equal(next.totals.accrued, 10000, "gross accrual lost late bonus");
    assert.equal(next.totals.deductions, 30000, "reversal was not separated from accruals");
    assert.equal(next.totals.payable, -20000, "late bonus and reversal formula");
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
      "disabling ORDA login removed the employee from payroll",
    );
    await prisma.employeePayrollProfile.update({ where: { id: profile.id }, data: { active: false } });
    assert.equal(
      (await payrollSummary(period.id, directorActor, profile.id)).rows.length,
      0,
      "inactive employee leaked into payroll dashboard",
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
      await prisma.payrollPaymentConfirmation.deleteMany({
        where: { employeeId: { in: employeeIds } },
      });
      await prisma.payrollAuditEvent.deleteMany({
        where: { OR: [{ employeeId: { in: employeeIds } }, { actorId: { in: ids.users } }] },
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
      await prisma.payrollPeriod.deleteMany({ where: { id: { in: ids.periods }, accruals: { none: {} }, payments: { none: {} } } });
      await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    }
    await prisma.$disconnect();
  }
}
void main();
