import "./require-test-database";

import assert from "node:assert/strict";
import {
  AdvanceRequestStatus,
  BonusPaymentMode,
  OrderLifecycle,
  OrderResponsibleType,
  PayrollAccrualType,
  PayrollPaymentType,
  PayrollPeriodStatus,
  Role,
} from "@prisma/client";
import { createRequestHash } from "../lib/idempotency";
import { companyYearMonth } from "../lib/company-calendar";
import { prisma } from "../lib/prisma";
import { getFinanceDashboard } from "../lib/services/payment.service";
import { runWithTenant } from "../lib/tenant-context";
import {
  changeAllowance,
  changeSalary,
  closePeriod,
  confirmPayrollCalculation,
  correctPayrollAccrual,
  accrueCompletedTerminatedManagerOrderBonus,
  createAccrual,
  createSelfAccrual,
  createPayment,
  ensurePeriod,
  payAdvance,
  payrollSummary,
  PayrollError,
  requestAdvance,
  requestPaymentConfirmation,
  reviewAdvance,
  reviewPaymentConfirmation,
  reverseAccrual,
  reversePayment,
  saveOrderBonusDecision,
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
  const ids: { users: number[]; periods: number[]; client?: number; orders: number[] } = {
    users: [],
    periods: [],
    orders: [],
  };
  try {
    const [director, manager, accountant, partner, founder] = await Promise.all([
      prisma.user.create({
        data: {
          name: `${tag}-director`,
          email: `${tag}-director@test.local`,
          password: "test",
          role: Role.OPERATIONS_DIRECTOR,
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
      prisma.user.create({
        data: {
          name: `${tag}-founder`,
          email: `${tag}-founder@test.local`,
          password: "test",
          role: Role.DIRECTOR,
        },
      }),
    ]);
    ids.users.push(director.id, manager.id, accountant.id, partner.id, founder.id);
    const directorActor = {
      userId: director.id,
      role: Role.OPERATIONS_DIRECTOR,
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
    const founderActor = {
      userId: founder.id,
      role: Role.DIRECTOR,
      name: founder.name,
    };
    // Calculation confirmation is allowed only for a started company month.
    // The mutation test runs in an isolated database, so a stable past year is
    // both realistic and collision-free after the test cleanup.
    const periodYear = companyYearMonth().year - 2;
    const periodDate = (month: number, day = 1) =>
      new Date(Date.UTC(periodYear, month - 1, day, 12));
    const profile = await upsertPayrollProfile(
      {
        userId: manager.id,
        hiredAt: periodDate(8),
        baseSalary: 200000,
        defaultGuaranteedBonus: 20000,
      },
      directorActor,
    );
    assert.equal(Number(profile.baseSalary), 200000);
    assert.equal(Number(profile.defaultGuaranteedBonus), 20000);
    const salaryHistoryUser = await prisma.user.create({
      data: {
        name: `${tag}-salary-history`,
        email: `${tag}-salary-history@test.local`,
        password: "test",
        role: Role.MARKETER,
      },
    });
    ids.users.push(salaryHistoryUser.id);
    const salaryHistoryProfile = await upsertPayrollProfile(
      {
        userId: salaryHistoryUser.id,
        hiredAt: periodDate(1),
        baseSalary: 200000,
        defaultGuaranteedBonus: 0,
      },
      directorActor,
    );
    await expectCode(
      () =>
        changeSalary(
          salaryHistoryProfile.id,
          205000,
          periodDate(5),
          "",
          directorActor,
        ),
      "REASON_REQUIRED",
    );
    await changeSalary(salaryHistoryProfile.id, 210000, periodDate(6), "Индексация", directorActor);
    await changeSalary(salaryHistoryProfile.id, 200000, periodDate(7), "Тестовая ставка", directorActor);
    const correctedRate = await changeSalary(
      salaryHistoryProfile.id,
      200000,
      periodDate(6, 15),
      "Исправление даты ставки",
      directorActor,
    );
    assert.equal(
      correctedRate.effectiveFrom.toISOString(),
      periodDate(6, 15).toISOString(),
      "same-amount salary rate can be safely backdated without adding history",
    );
    await changeSalary(
      salaryHistoryProfile.id,
      200000,
      periodDate(7),
      "Повтор ставки для проверки",
      directorActor,
    );
    const normalizedRate = await changeSalary(
      salaryHistoryProfile.id,
      200000,
      periodDate(6, 10),
      "Исправление даты повторной ставки",
      directorActor,
    );
    assert.equal(
      normalizedRate.effectiveFrom.toISOString().slice(0, 10),
      `${periodYear}-06-10`,
      "duplicate same-amount rates are normalized when their start date is corrected",
    );
    await changeAllowance(profile.id, 20000, "Гарантированный бонус", directorActor);
    assert.equal((await prisma.employeeSalaryRate.count({ where: { employeeId: salaryHistoryProfile.id } })), 4, "salary history preserved");
    await prisma.employeePayrollProfile.update({
      where: { id: salaryHistoryProfile.id },
      data: { payrollEnabled: false, active: false },
    });
    const salaryReplayUser = await prisma.user.create({
      data: {
        name: `${tag}-salary-replay`,
        email: `${tag}-salary-replay@test.local`,
        password: "test",
        role: Role.MARKETER,
      },
    });
    ids.users.push(salaryReplayUser.id);
    const salaryReplayProfile = await upsertPayrollProfile(
      {
        userId: salaryReplayUser.id,
        hiredAt: periodDate(1),
        baseSalary: 100000,
        defaultGuaranteedBonus: 0,
      },
      directorActor,
    );
    const salaryReplayIdempotency = {
      key: key("salary-concurrent-replay"),
      requestHash: "salary-concurrent-replay",
    };
    const [parallelSalaryLeft, parallelSalaryRight] = await Promise.all([
      changeSalary(
        salaryReplayProfile.id,
        120000,
        periodDate(7),
        "Параллельная идемпотентная ставка",
        directorActor,
        salaryReplayIdempotency,
      ),
      changeSalary(
        salaryReplayProfile.id,
        120000,
        periodDate(7),
        "Параллельная идемпотентная ставка",
        directorActor,
        salaryReplayIdempotency,
      ),
    ]);
    assert.equal(parallelSalaryLeft.id, parallelSalaryRight.id);
    const replayedSalary = await changeSalary(
      salaryReplayProfile.id,
      120000,
      periodDate(7),
      "Параллельная идемпотентная ставка",
      directorActor,
      salaryReplayIdempotency,
    );
    assert.equal(replayedSalary.id, parallelSalaryLeft.id);
    assert.equal(
      await prisma.employeeSalaryRate.count({
        where: { employeeId: salaryReplayProfile.id, effectiveTo: null },
      }),
      1,
      "parallel salary replay left more than one open-ended rate",
    );
    assert.equal(
      await prisma.employeeSalaryRate.count({
        where: { employeeId: salaryReplayProfile.id },
      }),
      2,
      "parallel salary replay created duplicate rates",
    );
    await prisma.employeePayrollProfile.update({
      where: { id: salaryReplayProfile.id },
      data: { payrollEnabled: false, active: false },
    });
    const profileReplayInput = {
      userId: manager.id,
      hiredAt: periodDate(8),
      baseSalary: 200000,
      defaultGuaranteedBonus: 30000,
    };
    const profileReplayIdempotency = {
      key: key("profile-replay"),
      requestHash: createRequestHash({
        action: "profile",
        ...profileReplayInput,
      }),
    };
    const configuredProfile = await upsertPayrollProfile(
      profileReplayInput,
      directorActor,
      profileReplayIdempotency,
    );
    const replayedProfile = await upsertPayrollProfile(
      profileReplayInput,
      directorActor,
      profileReplayIdempotency,
    );
    assert.equal(replayedProfile.id, configuredProfile.id);
    assert.deepEqual(
      replayedProfile.salaryRates.map((rate) => rate.id),
      configuredProfile.salaryRates.map((rate) => rate.id),
      "profile replay returned a different logical result",
    );
    assert.equal(
      await prisma.payrollAuditEvent.count({
        where: { idempotencyKey: profileReplayIdempotency.key },
      }),
      1,
      "profile replay created a duplicate audit event",
    );
    await expectCode(
      () =>
        upsertPayrollProfile(
          { ...profileReplayInput, defaultGuaranteedBonus: 40000 },
          directorActor,
          {
            key: profileReplayIdempotency.key,
            requestHash: createRequestHash({
              action: "profile",
              ...profileReplayInput,
              defaultGuaranteedBonus: 40000,
            }),
          },
        ),
      "IDEMPOTENCY_CONFLICT",
    );
    const changed = await prisma.employeePayrollProfile.findUniqueOrThrow({
      where: { id: profile.id },
    });
    assert.equal(
      Number(changed.defaultGuaranteedBonus),
      30000,
      "director guaranteed bonus change",
    );
    const allowanceReplayIdempotency = {
      key: key("allowance-replay"),
      requestHash: createRequestHash({
        action: "allowance",
        employeeId: profile.id,
        amount: 20000,
        comment: "Возврат гарантированного бонуса",
      }),
    };
    const changedAllowance = await changeAllowance(
      profile.id,
      20000,
      "Возврат гарантированного бонуса",
      directorActor,
      allowanceReplayIdempotency,
    );
    const replayedAllowance = await changeAllowance(
      profile.id,
      20000,
      "Возврат гарантированного бонуса",
      directorActor,
      allowanceReplayIdempotency,
    );
    assert.equal(replayedAllowance.id, changedAllowance.id);
    assert.equal(Number(replayedAllowance.defaultGuaranteedBonus), 20000);
    assert.equal(
      await prisma.payrollAuditEvent.count({
        where: { idempotencyKey: allowanceReplayIdempotency.key },
      }),
      1,
      "allowance replay created a duplicate audit event",
    );
    await expectCode(
      () =>
        changeAllowance(
          profile.id,
          25000,
          "Конфликтующее изменение гарантированного бонуса",
          directorActor,
          {
            key: allowanceReplayIdempotency.key,
            requestHash: createRequestHash({
              action: "allowance",
              employeeId: profile.id,
              amount: 25000,
              comment: "Конфликтующее изменение гарантированного бонуса",
            }),
          },
        ),
      "IDEMPOTENCY_CONFLICT",
    );
    assert.equal(
      Number(
        (
          await prisma.employeePayrollProfile.findUniqueOrThrow({
            where: { id: profile.id },
          })
        ).defaultGuaranteedBonus,
      ),
      20000,
      "conflicting allowance replay mutated the profile",
    );
    await changeAllowance(
      profile.id,
      22000,
      "Последующее изменение гарантированного бонуса",
      directorActor,
      {
        key: key("allowance-later-change"),
        requestHash: createRequestHash({
          action: "allowance",
          employeeId: profile.id,
          amount: 22000,
          comment: "Последующее изменение гарантированного бонуса",
        }),
      },
    );
    const historicalAllowanceReplay = await changeAllowance(
      profile.id,
      20000,
      "Возврат гарантированного бонуса",
      directorActor,
      allowanceReplayIdempotency,
    );
    assert.equal(
      Number(historicalAllowanceReplay.defaultGuaranteedBonus),
      20000,
      "allowance replay did not return its original logical result",
    );
    const historicalProfileReplay = await upsertPayrollProfile(
      profileReplayInput,
      directorActor,
      profileReplayIdempotency,
    );
    assert.equal(
      Number(historicalProfileReplay.defaultGuaranteedBonus),
      30000,
      "profile replay did not return its original logical result",
    );
    assert.equal(
      Number(
        (
          await prisma.employeePayrollProfile.findUniqueOrThrow({
            where: { id: profile.id },
          })
        ).defaultGuaranteedBonus,
      ),
      22000,
      "historical replay reapplied an old profile mutation",
    );
    assert.equal(
      await prisma.payrollAuditEvent.count({
        where: {
          idempotencyKey: {
            in: [
              profileReplayIdempotency.key,
              allowanceReplayIdempotency.key,
            ],
          },
        },
      }),
      2,
      "historical replay duplicated an idempotent audit event",
    );
    await changeAllowance(
      profile.id,
      20000,
      "Восстановление тестового гарантированного бонуса",
      directorActor,
      {
        key: key("allowance-restore"),
        requestHash: createRequestHash({
          action: "allowance",
          employeeId: profile.id,
          amount: 20000,
          comment: "Восстановление тестового гарантированного бонуса",
        }),
      },
    );
    const period = await ensurePeriod(periodYear, 8);
    const nextPeriod = await ensurePeriod(periodYear, 9);
    const formulaPeriod = await ensurePeriod(periodYear, 10);
    const confirmationPeriod = await ensurePeriod(periodYear, 11);
    const bonusStatusPeriod = await ensurePeriod(periodYear, 12);
    const correctionPeriod = await ensurePeriod(periodYear + 1, 1);
    ids.periods.push(period.id, nextPeriod.id, formulaPeriod.id, confirmationPeriod.id, bonusStatusPeriod.id, correctionPeriod.id);
    const foreignProfile = await upsertPayrollProfile(
      {
        userId: director.id,
        hiredAt: new Date(Date.UTC(periodYear, 0, 1, 12)),
        baseSalary: 0,
        defaultGuaranteedBonus: 0,
      },
      founderActor,
    );
    const founderBonus = await createAccrual(
      {
        employeeId: profile.id,
        periodId: correctionPeriod.id,
        type: PayrollAccrualType.EXTRA_BONUS,
        amount: 10_000,
        reason: "Founder correction access",
        key: key("founder-extra-bonus"),
        requestHash: "founder-extra-bonus",
      },
      founderActor,
    );
    const correctedFounderBonus = await correctPayrollAccrual(
      {
        accrualId: founderBonus.accrual.id,
        amount: 15_000,
        reason: "Исправление суммы учредителем",
        key: key("founder-extra-bonus-correction"),
        requestHash: "founder-extra-bonus-correction",
      },
      founderActor,
    );
    assert.equal(Number(correctedFounderBonus.replacement?.amount), 15_000);
    assert.equal(
      (await payrollSummary(correctionPeriod.id, founderActor)).rows.find(
        (row) => row.id === profile.id,
      )?.calculation.bonuses,
      15_000,
      "founder can correct any employee accrual",
    );
    await reverseAccrual(
      correctedFounderBonus.replacement!.id,
      correctionPeriod.id,
      "Проверка сторно учредителем",
      key("founder-extra-bonus-reversal"),
      "founder-extra-bonus-reversal",
      founderActor,
    );
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
    const foreignOrder = await prisma.order.create({
      data: {
        number: `PAY-FOREIGN-${Date.now()}`,
        clientId: client.id,
        address: "Test",
        staircase: "Test",
        material: "Test",
        amount: 100000,
        manager: director.name,
        responsibleType: OrderResponsibleType.EMPLOYEE,
        managerUserId: director.id,
        status: "Оформлен",
        orderReceivedAt: new Date(Date.UTC(periodYear + 1, 0, 15, 12)),
      },
    });
    ids.orders.push(foreignOrder.id);
    await expectCode(
      () =>
        saveOrderBonusDecision(
          {
            year: periodYear + 1,
            month: 1,
            orderId: foreignOrder.id,
            employeeId: foreignProfile.id,
            manualBonus: 25000,
            reason: "Менеджер не может менять чужой бонус",
            key: key("foreign-manager-bonus"),
            requestHash: "foreign-manager-bonus",
          },
          managerActor,
        ),
      "FORBIDDEN",
    );
    const founderForeignDecision = await saveOrderBonusDecision(
      {
        year: periodYear + 1,
        month: 1,
        orderId: foreignOrder.id,
        employeeId: foreignProfile.id,
        manualBonus: 25000,
        reason: "Учредитель меняет бонус доступного сотрудника",
        key: key("founder-foreign-bonus"),
        requestHash: "founder-foreign-bonus",
      },
      founderActor,
    );
    assert.equal(founderForeignDecision.effectiveBonus, 25000);
    const order = await prisma.order.create({
      data: {
        number: `PAY-${Date.now()}`,
        clientId: client.id,
        address: "Test",
        staircase: "Test",
        material: "Test",
        amount: 100000,
        manager: manager.name,
        responsibleType: OrderResponsibleType.EMPLOYEE,
        managerUserId: manager.id,
        status: "Оформлен",
        orderReceivedAt: new Date(Date.UTC(periodYear, 7, 15, 12)),
      },
    });
    ids.orders.push(order.id);
    await expectCode(
      () =>
        saveOrderBonusDecision(
          {
            year: periodYear,
            month: 8,
            orderId: order.id,
            employeeId: profile.id,
            manualBonus: 30000,
            reason: "Бухгалтер не меняет бонус",
            key: key("accountant-order-bonus"),
            requestHash: "accountant-order-bonus",
          },
          accountantActor,
        ),
      "FORBIDDEN",
    );
    const base = { employeeId: profile.id, periodId: period.id };
    const beforeManualSalaryAccrual = await payrollSummary(
      period.id,
      directorActor,
    );
    const beforeManualSalaryRow = beforeManualSalaryAccrual.rows.find(
      (row) => row.id === profile.id,
    );
    assert(beforeManualSalaryRow, "manager payroll preview row is missing");
    assert.equal(
      beforeManualSalaryRow.totals.accrued,
      0,
      "configured salary must remain a preview until the founder accrues it",
    );
    assert.equal(beforeManualSalaryRow.currentSalary, 200000);
    assert.equal(
      beforeManualSalaryRow.calculation.bonuses,
      0,
      "an unsaved system suggestion must not participate in entitlement",
    );
    assert.equal(beforeManualSalaryRow.calculation.incomplete, true);
    assert.equal(beforeManualSalaryRow.calculation.missingBonusCount, 1);
    assert.equal(beforeManualSalaryRow.orderBonuses[0]?.systemSuggestion, 30000);
    assert.equal(beforeManualSalaryRow.orderBonuses[0]?.manualBonus, null);
    assert.equal(
      beforeManualSalaryRow.totals.payable,
      200000,
      "salary condition affects payable while an unsaved suggestion does not",
    );
    const companyOrder = await prisma.order.create({
      data: {
        number: `PAY-COMPANY-${Date.now()}`,
        clientId: client.id,
        address: "Test",
        staircase: "Test",
        material: "Test",
        amount: 100000,
        manager: "Компания",
        responsibleType: OrderResponsibleType.COMPANY,
        managerUserId: null,
        status: "Оформлен",
        orderReceivedAt: new Date(Date.UTC(periodYear, 7, 16, 12)),
      },
    });
    ids.orders.push(companyOrder.id);
    await expectCode(
      () =>
        saveOrderBonusDecision(
          {
            year: periodYear,
            month: 8,
            orderId: companyOrder.id,
            employeeId: profile.id,
            manualBonus: 30000,
            reason: "Заказ компании не относится к зарплате сотрудника",
            key: key("company-order-bonus"),
            requestHash: "company-order-bonus",
          },
          managerActor,
        ),
      "ORDER_OUTSIDE_PERIOD",
    );
    await expectCode(
      () =>
        createSelfAccrual(
          {
            periodId: period.id,
            type: PayrollAccrualType.ORDER_BONUS,
            amount: 30000,
            orderId: order.id,
            reason: "Старый путь начисления бонуса",
            key: key("self-order-bonus-rejected"),
            requestHash: "self-order-bonus-rejected",
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
    await expectCode(
      () =>
        createAccrual(
          {
            ...base,
            type: PayrollAccrualType.BASE_SALARY,
            amount: 200000,
            reason: "Старый путь начисления оклада",
            key: key("salary-accrual-rejected"),
            requestHash: "salary-accrual-rejected",
          },
          directorActor,
        ),
      "USE_CONFIRM_CALCULATION",
    );
    await expectCode(
      () =>
        createAccrual(
          {
            ...base,
            type: PayrollAccrualType.GUARANTEED_ORDER_BONUS,
            amount: 20000,
            orderId: order.id,
            reason: "Старое гарантированное начисление за заказ",
            paymentMode: BonusPaymentMode.IMMEDIATE,
            key: key("guaranteed-order-bonus-rejected"),
            requestHash: "guaranteed-order-bonus-rejected",
          },
          directorActor,
        ),
      "ORDER_BONUS_DECISION_REQUIRED",
    );
    await expectCode(
      () =>
        createAccrual(
          {
            ...base,
            type: PayrollAccrualType.ORDER_BONUS,
            amount: 30000,
            orderId: order.id,
            reason: "Старое начисление бонуса за заказ",
            key: key("order-bonus-rejected"),
            requestHash: "order-bonus-rejected",
          },
          directorActor,
        ),
      "ORDER_BONUS_DECISION_REQUIRED",
    );
    const immediateExtraBonus = await createAccrual(
      {
        ...base,
        type: PayrollAccrualType.EXTRA_BONUS,
        amount: 20000,
        reason: "Разовая премия с немедленной выплатой",
        paymentMode: BonusPaymentMode.IMMEDIATE,
        key: key("immediate-extra-bonus"),
        requestHash: "immediate-extra-bonus",
      },
      directorActor,
    );
    assert(immediateExtraBonus.payment, "immediate bonus payment missing");
    const orderBonusDecision = await saveOrderBonusDecision(
      {
        year: periodYear,
        month: 8,
        orderId: order.id,
        employeeId: profile.id,
        manualBonus: 30000,
        reason: "Подтверждение бонуса за заказ",
        key: key("order-bonus-decision"),
        requestHash: "order-bonus-decision",
      },
      directorActor,
    );
    assert.equal(orderBonusDecision.effectiveBonus, 30000);
    const orderBonusReplay = await saveOrderBonusDecision(
      {
        year: periodYear,
        month: 8,
        orderId: order.id,
        employeeId: profile.id,
        manualBonus: 30000,
        reason: "Повтор того же решения",
        key: key("order-bonus-decision"),
        requestHash: "order-bonus-decision",
      },
      directorActor,
    );
    assert.equal(orderBonusReplay.replay, true, "order bonus decision replay");
    await expectCode(
      () =>
        saveOrderBonusDecision(
          {
            year: periodYear,
            month: 8,
            orderId: order.id,
            employeeId: profile.id,
            manualBonus: 50000,
            reason: "Конфликт повторного запроса",
            key: key("order-bonus-decision"),
            requestHash: "order-bonus-decision-conflict",
          },
          directorActor,
        ),
      "IDEMPOTENCY_CONFLICT",
    );
    assert.equal(
      await prisma.payrollOrderBonusDecision.count({
        where: { orderId: order.id, employeeId: profile.id },
      }),
      1,
      "repeated order bonus save created a duplicate decision",
    );
    assert.equal(
      await prisma.payrollAccrual.count({
        where: {
          employeeId: profile.id,
          type: {
            in: [
              PayrollAccrualType.ORDER_BONUS,
              PayrollAccrualType.GUARANTEED_ORDER_BONUS,
            ],
          },
        },
      }),
      0,
      "order bonus decision must not create an accounting accrual",
    );
    const premiumAccrual = await createAccrual(
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
            key: key("advance-review-manager"),
            requestHash: "advance-review-manager",
          },
          managerActor,
        ),
      "FORBIDDEN",
    );
    const approved = await reviewAdvance(
      advance.id,
      {
        status: AdvanceRequestStatus.APPROVED,
        approvedAmount: 70000,
        key: key("advance-review-approved"),
        requestHash: "advance-review-approved",
      },
      directorActor,
    );
    assert.equal(Number(approved.approvedAmount), 70000);
    const approvedReplay = await reviewAdvance(
      advance.id,
      {
        status: AdvanceRequestStatus.APPROVED,
        approvedAmount: 70000,
        key: key("advance-review-approved"),
        requestHash: "advance-review-approved",
      },
      directorActor,
    );
    assert.equal(approvedReplay.id, approved.id, "advance review idempotency");
    const advancePayment = await payAdvance(
      advance.id,
      { key: key("advance-payment"), requestHash: "advance-payment" },
      directorActor,
    );
    const replay = await payAdvance(
      advance.id,
      { key: key("advance-payment"), requestHash: "advance-payment" },
      directorActor,
    );
    assert.equal(replay.id, advancePayment.id, "payment idempotency");
    await expectCode(
      () =>
        reviewAdvance(
          advance.id,
          {
            status: AdvanceRequestStatus.REJECTED,
            comment: "Запоздалое решение",
            key: key("advance-review-after-payment"),
            requestHash: "advance-review-after-payment",
          },
          directorActor,
        ),
      "CONFLICT",
    );
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
        key: key("advance-review-rejected"),
        requestHash: "advance-review-rejected",
      },
      directorActor,
    );
    const periodPreview = await payrollSummary(period.id, directorActor);
    const periodPreviewRow = periodPreview.rows.find(
      (row) => row.id === profile.id,
    );
    assert(periodPreviewRow, "payroll preview row is missing before confirmation");
    const confirmedPeriodCalculation = await confirmPayrollCalculation(
      {
        employeeId: profile.id,
        periodId: period.id,
        reason: "Подтверждение полного расчёта августа",
        key: key("period-calculation-confirmation"),
        requestHash: "period-calculation-confirmation",
        expectedCalculationHash: periodPreviewRow.calculation.calculationHash,
      },
      directorActor,
    );
    assert.equal(Number(confirmedPeriodCalculation.snapshot.preparedAmount), 270000);
    const summary = await payrollSummary(period.id, directorActor);
    assert.deepEqual(summary.totals, {
      prepared: 270000,
      accrued: 270000,
      paid: 90000,
      pending: 0,
      payable: 180000,
      remaining: 180000,
      priorDebt: 0,
    });
    assert.deepEqual(summary.breakdown, {
      salaryPrepared: 200000,
      orderBonusesPrepared: 30000,
      otherBonusesPrepared: 20000,
      premiumsPrepared: 20000,
      deductionsPrepared: 0,
      prepared: 270000,
      salaryAccrued: 200000,
      bonusesAccrued: 50000,
      premiumsAccrued: 20000,
      advancesPaid: 70000,
      totalAccrued: 270000,
      totalPaid: 90000,
      payable: 180000,
      priorDebt: 0,
    });
    assert.equal(summary.settings.paydayDayOfMonth, 1);
    const managerSummary = summary.rows.find((row) => row.id === profile.id);
    assert(managerSummary, "manager payroll summary row is missing");
    assert(
      managerSummary.bonusAccruals.some(
        (item) =>
          item.id === immediateExtraBonus.accrual.id &&
          item.status === "PAID",
      ),
    );
    assert.equal(
      managerSummary.orderBonuses.find((item) => item.orderId === order.id)
        ?.manualBonus,
      30000,
    );
    assert.equal(
      managerSummary.orderBonuses.find((item) => item.orderId === order.id)
        ?.effectiveBonus,
      30000,
    );
    assert.equal(
      managerSummary.orderBonuses.some(
        (item) => item.orderId === companyOrder.id,
      ),
      false,
      "company order leaked into employee payroll",
    );
    await createAccrual({ employeeId: profile.id, periodId: formulaPeriod.id, type: PayrollAccrualType.PREMIUM, amount: 30000, reason: "Премия", key: key("formula-premium"), requestHash: "formula-premium" }, directorActor);
    const formulaAdvance = await requestAdvance({ periodId: formulaPeriod.id, amount: 50000, comment: "Аванс", key: key("formula-advance"), requestHash: "formula-advance" }, managerActor);
    await reviewAdvance(formulaAdvance.id, {
      status: AdvanceRequestStatus.APPROVED,
      approvedAmount: 50000,
      comment: "Одобрено",
      key: key("formula-advance-review"),
      requestHash: "formula-advance-review",
    }, directorActor);
    const formulaAdvancePayment = await payAdvance(
      formulaAdvance.id,
      {
        key: key("formula-advance-payment"),
        requestHash: "formula-advance-payment",
      },
      directorActor,
    );
    const formulaPreview = await payrollSummary(formulaPeriod.id, directorActor);
    const formulaPreviewRow = formulaPreview.rows.find((row) => row.id === profile.id);
    assert(formulaPreviewRow, "formula payroll preview row is missing");
    await confirmPayrollCalculation(
      {
        employeeId: profile.id,
        periodId: formulaPeriod.id,
        reason: "Подтверждение расчёта с премией",
        key: key("formula-calculation-confirmation"),
        requestHash: "formula-calculation-confirmation",
        expectedCalculationHash: formulaPreviewRow.calculation.calculationHash,
      },
      directorActor,
    );
    assert.deepEqual((await payrollSummary(formulaPeriod.id, directorActor)).totals, { prepared: 230000, accrued: 230000, paid: 50000, pending: 0, payable: 180000, remaining: 180000, priorDebt: 380000 }, "confirmed snapshot is salary 200k + premium 30k; advance 50k only reduces the remaining amount");
    await expectCode(
      () => payAdvance(formulaAdvance.id, { key: key("accountant-advance-payment"), requestHash: "accountant-advance-payment" }, accountantActor),
      "FORBIDDEN",
    );
    const confirmationPreview = await payrollSummary(confirmationPeriod.id, directorActor);
    const confirmationPreviewRow = confirmationPreview.rows.find((row) => row.id === profile.id);
    assert(confirmationPreviewRow, "payment confirmation payroll preview row is missing");
    await confirmPayrollCalculation(
      {
        employeeId: profile.id,
        periodId: confirmationPeriod.id,
        reason: "Подтверждение расчёта перед выплатами",
        key: key("payment-period-calculation-confirmation"),
        requestHash: "payment-period-calculation-confirmation",
        expectedCalculationHash: confirmationPreviewRow.calculation.calculationHash,
      },
      directorActor,
    );
    const confirmationPayload = { periodId: confirmationPeriod.id, amount: 30000, type: PayrollPaymentType.SALARY_PAYMENT, claimedPaymentDate: periodDate(11, 15), method: "kaspi", comment: "Получено" };
    const confirmation = await requestPaymentConfirmation({ ...confirmationPayload, key: key("confirmation-request"), requestHash: createRequestHash(confirmationPayload) }, managerActor);
    let confirmationSummary = await payrollSummary(confirmationPeriod.id, directorActor);
    assert.deepEqual(confirmationSummary.totals, { prepared: 200000, accrued: 200000, paid: 0, pending: 30000, payable: 200000, remaining: 200000, priorDebt: 560000 }, "pending confirmation must not become paid");
    assert.equal(await prisma.companyLedgerEntry.count({ where: { payrollPayment: { periodId: confirmationPeriod.id } } }), 0, "pending confirmation created cash outflow");
    const confirmationRejected = await requestPaymentConfirmation({ ...confirmationPayload, amount: 10000, key: key("confirmation-reject"), requestHash: "confirmation-reject" }, managerActor);
    await reviewPaymentConfirmation(confirmationRejected.id, { decision: "REJECT", comment: "Не подтверждено", key: key("confirmation-rejected-review"), requestHash: "confirmation-rejected-review" }, directorActor);
    assert.equal(await prisma.payrollPayment.count({ where: { periodId: confirmationPeriod.id } }), 0, "rejected confirmation created payment");
    const foreignCompany = await prisma.company.create({
      data: {
        slug: `${tag}-foreign`,
        name: `${tag} Foreign company`,
      },
    });
    const foreignTenant = {
      companyId: foreignCompany.id,
      companySlug: foreignCompany.slug,
      companyName: foreignCompany.name,
      isDemo: false,
    };
    let foreignConfirmationId = 0;
    let foreignProfileId = 0;
    let foreignPeriodId = 0;
    let foreignUserIds: number[] = [];
    await runWithTenant(foreignTenant, async () => {
      const [foreignDirector, foreignManager] = await Promise.all([
        prisma.user.create({
          data: {
            name: `${tag}-foreign-director`,
            email: `${tag}-foreign-director@test.local`,
            password: "test",
            role: Role.DIRECTOR,
          },
        }),
        prisma.user.create({
          data: {
            name: `${tag}-foreign-manager`,
            email: `${tag}-foreign-manager@test.local`,
            password: "test",
            role: Role.MANAGER,
          },
        }),
      ]);
      foreignUserIds = [foreignDirector.id, foreignManager.id];
      const foreignProfile = await prisma.employeePayrollProfile.create({
        data: {
          userId: foreignManager.id,
          name: foreignManager.name,
          position: Role.MANAGER,
          hiredAt: new Date(Date.UTC(periodYear, 0, 1)),
          baseSalary: 100000,
          salaryPlanEnabled: true,
        },
      });
      foreignProfileId = foreignProfile.id;
      const foreignPeriod = await prisma.payrollPeriod.create({
        data: { year: periodYear, month: 11 },
      });
      foreignPeriodId = foreignPeriod.id;
      const foreignConfirmation = await prisma.payrollPaymentConfirmation.create({
        data: {
          employeeId: foreignProfile.id,
          periodId: foreignPeriod.id,
          amount: 10000,
          type: PayrollPaymentType.SALARY_PAYMENT,
          claimedPaymentDate: new Date(Date.UTC(periodYear, 10, 15)),
          createdById: foreignManager.id,
          idempotencyKey: `${tag}:foreign-confirmation`,
          requestHash: `${tag}:foreign-confirmation`,
        },
      });
      foreignConfirmationId = foreignConfirmation.id;
      assert.notEqual(foreignDirector.id, directorActor.userId);
    });
    await expectCode(
      () =>
        reviewPaymentConfirmation(
          foreignConfirmationId,
          {
            decision: "CONFIRM",
            key: key("foreign-confirmation-review"),
            requestHash: "foreign-confirmation-review",
          },
          directorActor,
        ),
      "CONFIRMATION_NOT_FOUND",
    );
    await runWithTenant(foreignTenant, async () => {
      const untouched = await prisma.payrollPaymentConfirmation.findUniqueOrThrow({
        where: { id: foreignConfirmationId },
        select: { status: true, confirmedPaymentId: true },
      });
      assert.deepEqual(untouched, {
        status: "PENDING",
        confirmedPaymentId: null,
      });
      assert.equal(
        await prisma.payrollPayment.count({
          where: { employeeId: foreignProfileId },
        }),
        0,
      );
      await prisma.payrollPaymentConfirmation.delete({
        where: { id: foreignConfirmationId },
      });
      await prisma.employeePayrollProfile.delete({
        where: { id: foreignProfileId },
      });
      await prisma.payrollPeriod.delete({ where: { id: foreignPeriodId } });
      await prisma.user.deleteMany({ where: { id: { in: foreignUserIds } } });
    });
    await prisma.company.delete({ where: { id: foreignCompany.id } });
    await expectCode(
      () => reviewPaymentConfirmation(confirmation.id, { decision: "CONFIRM", key: key("accountant-confirm"), requestHash: "accountant-confirm" }, accountantActor),
      "FORBIDDEN",
    );
    const confirmationReview = {
      decision: "CONFIRM" as const,
      key: key("director-confirm"),
      requestHash: "director-confirm",
    };
    const confirmed = await reviewPaymentConfirmation(
      confirmation.id,
      confirmationReview,
      directorActor,
    );
    const confirmedReplay = await reviewPaymentConfirmation(
      confirmation.id,
      confirmationReview,
      directorActor,
    );
    assert.equal(confirmed.payment?.id, confirmedReplay.payment?.id, "double confirmation duplicated payment");
    await expectCode(
      () => reviewPaymentConfirmation(
        confirmation.id,
        { ...confirmationReview, key: key("director-confirm-conflicting-key") },
        directorActor,
      ),
      "IDEMPOTENCY_CONFLICT",
    );
    await expectCode(
      () => reviewPaymentConfirmation(
        confirmation.id,
        { ...confirmationReview, requestHash: "director-confirm-conflicting-hash" },
        directorActor,
      ),
      "IDEMPOTENCY_CONFLICT",
    );
    await expectCode(
      () => reviewPaymentConfirmation(
        confirmation.id,
        { ...confirmationReview, decision: "REJECT" },
        directorActor,
      ),
      "IDEMPOTENCY_CONFLICT",
    );
    await expectCode(
      () => reviewPaymentConfirmation(
        confirmation.id,
        { ...confirmationReview, amount: 30001 },
        directorActor,
      ),
      "IDEMPOTENCY_CONFLICT",
    );
    assert.equal(await prisma.payrollPayment.count({ where: { periodId: confirmationPeriod.id } }), 1, "confirmation payment count");
    confirmationSummary = await payrollSummary(confirmationPeriod.id, directorActor);
    assert.deepEqual(confirmationSummary.totals, { prepared: 200000, accrued: 200000, paid: 30000, pending: 0, payable: 170000, remaining: 170000, priorDebt: 560000 }, "confirmed payment totals");
    const confirmationCash = await prisma.companyLedgerEntry.aggregate({ where: { payrollPayment: { periodId: confirmationPeriod.id }, direction: "EXPENSE" }, _sum: { amount: true } });
    assert.equal(Number(confirmationCash._sum.amount ?? 0), 30000, "confirmed payment cash outflow");
    const confirmationFinance = await getFinanceDashboard({ from: new Date(Date.UTC(periodYear, 10, 15, 0)), to: new Date(Date.UTC(periodYear, 10, 15, 23, 59, 59, 999)) });
    assert.equal(confirmationFinance.operations.filter((item) => item.type === "PAYROLL_PAYMENT").length, 1, "Payroll payment missing from canonical Finance journal");
    assert.equal(confirmationFinance.cards.expenses, 30000, "Finance did not include confirmed Payroll cash outflow");
    await expectCode(
      () => createPayment({ employeeId: profile.id, periodId: confirmationPeriod.id, amount: 1, type: PayrollPaymentType.SALARY_PAYMENT, paymentDate: new Date(), key: key("manager-direct-payment"), requestHash: "manager-direct-payment" }, managerActor),
      "FORBIDDEN",
    );
    const reversal = await reversePayment(confirmed.payment!.id, { reason: "Ошибочная выплата", key: key("payment-reversal"), requestHash: "payment-reversal" }, directorActor);
    const reversalReplay = await reversePayment(confirmed.payment!.id, { reason: "Ошибочная выплата", key: key("payment-reversal"), requestHash: "payment-reversal" }, directorActor);
    assert.equal(reversal.id, reversalReplay.id, "payment reversal idempotency");
    assert.deepEqual((await payrollSummary(confirmationPeriod.id, directorActor)).totals, { prepared: 200000, accrued: 200000, paid: 0, pending: 0, payable: 200000, remaining: 200000, priorDebt: 560000 }, "reversal totals");
    const partialSalary = await createPayment(
      {
        employeeId: profile.id,
        periodId: confirmationPeriod.id,
        amount: 50000,
        type: PayrollPaymentType.ADVANCE,
        partialSalary: true,
        paymentDate: periodDate(11, 20),
        method: "kaspi",
        comment: "Частичная оплата зарплаты",
        key: key("founder-partial-salary"),
        requestHash: "founder-partial-salary",
      },
      founderActor,
    );
    assert.equal(Number(partialSalary.amount), 50000);
    assert.deepEqual(
      (await payrollSummary(confirmationPeriod.id, directorActor)).totals,
      { prepared: 200000, accrued: 200000, paid: 50000, pending: 0, payable: 150000, remaining: 150000, priorDebt: 560000 },
      "partial salary payment must leave 150,000 from a 200,000 salary",
    );
    await expectCode(
      () => createPayment(
        {
          employeeId: profile.id,
          periodId: confirmationPeriod.id,
          amount: 150001,
          type: PayrollPaymentType.ADVANCE,
          partialSalary: true,
          paymentDate: periodDate(11, 21),
          method: "kaspi",
          comment: "Переплата",
          key: key("founder-partial-salary-overpay"),
          requestHash: "founder-partial-salary-overpay",
        },
        founderActor,
      ),
      "PAYMENT_EXCEEDS_PAYABLE",
    );
    assert.equal(await prisma.payrollAuditEvent.count({ where: { employeeId: profile.id, action: "PAYROLL_PAYMENT_REVERSED" } }), 1, "payment reversal audit");
    assert(
      await prisma.payrollAuditEvent.count({
        where: {
          employeeId: salaryHistoryProfile.id,
          action: "SALARY_CHANGED",
        },
      }),
      "payroll audit missing: SALARY_CHANGED",
    );
    const employeeAuditActions = new Set((await prisma.payrollAuditEvent.findMany({ where: { employeeId: profile.id }, select: { action: true } })).map((event) => event.action));
    for (const action of [
      "ALLOWANCE_CHANGED",
      "PREMIUM_ACCRUED",
      "ADVANCE_APPROVED",
      "PAYROLL_CALCULATION_CONFIRMED",
    ])
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
    const payrollAccrualRows = await prisma.payrollAccrual.findMany({
      where: { employeeId: profile.id },
      select: { id: true, amount: true, direction: true },
    });
    const payrollPaymentRows = await prisma.payrollPayment.findMany({
      where: { employeeId: profile.id },
      select: { id: true, amount: true, type: true },
    });
    const payrollCalculationSnapshots = await prisma.payrollCalculationSnapshot.findMany({
      where: { employeeId: profile.id },
      select: { id: true, preparedAmount: true },
    });
    const payrollAccrualIds = payrollAccrualRows.map((row) => row.id);
    const payrollPaymentIds = payrollPaymentRows.map((row) => row.id);
    const payrollCalculationSnapshotIds = payrollCalculationSnapshots.map(
      (row) => row.id,
    );
    const ledger = await prisma.companyLedgerEntry.findMany({
      where: {
        OR: [
          { payrollAccrualId: { in: payrollAccrualIds } },
          { payrollPaymentId: { in: payrollPaymentIds } },
          {
            payrollCalculationSnapshotId: {
              in: payrollCalculationSnapshotIds,
            },
          },
        ],
      },
    });
    assert.equal(
      ledger
        .filter((row) => row.payrollCalculationSnapshotId != null)
        .reduce(
          (sum, row) =>
            sum +
            (row.direction === "EXPENSE"
              ? Number(row.amount)
              : -Number(row.amount)),
          0,
        ),
      payrollCalculationSnapshots.reduce(
        (sum, row) => sum + Number(row.preparedAmount),
        0,
      ),
      "payroll P&L ledger diverged from confirmed calculation snapshots",
    );
    assert.equal(
      ledger.some(
        (row) => row.payrollAccrualId != null && row.affectsProfit,
      ),
      false,
      "component accruals must not duplicate snapshot P&L recognition",
    );
    assert.equal(
      ledger
        .filter((row) => row.payrollPaymentId != null)
        .reduce(
          (sum, row) =>
            sum +
            (row.direction === "EXPENSE"
              ? Number(row.amount)
              : -Number(row.amount)),
          0,
        ),
      payrollPaymentRows.reduce(
        (sum, row) =>
          sum +
          (row.type === PayrollPaymentType.EMPLOYEE_REFUND
            ? -Number(row.amount)
            : Number(row.amount)),
        0,
      ),
      "cash payroll ledger diverged from confirmed payments",
    );
    const trackedOrder = await prisma.order.create({
      data: {
        number: `PAY-TRACKED-${Date.now()}`,
        clientId: client.id,
        address: "Test",
        staircase: "Test",
        material: "Test",
        amount: 100000,
        manager: manager.name,
        responsibleType: OrderResponsibleType.EMPLOYEE,
        managerUserId: manager.id,
        status: "Оформлен",
        orderReceivedAt: new Date(Date.UTC(periodYear, 11, 15, 12)),
      },
    });
    ids.orders.push(trackedOrder.id);
    const trackedOrderBonusDecision = await saveOrderBonusDecision(
      {
        year: periodYear,
        month: 12,
        orderId: trackedOrder.id,
        employeeId: profile.id,
        manualBonus: 50000,
        reason: "Ручное решение директора по бонусу",
        key: key("tracked-order-bonus-decision"),
        requestHash: "tracked-order-bonus-decision",
      },
      directorActor,
    );
    assert.equal(trackedOrderBonusDecision.systemSuggestion, 30000);
    assert.equal(trackedOrderBonusDecision.effectiveBonus, 50000);
    const trackedOrderDecisionAudit =
      await prisma.payrollAuditEvent.findUniqueOrThrow({
        where: {
          idempotencyKey: `${key("tracked-order-bonus-decision")}:audit`,
        },
        select: {
          action: true,
          actorId: true,
          actor: { select: { id: true, name: true } },
          before: true,
          after: true,
          reason: true,
        },
      });
    assert.deepEqual(trackedOrderDecisionAudit, {
      action: "ORDER_BONUS_DECISION_CHANGED",
      actorId: directorActor.userId,
      actor: { id: directorActor.userId, name: directorActor.name },
      before: {
        orderId: trackedOrder.id,
        earnedAt: trackedOrder.orderReceivedAt!.toISOString(),
        periodId: bonusStatusPeriod.id,
        manualBonus: null,
        systemSuggestion: 30000,
        effectiveBonus: 0,
      },
      after: {
        orderId: trackedOrder.id,
        earnedAt: trackedOrder.orderReceivedAt!.toISOString(),
        periodId: bonusStatusPeriod.id,
        manualBonus: 50000,
        systemSuggestion: 30000,
        effectiveBonus: 50000,
        requestHash: "tracked-order-bonus-decision",
      },
      reason: "Ручное решение директора по бонусу",
    });
    const trackedBonus = await createAccrual(
      {
        employeeId: profile.id,
        periodId: bonusStatusPeriod.id,
        type: PayrollAccrualType.EXTRA_BONUS,
        amount: 30000,
        reason: "Tracked standalone employee bonus",
        key: key("tracked-extra-bonus"),
        requestHash: "tracked-extra-bonus",
      },
      directorActor,
    );
    const selfOrder = await prisma.order.create({
      data: {
        number: `PAY-SELF-${Date.now()}`,
        clientId: client.id,
        address: "Test",
        staircase: "Test",
        material: "Test",
        amount: 100000,
        manager: manager.name,
        responsibleType: OrderResponsibleType.EMPLOYEE,
        managerUserId: manager.id,
        status: "Оформлен",
        orderReceivedAt: new Date(Date.UTC(periodYear, 11, 16, 12)),
      },
    });
    ids.orders.push(selfOrder.id);
    const selfBonusDecision = await saveOrderBonusDecision(
      {
        year: periodYear,
        month: 12,
        orderId: selfOrder.id,
        employeeId: profile.id,
        manualBonus: 0,
        reason: "Осознанно нулевой бонус менеджера",
        key: key("self-order-bonus-zero"),
        requestHash: "self-order-bonus-zero",
      },
      managerActor,
    );
    assert.equal(selfBonusDecision.systemSuggestion, 30000);
    assert.equal(selfBonusDecision.effectiveBonus, 0);
    assert.equal(
      Number(selfBonusDecision.decision?.manualAmount),
      0,
      "manual zero must not be confused with an absent decision",
    );
    const reassignedOrder = await prisma.order.create({
      data: {
        number: `PAY-REASSIGN-${Date.now()}`,
        clientId: client.id,
        address: "Test",
        staircase: "Test",
        material: "Test",
        amount: 100000,
        manager: manager.name,
        responsibleType: OrderResponsibleType.EMPLOYEE,
        managerUserId: manager.id,
        status: "Оформлен",
        orderReceivedAt: new Date(Date.UTC(periodYear, 11, 17, 12)),
      },
    });
    ids.orders.push(reassignedOrder.id);
    await saveOrderBonusDecision(
      {
        year: periodYear,
        month: 12,
        orderId: reassignedOrder.id,
        employeeId: profile.id,
        manualBonus: 50000,
        reason: "Бонус до смены ответственного",
        key: key("reassigned-order-bonus"),
        requestHash: "reassigned-order-bonus",
      },
      directorActor,
    );
    assert.equal(
      (await payrollSummary(bonusStatusPeriod.id, directorActor)).rows
        .find((row) => row.id === profile.id)
        ?.orderBonuses.some((item) => item.orderId === reassignedOrder.id),
      true,
    );
    await prisma.order.update({
      where: { id: reassignedOrder.id },
      data: {
        responsibleType: OrderResponsibleType.COMPANY,
        manager: "Компания",
        managerUserId: null,
      },
    });
    assert.equal(
      (await payrollSummary(bonusStatusPeriod.id, directorActor)).rows
        .find((row) => row.id === profile.id)
        ?.orderBonuses.some((item) => item.orderId === reassignedOrder.id),
      false,
      "current company responsibility must immediately remove a former employee order from payroll",
    );
    assert.equal(
      await prisma.payrollOrderBonusDecision.count({
        where: {
          orderId: reassignedOrder.id,
          employeeId: profile.id,
        },
      }),
      1,
      "historical decision may remain for audit but must not affect payroll",
    );
    await expectCode(
      () => createSelfAccrual(
        {
          periodId: bonusStatusPeriod.id,
          type: PayrollAccrualType.DEDUCTION,
          amount: 1000,
          orderId: selfOrder.id,
          reason: "Штраф за несвоевременную работу",
          key: key("self-deduction-rejected"),
          requestHash: "self-deduction-rejected",
        },
        managerActor,
      ),
      "FORBIDDEN",
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
      directorActor,
    );
    let bonusStatusSummary = await payrollSummary(bonusStatusPeriod.id, directorActor);
    assert.deepEqual(
      bonusStatusSummary.totals,
      { prepared: 280000, accrued: 0, paid: 10000, pending: 0, payable: 270000, remaining: 270000, priorDebt: 710000 },
      "salary plan, order decisions and extra bonuses must affect payable without becoming confirmed salary accrual",
    );
    let trackedBonusSummary = bonusStatusSummary.rows.find((row) => row.id === profile.id);
    assert(trackedBonusSummary, "tracked employee payroll summary row is missing");
    const trackedOrderPayload = trackedBonusSummary.orderBonuses.find(
      (item) => item.orderId === trackedOrder.id,
    );
    assert(trackedOrderPayload, "tracked order bonus payload is missing");
    assert.deepEqual(
      trackedOrderPayload.history.map(
        ({
          actorName,
          previousManualBonus,
          manualBonus,
          previousEffectiveBonus,
          effectiveBonus,
          reason,
        }) => ({
          actorName,
          previousManualBonus,
          manualBonus,
          previousEffectiveBonus,
          effectiveBonus,
          reason,
        }),
      ),
      [
        {
          actorName: directorActor.name,
          previousManualBonus: null,
          manualBonus: 50000,
          previousEffectiveBonus: 0,
          effectiveBonus: 50000,
          reason: "Ручное решение директора по бонусу",
        },
      ],
      "service payload must expose the exact old/new bonus values and author",
    );
    assert.equal(
      trackedOrderPayload.effectiveBonus,
      trackedOrderPayload.history[0]?.effectiveBonus,
      "current bonus and latest history value diverged",
    );
    const canonicalStatementPayload = {
      accrued: trackedBonusSummary.calculation.accrued,
      paid: trackedBonusSummary.totals.paid,
      payable: trackedBonusSummary.calculation.amountToPay,
    };
    assert.deepEqual(canonicalStatementPayload, {
      accrued: 0,
      paid: 10000,
      payable: 270000,
    });
    assert.deepEqual(
      {
        accrued: trackedBonusSummary.totals.accrued,
        paid: trackedBonusSummary.totals.paid,
        payable: trackedBonusSummary.totals.payable,
      },
      canonicalStatementPayload,
      "service row exposes conflicting statement values to its consumers",
    );
    assert.equal(
      trackedBonusSummary.bonusAccruals.find(
        (item) => item.id === trackedBonus.accrual.id,
      )?.status,
      "PARTIALLY_PAID",
    );
    assert.equal(
      trackedBonusSummary.orderBonuses.find(
        (item) => item.orderId === trackedOrder.id,
      )?.effectiveBonus,
      50000,
    );
    assert.equal(
      trackedBonusSummary.orderBonuses.find(
        (item) => item.orderId === selfOrder.id,
      )?.effectiveBonus,
      0,
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
    assert.deepEqual(
      bonusStatusSummary.totals,
      { prepared: 280000, accrued: 0, paid: 30000, pending: 0, payable: 250000, remaining: 250000, priorDebt: 710000 },
    );
    trackedBonusSummary = bonusStatusSummary.rows.find((row) => row.id === profile.id);
    assert(trackedBonusSummary, "tracked employee payroll summary row is missing after final payment");
    assert.equal(
      trackedBonusSummary.bonusAccruals.find(
        (item) => item.id === trackedBonus.accrual.id,
      )?.status,
      "PAID",
    );
    const clearedSelfBonus = await saveOrderBonusDecision(
      {
        year: periodYear,
        month: 12,
        orderId: selfOrder.id,
        employeeId: profile.id,
        manualBonus: null,
        reason: "Возврат к подсказке системы",
        key: key("self-order-bonus-clear"),
        requestHash: "self-order-bonus-clear",
      },
      managerActor,
    );
    assert.equal(clearedSelfBonus.decision?.manualAmount, null);
    assert.equal(clearedSelfBonus.effectiveBonus, 0);
    const restoredZeroSelfBonus = await saveOrderBonusDecision(
      {
        year: periodYear,
        month: 12,
        orderId: selfOrder.id,
        employeeId: profile.id,
        manualBonus: 0,
        reason: "Повторно установлен нулевой бонус",
        key: key("self-order-bonus-zero-again"),
        requestHash: "self-order-bonus-zero-again",
      },
      managerActor,
    );
    assert.equal(restoredZeroSelfBonus.effectiveBonus, 0);
    assert.equal(
      await prisma.payrollOrderBonusDecision.count({
        where: { orderId: selfOrder.id, employeeId: profile.id },
      }),
      1,
      "bonus decision updates must use one row",
    );
    await createPayment(
      {
        employeeId: profile.id,
        periodId: period.id,
        amount: 180000,
        type: PayrollPaymentType.SALARY_PAYMENT,
        paymentDate: new Date(),
        method: "kaspi",
        comment: "Полный расчёт перед закрытием периода",
        key: key("period-final-payment"),
        requestHash: "period-final-payment",
      },
      directorActor,
    );
    assert.equal(
      (await payrollSummary(period.id, directorActor)).totals.payable,
      0,
      "period must be fully paid before closing",
    );
    const reviewTransitionKey = key("review");
    const reviewTransitionHash = "review";
    const reviewedPeriod = await transitionPeriod(
      period.id,
      PayrollPeriodStatus.REVIEW,
      "Проверка",
      reviewTransitionKey,
      reviewTransitionHash,
      directorActor,
    );
    const reviewedPeriodReplay = await transitionPeriod(
      period.id,
      PayrollPeriodStatus.REVIEW,
      "Проверка",
      reviewTransitionKey,
      reviewTransitionHash,
      directorActor,
    );
    assert.equal(reviewedPeriod.id, reviewedPeriodReplay.id);
    await expectCode(
      () => transitionPeriod(
        period.id,
        PayrollPeriodStatus.OPEN,
        "Проверка",
        reviewTransitionKey,
        reviewTransitionHash,
        directorActor,
      ),
      "IDEMPOTENCY_CONFLICT",
    );
    await expectCode(
      () => transitionPeriod(
        period.id,
        PayrollPeriodStatus.REVIEW,
        "Другая причина",
        reviewTransitionKey,
        reviewTransitionHash,
        directorActor,
      ),
      "IDEMPOTENCY_CONFLICT",
    );
    await expectCode(
      () => transitionPeriod(
        period.id,
        PayrollPeriodStatus.REVIEW,
        "Проверка",
        reviewTransitionKey,
        "review-conflicting-hash",
        directorActor,
      ),
      "IDEMPOTENCY_CONFLICT",
    );
    await expectCode(
      () => createAccrual({ ...base, type: PayrollAccrualType.EXTRA_BONUS, amount: 1, reason: "Review", key: key("review-locked"), requestHash: "review-locked" }, directorActor),
      "PERIOD_NOT_OPEN",
    );
    const closeKey = key("close");
    const closedPeriod = await closePeriod(
      period.id,
      closeKey,
      "close",
      directorActor,
    );
    const closedPeriodReplay = await closePeriod(
      period.id,
      closeKey,
      "close",
      directorActor,
    );
    assert.equal(closedPeriod.id, closedPeriodReplay.id);
    await expectCode(
      () => closePeriod(
        period.id,
        closeKey,
        "close-conflicting-hash",
        directorActor,
      ),
      "IDEMPOTENCY_CONFLICT",
    );
    const closedCorrectionInput = {
      year: periodYear,
      month: 8,
      orderId: order.id,
      employeeId: profile.id,
      manualBonus: 50000,
      reason: "Исправление бонуса в закрытом месяце",
      key: key("closed-period-bonus-correction"),
      requestHash: "closed-period-bonus-correction",
    };
    await expectCode(
      () => saveOrderBonusDecision(closedCorrectionInput, managerActor),
      "FORBIDDEN",
    );
    const closedPeriodBonusCorrection = await saveOrderBonusDecision(
      closedCorrectionInput,
      directorActor,
    );
    assert.equal(closedPeriodBonusCorrection.effectiveBonus, 50000);
    assert.equal(
      (await prisma.payrollPeriod.findUniqueOrThrow({
        where: { id: period.id },
      })).status,
      PayrollPeriodStatus.CLOSED,
      "bonus correction must not reopen the period",
    );
    assert.deepEqual(
      (await payrollSummary(period.id, directorActor)).totals,
      { prepared: 290000, accrued: 270000, paid: 270000, pending: 0, payable: 0, remaining: 0, priorDebt: 0 },
      "closed-month bonus correction must update the draft while preserving the approved snapshot",
    );
    assert.equal(
      (await payrollSummary(period.id, directorActor)).rows.find(
        (row) => row.id === profile.id,
      )?.calculation.approvalStatus,
      "NEEDS_CORRECTION",
      "a closed-month component correction must require an explicit snapshot revision",
    );
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
      () => transitionPeriod(period.id, PayrollPeriodStatus.OPEN, "Accountant reopen", key("accountant-reopen"), "accountant-reopen", accountantActor),
      "FORBIDDEN",
    );
    await expectCode(
      () => transitionPeriod(period.id, PayrollPeriodStatus.OPEN, "Manager reopen", key("manager-reopen"), "manager-reopen", managerActor),
      "FORBIDDEN",
    );
    await expectCode(
      () => transitionPeriod(period.id, PayrollPeriodStatus.OPEN, "", key("empty-reason"), "empty-reason", directorActor),
      "REASON_REQUIRED",
    );
    await transitionPeriod(period.id, PayrollPeriodStatus.OPEN, "Исправление начисления сотрудника", key("reopen"), "reopen", directorActor);
    await createAccrual(
      { ...base, type: PayrollAccrualType.EXTRA_BONUS, amount: 1, reason: "После открытия", key: key("after-reopen"), requestHash: "after-reopen" },
      directorActor,
    );
    const periodAudit = await prisma.payrollAuditEvent.findMany({ where: { periodId: period.id } });
    assert(periodAudit.some((event) => event.action === "PERIOD_CLOSED"));
    assert(periodAudit.some((event) => event.action === "PERIOD_REOPENED" && event.reason === "Исправление начисления сотрудника"));
    assert(
      periodAudit.some(
        (event) =>
          event.action === "ORDER_BONUS_DECISION_CHANGED" &&
          event.reason === "Исправление бонуса в закрытом месяце",
      ),
      "closed-month bonus correction audit is missing",
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
    await expectCode(
      () =>
        reverseAccrual(
          premiumAccrual.accrual.id,
          nextPeriod.id,
          "Сторно бонуса в неверном периоде",
          key("reversal-wrong-period"),
          "reversal-wrong-period",
          directorActor,
        ),
      "ACCRUAL_PERIOD_MISMATCH",
    );
    await reverseAccrual(
      premiumAccrual.accrual.id,
      period.id,
      "Сторно бонуса",
      key("reversal"),
      "reversal",
      directorActor,
    );
    const next = await payrollSummary(nextPeriod.id, directorActor);
    assert.equal(
      next.totals.accrued,
      0,
      "late bonus and reversal must not become confirmed salary accrual",
    );
    assert.equal(
      next.totals.payable,
      210000,
      "payable uses salary entitlement plus the late bonus; reversal removes the original operation rather than becoming salary accrual",
    );
    const cancelledOrder = await prisma.order.create({
      data: {
        number: `PAY-CANCELLED-${Date.now()}`,
        clientId: client.id,
        address: "Test",
        staircase: "Test",
        material: "Test",
        amount: 100000,
        manager: manager.name,
        responsibleType: OrderResponsibleType.EMPLOYEE,
        managerUserId: manager.id,
        status: "Отменён",
        orderReceivedAt: new Date(Date.UTC(periodYear, 8, 15, 12)),
      },
    });
    ids.orders.push(cancelledOrder.id);
    await expectCode(
      () =>
        saveOrderBonusDecision(
          {
            year: periodYear,
            month: 9,
            orderId: cancelledOrder.id,
            employeeId: profile.id,
            manualBonus: 1000,
            reason: "Решение директора",
            key: key("cancelled-warning"),
            requestHash: "cancelled-warning",
          },
          directorActor,
        ),
      "ORDER_OUTSIDE_PERIOD",
    );
    const snapshotOnlyUser = await prisma.user.create({
      data: {
        name: `${tag}-snapshot-only-terminated`,
        email: `${tag}-snapshot-only-terminated@test.local`,
        password: "test",
        role: Role.MARKETER,
      },
    });
    ids.users.push(snapshotOnlyUser.id);
    const snapshotOnlyProfile = await upsertPayrollProfile(
      {
        userId: snapshotOnlyUser.id,
        hiredAt: new Date(Date.UTC(periodYear, 11, 1, 12)),
        baseSalary: 100000,
        defaultGuaranteedBonus: 0,
      },
      directorActor,
    );
    const snapshotOnlyPreview = await payrollSummary(
      bonusStatusPeriod.id,
      directorActor,
      snapshotOnlyProfile.id,
    );
    const snapshotOnlyPreviewRow = snapshotOnlyPreview.rows[0];
    assert(snapshotOnlyPreviewRow, "snapshot-only employee preview is missing");
    await confirmPayrollCalculation(
      {
        employeeId: snapshotOnlyProfile.id,
        periodId: bonusStatusPeriod.id,
        reason: "Подтверждение расчёта перед увольнением",
        key: key("snapshot-only-confirmation"),
        requestHash: "snapshot-only-confirmation",
        expectedCalculationHash:
          snapshotOnlyPreviewRow.calculation.calculationHash,
      },
      directorActor,
    );
    await prisma.user.update({
      where: { id: snapshotOnlyUser.id },
      data: { active: false },
    });
    await prisma.employeePayrollProfile.update({
      where: { id: snapshotOnlyProfile.id },
      data: {
        active: false,
        terminatedAt: new Date(Date.UTC(periodYear, 11, 31, 12)),
      },
    });
    assert.equal(
      await prisma.payrollAccrual.count({
        where: { employeeId: snapshotOnlyProfile.id, periodId: bonusStatusPeriod.id },
      }),
      0,
    );
    assert.equal(
      await prisma.payrollPayment.count({
        where: { employeeId: snapshotOnlyProfile.id, periodId: bonusStatusPeriod.id },
      }),
      0,
    );
    const snapshotOnlyTerminatedSummary = await payrollSummary(
      bonusStatusPeriod.id,
      directorActor,
      snapshotOnlyProfile.id,
    );
    assert.equal(snapshotOnlyTerminatedSummary.rows.length, 1);
    assert.equal(
      snapshotOnlyTerminatedSummary.rows[0].totals.accrued,
      100000,
      "terminated employee with only a current snapshot disappeared from payroll",
    );
    assert.equal(
      snapshotOnlyTerminatedSummary.rows[0].calculation.remaining,
      100000,
      "snapshot-only terminated employee debt is not visible",
    );
    await prisma.user.update({
      where: { id: manager.id },
      data: { active: false },
    });
    assert.equal(
      (await payrollSummary(period.id, directorActor, profile.id)).rows.length,
      1,
      "disabling ORDA login removed the employee from payroll",
    );
    await prisma.employeePayrollProfile.update({
      where: { id: profile.id },
      data: { active: false, terminatedAt: new Date(Date.UTC(periodYear, 7, 31, 12)) },
    });
    assert.equal(
      (await payrollSummary(period.id, directorActor, profile.id)).rows.length,
      1,
      "terminated employee payroll history must remain available",
    );
    const deferredOrder = await prisma.order.create({
      data: {
        number: `PAY-DEFERRED-${Date.now()}`,
        clientId: client.id,
        address: "Test",
        staircase: "Test",
        material: "Test",
        amount: 100000,
        manager: manager.name,
        responsibleType: OrderResponsibleType.EMPLOYEE,
        managerUserId: manager.id,
        status: "В производстве",
        lifecycle: OrderLifecycle.IN_PRODUCTION,
        orderReceivedAt: new Date(Date.UTC(periodYear, 7, 20, 12)),
      },
    });
    ids.orders.push(deferredOrder.id);
    await expectCode(
      () =>
        saveOrderBonusDecision(
          {
            year: periodYear,
            month: 8,
            orderId: deferredOrder.id,
            employeeId: profile.id,
            manualBonus: 30000,
            reason: "Бонус уволенного менеджера",
            key: key("deferred-before-completion"),
            requestHash: "deferred-before-completion",
          },
          directorActor,
        ),
      "ORDER_OUTSIDE_PERIOD",
    );
    assert.deepEqual(
      await accrueCompletedTerminatedManagerOrderBonus(
        deferredOrder.id,
        directorActor,
      ),
      { created: false, skipped: true, reason: "ORDER_NOT_ELIGIBLE" },
    );
    await prisma.order.update({
      where: { id: deferredOrder.id },
      data: {
        lifecycle: OrderLifecycle.COMPLETED,
        status: "Заказ завершён",
        completedAt: new Date(Date.UTC(periodYear, 8, 20, 12)),
      },
    });
    await expectCode(
      () =>
        saveOrderBonusDecision(
          {
            year: periodYear,
            month: 9,
            orderId: deferredOrder.id,
            employeeId: profile.id,
            manualBonus: 30000,
            reason: "Проверка неверного месяца после завершения",
            key: key("deferred-wrong-month-after-completion"),
            requestHash: "deferred-wrong-month-after-completion",
          },
          directorActor,
        ),
      "ORDER_OUTSIDE_PERIOD",
    );
    const terminatedBonusBeforeDecision =
      await accrueCompletedTerminatedManagerOrderBonus(
        deferredOrder.id,
        directorActor,
      );
    assert.equal(
      terminatedBonusBeforeDecision.reason,
      "ORDER_BONUS_DECISION_ONLY",
    );
    assert.equal(terminatedBonusBeforeDecision.manualBonus, null);
    assert.equal(terminatedBonusBeforeDecision.systemSuggestion, 30000);
    assert.equal(
      terminatedBonusBeforeDecision.effectiveBonus,
      0,
      "an unsaved terminated-employee suggestion must not become a bonus",
    );
    const incompleteTerminatedSummary = await payrollSummary(
      period.id,
      directorActor,
      profile.id,
    );
    assert.equal(incompleteTerminatedSummary.rows[0]?.calculation.incomplete, true);
    assert.equal(
      incompleteTerminatedSummary.rows[0]?.orderBonuses.find(
        (item) => item.orderId === deferredOrder.id,
      )?.manualBonus,
      null,
    );
    const deferredBonus = await saveOrderBonusDecision(
      {
        year: periodYear,
        month: 8,
        orderId: deferredOrder.id,
        employeeId: profile.id,
        manualBonus: 30000,
        reason: "Бонус после завершения заказа уволенного менеджера",
        key: key("deferred-after-completion"),
        requestHash: "deferred-after-completion",
      },
      directorActor,
    );
    assert.equal(deferredBonus.effectiveBonus, 30000);
    const terminatedBonusAfterDecision = await accrueCompletedTerminatedManagerOrderBonus(
      deferredOrder.id,
      directorActor,
    );
    assert.equal(terminatedBonusAfterDecision.reason, "ORDER_BONUS_DECISION_ONLY");
    assert.deepEqual(terminatedBonusAfterDecision.period, {
      year: periodYear,
      month: 8,
    });
    assert.equal(terminatedBonusAfterDecision.effectiveBonus, 30000);
    const terminatedSummary = await payrollSummary(
      period.id,
      directorActor,
      profile.id,
    );
    assert.equal(terminatedSummary.rows[0]?.employmentEnded, true);
    assert.equal(terminatedSummary.rows[0]?.currentSalary, 200000);
    assert.equal(
      terminatedSummary.rows[0]?.orderBonuses.find(
        (item) => item.orderId === deferredOrder.id,
      )?.effectiveBonus,
      30000,
      "completed order bonus is missing from the factual order month",
    );
    const missingPriorPeriodYear = periodYear + 2;
    const missingPriorPeriodMonth = 2;
    assert.equal(
      await prisma.payrollPeriod.count({
        where: {
          year: missingPriorPeriodYear,
          month: missingPriorPeriodMonth,
        },
      }),
      0,
      "prior-debt regression requires a month without a PayrollPeriod row",
    );
    const missingPriorUser = await prisma.user.create({
      data: {
        name: `${tag}-missing-prior-period`,
        email: `${tag}-missing-prior-period@test.local`,
        password: "test",
        role: Role.MARKETER,
      },
    });
    ids.users.push(missingPriorUser.id);
    const missingPriorProfile = await upsertPayrollProfile(
      {
        userId: missingPriorUser.id,
        hiredAt: new Date(
          Date.UTC(missingPriorPeriodYear, missingPriorPeriodMonth - 1, 1, 12),
        ),
        baseSalary: 123456,
        defaultGuaranteedBonus: 0,
      },
      directorActor,
    );
    const missingPriorCurrentPeriod = await ensurePeriod(
      missingPriorPeriodYear,
      missingPriorPeriodMonth + 1,
    );
    ids.periods.push(missingPriorCurrentPeriod.id);
    const missingPriorSummary = await payrollSummary(
      missingPriorCurrentPeriod.id,
      directorActor,
      missingPriorProfile.id,
    );
    const missingPriorRow = missingPriorSummary.rows[0];
    assert(missingPriorRow, "employee with a missing prior period is absent");
    assert.equal(missingPriorRow.calculation.priorDebt, 123456);
    assert.deepEqual(
      missingPriorRow.calculation.priorDebtBreakdown.find(
        (item) =>
          item.year === missingPriorPeriodYear &&
          item.month === missingPriorPeriodMonth,
      ),
      {
        periodId: null,
        year: missingPriorPeriodYear,
        month: missingPriorPeriodMonth,
        prepared: 123456,
        approvedAmount: null,
        paid: 0,
        remaining: 123456,
        debt: 123456,
        incomplete: false,
        missingBonusCount: 0,
        approvalStatus: "PRELIMINARY",
      },
      "salary condition from a missing prior month was omitted from debt",
    );
    assert.equal(
      await prisma.payrollPeriod.count({
        where: {
          year: missingPriorPeriodYear,
          month: missingPriorPeriodMonth,
        },
      }),
      0,
      "payroll summary must not create a missing historical period",
    );
    await reversePayment(
      formulaAdvancePayment.id,
      {
        reason: "Проверка детализации сторно аванса",
        key: key("formula-advance-reversal"),
        requestHash: "formula-advance-reversal",
      },
      directorActor,
    );
    const reversedAdvanceSummary = await payrollSummary(
      formulaPeriod.id,
      directorActor,
      profile.id,
    );
    const reversedAdvanceRow = reversedAdvanceSummary.rows[0];
    assert(reversedAdvanceRow, "reversed advance payroll row is missing");
    assert.equal(reversedAdvanceRow.totals.paid, 0);
    assert.equal(reversedAdvanceRow.breakdown.advancesPaid, 0);
    assert.equal(reversedAdvanceRow.calculation.advances, 0);
    assert.equal(
      reversedAdvanceRow.calculation.otherPayments,
      0,
      "an advance refund must not be misclassified as another payment",
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
      const calculationSnapshots = await prisma.payrollCalculationSnapshot.findMany({
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
      await prisma.payrollOrderBonusDecision.deleteMany({
        where: {
          OR: [
            { employeeId: { in: employeeIds } },
            { orderId: { in: ids.orders } },
          ],
        },
      });
      await prisma.companyLedgerEntry.deleteMany({
        where: {
          OR: [
            { payrollAccrualId: { in: accruals.map((r) => r.id) } },
            { payrollPaymentId: { in: payments.map((r) => r.id) } },
            {
              payrollCalculationSnapshotId: {
                in: calculationSnapshots.map((row) => row.id),
              },
            },
          ],
        },
      });
      await prisma.payrollCalculationSnapshot.deleteMany({
        where: { employeeId: { in: employeeIds } },
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
      if (ids.orders.length)
        await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
      if (ids.client)
        await prisma.client.deleteMany({ where: { id: ids.client } });
      await prisma.payrollPeriod.deleteMany({ where: { id: { in: ids.periods }, accruals: { none: {} }, payments: { none: {} } } });
      await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    }
    await prisma.$disconnect();
  }
}
void main();
