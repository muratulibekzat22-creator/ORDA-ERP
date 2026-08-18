import "../../scripts/require-test-database";

import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import { expect, test, type Page } from "@playwright/test";
import {
  AdvanceRequestStatus,
  PayrollAccrualType,
  PayrollBonusRule,
  PayrollPaymentType,
  Role,
} from "@prisma/client";

import { prisma } from "../../lib/prisma";
import {
  createAccrual,
  ensurePeriod,
  requestAdvance,
  requestPaymentConfirmation,
  reviewAdvance,
  upsertPayrollProfile,
} from "../../lib/services/payroll.service";
import {
  runWithSystemAccess,
  runWithTenant,
  type TenantIdentity,
} from "../../lib/tenant-context";

test.describe.configure({ mode: "serial" });

const tag = `payroll-playwright-${Date.now()}`;
const password = `Payroll-${Date.now()}!`;
const managerEmail = `${tag}-manager@test.local`;
const directorEmail = `${tag}-director@test.local`;
const managerName = `${tag} manager`;
const otherManagerName = `${tag} other manager`;
const key = (name: string) => `${tag}:${name}`;

let tenant: TenantIdentity;
let companyId = 0;
let directorId = 0;
let managerId = 0;
let otherManagerId = 0;
let employeeId = 0;
let otherEmployeeId = 0;
let periodId = 0;
const clientIds: number[] = [];
const orderIds: number[] = [];

async function login(page: Page, email: string) {
  const csrfResponse = await page.request.get("/api/auth/csrf");
  const csrf = (await csrfResponse.json()) as { csrfToken: string };
  const response = await page.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email,
      password,
      callbackUrl: "/payroll",
      json: "true",
    },
  });
  expect(response.ok() || response.status() === 302).toBe(true);
  await page.goto("/payroll");
}

test.beforeAll(async () => {
  const company = await runWithSystemAccess(() => prisma.company.create({
    data: { slug: tag, name: `Payroll E2E ${tag}`, isDemo: false },
  }));
  companyId = company.id;
  tenant = {
    companyId,
    companySlug: company.slug,
    companyName: company.name,
    isDemo: false,
  };
  await runWithTenant(tenant, async () => {
    const hash = await bcrypt.hash(password, 10);
    const [director, manager, otherManager] = await Promise.all([
      prisma.user.create({ data: { name: `${tag} director`, email: directorEmail, password: hash, role: Role.DIRECTOR } }),
      prisma.user.create({ data: { name: managerName, email: managerEmail, password: hash, role: Role.MANAGER } }),
      prisma.user.create({ data: { name: otherManagerName, email: `${tag}-other@test.local`, password: hash, role: Role.MANAGER } }),
    ]);
    directorId = director.id;
    managerId = manager.id;
    otherManagerId = otherManager.id;
    const directorActor = { userId: director.id, role: Role.DIRECTOR, name: director.name };
    const managerActor = { userId: manager.id, role: Role.MANAGER, name: manager.name };
    const profile = await upsertPayrollProfile({ userId: manager.id, hiredAt: new Date("2026-01-01"), baseSalary: 200000 }, directorActor);
    const otherProfile = await upsertPayrollProfile({ userId: otherManager.id, hiredAt: new Date("2026-01-01"), baseSalary: 300000 }, directorActor);
    employeeId = profile.id;
    otherEmployeeId = otherProfile.id;
    const now = new Date();
    const period = await ensurePeriod(now.getFullYear(), now.getMonth() + 1);
    periodId = period.id;
    const orders = [];
    for (const [index, bonus] of [120000, 80000].entries()) {
      const client = await prisma.client.create({ data: { name: `${tag} client ${index + 1}`, phone: `77000000${companyId}${index}`, city: "Алматы", manager: manager.name, managerUserId: manager.id, amount: "500000", status: "WON" } });
      clientIds.push(client.id);
      const order = await prisma.order.create({ data: { number: `${tag}-ORD-${index + 1}`, clientId: client.id, address: "Алматы", staircase: "Прямая", material: "Ясень", amount: 500000, balance: 500000, companyProfit: 200000, manager: manager.name, managerUserId: manager.id, status: "Оформлен" } });
      orderIds.push(order.id);
      orders.push({ order, bonus });
    }
    await createAccrual({ employeeId, periodId, type: PayrollAccrualType.BASE_SALARY, amount: 200000, reason: "Оклад", key: key("salary"), requestHash: key("salary") }, directorActor);
    for (const [index, item] of orders.entries()) {
      await createAccrual({ employeeId, periodId, type: PayrollAccrualType.ORDER_BONUS, amount: item.bonus, orderId: item.order.id, bonusRule: PayrollBonusRule.FIXED, bonusValue: item.bonus, reason: `Бонус по заказу №${index + 1}`, key: key(`bonus-${index + 1}`), requestHash: key(`bonus-${index + 1}`) }, directorActor);
    }
    await createAccrual({ employeeId, periodId, type: PayrollAccrualType.PREMIUM, amount: 50000, reason: "Премия директора", key: key("premium"), requestHash: key("premium") }, directorActor);
    for (const [index, method] of ["cash", "bank_transfer"].entries()) {
      const request = await requestAdvance({ periodId, amount: 20000, method, comment: `Аванс №${index + 1}`, key: key(`advance-${index + 1}`), requestHash: key(`advance-${index + 1}`) }, managerActor);
      await reviewAdvance(request.id, { status: AdvanceRequestStatus.APPROVED, key: key(`advance-review-${index + 1}`), requestHash: key(`advance-review-${index + 1}`) }, directorActor);
    }
    await requestPaymentConfirmation({ periodId, amount: 100000, type: PayrollPaymentType.SALARY_PAYMENT, claimedPaymentDate: new Date(), method: "bank_transfer", comment: "Частичная выплата", key: key("reported-payment"), requestHash: key("reported-payment") }, managerActor);
  });
});

test.afterAll(async () => {
  if (!companyId) return;
  await runWithSystemAccess(async () => {
    const employeeIds = [employeeId, otherEmployeeId].filter(Boolean);
    const accrualIds = (await prisma.payrollAccrual.findMany({ where: { employeeId: { in: employeeIds } }, select: { id: true } })).map((row) => row.id);
    const paymentIds = (await prisma.payrollPayment.findMany({ where: { employeeId: { in: employeeIds } }, select: { id: true } })).map((row) => row.id);
    await prisma.companyLedgerEntry.deleteMany({ where: { OR: [{ payrollAccrualId: { in: accrualIds } }, { payrollPaymentId: { in: paymentIds } }] } });
    await prisma.payrollAdvanceRequest.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.payrollPaymentConfirmation.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.payrollAuditEvent.deleteMany({ where: { OR: [{ employeeId: { in: employeeIds } }, { actorId: { in: [directorId, managerId, otherManagerId] } }] } });
    await prisma.payrollPayment.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.payrollAccrual.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.employeeSalaryRate.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.employeePayrollProfile.deleteMany({ where: { id: { in: employeeIds } } });
    if (periodId) await prisma.payrollPeriod.deleteMany({ where: { id: periodId } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [directorId, managerId, otherManagerId].filter(Boolean) } } });
    await prisma.rolePermission.deleteMany({ where: { companyId } });
    await prisma.systemSettings.deleteMany({ where: { companyId } });
    await prisma.companySettings.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
  });
  await prisma.$disconnect();
});

test("manager sees only own calculated payroll at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, managerEmail);
  await expect(page.getByRole("heading", { name: "Моя зарплата" })).toBeVisible();
  await expect(page.getByText("450 000 ₸").first()).toBeVisible();
  await expect(page.getByText("40 000 ₸").first()).toBeVisible();
  await expect(page.getByText("410 000 ₸").first()).toBeVisible();
  await expect(page.getByText(otherManagerName)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Сообщить о получении" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Запросить аванс" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Назначить премию" })).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("director confirms manager report without re-entering payroll data", async ({ page }) => {
  let unexpectedDialog = false;
  page.on("dialog", async (dialog) => {
    unexpectedDialog = true;
    await dialog.dismiss();
  });
  await login(page, directorEmail);
  await expect(page.getByRole("heading", { name: "Зарплаты" })).toBeVisible();
  const pending = page.locator("article").filter({ hasText: managerName }).filter({ hasText: "100 000 ₸" });
  await expect(pending).toBeVisible();
  await pending.getByRole("button", { name: "Подтвердить выплату" }).click();
  await expect(page.getByText("Выплата подтверждена")).toBeVisible();
  expect(unexpectedDialog).toBe(false);
  await expect.poll(async () => runWithTenant(tenant, () => prisma.payrollPayment.count({ where: { employeeId, periodId, type: PayrollPaymentType.SALARY_PAYMENT } }))).toBe(1);
  const confirmation = await runWithTenant(tenant, () => prisma.payrollPaymentConfirmation.findFirstOrThrow({ where: { employeeId, periodId }, include: { confirmedPayment: { include: { ledgerEntry: true } } } }));
  assert.equal(Number(confirmation.amount), 100000);
  assert.equal(Number(confirmation.confirmedPayment?.amount), 100000);
  assert.equal(Number(confirmation.confirmedPayment?.ledgerEntry?.amount), 100000);
  await expect(page.getByText("310 000 ₸").first()).toBeVisible();
});
