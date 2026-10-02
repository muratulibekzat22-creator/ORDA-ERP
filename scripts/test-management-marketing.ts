import "./require-test-database";

import assert from "node:assert/strict";
import {
  ManagementMarketingTaskStatus,
  RecruitmentVacancyStatus,
  Role,
} from "@prisma/client";

import { prisma } from "../lib/prisma";
import { marketingMonthRange } from "../lib/marketing";
import { getMarketingAnalytics } from "../lib/services/marketing-analytics.service";
import { runWithTenant } from "../lib/tenant-context";

if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
  throw new Error("Marketing integration requires TEST_DATABASE_URL");

const tenant = {
  companyId: 1,
  companySlug: "altyn-sapa-company",
  companyName: "ТОО ALTYN SAPA COMPANY",
  isDemo: false,
};

const september = marketingMonthRange(new Date("2026-09-25T12:00:00Z"));
assert.equal(september.start.toISOString(), "2026-08-31T19:00:00.000Z");
assert.equal(september.end.toISOString(), "2026-09-30T19:00:00.000Z");

async function main() {
  const tag = `marketing-test-${Date.now()}`;
  await runWithTenant(tenant, async () => {
    const director = await prisma.user.create({
      data: {
        name: tag,
        email: `${tag}@test.local`,
        password: "test-only-hash-placeholder",
        role: Role.OPERATIONS_DIRECTOR,
      },
    });
    try {
      const [task, metric, vacancy] = await Promise.all([
        prisma.managementMarketingTask.create({
          data: { title: `${tag}-task`, priority: 3, createdById: director.id },
        }),
        prisma.managementMarketingMetric.create({
          data: {
            metricMonth: new Date("2097-01-01T00:00:00+05:00"),
            channel: tag,
            spend: 100_000,
            leads: 20,
            orders: 4,
            revenue: 800_000,
            createdById: director.id,
          },
        }),
        prisma.recruitmentVacancy.create({
          data: { title: `${tag}-vacancy`, createdById: director.id },
        }),
      ]);
      const updatedTask = await prisma.managementMarketingTask.update({
        where: { id: task.id },
        data: { status: ManagementMarketingTaskStatus.DONE },
      });
      const updatedVacancy = await prisma.recruitmentVacancy.update({
        where: { id: vacancy.id },
        data: { status: RecruitmentVacancyStatus.INTERVIEW, candidates: 3 },
      });
      assert.equal(updatedTask.status, ManagementMarketingTaskStatus.DONE);
      assert.equal(updatedVacancy.candidates, 3);
      assert.equal(Number(metric.revenue) / Number(metric.spend), 8, "ROAS input is inconsistent");
      assert.equal(Number(metric.spend) / metric.orders, 25_000, "CAC input is inconsistent");
      const crmClient = await prisma.client.create({
        data: {
          name: `${tag}-client`,
          phone: "77000000000",
          city: "Test",
          manager: director.name,
          managerUserId: director.id,
          amount: "350000",
          status: "WON",
          createdAt: new Date("2097-01-10T08:00:00+05:00"),
        },
      });
      const crmOrder = await prisma.order.create({
        data: {
          number: `MKT-${Date.now()}`,
          clientId: crmClient.id,
          address: "Test",
          staircase: "Test",
          material: "Test",
          amount: 350_000,
          balance: 350_000,
          manager: director.name,
          managerUserId: director.id,
        },
      });
      const january = marketingMonthRange("2097-01");
      const analytics = await getMarketingAnalytics({
        companyId: tenant.companyId,
        start: january.start,
        end: january.end,
        metrics: [metric],
      });
      assert.equal(analytics.leads, 1, "CRM inquiries did not replace a stale imported lead count");
      assert.equal(analytics.orders, 1, "CRM-attributed orders are missing");
      assert.equal(analytics.revenue, 350_000, "CRM-attributed revenue is missing");
      assert.equal(analytics.spend, 100_000, "recorded advertising spend is missing");
      assert.equal(analytics.cpl, 100_000, "cost per inquiry is incorrect");
      await prisma.order.delete({ where: { id: crmOrder.id } });
      await prisma.client.delete({ where: { id: crmClient.id } });
      await prisma.managementMarketingTask.delete({ where: { id: task.id } });
      await prisma.managementMarketingMetric.delete({ where: { id: metric.id } });
      await prisma.recruitmentVacancy.delete({ where: { id: vacancy.id } });
      assert.equal(await prisma.managementMarketingTask.count({ where: { title: `${tag}-task` } }), 0);
    } finally {
      await prisma.managementMarketingTask.deleteMany({ where: { createdById: director.id } });
      await prisma.managementMarketingMetric.deleteMany({ where: { createdById: director.id } });
      await prisma.recruitmentVacancy.deleteMany({ where: { createdById: director.id } });
      await prisma.employeePayrollProfile.deleteMany({ where: { userId: director.id } });
      await prisma.user.deleteMany({ where: { id: director.id } });
    }
  });
  console.log("marketing KPI, Kanban, vacancy lifecycle and cleanup checks passed");
}

void main().finally(() => prisma.$disconnect());
