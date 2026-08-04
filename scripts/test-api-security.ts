import "dotenv/config";

import { spawn, type ChildProcess } from "child_process";
import path from "path";
import bcrypt from "bcrypt";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createPayment } from "@/lib/services/payment.service";

const port = 3219;
const baseUrl = `http://127.0.0.1:${port}`;
const tag = `api-security-${Date.now()}`;
const password = "E2ePassword!123";
const userIds: number[] = [];
const measurerUserIds: number[] = [];
const productionUserIds: number[] = [];
const managerUserIds: number[] = [];
const installationStage = "\u041c\u043e\u043d\u0442\u0430\u0436";
const productionStage = "\u0417\u0430\u0433\u043e\u0442\u043e\u0432\u043a\u0430";
let server: ChildProcess | undefined;

function assert(value: boolean, message: string) {
  if (!value) throw new Error(message);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/auth/csrf`)).ok) return;
    } catch {
      // Server is starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Next.js server did not start");
}

async function stopServer() {
  if (!server || server.killed || server.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => server?.once("exit", () => resolve()));
  server.kill();
  await exited;
}

function cookieValue(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.().map((value) => value.split(";", 1)[0]).join("; ") ?? (headers.get("set-cookie")?.split(";", 1)[0] ?? "");
}

async function session(email: string) {
  const csrf = await fetch(`${baseUrl}/api/auth/csrf`);
  const initialCookie = cookieValue(csrf);
  const { csrfToken } = await csrf.json() as { csrfToken: string };
  const body = new URLSearchParams({ csrfToken, email, password, callbackUrl: baseUrl, json: "true" });
  const login = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: initialCookie },
    body,
    redirect: "manual",
  });
  const cookie = [initialCookie, cookieValue(login)].filter(Boolean).join("; ");
  assert(cookie.includes("next-auth"), `session cookie missing for ${email}`);
  return cookie;
}

async function expectStatus(pathname: string, status: number, cookie: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { ...init.headers, Cookie: cookie },
  });
  assert(response.status === status, `${pathname}: expected ${status}, received ${response.status}`);
  return response;
}

async function expectStatuses(pathname: string, statuses: number[], cookie: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { ...init.headers, Cookie: cookie },
  });
  assert(statuses.includes(response.status), `${pathname}: expected ${statuses.join(" or ")}, received ${response.status}`);
  return response;
}

type MeasurementPayload = { id: number; measurerUserId: number | null; order: { id: number } };
type ProductionPayload = { id: number; masterUserId: number | null; stage: string; order: { id: number } };

function assertMeasurementPayload(
  payload: MeasurementPayload[],
  ownMeasurementId: number,
  foreignMeasurementId: number,
  ownOrderId: number,
  foreignOrderId: number,
  userId: number,
) {
  assert(payload.length === 1, "measurer payload must contain exactly one measurement");
  assert(payload.some((measurement) => measurement.id === ownMeasurementId), "measurer payload is missing own measurement");
  assert(!payload.some((measurement) => measurement.id === foreignMeasurementId), "measurer payload contains foreign measurement");
  assert(payload.every((measurement) => measurement.measurerUserId === userId), "measurer payload contains another user's assignment");
  assert(payload.every((measurement) => measurement.order.id === ownOrderId), "measurer payload contains a foreign order");
  assert(!payload.some((measurement) => measurement.order.id === foreignOrderId), "measurer payload leaks a foreign order");
}

function assertProductionPayload(
  payload: ProductionPayload[],
  ownIds: number[],
  foreignIds: number[],
  ownOrderIds: number[],
  userId: number,
  stages: string[],
) {
  assert(payload.length === ownIds.length, "production payload has an unexpected number of records");
  assert(ownIds.every((id) => payload.some((production) => production.id === id)), "production payload is missing an own record");
  assert(!foreignIds.some((id) => payload.some((production) => production.id === id)), "production payload contains a foreign record");
  assert(payload.every((production) => production.masterUserId === userId), "production payload contains another user's assignment");
  assert(payload.every((production) => stages.includes(production.stage)), "production payload contains an unexpected stage");
  assert(payload.every((production) => ownOrderIds.includes(production.order.id)), "production payload leaks a foreign order");
}

async function main() {
  try {
    const hash = await bcrypt.hash(password, 10);
    const [firstUser, secondUser] = await Promise.all(
      ["first", "second"].map(async (name) => {
        const user = await prisma.user.create({
          data: { name: `${tag}-${name}`, email: `${tag}-${name}@test.local`, password: hash, role: Role.PARTNER },
        });
        userIds.push(user.id);
        return user;
      }),
    );
    const [firstPartner, secondPartner] = await Promise.all([
      prisma.partner.create({ data: { name: `${tag}-first`, userId: firstUser.id } }),
      prisma.partner.create({ data: { name: `${tag}-second`, userId: secondUser.id } }),
    ]);
    const client = await prisma.client.create({
      data: { name: tag, phone: `+7${Date.now()}`, city: "E2E", manager: tag, amount: "0", status: "Новый" },
    });
    const [firstOrder, secondOrder] = await Promise.all([
      prisma.order.create({
        data: { number: `${tag}-first`, clientId: client.id, partnerId: firstPartner.id, address: "E2E", staircase: "Прямая", material: "Дуб", amount: "100", prepayment: "0", balance: "100", partnerPrice: "40", partnerPaid: "0", partnerBalance: "40", companyProfit: "60", manager: tag, status: "Монтаж" },
      }),
      prisma.order.create({
        data: { number: `${tag}-second`, clientId: client.id, partnerId: secondPartner.id, address: "E2E", staircase: "Прямая", material: "Дуб", amount: "100", prepayment: "0", balance: "100", partnerPrice: "40", partnerPaid: "0", partnerBalance: "40", companyProfit: "60", manager: tag, status: "Монтаж" },
      }),
    ]);

    const [firstMeasurer, secondMeasurer] = await Promise.all(
      ["first", "second"].map((name) => prisma.user.create({
        data: { name: `${tag}-measurer-${name}`, email: `${tag}-measurer-${name}@test.local`, password: hash, role: Role.MEASURER },
      })),
    );
    measurerUserIds.push(firstMeasurer.id, secondMeasurer.id);
    const [firstMeasurerClient, secondMeasurerClient] = await Promise.all(
      ["first", "second"].map((name) => prisma.client.create({
        data: { name: `${tag}-measurer-${name}`, phone: `+7${Date.now()}${name === "first" ? "1" : "2"}`, city: "E2E", manager: tag, amount: "0", status: "New" },
      })),
    );
    const [firstMeasurerOrder, secondMeasurerOrder] = await Promise.all([
      prisma.order.create({
        data: { number: `${tag}-measurer-first`, clientId: firstMeasurerClient.id, address: "E2E", staircase: "Straight", material: "Oak", amount: "100", prepayment: "0", balance: "100", partnerPrice: "0", partnerPaid: "0", partnerBalance: "0", companyProfit: "100", manager: tag, status: "Measurement" },
      }),
      prisma.order.create({
        data: { number: `${tag}-measurer-second`, clientId: secondMeasurerClient.id, address: "E2E", staircase: "Straight", material: "Oak", amount: "100", prepayment: "0", balance: "100", partnerPrice: "0", partnerPaid: "0", partnerBalance: "0", companyProfit: "100", manager: tag, status: "Measurement" },
      }),
    ]);
    const [firstMeasurement, secondMeasurement] = await Promise.all([
      prisma.measurement.create({ data: { orderId: firstMeasurerOrder.id, measurerUserId: firstMeasurer.id, measurer: firstMeasurer.name, visitDate: new Date(), comment: "first original" } }),
      prisma.measurement.create({ data: { orderId: secondMeasurerOrder.id, measurerUserId: secondMeasurer.id, measurer: secondMeasurer.name, visitDate: new Date(), comment: "second original" } }),
    ]);

    const [firstInstaller, secondInstaller, firstProductionUser, secondProductionUser, director] = await Promise.all([
      prisma.user.create({ data: { name: `${tag}-installer-first`, email: `${tag}-installer-first@test.local`, password: hash, role: Role.INSTALLER } }),
      prisma.user.create({ data: { name: `${tag}-installer-second`, email: `${tag}-installer-second@test.local`, password: hash, role: Role.INSTALLER } }),
      prisma.user.create({ data: { name: `${tag}-production-first`, email: `${tag}-production-first@test.local`, password: hash, role: Role.PRODUCTION } }),
      prisma.user.create({ data: { name: `${tag}-production-second`, email: `${tag}-production-second@test.local`, password: hash, role: Role.PRODUCTION } }),
      prisma.user.create({ data: { name: `${tag}-director`, email: `${tag}-director@test.local`, password: hash, role: Role.DIRECTOR } }),
    ]);
    productionUserIds.push(firstInstaller.id, secondInstaller.id, firstProductionUser.id, secondProductionUser.id, director.id);
    const workflowClients = await Promise.all(
      ["installer-first", "installer-second", "installer-other-stage", "production-first", "production-second"].map((name, index) => prisma.client.create({
        data: { name: `${tag}-${name}`, phone: `+7${Date.now()}${index}`, city: "E2E", manager: tag, amount: "0", status: "New" },
      })),
    );
    const workflowOrders = await Promise.all(workflowClients.map((workflowClient, index) => prisma.order.create({
      data: { number: `${tag}-workflow-${index}`, clientId: workflowClient.id, address: "E2E", staircase: "Straight", material: "Oak", amount: "100", prepayment: "0", balance: "100", partnerPrice: "0", partnerPaid: "0", partnerBalance: "0", companyProfit: "100", manager: tag, status: "Workflow" },
    })));
    const [firstInstallerOrder, secondInstallerOrder, otherStageOrder, firstProductionOrder, secondProductionOrder] = workflowOrders;
    const [firstInstallerProduction, secondInstallerProduction, otherStageProduction, firstProduction, secondProduction] = await Promise.all([
      prisma.production.create({ data: { orderId: firstInstallerOrder.id, stage: installationStage, percent: 20, masterUserId: firstInstaller.id, master: firstInstaller.name } }),
      prisma.production.create({ data: { orderId: secondInstallerOrder.id, stage: installationStage, percent: 30, masterUserId: secondInstaller.id, master: secondInstaller.name } }),
      prisma.production.create({ data: { orderId: otherStageOrder.id, stage: productionStage, percent: 40, masterUserId: firstInstaller.id, master: firstInstaller.name } }),
      prisma.production.create({ data: { orderId: firstProductionOrder.id, stage: productionStage, percent: 50, masterUserId: firstProductionUser.id, master: firstProductionUser.name } }),
      prisma.production.create({ data: { orderId: secondProductionOrder.id, stage: productionStage, percent: 60, masterUserId: secondProductionUser.id, master: secondProductionUser.name } }),
    ]);

    const manager = await prisma.user.create({
      data: { name: `${tag}-manager`, email: `${tag}-manager@test.local`, password: hash, role: Role.MANAGER },
    });
    managerUserIds.push(manager.id);
    const financeData = await createPayment({ orderId: firstOrder.id, amount: 20, method: "cash", type: "payment", comment: tag });
    assert(financeData !== null, "failed to create temporary finance data");

    server = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "dev", "--port", String(port)], { cwd: process.cwd(), stdio: "ignore" });
    await waitForServer();

    const firstCookie = await session(firstUser.email);
    const secondCookie = await session(secondUser.email);
    const orders = await (await expectStatus("/api/orders", 200, firstCookie)).json() as Array<{ id: number }>;
    assert(orders.length === 1 && orders[0].id === firstOrder.id, "partner can only list own orders");
    await expectStatus(`/api/orders/${firstOrder.id}`, 200, firstCookie);
    await expectStatus(`/api/orders/${secondOrder.id}`, 404, firstCookie);
    await expectStatus(`/api/partners/${firstPartner.id}`, 200, firstCookie);
    await expectStatus(`/api/partners/${secondPartner.id}`, 404, firstCookie);
    await expectStatus(`/api/proposal/${firstOrder.id}`, 200, firstCookie);
    await expectStatus(`/api/proposal/${secondOrder.id}`, 404, firstCookie);
    await expectStatus(`/api/orders/${firstOrder.id}`, 400, firstCookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prepayment: "1", balance: "99", partnerPaid: "1", partnerBalance: "39", companyProfit: "60" }),
    });

    await expectStatus(`/api/orders/${secondOrder.id}`, 200, secondCookie);
    await expectStatus(`/api/orders/${firstOrder.id}`, 404, secondCookie);
    await expectStatus(`/api/partners/${secondPartner.id}`, 200, secondCookie);
    await expectStatus(`/api/partners/${firstPartner.id}`, 404, secondCookie);
    await expectStatus(`/api/proposal/${secondOrder.id}`, 200, secondCookie);
    await expectStatus(`/api/proposal/${firstOrder.id}`, 404, secondCookie);
    console.log("partner API security checks passed");

    const firstMeasurerCookie = await session(firstMeasurer.email);
    const secondMeasurerCookie = await session(secondMeasurer.email);
    const firstMeasurements = await (await expectStatus("/api/measurements", 200, firstMeasurerCookie)).json() as MeasurementPayload[];
    assertMeasurementPayload(firstMeasurements, firstMeasurement.id, secondMeasurement.id, firstMeasurerOrder.id, secondMeasurerOrder.id, firstMeasurer.id);
    const firstComment = "first updated";
    const firstPatch = await (await expectStatus(`/api/measurements/${firstMeasurement.id}`, 200, firstMeasurerCookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: firstComment }),
    })).json() as { comment: string | null };
    assert(firstPatch.comment === firstComment, "first measurer own PATCH did not persist comment");
    await expectStatuses(`/api/measurements/${secondMeasurement.id}`, [403, 404], firstMeasurerCookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: "first foreign update" }),
    });
    const secondAfterFirstForeignPatch = await prisma.measurement.findUniqueOrThrow({ where: { id: secondMeasurement.id } });
    assert(secondAfterFirstForeignPatch.comment === "second original", "first measurer changed a foreign measurement");

    const secondMeasurements = await (await expectStatus("/api/measurements", 200, secondMeasurerCookie)).json() as MeasurementPayload[];
    assertMeasurementPayload(secondMeasurements, secondMeasurement.id, firstMeasurement.id, secondMeasurerOrder.id, firstMeasurerOrder.id, secondMeasurer.id);
    const secondComment = "second updated";
    const secondPatch = await (await expectStatus(`/api/measurements/${secondMeasurement.id}`, 200, secondMeasurerCookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: secondComment }),
    })).json() as { comment: string | null };
    assert(secondPatch.comment === secondComment, "second measurer own PATCH did not persist comment");
    await expectStatuses(`/api/measurements/${firstMeasurement.id}`, [403, 404], secondMeasurerCookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: "second foreign update" }),
    });
    const firstAfterSecondForeignPatch = await prisma.measurement.findUniqueOrThrow({ where: { id: firstMeasurement.id } });
    assert(firstAfterSecondForeignPatch.comment === firstComment, "second measurer changed a foreign measurement");
    console.log("measurer API security checks passed");

    const firstInstallerCookie = await session(firstInstaller.email);
    const secondInstallerCookie = await session(secondInstaller.email);
    const firstProductionCookie = await session(firstProductionUser.email);
    const secondProductionCookie = await session(secondProductionUser.email);
    const directorCookie = await session(director.email);
    const workflowProductionIds = [firstInstallerProduction.id, secondInstallerProduction.id, otherStageProduction.id, firstProduction.id, secondProduction.id];

    const firstInstallerProductions = await (await expectStatus("/api/production", 200, firstInstallerCookie)).json() as ProductionPayload[];
    assertProductionPayload(firstInstallerProductions, [firstInstallerProduction.id], [secondInstallerProduction.id, otherStageProduction.id, firstProduction.id, secondProduction.id], [firstInstallerOrder.id], firstInstaller.id, [installationStage]);
    const secondInstallerProductions = await (await expectStatus("/api/production", 200, secondInstallerCookie)).json() as ProductionPayload[];
    assertProductionPayload(secondInstallerProductions, [secondInstallerProduction.id], [firstInstallerProduction.id, otherStageProduction.id, firstProduction.id, secondProduction.id], [secondInstallerOrder.id], secondInstaller.id, [installationStage]);

    const firstProductionProductions = await (await expectStatus("/api/production", 200, firstProductionCookie)).json() as ProductionPayload[];
    assertProductionPayload(firstProductionProductions, [firstProduction.id], [firstInstallerProduction.id, secondInstallerProduction.id, otherStageProduction.id, secondProduction.id], [firstProductionOrder.id], firstProductionUser.id, [productionStage]);
    const secondProductionProductions = await (await expectStatus("/api/production", 200, secondProductionCookie)).json() as ProductionPayload[];
    assertProductionPayload(secondProductionProductions, [secondProduction.id], [firstInstallerProduction.id, secondInstallerProduction.id, otherStageProduction.id, firstProduction.id], [secondProductionOrder.id], secondProductionUser.id, [productionStage]);

    const directorProductions = await (await expectStatus("/api/production", 200, directorCookie)).json() as ProductionPayload[];
    assert(workflowProductionIds.every((id) => directorProductions.some((production) => production.id === id)), "director cannot see all workflow production records");
    assert(directorProductions.some((production) => production.id === otherStageProduction.id && production.stage === productionStage), "director cannot see the installer non-installation record");
    console.log("installer and production API security checks passed");

    const managerCookie = await session(manager.email);
    const managerClients = await (await expectStatus(`/api/clients?search=${encodeURIComponent(tag)}`, 200, managerCookie)).json() as { data: Array<{ id: number }>; pagination: { total: number } };
    assert(Array.isArray(managerClients.data) && managerClients.pagination.total > 0 && managerClients.data.some((item) => item.id === client.id), "manager clients payload is invalid");
    const managerOrders = await (await expectStatus("/api/orders", 200, managerCookie)).json() as Array<{ id: number }>;
    assert(Array.isArray(managerOrders) && managerOrders.some((order) => order.id === firstOrder.id), "manager orders payload is invalid");
    const managerCalendar = await (await expectStatus("/api/calendar", 200, managerCookie)).json() as { events: Array<{ id: string }>; orders: Array<{ id: number }>; filters: { assignees: unknown[] } };
    assert(Array.isArray(managerCalendar.events) && Array.isArray(managerCalendar.orders) && Array.isArray(managerCalendar.filters.assignees), "manager calendar payload is invalid");
    assert(managerCalendar.events.some((event) => event.id === String(firstMeasurement.id)) && managerCalendar.orders.some((order) => order.id === firstOrder.id), "manager calendar payload is missing temporary data");
    await expectStatus(`/api/proposal/${firstOrder.id}`, 200, managerCookie);
    for (const pathname of ["/api/settings", "/api/employees", "/api/finance", "/api/analytics"]) await expectStatus(pathname, 403, managerCookie);
    console.log("manager API security matrix passed");

    const directorOrders = await (await expectStatus("/api/orders", 200, directorCookie)).json() as Array<{ id: number }>;
    assert(Array.isArray(directorOrders) && directorOrders.some((order) => order.id === firstOrder.id), "director orders payload is invalid");
    const directorClients = await (await expectStatus(`/api/clients?search=${encodeURIComponent(tag)}`, 200, directorCookie)).json() as { data: Array<{ id: number }>; pagination: { total: number } };
    assert(Array.isArray(directorClients.data) && directorClients.pagination.total > 0 && directorClients.data.some((item) => item.id === client.id), "director clients payload is invalid");
    const directorMeasurements = await (await expectStatus("/api/measurements", 200, directorCookie)).json() as Array<{ id: number; order: { id: number } }>;
    assert(Array.isArray(directorMeasurements) && directorMeasurements.some((measurement) => measurement.id === firstMeasurement.id && measurement.order.id === firstMeasurerOrder.id), "director measurements payload is invalid");
    const directorPartners = await (await expectStatus("/api/partners", 200, directorCookie)).json() as Array<{ id: number; stats: { totalOrders: number } }>;
    assert(Array.isArray(directorPartners) && directorPartners.some((partner) => partner.id === firstPartner.id && partner.stats.totalOrders > 0), "director partners payload is invalid");
    const directorWarehouse = await (await expectStatus("/api/warehouse", 200, directorCookie)).json() as { materials: unknown[]; movements: unknown[]; orders: Array<{ id: number }>; stats: Record<string, unknown> };
    assert(Array.isArray(directorWarehouse.materials) && Array.isArray(directorWarehouse.movements) && directorWarehouse.orders.some((order) => order.id === firstOrder.id) && typeof directorWarehouse.stats === "object", "director warehouse payload is invalid");
    const directorFinance = await (await expectStatus("/api/finance", 200, directorCookie)).json() as { rows: Array<{ id: number; prepayment: number }>; totals: Record<string, number>; managers: string[]; partners: Array<{ id: number }> };
    assert(Array.isArray(directorFinance.rows) && directorFinance.rows.some((row) => row.id === firstOrder.id && row.prepayment === 20) && typeof directorFinance.totals.turnover === "number" && Array.isArray(directorFinance.managers) && directorFinance.partners.some((partner) => partner.id === firstPartner.id), "director finance payload is invalid");
    const directorAnalytics = await (await expectStatus("/api/analytics", 200, directorCookie)).json() as { kpi: Record<string, number>; funnel: unknown[]; byManager: Array<{ manager: string }>; byPartner: Array<{ partner: string }>; months: unknown[]; filters: { partners: Array<{ id: number }> } };
    assert(typeof directorAnalytics.kpi.leads === "number" && Array.isArray(directorAnalytics.funnel) && Array.isArray(directorAnalytics.months) && directorAnalytics.byManager.some((item) => item.manager === tag) && directorAnalytics.filters.partners.some((partner) => partner.id === firstPartner.id), "director analytics payload is invalid");
    const directorSettings = await (await expectStatus("/api/settings", 200, directorCookie)).json() as Record<string, unknown>;
    assert(typeof directorSettings === "object" && directorSettings !== null, "director settings payload is invalid");
    const directorEmployees = await (await expectStatus("/api/employees", 200, directorCookie)).json() as Array<{ id: number; role: Role }>;
    assert(Array.isArray(directorEmployees) && directorEmployees.some((employee) => employee.id === director.id && employee.role === Role.DIRECTOR) && directorEmployees.some((employee) => employee.id === manager.id && employee.role === Role.MANAGER), "director employees payload is invalid");
    console.log("manager and director API security matrix passed");
  } finally {
    await stopServer();
    await prisma.orderEvent.deleteMany({ where: { order: { number: { startsWith: tag } } } });
    await prisma.payment.deleteMany({ where: { order: { number: { startsWith: tag } } } });
    await prisma.materialMovement.deleteMany({ where: { order: { number: { startsWith: tag } } } });
    await prisma.measurement.deleteMany({ where: { order: { number: { startsWith: tag } } } });
    await prisma.production.deleteMany({ where: { order: { number: { startsWith: tag } } } });
    await prisma.order.deleteMany({ where: { number: { startsWith: tag } } });
    await prisma.partner.deleteMany({ where: { name: { startsWith: tag } } });
    await prisma.client.deleteMany({ where: { name: { startsWith: tag } } });
    await prisma.user.deleteMany({ where: { id: { in: [...userIds, ...measurerUserIds, ...productionUserIds, ...managerUserIds] } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
