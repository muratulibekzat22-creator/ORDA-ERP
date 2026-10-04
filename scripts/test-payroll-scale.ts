import "./require-test-database";

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { PayrollPaymentType, Role } from "@prisma/client";

import { prisma } from "../lib/prisma";
import { payrollSummary } from "../lib/services/payroll.service";
import { runWithTenant } from "../lib/tenant-context";

const EMPLOYEE_COUNT = 100;
const MAX_SUMMARY_TIME_MS = 10_000;
const tag = `payroll-scale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function main() {
  const company = await prisma.company.create({
    data: {
      slug: tag,
      name: `Payroll scale ${tag}`,
      timezone: "Asia/Almaty",
    },
  });
  const tenant = {
    companyId: company.id,
    companySlug: company.slug,
    companyName: company.name,
    isDemo: false,
  };

  try {
    await runWithTenant(tenant, async () => {
      const director = await prisma.user.create({
        data: {
          name: `${tag} Director`,
          email: `${tag}-director@example.test`,
          password: "test-only",
          role: Role.DIRECTOR,
        },
      });
      await prisma.user.createMany({
        data: Array.from({ length: EMPLOYEE_COUNT }, (_, index) => ({
          name: `${tag} Employee ${String(index + 1).padStart(3, "0")}`,
          email: `${tag}-employee-${index + 1}@example.test`,
          password: "test-only",
          role: Role.MANAGER,
        })),
      });
      const employees = await prisma.user.findMany({
        where: { email: { startsWith: `${tag}-employee-` } },
        orderBy: { id: "asc" },
        select: { id: true, name: true },
      });
      assert.equal(employees.length, EMPLOYEE_COUNT);

      await prisma.employeePayrollProfile.createMany({
        data: employees.map((employee, index) => ({
          userId: employee.id,
          name: employee.name,
          position: Role.MANAGER,
          hiredAt: new Date("2026-09-01T00:00:00+05:00"),
          baseSalary: 100_000 + index * 1_000,
          salaryPlanEnabled: true,
          defaultGuaranteedBonus: 0,
        })),
      });
      const profiles = await prisma.employeePayrollProfile.findMany({
        where: { userId: { in: employees.map((employee) => employee.id) } },
        orderBy: { id: "asc" },
        select: { id: true, userId: true, baseSalary: true },
      });
      assert.equal(profiles.length, EMPLOYEE_COUNT);

      // October is deliberately absent. A skipped period must not erase a real
      // salary obligation between the first persisted month and the selected one.
      const september = await prisma.payrollPeriod.create({
        data: { year: 2026, month: 9 },
      });
      const november = await prisma.payrollPeriod.create({
        data: { year: 2026, month: 11 },
      });
      await prisma.payrollPayment.create({
        data: {
          employeeId: profiles[0].id,
          periodId: september.id,
          amount: 25_000,
          paymentDate: new Date("2026-09-15T12:00:00+05:00"),
          type: PayrollPaymentType.ADVANCE,
          paidById: director.id,
          idempotencyKey: `${tag}:september-advance`,
          requestHash: `${tag}:september-advance`,
        },
      });

      const actor = {
        userId: director.id,
        role: Role.DIRECTOR,
        name: director.name,
      };
      const startedAt = performance.now();
      const summary = await payrollSummary(
        november.id,
        actor,
        undefined,
        false,
        { includeDetails: false },
      );
      const durationMs = performance.now() - startedAt;

      assert.equal(summary.rows.length, EMPLOYEE_COUNT);
      assert.ok(
        durationMs < MAX_SUMMARY_TIME_MS,
        `100 employee payroll summary took ${durationMs.toFixed(1)} ms`,
      );

      const first = summary.rows.find((row) => row.id === profiles[0].id);
      assert.ok(first);
      assert.equal(first.calculation.prepared, 100_000);
      assert.equal(first.calculation.remaining, 100_000);
      assert.equal(first.calculation.priorDebt, 175_000);
      assert.deepEqual(
        first.calculation.priorDebtBreakdown.map((item) => ({
          year: item.year,
          month: item.month,
          periodId: item.periodId,
          prepared: item.prepared,
          paid: item.paid,
          debt: item.debt,
        })),
        [
          {
            year: 2026,
            month: 9,
            periodId: september.id,
            prepared: 100_000,
            paid: 25_000,
            debt: 75_000,
          },
          {
            year: 2026,
            month: 10,
            periodId: null,
            prepared: 100_000,
            paid: 0,
            debt: 100_000,
          },
        ],
      );

      const expectedPriorDebt = profiles.reduce(
        (sum, profile, index) =>
          sum + 2 * Number(profile.baseSalary) - (index === 0 ? 25_000 : 0),
        0,
      );
      const expectedCurrentPrepared = profiles.reduce(
        (sum, profile) => sum + Number(profile.baseSalary),
        0,
      );
      assert.equal(summary.totals.priorDebt, expectedPriorDebt);
      assert.equal(summary.totals.prepared, expectedCurrentPrepared);
      assert.equal(summary.totals.remaining, expectedCurrentPrepared);
      assert.equal(
        summary.totals.remaining + summary.totals.priorDebt,
        expectedCurrentPrepared + expectedPriorDebt,
        "prior debt must stay separate and must not be included twice in the selected month",
      );

      const detail = await payrollSummary(
        november.id,
        actor,
        profiles[0].id,
        false,
        { includeDetails: true },
      );
      assert.equal(detail.rows.length, 1);
      assert.equal(detail.rows[0].calculation.priorDebt, first.calculation.priorDebt);

      console.log(
        JSON.stringify({
          employees: EMPLOYEE_COUNT,
          durationMs: Number(durationMs.toFixed(1)),
          selectedMonthPrepared: summary.totals.prepared,
          priorDebt: summary.totals.priorDebt,
          missingPriorMonthRecovered: "2026-10",
        }),
      );
    });
  } finally {
    await runWithTenant(tenant, async () => {
      const employeeIds = (
        await prisma.employeePayrollProfile.findMany({ select: { id: true } })
      ).map((item) => item.id);
      if (employeeIds.length) {
        await prisma.payrollPayment.deleteMany({
          where: { employeeId: { in: employeeIds } },
        });
        await prisma.employeeSalaryRate.deleteMany({
          where: { employeeId: { in: employeeIds } },
        });
        await prisma.employeePayrollProfile.deleteMany({
          where: { id: { in: employeeIds } },
        });
      }
      await prisma.payrollPeriod.deleteMany({});
      await prisma.user.deleteMany({});
    });
    await prisma.company.delete({ where: { id: company.id } });
    await prisma.$disconnect();
  }
}

void main();
