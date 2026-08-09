import "./require-test-database";

import assert from "node:assert/strict";
import { PayrollAccrualType, PayrollPaymentType, Role } from "@prisma/client";

import { createRequestHash } from "../lib/idempotency";
import { prisma } from "../lib/prisma";
import { createEmployee, createEmployeeAccess, listEmployees } from "../lib/services/employee.service";
import { getDashboardSummary } from "../lib/services/dashboard.service";
import { changeSalary, createAccrual, createPayment, ensurePeriod, payrollSummary } from "../lib/services/payroll.service";

if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
  throw new Error("Employee payroll integration requires TEST_DATABASE_URL");

const tag = `employee-no-user-${Date.now()}`;
const key = (operation: string) => `${tag}:${operation}`;

async function main() {
  let directorId = 0;
  let employeeId = 0;
  let linkedUserId = 0;
  let periodId = 0;
  try {
    const director = await prisma.user.create({
      data: {
        name: `${tag}-director`,
        email: `${tag}-director@test.local`,
        password: "test-only-hash-placeholder",
        role: Role.DIRECTOR,
      },
    });
    directorId = director.id;
    const actor = { userId: director.id, role: Role.DIRECTOR, name: director.name };
    const activeEmployeesBefore = await prisma.employeePayrollProfile.count({ where: { active: true } });

    const employee = await createEmployee({
      name: `${tag}-employee`,
      position: "Сборщик",
      phone: "+70000000000",
      hasOrdaAccess: false,
    }, director.id);
    employeeId = employee.employeeId;
    assert.equal(employee.userId, null);
    assert.equal(employee.hasOrdaAccess, false);
    assert.equal(await prisma.user.count({ where: { name: `${tag}-employee` } }), 0, "employee creation produced a fake User");
    assert((await listEmployees("active")).some((row) => row.employeeId === employeeId), "employee is missing from the active list");

    const dashboard = await getDashboardSummary({ role: Role.DIRECTOR, userId: director.id, period: "month" });
    const directorMetrics = dashboard.metrics as Record<string, number | undefined>;
    assert.equal(directorMetrics.activeEmployees, activeEmployeesBefore + 1, "dashboard does not count employees without login");

    await changeSalary(employeeId, 300_000, new Date(), "Тестовый оклад", actor);
    const period = await ensurePeriod(2098, 12);
    periodId = period.id;
    await createAccrual({
      employeeId, periodId, type: PayrollAccrualType.BASE_SALARY, amount: 300_000,
      reason: "Оклад за месяц", key: key("salary"), requestHash: createRequestHash({ employeeId, periodId, amount: 300_000 }),
    }, actor);
    await createAccrual({
      employeeId, periodId, type: PayrollAccrualType.PREMIUM, amount: 50_000,
      reason: "Премия", key: key("premium"), requestHash: createRequestHash({ employeeId, periodId, amount: 50_000 }),
    }, actor);
    await createPayment({
      employeeId, periodId, type: PayrollPaymentType.ADVANCE, amount: 100_000,
      paymentDate: new Date(), method: "TEST", comment: "Фактически выплаченный аванс",
      key: key("advance"), requestHash: createRequestHash({ employeeId, periodId, amount: 100_000 }),
    }, actor);

    const beforeAccess = await payrollSummary(periodId, actor, employeeId);
    assert.equal(beforeAccess.rows.length, 1);
    assert.equal(beforeAccess.rows[0].hasOrdaAccess, false);
    assert.equal(beforeAccess.rows[0].breakdown.salaryAccrued, 300_000);
    assert.equal(beforeAccess.rows[0].breakdown.premiumsAccrued, 50_000);
    assert.equal(beforeAccess.rows[0].breakdown.advancesPaid, 100_000);
    assert.equal(beforeAccess.rows[0].totals.payable, 250_000, "advance did not reduce payable");

    const linked = await createEmployeeAccess(employeeId, {
      email: `${tag}-employee@test.local`,
      password: "Test-only-password-123!",
      role: Role.MANAGER,
    }, director.id);
    linkedUserId = linked.userId!;
    assert.equal(linked.employeeId, employeeId, "account creation replaced the employee record");
    const afterAccess = await payrollSummary(periodId, actor, employeeId);
    assert.equal(afterAccess.rows[0].totals.payable, 250_000, "payroll history changed after linking User");
    assert.equal(afterAccess.rows[0].accruals.length, 2);
    assert.equal(afterAccess.rows[0].payments.length, 1);

    await prisma.user.update({ where: { id: linkedUserId }, data: { active: false } });
    const afterLoginDisabled = await payrollSummary(periodId, actor, employeeId);
    assert.equal(afterLoginDisabled.rows.length, 1, "disabling login removed the employee from payroll");
    console.log("employee without User, payroll, direct advance, later account link and login deactivation passed");
  } finally {
    if (employeeId) {
      await prisma.companyLedgerEntry.deleteMany({ where: { OR: [{ payrollAccrual: { employeeId } }, { payrollPayment: { employeeId } }] } });
      await prisma.payrollAuditEvent.deleteMany({ where: { OR: [{ employeeId }, ...(directorId ? [{ actorId: directorId }] : [])] } });
      await prisma.payrollPayment.deleteMany({ where: { employeeId } });
      await prisma.payrollAccrual.deleteMany({ where: { employeeId } });
      await prisma.employeeSalaryRate.deleteMany({ where: { employeeId } });
      await prisma.employeePayrollProfile.deleteMany({ where: { id: employeeId } });
    }
    if (periodId) await prisma.payrollPeriod.deleteMany({ where: { id: periodId } });
    if (linkedUserId) await prisma.user.deleteMany({ where: { id: linkedUserId } });
    if (directorId) await prisma.user.deleteMany({ where: { id: directorId } });
  }
}

void main().finally(() => prisma.$disconnect());
