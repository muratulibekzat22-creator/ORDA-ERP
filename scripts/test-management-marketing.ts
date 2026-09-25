import "./require-test-database";

import assert from "node:assert/strict";
import {
  ManagementMarketingTaskStatus,
  RecruitmentVacancyStatus,
  Role,
} from "@prisma/client";

import { prisma } from "../lib/prisma";
import { runWithTenant } from "../lib/tenant-context";

if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
  throw new Error("Marketing integration requires TEST_DATABASE_URL");

const tenant = {
  companyId: 1,
  companySlug: "altyn-sapa-company",
  companyName: "ТОО ALTYN SAPA COMPANY",
  isDemo: false,
};

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
