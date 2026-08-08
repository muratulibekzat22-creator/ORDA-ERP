import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Role } from "@prisma/client";
import { dashboardPeriodRange, getDashboardSummary } from "../lib/services/dashboard.service";
import { prisma } from "../lib/prisma";

if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
  throw new Error("Dashboard integration requires TEST_DATABASE_URL");

async function main() {
  const range = dashboardPeriodRange("month", new Date("2026-08-31T20:30:00.000Z"));
  assert.equal(range.start.toISOString(), "2026-08-31T19:00:00.000Z");
  const userId = -2147483000;
  const [director, manager, accountant, production, installer] = await Promise.all([
    getDashboardSummary({ role: Role.DIRECTOR, userId, period: "month" }),
    getDashboardSummary({ role: Role.MANAGER, userId, period: "month" }),
    getDashboardSummary({ role: Role.ACCOUNTANT, userId, period: "month" }),
    getDashboardSummary({ role: Role.PRODUCTION, userId, period: "month" }),
    getDashboardSummary({ role: Role.INSTALLER, userId, period: "month" }),
  ]);
  assert.equal(director.role, Role.DIRECTOR);
  assert("managers" in director, "director manager performance missing");
  assert.equal(manager.role, Role.MANAGER);
  assert(!("managers" in manager), "manager received company manager performance");
  assert.equal(accountant.role, Role.ACCOUNTANT);
  assert(!("newLeads" in accountant.metrics), "accountant received CRM funnel projection");
  assert.equal(production.role, Role.PRODUCTION);
  assert(!("totalSales" in production.metrics), "production received finance projection");
  assert(!("payrollPayable" in production.metrics), "production received payroll projection");
  assert.equal(installer.role, Role.INSTALLER);
  assert(!("totalSales" in installer.metrics), "installer received company finance projection");

  const route = readFileSync("app/api/dashboard/sales/route.ts", "utf8");
  assert(!route.includes("searchParams.get(\"role\")"), "dashboard accepts role override");
  const dashboard = readFileSync("components/dashboard/DirectorCockpit.tsx", "utf8");
  for (const label of ["Продажи", "Получено", "Осталось получить", "Новые заявки", "Payroll к выплате", "На заготовке", "Установки сегодня"])
    assert.ok(dashboard.includes(label), `dashboard label missing: ${label}`);
  for (const routeName of ["/clients", "/orders", "/calendar", "/warehouse", "/finance", "/payroll", "/production"])
    assert.ok(dashboard.includes(routeName), `dashboard route missing: ${routeName}`);
  console.log("five role dashboard projections, scoping and navigation contracts passed");
}

void main().finally(() => prisma.$disconnect());
