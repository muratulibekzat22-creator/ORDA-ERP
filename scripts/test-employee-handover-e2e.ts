import { createSanitizedTestServerEnv, testDatabaseFingerprint } from "./require-test-database";

import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import bcrypt from "bcrypt";
import { Role } from "@prisma/client";
import { chromium } from "@playwright/test";

import { prisma } from "../lib/prisma";
import { runWithTenant } from "../lib/tenant-context";
import { confirmHandover, editHandover, HandoverError, prepareHandover, previewHandover, rollbackHandover } from "../lib/services/employee-handover.service";
import { getManagerMonthlySales } from "../lib/services/manager-monthly-sales.service";
import { getEmployeeKpi } from "../lib/services/employee-kpi.service";
import { getReportsReadModel } from "../lib/services/report.service";
import { listCalendarTasks } from "../lib/services/calendar.service";

const target = new URL(process.env.TEST_DATABASE_URL!);
if (!["localhost", "127.0.0.1"].includes(target.hostname)) throw new Error("Handover E2E requires a disposable localhost database");
const tag = `handover-e2e-${Date.now()}`;
const selected = { clients: true, orders: true, tasks: true, followUps: true, approvals: true, blockers: true, marketingTasks: true, recruitment: true };
const month = new Date().toISOString().slice(0, 7);
const start = new Date(`${month}-01T00:00:00+05:00`);
const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1) - 5 * 60 * 60 * 1000);
const ensureConflict = async (action: () => Promise<unknown>, part: string) => {
  await assert.rejects(action, (error: unknown) => error instanceof HandoverError && error.status === 409 && error.message.includes(part));
};

async function verifyBrowserFlow(directorEmail: string, oldEmail: string, replacementEmail: string) {
  const port = 3227;
  const baseUrl = `http://127.0.0.1:${port}`;
  const probeToken = crypto.randomBytes(32).toString("hex");
  const server = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: process.cwd(),
    env: createSanitizedTestServerEnv({ NEXTAUTH_URL: baseUrl, NEXTAUTH_SECRET: crypto.randomBytes(32).toString("hex"), TEST_DATABASE_PROBE_TOKEN: probeToken }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  server.stdout?.on("data", (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-3000); });
  server.stderr?.on("data", (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-3000); });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (server.exitCode !== null) throw new Error(`Next server exited: ${diagnostics}`);
      try {
        const response = await fetch(`${baseUrl}/api/internal/test-database-identity`, { headers: { "x-test-database-probe-token": probeToken }, signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          const body = await response.json() as { fingerprint: string };
          assert.equal(body.fingerprint, testDatabaseFingerprint, "browser server connected to wrong database");
          ready = true;
          break;
        }
      } catch { /* waiting for local server */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert(ready, `Next server was not ready: ${diagnostics}`);
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200, `Local Next database health failed: ${await health.text()} | ${diagnostics}`);
    browser = await chromium.launch({ headless: true });
    const password = "HandoverTestPassword!2026";
    const signIn = async (email: string) => {
      const context = await browser!.newContext();
      const page = await context.newPage();
      await page.goto(`${baseUrl}/login`);
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole("button", { name: "Войти" }).click();
      return { context, page };
    };

    const director = await signIn(directorEmail);
    try { await director.page.waitForURL((url) => url.pathname !== "/login", { timeout: 15_000 }); }
    catch { throw new Error(`Director browser login failed: page=${director.page.url()}, alert=${await director.page.getByRole("alert").allTextContents()} | ${diagnostics}`); }
    await director.page.goto(`${baseUrl}/employee-handovers`);
    await director.page.getByRole("heading", { name: "Передача дел менеджера" }).waitFor();
    const handovers = await director.context.request.get(`${baseUrl}/api/employee-handovers`);
    assert.equal(handovers.status(), 200, `handover API: ${await handovers.text()} | page: ${await director.page.locator("main").last().innerText()} | server: ${diagnostics}`);
    const handoverBody = await handovers.json() as { plans: { id: number; status: string }[]; managers: { id: number; name: string; active: boolean }[] };
    await director.page.getByRole("heading", { name: "Ахбота ТЕСТ → Новая сотрудница ТЕСТ" }).first().waitFor({ timeout: 10_000 }).catch(async () => { throw new Error(`handover row missing: ${JSON.stringify(handoverBody)} | page: ${await director.page.locator("main").last().innerText()}`); });
    assert(handoverBody.plans.some((plan) => plan.status === "COMPLETED"));
    assert(handoverBody.managers.some((manager) => manager.name === "Ахбота ТЕСТ" && !manager.active));
    assert(handoverBody.managers.some((manager) => manager.name === "Новая сотрудница ТЕСТ" && manager.active));
    const gulsym = handoverBody.managers.find((manager) => manager.name === "Гульсим ТЕСТ")!;
    const former = handoverBody.managers.find((manager) => manager.name === "Ахбота ТЕСТ")!;
    const prepared = await director.context.request.post(`${baseUrl}/api/employee-handovers`, { data: { fromUserId: gulsym.id, toUserId: former.id, scheduledAt: new Date(Date.now() + 120_000).toISOString(), categories: selected } });
    assert.equal(prepared.status(), 201, `director API prepare: ${await prepared.text()}`);
    const temporaryPlan = await prepared.json() as { id: number };
    const updated = await director.context.request.patch(`${baseUrl}/api/employee-handovers`, { data: { id: temporaryPlan.id, action: "update", scheduledAt: new Date(Date.now() + 180_000).toISOString() } });
    assert.equal(updated.status(), 200, `director API update: ${await updated.text()}`);
    const cancelled = await director.context.request.patch(`${baseUrl}/api/employee-handovers`, { data: { id: temporaryPlan.id, action: "cancel" } });
    assert.equal(cancelled.status(), 200, `director API cancel: ${await cancelled.text()}`);
    const completedPlan = handoverBody.plans.find((plan) => plan.status === "COMPLETED")!;
    const unsafeRollback = await director.context.request.patch(`${baseUrl}/api/employee-handovers`, { data: { id: completedPlan.id, action: "rollback" } });
    assert.equal(unsafeRollback.status(), 409, `unsafe API rollback: ${await unsafeRollback.text()}`);
    await director.page.goto(`${baseUrl}/kpi`);
    await director.page.getByRole("heading", { name: "Ахбота ТЕСТ" }).waitFor();
    await director.page.getByRole("heading", { name: "Новая сотрудница ТЕСТ" }).waitFor();
    await director.page.getByLabel("Фильтр статуса сотрудника").selectOption("ACTIVE");
    assert.equal(await director.page.getByRole("heading", { name: "Ахбота ТЕСТ" }).count(), 0);
    await director.page.getByLabel("Фильтр статуса сотрудника").selectOption("TERMINATED");
    await director.page.getByRole("heading", { name: "Ахбота ТЕСТ" }).waitFor();
    assert.equal(await director.page.getByRole("heading", { name: "Новая сотрудница ТЕСТ" }).count(), 0);
    for (const route of ["/api/vacancies", "/api/reports?period=month", "/api/dashboard/sales?period=month"]) {
      const response = await director.context.request.get(`${baseUrl}${route}`);
      assert.equal(response.status(), 200, `director route ${route}: ${await response.text()} | ${diagnostics}`);
    }
    await director.page.goto(`${baseUrl}/reports`);
    await director.page.getByLabel("Статус менеджера").selectOption("TERMINATED");
    await director.page.getByLabel("Менеджер").locator("option").filter({ hasText: "Ахбота ТЕСТ" }).waitFor({ state: "attached" });
    const formerOptions = await director.page.getByLabel("Менеджер").locator("option").allTextContents();
    assert(formerOptions.some((name) => name.includes("Ахбота ТЕСТ")) && !formerOptions.some((name) => name.includes("Новая сотрудница ТЕСТ")), "report status filter does not separate former and current managers");
    console.log("Browser pass 1: director view, handover history and both KPI names passed");
    await director.context.close();

    const old = await signIn(oldEmail);
    await old.page.getByRole("alert").waitFor({ timeout: 15_000 });
    assert.equal(new URL(old.page.url()).pathname, "/login", "deactivated manager unexpectedly signed in");
    console.log("Browser pass 2: former manager access rejected");
    await old.context.close();

    const replacement = await signIn(replacementEmail);
    await replacement.page.waitForURL((url) => url.pathname !== "/login", { timeout: 15_000 });
    const deniedPage = await replacement.context.request.get(`${baseUrl}/employee-handovers`, { maxRedirects: 0 });
    assert([307, 308].includes(deniedPage.status()), "new manager unexpectedly reached director handover page");
    const denied = await replacement.context.request.get(`${baseUrl}/api/employee-handovers`);
    assert.equal(denied.status(), 403, "new manager unexpectedly has director handover access");
    await replacement.page.goto(`${baseUrl}/clients`);
    const clients = await replacement.context.request.get(`${baseUrl}/api/clients`);
    assert.equal(clients.status(), 200, `new manager clients API: ${await clients.text()} | page: ${await replacement.page.locator("main").last().innerText()} | server: ${diagnostics}`);
    const clientsBody = await clients.json() as { data: { name: string }[] };
    assert(clientsBody.data.some((client) => client.name === "Клиент Ахботы ТЕСТ"), `transferred client absent: ${JSON.stringify(clientsBody)} | page: ${await replacement.page.locator("main").last().innerText()}`);
    const orders = await replacement.context.request.get(`${baseUrl}/api/orders?page=1&limit=100`);
    assert.equal(orders.status(), 200, `new manager orders API: ${await orders.text()}`);
    const ordersBody = await orders.json() as { data: { manager: string }[] };
    assert(ordersBody.data.some((order) => order.manager === "Новая сотрудница ТЕСТ"), "new manager cannot see transferred order");
    await replacement.page.getByText("Я ознакомился и понял задачу").click();
    await replacement.page.getByLabel("Что понял / комментарий").fill("Приняла переданную задачу и свяжусь с клиентом");
    await replacement.page.getByRole("button", { name: "Подтвердить и перейти к работе" }).click();
    await replacement.page.getByRole("cell", { name: "Клиент Ахботы ТЕСТ" }).waitFor({ timeout: 15_000 }).catch(async () => { throw new Error(`new manager client UI missing: ${await replacement.page.locator("main").last().innerText()} | server: ${diagnostics}`); });
    console.log("Browser pass 3: new manager signs in, sees transferred client and cannot manage handovers");
    await replacement.context.close();
  } finally {
    await browser?.close();
    server.kill();
  }
}

async function main() {
  const company = await prisma.company.create({ data: { slug: tag, name: "ORDA HANDOVER TEST" } });
  const identity = { companyId: company.id, companySlug: company.slug, companyName: company.name, isDemo: false };
  try {
    await runWithTenant(identity, async () => {
      const password = await bcrypt.hash("HandoverTestPassword!2026", 12);
      const [director, old, gulsym, replacement] = await Promise.all([
        prisma.user.create({ data: { name: "Директор ТЕСТ", email: `${tag}-director@test.local`, password, role: Role.DIRECTOR } }),
        prisma.user.create({ data: { name: "Ахбота ТЕСТ", email: `${tag}-old@test.local`, password, role: Role.MANAGER } }),
        prisma.user.create({ data: { name: "Гульсим ТЕСТ", email: `${tag}-gulsym@test.local`, password, role: Role.MANAGER } }),
        prisma.user.create({ data: { name: "Новая сотрудница ТЕСТ", email: `${tag}-new@test.local`, password, role: Role.MANAGER, active: false } }),
      ]);
      await prisma.employeePayrollProfile.createMany({ data: [
        { companyId: company.id, userId: old.id, name: old.name, position: "Менеджер", hiredAt: new Date(start.getTime() - 86_400_000), active: true, baseSalary: 0 },
        { companyId: company.id, userId: gulsym.id, name: gulsym.name, position: "Менеджер", hiredAt: new Date(start.getTime() - 86_400_000), active: true, baseSalary: 0 },
        { companyId: company.id, userId: replacement.id, name: replacement.name, position: "Менеджер", hiredAt: new Date(), active: false, baseSalary: 0 },
      ] });
      const client = await prisma.client.create({ data: { name: "Клиент Ахботы ТЕСТ", phone: "+70000000001", city: "Семей", manager: old.name, managerUserId: old.id, amount: "1000000", status: "Новая заявка" } });
      const order = await prisma.order.create({ data: { number: `${tag}-order`, clientId: client.id, address: "Тестовая улица", staircase: "1", material: "Металл", amount: 1_000_000, manager: old.name, managerUserId: old.id } });
      const task = await prisma.calendarTask.create({ data: { title: "Позвонить клиенту ТЕСТ", type: "CALL", dueAt: new Date(Date.now() + 86_400_000), assigneeId: old.id, creatorId: director.id, clientId: client.id, orderId: order.id, acknowledgementRequired: true, acknowledgedAt: new Date(), acknowledgementComment: "Ахбота ознакомлена" } });
      const calculation = await prisma.leadCalculation.create({ data: { clientId: client.id, material: "Металл", baseClientPrice: 1_000_000, clientPrice: 900_000, internalCost: 600_000, snapshot: {}, authorId: old.id, authorName: old.name } });
      const approval = await prisma.priceApprovalRequest.create({ data: { clientId: client.id, calculationId: calculation.id, managerUserId: old.id, managerName: old.name, requestedByUserId: old.id, requestedByName: old.name, standardSalePrice: 1_000_000, currentSalePrice: 900_000, requestedSalePrice: 850_000, snapshotHash: tag, reason: "Тестовая скидка" } });
      const followUp = await prisma.leadFollowUp.create({ data: { clientId: client.id, oldPrice: 1_000_000, proposedPrice: 900_000, standardPrice: 1_000_000, discount: 100_000, reason: "Тест", channel: "Звонок", managerUserId: old.id, managerName: old.name, createdByUserId: old.id, createdByName: old.name, nextActionAt: new Date(Date.now() + 86_400_000) } });
      const blocker = await prisma.orderBlocker.create({ data: { orderId: order.id, type: "OTHER", severity: "WARNING", title: "Проверка ТЕСТ", responsibleUserId: old.id, openedById: director.id, idempotencyKey: `${tag}-blocker`, requestHash: tag } });
      await prisma.salesPlan.create({ data: { year: Number(month.slice(0, 4)), month: Number(month.slice(5)), revenueTarget: 2_000_000, orderTarget: 2, createdById: director.id, managerTargets: { create: [{ managerId: old.id, revenueTarget: 1_000_000, orderTarget: 1 }, { managerId: gulsym.id, revenueTarget: 1_000_000, orderTarget: 1 }] } } });

      // Pass 1: preview and cancel are read-only; future schedule cannot be confirmed.
      const before = await previewHandover(old.id, selected);
      for (const key of ["clients", "orders", "tasks", "followUps", "approvals", "blockers"] as const) assert.equal(before.counts[key], 1, `preview ${key}`);
      assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).managerUserId, old.id);
      const draft = await prepareHandover({ fromUserId: old.id, toUserId: replacement.id, scheduledAt: new Date(Date.now() + 60_000), categories: selected, actorId: director.id });
      await ensureConflict(() => confirmHandover(draft.id, before.fingerprint, director.id), "время");
      await editHandover(draft.id, { action: "cancel" });
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: old.id } })).active, true);
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).managerUserId, old.id);
      console.log("Pass 1: preview, future schedule and cancellation passed");

      // Pass 2: stale preview must abort, then all ownership changes commit together.
      const pending = await prepareHandover({ fromUserId: old.id, toUserId: replacement.id, scheduledAt: new Date(Date.now() + 60_000), categories: selected, actorId: director.id });
      await prisma.employeeHandover.update({ where: { id: pending.id }, data: { scheduledAt: new Date(Date.now() - 1_000) } });
      await prisma.calendarTask.update({ where: { id: task.id }, data: { title: "Позвонить клиенту ТЕСТ (обновлено)" } });
      await ensureConflict(() => confirmHandover(pending.id, before.fingerprint, director.id), "Список изменился");
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: old.id } })).active, true);
      const fresh = await previewHandover(old.id, selected);
      const report = await confirmHandover(pending.id, fresh.fingerprint, director.id);
      for (const key of ["clients", "orders", "tasks", "followUps", "approvals", "blockers"] as const) assert.equal(report.moved[key], 1, `transfer ${key}`);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: old.id } })).active, false);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: replacement.id } })).active, true);
      assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).managerUserId, replacement.id);
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).managerUserId, replacement.id);
      assert.equal((await prisma.calendarTask.findUniqueOrThrow({ where: { id: task.id } })).assigneeId, replacement.id);
      assert.equal((await prisma.priceApprovalRequest.findUniqueOrThrow({ where: { id: approval.id } })).requestedByName, old.name);
      assert.equal((await prisma.leadFollowUp.findUniqueOrThrow({ where: { id: followUp.id } })).createdByName, old.name);
      assert.equal((await prisma.orderBlocker.findUniqueOrThrow({ where: { id: blocker.id } })).responsibleUserId, replacement.id);
      assert.equal(await prisma.employeeHandoverNotice.count({ where: { handoverId: pending.id, userId: replacement.id } }), 1);
      assert.equal(await prisma.orderEvent.count({ where: { orderId: order.id, title: "Передача дел" } }), 1);
      const monthly = await getManagerMonthlySales({ companyId: company.id, start, end });
      assert.equal(monthly.rows.find((row) => row.userId === old.id)?.orders, 1, "old manager keeps registered sale");
      assert.equal(monthly.rows.find((row) => row.userId === replacement.id)?.orders, 0, "new manager does not inherit registered sale");
      const kpi = await getEmployeeKpi(month, { userId: director.id, role: Role.DIRECTOR });
      assert(kpi.rows.some((row) => row.userId === old.id && !row.active), "former manager missing or active in historical KPI");
      assert(kpi.rows.some((row) => row.userId === replacement.id && row.active), "new manager missing or inactive in KPI");
      const reports = await getReportsReadModel(new URLSearchParams({ period: "month" }), { id: director.id, role: Role.DIRECTOR });
      assert(reports.managers.some((row) => row.id === old.id && row.orders === 1 && !row.active), "former manager missing from report");
      assert(reports.managers.some((row) => row.id === replacement.id && row.active), "new manager missing from report");
      const calendar = await listCalendarTasks({ userId: replacement.id, role: Role.MANAGER, name: replacement.name }, { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 3 * 86_400_000) });
      assert(calendar.tasks.some((row) => row.id === task.id && row.handover?.oldName === old.name), "handover absent in task card");
      console.log("Pass 2: atomic transfer, ownership, audit, notification, KPI and reports passed");

      // Pass 3: rollback restores the old owner, then a new action makes rollback unsafe.
      await rollbackHandover(pending.id, director.id);
      assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).managerUserId, old.id);
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).manager, old.name);
      assert.equal((await prisma.calendarTask.findUniqueOrThrow({ where: { id: task.id } })).acknowledgementComment, "Ахбота ознакомлена");
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: old.id } })).active, true);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: replacement.id } })).active, false);
      const second = await prepareHandover({ fromUserId: old.id, toUserId: replacement.id, scheduledAt: new Date(Date.now() + 60_000), categories: selected, actorId: director.id });
      await prisma.employeeHandover.update({ where: { id: second.id }, data: { scheduledAt: new Date(Date.now() - 1_000) } });
      const secondPreview = await previewHandover(old.id, selected);
      await confirmHandover(second.id, secondPreview.fingerprint, director.id);
      await prisma.client.create({ data: { name: "Новая заявка ТЕСТ", phone: "+70000000002", city: "Семей", manager: replacement.name, managerUserId: replacement.id, amount: "500000", status: "Новая заявка" } });
      await ensureConflict(() => rollbackHandover(second.id, director.id), "Автоматический откат заблокирован");
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: replacement.id } })).active, true);
      console.log("Pass 3: safe rollback, restored name and acknowledgement, incompatible-change guard passed");
      await prisma.$disconnect();
      try { await verifyBrowserFlow(director.email, old.email, replacement.email); }
      finally { await prisma.$connect(); }
    });
  } finally {
    await runWithTenant(identity, async () => {
      await prisma.employeeHandoverNotice.deleteMany({ where: { handover: { companyId: company.id } } });
      await prisma.employeeHandoverItem.deleteMany({ where: { handover: { companyId: company.id } } });
      await prisma.employeeHandover.deleteMany({ where: { companyId: company.id } });
      await prisma.calendarTaskAudit.deleteMany({ where: { task: { companyId: company.id } } });
      await prisma.calendarTask.deleteMany({ where: { companyId: company.id } });
      await prisma.orderEvent.deleteMany({ where: { companyId: company.id } });
      await prisma.orderBlocker.deleteMany({ where: { order: { companyId: company.id } } });
      await prisma.priceApprovalRequest.deleteMany({ where: { client: { companyId: company.id } } });
      await prisma.leadFollowUp.deleteMany({ where: { client: { companyId: company.id } } });
      await prisma.leadCalculation.deleteMany({ where: { client: { companyId: company.id } } });
      await prisma.clientInteraction.deleteMany({ where: { client: { companyId: company.id } } });
      await prisma.salesPlanManagerTarget.deleteMany({ where: { plan: { companyId: company.id } } });
      await prisma.salesPlan.deleteMany({ where: { companyId: company.id } });
      await prisma.order.deleteMany({ where: { companyId: company.id } });
      await prisma.client.deleteMany({ where: { companyId: company.id } });
      await prisma.employeePayrollProfile.deleteMany({ where: { companyId: company.id } });
      await prisma.rolePermission.deleteMany({ where: { companyId: company.id } });
      const users = await prisma.user.findMany({ where: { companyId: company.id }, select: { id: true } });
      await prisma.authAuditEvent.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
      await prisma.user.deleteMany({ where: { companyId: company.id } });
    });
    await prisma.company.delete({ where: { id: company.id } });
    await prisma.$disconnect();
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
