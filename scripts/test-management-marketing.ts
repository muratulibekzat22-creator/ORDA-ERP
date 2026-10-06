import "./require-test-database";

import assert from "node:assert/strict";
import {
  ManagementMarketingReportPeriod,
  ManagementMarketingReportStatus,
  ManagementMarketingTaskStatus,
  RecruitmentVacancyStatus,
  Role,
} from "@prisma/client";

import { prisma } from "../lib/prisma";
import { marketingMonthRange } from "../lib/marketing";
import { getMarketingAnalytics } from "../lib/services/marketing-analytics.service";
import { runWithSystemAccess, runWithTenant } from "../lib/tenant-context";

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
  const runNumber = Date.now();
  const testYear = 2100 + (runNumber % 7000);
  const testMonthIndex = Math.floor(runNumber / 7000) % 12;
  const testDate = (day: number, hour = 8) => new Date(Date.UTC(testYear, testMonthIndex, day, hour));
  const testMonth = `${testYear}-${String(testMonthIndex + 1).padStart(2, "0")}`;
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
      const [task, metric, report, vacancy] = await Promise.all([
        prisma.managementMarketingTask.create({
          data: { title: `${tag}-task`, priority: 3, createdById: director.id },
        }),
        prisma.managementMarketingMetric.create({
          data: {
            metricMonth: testDate(1),
            channel: tag,
            spend: 100_000,
            leads: 20,
            orders: 4,
            revenue: 800_000,
            createdById: director.id,
          },
        }),
        prisma.managementMarketingReport.create({
          data: {
            periodType: ManagementMarketingReportPeriod.WEEKLY,
            periodStart: testDate(1),
            periodEnd: testDate(7),
            workCompleted: "Запущены тестовые креативы",
            resultSummary: "Получены тестовые обращения",
            bestResult: "Видео-креатив",
            problems: "Нет проблем",
            nextActions: "Проверить качество обращений",
            creativesPublished: 3,
            qualifiedLeads: 4,
            unqualifiedLeads: 2,
            authorId: director.id,
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
      const reviewedReport = await prisma.managementMarketingReport.update({
        where: { id: report.id },
        data: { status: ManagementMarketingReportStatus.APPROVED, directorComment: "Принято", reviewedById: director.id, reviewedAt: new Date() },
      });
      assert.equal(reviewedReport.status, ManagementMarketingReportStatus.APPROVED);
      assert.equal(reviewedReport.qualifiedLeads, 4);
      assert.equal(Number(metric.revenue) / Number(metric.spend), 8, "ROAS input is inconsistent");
      assert.equal(Number(metric.spend) / metric.orders, 25_000, "CAC input is inconsistent");
      const crmClient = await prisma.client.create({
        data: {
          name: `${tag}-client`,
          phone: `81${Date.now().toString().slice(-10)}`,
          city: "Test",
          manager: director.name,
          managerUserId: director.id,
          amount: "350000",
          status: "WON",
          source: "Instagram",
          sourceCode: "INSTAGRAM",
          createdAt: testDate(10),
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
          orderReceivedAt: testDate(12, 9),
          orderDateNeedsReview: false,
        },
      });
      const calculation = await prisma.leadCalculation.create({
        data: {
          clientId: crmClient.id,
          material: "Test",
          baseClientPrice: 350_000,
          clientPrice: 350_000,
          internalCost: 200_000,
          snapshot: {},
          authorName: director.name,
        },
      });
      const proposal = await prisma.commercialProposal.create({
        data: {
          clientId: crmClient.id,
          calculationId: calculation.id,
          number: `MKT-KP-${Date.now()}`,
          snapshot: {},
          validUntil: new Date(Date.UTC(testYear, testMonthIndex + 1, 1)),
          executionTerm: "30 дней",
          paymentTerms: "50/50",
          warranty: "12 месяцев",
          managerContact: director.name,
          createdByName: director.name,
          createdAt: testDate(11),
        },
      });
      const measurement = await prisma.measurement.create({
        data: {
          clientId: crmClient.id,
          measurer: director.name,
          visitDate: testDate(11, 10),
          city: "Test",
          address: "Test",
        },
      });
      const january = marketingMonthRange(testMonth);
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
      const metaAnalytics = await getMarketingAnalytics({
        companyId: tenant.companyId,
        start: january.start,
        end: january.end,
        metrics: [{
          channel: "Instagram / Meta",
          note: "Автосинхронизация Meta · test · 10 начатых переписок · 20 событий lead в Meta",
          spend: 100_000,
          leads: 20,
          orders: 4,
          revenue: 800_000,
        }],
      });
      assert.equal(metaAnalytics.spend, 100_000);
      assert.equal(metaAnalytics.leads, 1, "CRM totals must remain visible alongside Meta spend");
      assert.equal(metaAnalytics.metaConversations, 10);
      assert.equal(metaAnalytics.metaCrmLeads, 1);
      assert.equal(metaAnalytics.metaProposals, 1, "unique Meta clients with a proposal are missing");
      assert.equal(metaAnalytics.metaMeasurements, 1, "Meta measurements are missing from the funnel");
      assert.equal(metaAnalytics.metaOrders, 1);
      assert.equal(metaAnalytics.metaRevenue, 350_000);
      assert.equal(metaAnalytics.costPerConversation, 10_000);
      assert.equal(metaAnalytics.cpl, 100_000, "Meta spend / attributed CRM leads is incorrect");
      assert.equal(metaAnalytics.cac, 100_000, "Meta spend / attributed CRM orders is incorrect");
      assert.equal(metaAnalytics.roas, 3.5, "Meta attributed revenue / spend is incorrect");
      assert.equal(metaAnalytics.metaConversion, 100);
      assert.equal(metaAnalytics.metaAttributionMissing, false);
      await runWithSystemAccess(async () => {
        await prisma.measurement.delete({ where: { id: measurement.id } });
        await prisma.commercialProposal.delete({ where: { id: proposal.id } });
        await prisma.leadCalculation.delete({ where: { id: calculation.id } });
        await prisma.order.delete({ where: { id: crmOrder.id } });
        await prisma.client.delete({ where: { id: crmClient.id } });
        await prisma.managementMarketingTask.delete({ where: { id: task.id } });
        await prisma.managementMarketingMetric.delete({ where: { id: metric.id } });
        await prisma.managementMarketingReport.delete({ where: { id: report.id } });
        await prisma.recruitmentVacancy.delete({ where: { id: vacancy.id } });
      });
      assert.equal(await prisma.managementMarketingTask.count({ where: { title: `${tag}-task` } }), 0);
    } finally {
      await runWithSystemAccess(async () => {
        await prisma.managementMarketingTask.deleteMany({ where: { createdById: director.id } });
        await prisma.managementMarketingMetric.deleteMany({ where: { createdById: director.id } });
        await prisma.managementMarketingReport.deleteMany({ where: { authorId: director.id } });
        await prisma.recruitmentVacancy.deleteMany({ where: { createdById: director.id } });
        await prisma.employeePayrollProfile.deleteMany({ where: { userId: director.id } });
        await prisma.user.deleteMany({ where: { id: director.id } });
      });
    }
  });
  console.log("marketing KPI, Kanban, vacancy lifecycle and cleanup checks passed");
}

void main().finally(() => prisma.$disconnect());
