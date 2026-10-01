import "dotenv/config";

import { Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getDashboardSummary } from "@/lib/services/dashboard.service";
import { getSalesPlan } from "@/lib/services/sales-plan.service";
import { runWithSystemAccess, runWithTenant } from "@/lib/tenant-context";

async function main() {
  if (process.env.VERCEL_ENV !== "production") {
    console.log("Sales plan release preparation skipped outside production");
    return;
  }
  const companies = await runWithSystemAccess(() =>
    prisma.company.findMany({
      where: { active: true, isDemo: false },
      select: { id: true, slug: true, name: true, isDemo: true },
    }),
  );
  for (const company of companies) {
    const leader = await runWithSystemAccess(() =>
      prisma.user.findFirst({
        where: {
          companyId: company.id,
          active: true,
          role: { in: [Role.OPERATIONS_DIRECTOR, Role.DIRECTOR] },
        },
        orderBy: { role: "desc" },
        select: { id: true, role: true },
      }),
    );
    if (!leader) continue;
    const snapshot = await runWithTenant(
      {
        companyId: company.id,
        companySlug: company.slug,
        companyName: company.name,
        isDemo: company.isDemo,
      },
      async () => {
        const plan = await getSalesPlan(undefined, {
          userId: leader.id,
          role: leader.role,
        });
        const months = [];
        for (const month of [...plan.history.map((row) => row.month), plan.month]) {
          const dashboard = await getDashboardSummary({
            role: Role.DIRECTOR,
            userId: leader.id,
            month,
          });
          if (!("finance" in dashboard)) continue;
          months.push({
            month,
            revenue: dashboard.finance.revenue,
            received: dashboard.finance.received,
            directExpenses: dashboard.finance.directExpenses,
            operatingExpenses: dashboard.finance.operatingExpenses,
            payrollAccrued: dashboard.finance.payrollAccrued,
            netProfit: dashboard.finance.netProfit,
            netMargin: dashboard.finance.netMargin,
            businessProfitability: dashboard.finance.businessProfitability,
            pricedRevenue: dashboard.finance.pricedRevenue,
            ordersWithMargin: dashboard.finance.ordersWithMargin,
            ordersWithoutMargin: dashboard.finance.ordersWithoutMargin,
            profitDataComplete: dashboard.finance.ordersWithoutMargin === 0,
          });
        }
        return {
          month: plan.month,
          targetRevenue: plan.plan.revenueTarget,
          targetOrders: plan.plan.orderTarget,
          actual: plan.actual,
          history: plan.history,
          managers: plan.managers.map((manager) => ({
            name: manager.managerName,
            actualRevenue: manager.actualRevenue,
            actualOrders: manager.actualOrders,
            contributionPercent: manager.contributionPercent,
          })),
          months,
        };
      },
    );
    console.log(`Sales plan release snapshot ${company.name}: ${JSON.stringify(snapshot)}`);
  }
}

runWithSystemAccess(main).finally(() => prisma.$disconnect());
