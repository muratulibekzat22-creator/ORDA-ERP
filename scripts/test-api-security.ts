import { execFile, spawn, type ChildProcess } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import net from "net";
import crypto from "crypto";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import { Permission, Role, type PrismaClient } from "@prisma/client";
import { del } from "@vercel/blob";
import { Agent } from "undici";

const testEnvironmentPath = path.join(process.cwd(), ".env.test.local");
const rawTestEnvironment = fs.existsSync(testEnvironmentPath) ? fs.readFileSync(testEnvironmentPath, "utf8").trim() : "";
const testEnvironment = fs.existsSync(testEnvironmentPath) ? dotenv.config({ path: testEnvironmentPath, quiet: true }).parsed : undefined;
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? testEnvironment?.TEST_DATABASE_URL ?? (rawTestEnvironment.startsWith("postgresql://") ? rawTestEnvironment : undefined);
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is missing from the environment and .env.test.local");
process.env.DATABASE_URL = testDatabaseUrl;
process.env.NEXTAUTH_URL = "http://127.0.0.1:3219";
process.env.NEXTAUTH_SECRET ||= crypto.randomBytes(32).toString("hex");
delete process.env.VERCEL;

const port = 3219;
const baseUrl = `http://127.0.0.1:${port}`;
const tag = `api-security-${Date.now()}`;
const password = "E2ePassword!123";
const userIds: number[] = [];
const measurerUserIds: number[] = [];
const productionUserIds: number[] = [];
const managerUserIds: number[] = [];
const generatedOrderIds: number[] = [];
const installationStage = "\u041c\u043e\u043d\u0442\u0430\u0436";
const productionStage = "\u0414\u0435\u0440\u0435\u0432\u043e";
let server: ChildProcess | undefined;
const execFileAsync = promisify(execFile);
const httpAgent = new Agent({ connections: 32, pipelining: 1, keepAliveTimeout: 1_000, keepAliveMaxTimeout: 1_000 });
let prisma!: PrismaClient;
let readinessTimer: NodeJS.Timeout | undefined;
let confirmedSessions = 0;
let partnerMatrixCompleted = false;
const temporaryRolePermissions: Permission[] = [];
let calculatorTariffBackup: Array<{ code: string; salePrice: number; internalPrice: number }> = [];

function apiFetch(input: string | URL, init: RequestInit = {}) {
  return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(15_000), dispatcher: httpAgent } as RequestInit);
}

function assert(value: boolean, message: string) {
  if (!value) throw new Error(message);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await apiFetch(`${baseUrl}/api/auth/csrf`);
      const ready = response.ok;
      await response.arrayBuffer();
      if (ready) return;
    } catch {
      // Server is starting.
    }
    await new Promise<void>((resolve) => {
      readinessTimer = setTimeout(resolve, 200);
    });
  }
  throw new Error("Next.js server did not start");
}

function waitForExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function isPortFree() {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(true);
    });
  });
}

async function stopServer() {
  if (readinessTimer) clearTimeout(readinessTimer);
  readinessTimer = undefined;
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill("SIGTERM");
    if (!(await waitForExit(server, 5_000)) && process.platform === "win32" && server.pid) {
      await execFileAsync("taskkill", ["/PID", String(server.pid), "/T", "/F"]).catch(() => undefined);
      assert(await waitForExit(server, 10_000), "next start did not exit after taskkill");
    }
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGKILL");
      assert(await waitForExit(server, 5_000), "next start did not exit");
    }
  }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await isPortFree()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`port ${port} is still in use`);
}

function cookieValue(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.().map((value) => value.split(";", 1)[0]).join("; ") ?? (headers.get("set-cookie")?.split(";", 1)[0] ?? "");
}

async function session(email: string) {
  const csrf = await apiFetch(`${baseUrl}/api/auth/csrf`);
  const initialCookie = cookieValue(csrf);
  const { csrfToken } = await csrf.json() as { csrfToken: string };
  const body = new URLSearchParams({ csrfToken, email, password, callbackUrl: baseUrl, json: "true" });
  const login = await apiFetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: initialCookie },
    body,
    redirect: "manual",
  });
  const cookie = [initialCookie, cookieValue(login)].filter(Boolean).join("; ");
  await login.arrayBuffer();
  assert(cookie.includes("next-auth"), `session cookie missing for ${email}`);
  const sessionResponse = await apiFetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } });
  const sessionPayload = await sessionResponse.json() as { user?: { email?: string; role?: string } };
  assert(sessionResponse.status === 200 && sessionPayload.user?.email === email && Boolean(sessionPayload.user.role), `authenticated session missing for ${email}`);
  confirmedSessions += 1;
  return cookie;
}

async function loginAttempt(email: string, candidatePassword: string) {
  const csrf = await apiFetch(`${baseUrl}/api/auth/csrf`);
  const initialCookie = cookieValue(csrf);
  const { csrfToken } = await csrf.json() as { csrfToken: string };
  const login = await apiFetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: initialCookie },
    body: new URLSearchParams({ csrfToken, email, password: candidatePassword, callbackUrl: baseUrl, json: "true" }),
    redirect: "manual",
  });
  const cookie = [initialCookie, cookieValue(login)].filter(Boolean).join("; ");
  await login.arrayBuffer();
  return cookie;
}

async function expectStatus(pathname: string, status: number, cookie: string, init: RequestInit = {}) {
  const response = await apiFetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { ...init.headers, Cookie: cookie },
  });
  assert(response.status === status, `${pathname}: expected ${status}, received ${response.status}`);
  const body = await response.arrayBuffer();
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

async function expectStatuses(pathname: string, statuses: number[], cookie: string, init: RequestInit = {}) {
  const response = await apiFetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { ...init.headers, Cookie: cookie },
  });
  assert(statuses.includes(response.status), `${pathname}: expected ${statuses.join(" or ")}, received ${response.status}`);
  const body = await response.arrayBuffer();
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

type MeasurementPayload = { id: number; measurerUserId: number | null; order: { id: number } };
type ProductionPayload = { id: number; masterUserId: number | null; stage: string; order: { id: number } };
type CalendarPayload = { events: Array<{ id: string; sourceType: "measurement" | "production"; orderId: number; assignedUserId: number | null; stage: string }>; orders: Array<{ id: number }> };
type DocumentPayload = { id: number; type: "OFFER" | "CONTRACT" | "ACT" | "INVOICE"; number: string; order: { id: number; client: { name: string } } };

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

function assertCalendarPayload(payload: CalendarPayload, ownEventIds: string[], foreignEventIds: string[], ownOrderIds: number[], userId: number, sourceType: "measurement" | "production", stages?: string[]) {
  assert(payload.events.length === ownEventIds.length, "calendar payload has an unexpected number of events");
  assert(ownEventIds.every((id) => payload.events.some((event) => event.id === id)), "calendar payload is missing an own event");
  assert(!foreignEventIds.some((id) => payload.events.some((event) => event.id === id)), "calendar payload contains a foreign event");
  assert(payload.events.every((event) => event.sourceType === sourceType && event.assignedUserId === userId), "calendar payload contains an unauthorized assignment");
  assert(payload.events.every((event) => ownOrderIds.includes(event.orderId)), "calendar payload leaks a foreign order");
  assert(payload.orders.every((order) => ownOrderIds.includes(order.id)), "calendar order list leaks a foreign order");
  if (stages) assert(payload.events.every((event) => stages.includes(event.stage)), "calendar payload contains an unauthorized stage");
}

async function main() {
  try {
    ({ prisma } = await import("@/lib/prisma"));
    const { createPayment } = await import("@/lib/services/payment.service");
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
      data: { name: tag, phone: `+7${Date.now()}`, city: "E2E", manager: `${tag}-manager`, amount: "0", status: "Новый" },
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

    const [firstInstaller, secondInstaller, firstProductionUser, secondProductionUser, director, accountant] = await Promise.all([
      prisma.user.create({ data: { name: `${tag}-installer-first`, email: `${tag}-installer-first@test.local`, password: hash, role: Role.INSTALLER } }),
      prisma.user.create({ data: { name: `${tag}-installer-second`, email: `${tag}-installer-second@test.local`, password: hash, role: Role.INSTALLER } }),
      prisma.user.create({ data: { name: `${tag}-production-first`, email: `${tag}-production-first@test.local`, password: hash, role: Role.PRODUCTION } }),
      prisma.user.create({ data: { name: `${tag}-production-second`, email: `${tag}-production-second@test.local`, password: hash, role: Role.PRODUCTION } }),
      prisma.user.create({ data: { name: `${tag}-director`, email: `${tag}-director@test.local`, password: hash, role: Role.DIRECTOR } }),
      prisma.user.create({ data: { name: `${tag}-accountant`, email: `${tag}-accountant@test.local`, password: hash, role: Role.ACCOUNTANT } }),
    ]);
    productionUserIds.push(firstInstaller.id, secondInstaller.id, firstProductionUser.id, secondProductionUser.id, director.id, accountant.id);
    for (const permission of [Permission.settings, Permission.orders]) {
      const existing = await prisma.rolePermission.findUnique({ where: { role_permission: { role: Role.ACCOUNTANT, permission } } });
      if (!existing) { await prisma.rolePermission.create({ data: { role: Role.ACCOUNTANT, permission } }); temporaryRolePermissions.push(permission); }
    }
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
      prisma.production.create({ data: { orderId: firstInstallerOrder.id, stage: installationStage, percent: 20, masterUserId: firstInstaller.id, master: firstInstaller.name, startDate: new Date() } }),
      prisma.production.create({ data: { orderId: secondInstallerOrder.id, stage: installationStage, percent: 30, masterUserId: secondInstaller.id, master: secondInstaller.name, startDate: new Date() } }),
      prisma.production.create({ data: { orderId: otherStageOrder.id, stage: productionStage, percent: 40, masterUserId: firstInstaller.id, master: firstInstaller.name, startDate: new Date() } }),
      prisma.production.create({ data: { orderId: firstProductionOrder.id, stage: productionStage, percent: 50, masterUserId: firstProductionUser.id, master: firstProductionUser.name, startDate: new Date() } }),
      prisma.production.create({ data: { orderId: secondProductionOrder.id, stage: productionStage, percent: 60, masterUserId: secondProductionUser.id, master: secondProductionUser.name, startDate: new Date() } }),
    ]);

    const manager = await prisma.user.create({
      data: { name: `${tag}-manager`, email: `${tag}-manager@test.local`, password: hash, role: Role.MANAGER },
    });
    await prisma.client.update({ where: { id: client.id }, data: { managerUserId: manager.id } });
    const lockoutUser = await prisma.user.create({
      data: { name: `${tag}-lockout`, email: `${tag}-lockout@test.local`, password: hash, role: Role.MANAGER },
    });
    managerUserIds.push(manager.id, lockoutUser.id);
    const financeData = await createPayment({ orderId: firstOrder.id, amount: 20, method: "cash", type: "payment", comment: tag });
    assert(financeData !== null, "failed to create temporary finance data");

    server = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(port)], { cwd: process.cwd(), stdio: "ignore", detached: false });
    await waitForServer();
    const health = await apiFetch(`${baseUrl}/api/health`);
    const healthPayload = await health.json() as Record<string, unknown>;
    assert(health.status === 200 && healthPayload.status === "ok" && healthPayload.database === "ok", "health endpoint is unavailable");
    assert(!("databaseHost" in healthPayload) && !("environment" in healthPayload) && !("envPresent" in healthPayload), "health endpoint exposes infrastructure details");
    assert(health.headers.get("x-content-type-options") === "nosniff" && health.headers.get("x-frame-options") === "DENY" && Boolean(health.headers.get("content-security-policy")), "security headers are missing");
    assert(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(health.headers.get("x-request-id") ?? ""), "safe request correlation id is missing");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failedCookie = await loginAttempt(lockoutUser.email, `${password}-wrong`);
      assert(!failedCookie.includes("next-auth.session-token") && !failedCookie.includes("__Secure-next-auth.session-token"), "invalid credentials created a session");
    }
    const lockedCookie = await loginAttempt(lockoutUser.email, password);
    assert(!lockedCookie.includes("next-auth.session-token") && !lockedCookie.includes("__Secure-next-auth.session-token"), "locked account created a session");
    const lockedUser = await prisma.user.findUniqueOrThrow({ where: { id: lockoutUser.id } });
    const failedAudits = await prisma.authAuditEvent.count({ where: { email: lockoutUser.email, success: false } });
    assert(Boolean(lockedUser.lockedUntil && lockedUser.lockedUntil > new Date()) && failedAudits >= 5, "login lockout or audit trail is missing");
    await prisma.user.update({ where: { id: lockoutUser.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
    await session(lockoutUser.email);
    console.log("authentication lockout and audit checks passed");

    const firstCookie = await session(firstUser.email);
    const secondCookie = await session(secondUser.email);
    const orders = await (await expectStatus("/api/orders", 200, firstCookie)).json() as Array<Record<string, unknown>>;
    assert(orders.length === 1 && orders[0].id === firstOrder.id && !orders.some((order) => order.id === secondOrder.id), "partner can only list own orders");
    assert(orders.every((order) => !("companyProfit" in order) && !("partnerPrice" in order) && !("partnerPaid" in order) && !("partnerBalance" in order) && !("userId" in order)), "partner list exposes internal financial fields");
    await expectStatus(`/api/orders/${firstOrder.id}`, 200, firstCookie);
    await expectStatus(`/api/orders/${secondOrder.id}`, 404, firstCookie);
    await expectStatus(`/api/partners/${firstPartner.id}`, 200, firstCookie);
    await expectStatus(`/api/partners/${secondPartner.id}`, 404, firstCookie);
    await expectStatus(`/api/proposal/${firstOrder.id}`, 200, firstCookie);
    await expectStatus(`/api/proposal/${secondOrder.id}`, 404, firstCookie);
    for (const pathname of [
      `/orders/${firstOrder.id}`,
      `/orders/${firstOrder.id}/offer`,
      `/orders/${firstOrder.id}/contract`,
      `/orders/${firstOrder.id}/act`,
      `/orders/${firstOrder.id}/invoice`,
      `/orders/${firstOrder.id}/print`,
      `/proposal/${firstOrder.id}`,
    ]) await expectStatus(pathname, 200, firstCookie);
    for (const pathname of [
      `/orders/${secondOrder.id}`,
      `/orders/${secondOrder.id}/offer`,
      `/orders/${secondOrder.id}/contract`,
      `/orders/${secondOrder.id}/act`,
      `/orders/${secondOrder.id}/invoice`,
      `/orders/${secondOrder.id}/print`,
      `/proposal/${secondOrder.id}`,
    ]) await expectStatus(pathname, 404, firstCookie);
    const beforePartnerPatch = await prisma.order.findUniqueOrThrow({ where: { id: firstOrder.id } });
    await expectStatus(`/api/orders/${firstOrder.id}`, 400, firstCookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partnerId: secondPartner.id, partnerPrice: "1", prepayment: "1", balance: "99", partnerPaid: "1", partnerBalance: "39", companyProfit: "60" }),
    });
    const afterPartnerPatch = await prisma.order.findUniqueOrThrow({ where: { id: firstOrder.id } });
    assert(["partnerId", "partnerPrice", "prepayment", "balance", "partnerPaid", "partnerBalance", "companyProfit"].every((key) => String(afterPartnerPatch[key as keyof typeof afterPartnerPatch]) === String(beforePartnerPatch[key as keyof typeof beforePartnerPatch])), "partner financial patch changed protected fields");

    const secondOrders = await (await expectStatus("/api/orders", 200, secondCookie)).json() as Array<Record<string, unknown>>;
    assert(secondOrders.length === 1 && secondOrders[0].id === secondOrder.id && !secondOrders.some((order) => order.id === firstOrder.id), "second partner can only list own orders");
    assert(secondOrders.every((order) => !("companyProfit" in order) && !("partnerPrice" in order) && !("partnerPaid" in order) && !("partnerBalance" in order) && !("userId" in order)), "second partner list exposes internal financial fields");
    await expectStatus(`/api/orders/${secondOrder.id}`, 200, secondCookie);
    await expectStatus(`/api/orders/${firstOrder.id}`, 404, secondCookie);
    await expectStatus(`/api/partners/${secondPartner.id}`, 200, secondCookie);
    await expectStatus(`/api/partners/${firstPartner.id}`, 404, secondCookie);
    await expectStatus(`/api/proposal/${secondOrder.id}`, 200, secondCookie);
    await expectStatus(`/api/proposal/${firstOrder.id}`, 404, secondCookie);
    await expectStatus("/api/warehouse", 403, firstCookie);
    partnerMatrixCompleted = true;
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

    const firstMeasurerCalendar = await (await expectStatus(`/api/calendar?assignedUserId=${secondMeasurer.id}`, 200, firstMeasurerCookie)).json() as CalendarPayload;
    assertCalendarPayload(firstMeasurerCalendar, [String(firstMeasurement.id)], [String(secondMeasurement.id)], [firstMeasurerOrder.id], firstMeasurer.id, "measurement");
    await expectStatus("/api/calendar", 200, firstMeasurerCookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceType: "measurement", id: firstMeasurement.id, startDate: "2026-09-01T10:00:00.000Z" }),
    });
    await expectStatuses("/api/calendar", [403, 404], firstMeasurerCookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceType: "measurement", id: secondMeasurement.id, startDate: "2026-09-02T10:00:00.000Z" }),
    });
    const secondAfterCalendarPatch = await prisma.measurement.findUniqueOrThrow({ where: { id: secondMeasurement.id } });
    assert(secondAfterCalendarPatch.visitDate.getTime() === secondMeasurement.visitDate.getTime(), "first measurer moved a foreign calendar event");

    const secondMeasurerCalendar = await (await expectStatus("/api/calendar", 200, secondMeasurerCookie)).json() as CalendarPayload;
    assertCalendarPayload(secondMeasurerCalendar, [String(secondMeasurement.id)], [String(firstMeasurement.id)], [secondMeasurerOrder.id], secondMeasurer.id, "measurement");
    console.log("measurer API security checks passed");

    const firstInstallerCookie = await session(firstInstaller.email);
    const secondInstallerCookie = await session(secondInstaller.email);
    const firstProductionCookie = await session(firstProductionUser.email);
    const secondProductionCookie = await session(secondProductionUser.email);
    const directorCookie = await session(director.email);
    await expectStatus("/api/company-finance", 403, firstProductionCookie);
    await expectStatus("/api/personal-finance", 403, firstProductionCookie);
    await expectStatus("/", 200, directorCookie);
    const orderCreationPayload = {
      clientId: client.id,
      address: "E2E order creation",
      staircase: "Straight",
      material: "Oak",
      amount: 1000,
      prepayment: 200,
      partnerPrice: 400,
      partnerPaid: 100,
    };
    const createdApiOrder = await (await expectStatus("/api/orders", 201, directorCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `${tag}-order` },
      body: JSON.stringify(orderCreationPayload),
    })).json() as { id: number; number: string; partnerPrice: string; partnerBalance: string; companyProfit: string };
    generatedOrderIds.push(createdApiOrder.id);
    assert(/^ORD-\d{8}-[A-F0-9]{12}$/.test(createdApiOrder.number), "order creation did not generate a stable number");
    assert(Number(createdApiOrder.partnerPrice) === 400 && Number(createdApiOrder.partnerBalance) === 300 && Number(createdApiOrder.companyProfit) === 600, "order creation calculated finances incorrectly");
    const repeatedApiOrder = await (await expectStatus("/api/orders", 200, directorCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `${tag}-order` },
      body: JSON.stringify(orderCreationPayload),
    })).json() as { id: number };
    assert(repeatedApiOrder.id === createdApiOrder.id, "order idempotency created a duplicate");
    await expectStatus("/api/orders", 409, directorCookie, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `${tag}-order` }, body: JSON.stringify({ ...orderCreationPayload, amount: 1001 }) });
    for (const invalidPayload of [
      { ...orderCreationPayload, clientId: 0 },
      { ...orderCreationPayload, amount: "NaN" },
      { ...orderCreationPayload, amount: -1 },
      { ...orderCreationPayload, prepayment: 1001 },
      { ...orderCreationPayload, partnerPaid: 401 },
    ]) await expectStatus("/api/orders", 400, directorCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `${tag}-invalid-${Math.random()}` },
      body: JSON.stringify(invalidPayload),
    });
    await expectStatus("/api/orders", 404, directorCookie, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `${tag}-missing-client` }, body: JSON.stringify({ ...orderCreationPayload, clientId: 999999999 }) });
    const parallelOrders = await Promise.all(["parallel-one", "parallel-two"].map(async (suffix) => {
      const order = await (await expectStatus("/api/orders", 201, directorCookie, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `${tag}-${suffix}` }, body: JSON.stringify(orderCreationPayload) })).json() as { id: number; number: string };
      generatedOrderIds.push(order.id);
      return order;
    }));
    assert(parallelOrders[0].number !== parallelOrders[1].number, "parallel order creation generated duplicate numbers");
    await expectStatus(`/orders/${firstOrder.id}`, 200, directorCookie);
    await expectStatus(`/orders/${secondOrder.id}`, 200, directorCookie);
    const workflowProductionIds = [firstInstallerProduction.id, secondInstallerProduction.id, otherStageProduction.id, firstProduction.id, secondProduction.id];

    const firstInstallerProductions = await (await expectStatus("/api/production", 200, firstInstallerCookie)).json() as ProductionPayload[];
    assertProductionPayload(firstInstallerProductions, [firstInstallerProduction.id], [secondInstallerProduction.id, otherStageProduction.id, firstProduction.id, secondProduction.id], [firstInstallerOrder.id], firstInstaller.id, [installationStage]);
    const secondInstallerProductions = await (await expectStatus("/api/production", 200, secondInstallerCookie)).json() as ProductionPayload[];
    assertProductionPayload(secondInstallerProductions, [secondInstallerProduction.id], [firstInstallerProduction.id, otherStageProduction.id, firstProduction.id, secondProduction.id], [secondInstallerOrder.id], secondInstaller.id, [installationStage]);

    const firstProductionProductions = await (await expectStatus("/api/production", 200, firstProductionCookie)).json() as ProductionPayload[];
    assertProductionPayload(firstProductionProductions, [firstProduction.id], [firstInstallerProduction.id, secondInstallerProduction.id, otherStageProduction.id, secondProduction.id], [firstProductionOrder.id], firstProductionUser.id, [productionStage]);
    const secondProductionProductions = await (await expectStatus("/api/production", 200, secondProductionCookie)).json() as ProductionPayload[];
    assertProductionPayload(secondProductionProductions, [secondProduction.id], [firstInstallerProduction.id, secondInstallerProduction.id, otherStageProduction.id, firstProduction.id], [secondProductionOrder.id], secondProductionUser.id, [productionStage]);

    const installerWarehouse = await (await expectStatus("/api/warehouse", 200, firstInstallerCookie)).json() as { orders: Array<{ id: number }> };
    assert(installerWarehouse.orders.length === 1 && installerWarehouse.orders[0].id === firstInstallerOrder.id, "installer warehouse scope is invalid");
    const productionWarehouse = await (await expectStatus("/api/warehouse", 200, firstProductionCookie)).json() as { orders: Array<{ id: number }> };
    assert(productionWarehouse.orders.length === 1 && productionWarehouse.orders[0].id === firstProductionOrder.id, "production warehouse scope is invalid");

    const firstInstallerCalendar = await (await expectStatus("/api/calendar", 200, firstInstallerCookie)).json() as CalendarPayload;
    assertCalendarPayload(firstInstallerCalendar, [String(firstInstallerProduction.id)], [String(secondInstallerProduction.id), String(otherStageProduction.id), String(firstProduction.id), String(secondProduction.id)], [firstInstallerOrder.id], firstInstaller.id, "production", [installationStage]);
    const secondInstallerCalendar = await (await expectStatus("/api/calendar", 200, secondInstallerCookie)).json() as CalendarPayload;
    assertCalendarPayload(secondInstallerCalendar, [String(secondInstallerProduction.id)], [String(firstInstallerProduction.id), String(otherStageProduction.id), String(firstProduction.id), String(secondProduction.id)], [secondInstallerOrder.id], secondInstaller.id, "production", [installationStage]);
    const firstProductionCalendar = await (await expectStatus("/api/calendar", 200, firstProductionCookie)).json() as CalendarPayload;
    assertCalendarPayload(firstProductionCalendar, [String(firstProduction.id)], [String(firstInstallerProduction.id), String(secondInstallerProduction.id), String(otherStageProduction.id), String(secondProduction.id)], [firstProductionOrder.id], firstProductionUser.id, "production", [productionStage]);
    const secondProductionCalendar = await (await expectStatus("/api/calendar", 200, secondProductionCookie)).json() as CalendarPayload;
    assertCalendarPayload(secondProductionCalendar, [String(secondProduction.id)], [String(firstInstallerProduction.id), String(secondInstallerProduction.id), String(otherStageProduction.id), String(firstProduction.id)], [secondProductionOrder.id], secondProductionUser.id, "production", [productionStage]);

    await expectStatus("/api/calendar", 200, firstInstallerCookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceType: "production", id: firstInstallerProduction.id, startDate: "2026-09-03T10:00:00.000Z" }),
    });
    for (const id of [secondInstallerProduction.id, otherStageProduction.id]) await expectStatuses("/api/calendar", [403, 404], firstInstallerCookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceType: "production", id, startDate: "2026-09-04T10:00:00.000Z" }),
    });
    await expectStatus("/api/production", 200, firstProductionCookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `${tag}:production-own` },
      body: JSON.stringify({ id: firstProduction.id, comment: "own production update" }),
    });
    await expectStatuses("/api/production", [403, 404], firstProductionCookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `${tag}:production-foreign` },
      body: JSON.stringify({ id: secondProduction.id, comment: "foreign production update" }),
    });
    await expectStatus("/api/production", 200, firstInstallerCookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `${tag}:installer-own` },
      body: JSON.stringify({ id: firstInstallerProduction.id, comment: "own installer update" }),
    });
    for (const body of [
      { id: otherStageProduction.id, comment: "non-installation update" },
      { id: firstInstallerProduction.id, stage: productionStage },
      { id: firstInstallerProduction.id, masterUserId: secondInstaller.id },
    ]) await expectStatuses("/api/production", [400, 403, 404], firstInstallerCookie, { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": `${tag}:installer-forbidden:${body.id}:${Object.keys(body).sort().join("-")}` }, body: JSON.stringify(body) });

    await expectStatus("/api/production", 400, directorCookie, { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": `${tag}:protected-fields` }, body: JSON.stringify({ id: firstProduction.id, completedAt: new Date().toISOString() }) });
    await expectStatus("/api/production", 400, directorCookie, { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": `${tag}:order-rebind` }, body: JSON.stringify({ id: firstProduction.id, orderId: secondProductionOrder.id }) });
    await expectStatus(`/api/production?id=${secondProduction.id}`, 404, firstProductionCookie);

    const directorProductions = await (await expectStatus("/api/production", 200, directorCookie)).json() as ProductionPayload[];
    assert(workflowProductionIds.every((id) => directorProductions.some((production) => production.id === id)), "director cannot see all workflow production records");
    assert(directorProductions.some((production) => production.id === otherStageProduction.id && production.stage === productionStage), "director cannot see the installer non-installation record");
    const directorCalendar = await (await expectStatus("/api/calendar", 200, directorCookie)).json() as CalendarPayload;
    assert([firstMeasurement.id, secondMeasurement.id, ...workflowProductionIds].every((id) => directorCalendar.events.some((event) => event.id === String(id))), "director cannot see all calendar events");
    await expectStatus("/api/calendar", 200, directorCookie, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceType: "production", id: secondProduction.id, startDate: "2026-09-05T10:00:00.000Z" }) });
    await expectStatus("/api/production", 200, directorCookie, { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": `${tag}:director-production` }, body: JSON.stringify({ id: secondProduction.id, comment: "director update" }) });
    console.log("installer and production API security checks passed");

    const managerCookie = await session(manager.email);
    const otherManagerCookie = await session(lockoutUser.email);
    const calculationPayload = { material: "Сосна", regularSteps: 10, platformEquivalents: [2, 3], installationRequired: false, deliveryRequired: false, lines: [{ code: "GLASS_RAILING", kind: "GLASS", name: "Стекло", quantity: 2, unit: "м²", unitCost: 100, unitSale: 200 }] };
    const leadOrderCountBefore = await prisma.order.count();
    const lead = await (await expectStatus("/api/clients", 201, managerCookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: `+7708${Date.now().toString().slice(-7)}`, estimateNotes: `${tag} лестница`, source: "WhatsApp" }) })).json() as { id: number };
    await expectStatus(`/api/clients/${lead.id}`, 404, otherManagerCookie);
    await expectStatus(`/api/clients/${lead.id}`, 404, otherManagerCookie, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comment: "IDOR" }) });
    await expectStatus(`/api/clients/${lead.id}`, 400, managerCookie, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ managerUserId: lockoutUser.id, stage: "WON", lostByUserId: lockoutUser.id }) });
    await expectStatus("/api/clients", 403, firstCookie);
    assert(await prisma.order.count() === leadOrderCountBefore, "creating an inquiry created an order");
    const leadCalculation = await (await expectStatus(`/api/clients/${lead.id}/calculations`, 201, managerCookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(calculationPayload) })).json() as Record<string, unknown>;
    assert(!("internalCost" in leadCalculation) && !JSON.stringify(leadCalculation).includes("workshopCost"), "lead calculation leaked internal prices");
    await expectStatus(`/api/clients/${lead.id}/calculations`, 409, managerCookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...calculationPayload, clientPrice: 1 }) });
    await expectStatus(`/api/clients/${lead.id}/follow-ups`, 201, managerCookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ calculationId: leadCalculation.id, oldPrice: Number(leadCalculation.clientPrice), proposedPrice: Number(leadCalculation.clientPrice) - 1, standardPrice: Number(leadCalculation.baseClientPrice), reason: "Клиент сказал: дорого", channel: "WhatsApp", nextActionAt: new Date(Date.now() + 86400000).toISOString() }) });
    const approval = await (await expectStatus("/api/price-approvals", 201, managerCookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ calculationId: leadCalculation.id, requestedSalePrice: Number(leadCalculation.clientPrice) - 1, reason: "Клиент сказал: дорого" }) })).json() as { id: number };
    const managerApprovals = await (await expectStatus("/api/price-approvals", 200, managerCookie)).json() as Array<Record<string, unknown>>;
    assert(managerApprovals.some((item) => item.id === approval.id) && !JSON.stringify(managerApprovals).includes("internalCost"), "approval list leaks internal prices");
    await expectStatus(`/api/price-approvals/${approval.id}`, 200, directorCookie, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "APPROVED" }) });
    const approvedCalculation = await (await expectStatus(`/api/price-approvals/${approval.id}/apply`, 201, managerCookie, { method: "POST" })).json() as Record<string, unknown>;
    assert(!("internalCost" in approvedCalculation), "approved calculation leaks internal price");
    await expectStatus(`/api/price-approvals/${approval.id}/apply`, 409, managerCookie, { method: "POST" });
    const rejectedApproval = await (await expectStatus("/api/price-approvals", 201, managerCookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ calculationId: leadCalculation.id, requestedSalePrice: Number(leadCalculation.clientPrice) - 2, reason: "security reject" }) })).json() as { id: number };
    await expectStatus(`/api/price-approvals/${rejectedApproval.id}`, 200, directorCookie, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "REJECTED" }) });
    const counterApproval = await (await expectStatus("/api/price-approvals", 201, managerCookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ calculationId: leadCalculation.id, requestedSalePrice: Number(leadCalculation.clientPrice) - 3, reason: "security counter" }) })).json() as { id: number };
    await expectStatus(`/api/price-approvals/${counterApproval.id}`, 200, directorCookie, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "COUNTER_OFFER", approvedSalePrice: Number(leadCalculation.clientPrice) - 2 }) });
    const leadProposal = await (await expectStatus(`/api/clients/${lead.id}/proposals`, 201, managerCookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ calculationId: approvedCalculation.id }) })).json() as { id: number; snapshot: unknown };
    assert(await prisma.order.count() === leadOrderCountBefore && !JSON.stringify(leadProposal).includes("workshopCost"), "proposal created an order or leaked internal prices");
    const immutableSnapshot = JSON.stringify(leadProposal.snapshot);
    const revisedProposal = await (await expectStatus(`/api/clients/${lead.id}/proposals`, 201, managerCookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ calculationId: approvedCalculation.id, previousProposalId: leadProposal.id }) })).json() as { id: number; version: number };
    assert(revisedProposal.version === 2 && JSON.stringify((await prisma.commercialProposal.findUniqueOrThrow({ where: { id: leadProposal.id } })).snapshot) === immutableSnapshot, "proposal version changed an immutable snapshot");
    await expectStatus(`/api/proposals/${leadProposal.id}`, 200, managerCookie, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Принято" }) });
    await expectStatus(`/api/clients/${lead.id}/stage`, 200, managerCookie, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: "WON", comment: "Клиент согласился оформить сделку" }) });
    const converted = await (await expectStatus(`/api/proposals/${leadProposal.id}/convert`, 201, managerCookie, { method: "POST" })).json() as { id: number };
    const repeatedConversion = await (await expectStatus(`/api/proposals/${leadProposal.id}/convert`, 201, managerCookie, { method: "POST" })).json() as { id: number };
    assert(converted.id === repeatedConversion.id, "repeated conversion created a duplicate order");
    generatedOrderIds.push(converted.id);
    await expectStatus("/api/company-finance", 403, managerCookie);
    await expectStatus("/api/personal-finance", 403, managerCookie);
    const managerCalculation = await (await expectStatus(`/api/orders/${firstOrder.id}/calculation`, 201, managerCookie, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `${tag}-calculation` }, body: JSON.stringify(calculationPayload) })).json() as Record<string, unknown>;
    assert(!("grossProfit" in managerCalculation) && !("totalCost" in managerCalculation) && Array.isArray(managerCalculation.lines) && !("unitCost" in (managerCalculation.lines as Array<Record<string, unknown>>)[0]), "manager calculation leaks internal costs");
    const repeatedManagerCalculation = await (await expectStatus(`/api/orders/${firstOrder.id}/calculation`, 200, managerCookie, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `${tag}-calculation` }, body: JSON.stringify(calculationPayload) })).json() as Record<string, unknown>;
    assert(!("grossProfit" in repeatedManagerCalculation), "idempotent calculation replay leaks internal costs");
    const managerOrderDetail = await (await expectStatus(`/api/orders/${firstOrder.id}`, 200, managerCookie)).json() as Record<string, unknown>;
    for (const field of ["companyProfit", "partnerPrice", "partnerPaid", "partnerBalance"]) assert(!(field in managerOrderDetail), `manager order detail leaks ${field}`);
    const managerOrderCalculations = managerOrderDetail.calculations as Array<Record<string, unknown>>;
    assert(Array.isArray(managerOrderCalculations) && managerOrderCalculations.length > 0, "manager order detail is missing client calculation");
    for (const field of ["workshopCost", "baseWorkshopCost", "workshopRate", "workshopAdjustment", "grossDifference", "materialCost", "installationCost", "deliveryCost", "otherDirectCosts", "totalCost", "grossProfit"]) assert(!(field in managerOrderCalculations[0]), `manager nested calculation leaks ${field}`);
    await expectStatus("/api/calculator-config", 403, managerCookie);
    const managerPricing = await (await expectStatus("/api/calculator-pricing", 200, managerCookie)).json() as { items: Array<Record<string, unknown>> };
    assert(managerPricing.items.length > 0 && managerPricing.items.every((item) => !("internalPrice" in item) && !("managerMinimumPrice" in item)), "manager calculator pricing leaks protected prices");
    const accountantCookie = await session(accountant.email);
    await expectStatus("/api/clients", 403, accountantCookie);
    const accountantConfig = await (await expectStatus("/api/calculator-config", 200, accountantCookie)).json() as { items: Array<Record<string, unknown>> };
    assert(accountantConfig.items.length > 0 && accountantConfig.items.every((item) => "internalPrice" in item), "accountant with permission cannot view internal calculator prices");
    await expectStatus("/api/calculator-config", 403, accountantCookie, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(accountantConfig) });
    const accountantCalculation = await (await expectStatus(`/api/orders/${firstOrder.id}/calculation`, 200, accountantCookie)).json() as Record<string, unknown>;
    assert("totalCost" in accountantCalculation && !("grossProfit" in accountantCalculation) && !("grossDifference" in accountantCalculation), "accountant calculation scope is invalid");
    for (const cookie of [managerCookie, firstMeasurerCookie, firstCookie]) await expectStatus("/api/settings", 403, cookie);
    const settingsBefore = await (await expectStatus("/api/settings", 200, directorCookie)).json() as { company: { name: string }; rolePermissions: Record<Role, string[]> };
    await expectStatus("/api/settings", 200, directorCookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: { name: settingsBefore.company.name } }),
    });
    await expectStatus("/api/settings", 409, directorCookie, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rolePermissions: { ...settingsBefore.rolePermissions, DIRECTOR: settingsBefore.rolePermissions.DIRECTOR.filter((permission) => permission !== "settings") } }),
    });
    await expectStatus("/api/employees", 400, directorCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `${tag}-partner-without-link`, email: `${tag}-partner-without-link@test.local`, password, role: Role.PARTNER }),
    });
    await expectStatus(`/api/employees/${director.id}`, 409, directorCookie, { method: "DELETE" });
    console.log("settings and employee security checks passed");
    const documentBody = { orderId: firstOrder.id, type: "OFFER", number: `${tag}-offer`, documentDate: "2026-08-05" };
    const createdDocument = await (await expectStatus("/api/documents", 201, managerCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `${tag}-document` },
      body: JSON.stringify(documentBody),
    })).json() as DocumentPayload;
    assert(createdDocument.order.id === firstOrder.id && createdDocument.type === "OFFER", "manager document creation returned an invalid payload");
    const repeatedDocument = await (await expectStatus("/api/documents", 200, managerCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `${tag}-document` },
      body: JSON.stringify(documentBody),
    })).json() as DocumentPayload;
    assert(repeatedDocument.id === createdDocument.id, "repeat document creation created a duplicate");
    await expectStatus("/api/documents", 409, managerCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `${tag}-document` },
      body: JSON.stringify({ ...documentBody, number: `${tag}-offer-changed` }),
    });
    const firstPartnerDocuments = await (await expectStatus("/api/documents", 200, firstCookie)).json() as DocumentPayload[];
    assert(firstPartnerDocuments.length === 1 && firstPartnerDocuments[0].id === createdDocument.id && firstPartnerDocuments[0].order.id === firstOrder.id, "partner document list contains an invalid order");
    const secondPartnerDocuments = await (await expectStatus("/api/documents", 200, secondCookie)).json() as DocumentPayload[];
    assert(secondPartnerDocuments.length === 0, "partner document list leaks a foreign document");
    await expectStatus("/api/documents", 403, firstCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: firstOrder.id, type: "CONTRACT", number: `${tag}-partner-contract`, documentDate: "2026-08-05" }),
    });
    await expectStatus(`/orders/${firstOrder.id}/offer`, 200, firstCookie);
    await expectStatus(`/orders/${secondOrder.id}/offer`, 404, firstCookie);
    const attachmentBody = new FormData();
    attachmentBody.set("orderId", String(firstOrder.id));
    attachmentBody.set("documentId", String(createdDocument.id));
    attachmentBody.set("file", new File(["%PDF-1.7\nprivate attachment"], `${tag}.pdf`, { type: "application/pdf" }));
    const attachmentKey = `${tag}-attachment`;
    const createdAttachment = await (await expectStatus("/api/attachments", 201, managerCookie, { method: "POST", headers: { "Idempotency-Key": attachmentKey }, body: attachmentBody })).json() as { id: number; fileName: string };
    const repeatedAttachment = await (await expectStatus("/api/attachments", 200, managerCookie, { method: "POST", headers: { "Idempotency-Key": attachmentKey }, body: attachmentBody })).json() as { id: number };
    assert(repeatedAttachment.id === createdAttachment.id, "attachment repeat created a duplicate");
    const conflictBody = new FormData(); conflictBody.set("orderId", String(firstOrder.id)); conflictBody.set("file", new File(["%PDF-1.7\nchanged"], `${tag}.pdf`, { type: "application/pdf" }));
    await expectStatus("/api/attachments", 409, managerCookie, { method: "POST", headers: { "Idempotency-Key": attachmentKey }, body: conflictBody });
    const invalidBody = new FormData(); invalidBody.set("orderId", String(firstOrder.id)); invalidBody.set("file", new File(["unsafe"], `${tag}.html`, { type: "text/html" }));
    await expectStatus("/api/attachments", 400, managerCookie, { method: "POST", headers: { "Idempotency-Key": `${tag}-unsafe` }, body: invalidBody });
    const ownAttachments = await (await expectStatus(`/api/attachments?orderId=${firstOrder.id}`, 200, firstCookie)).json() as Array<{ id: number }>;
    assert(ownAttachments.some((item) => item.id === createdAttachment.id), "partner cannot list own attachment");
    await expectStatus(`/api/attachments?orderId=${firstOrder.id}`, 404, secondCookie);
    const attachmentDownload = await expectStatus(`/api/attachments/${createdAttachment.id}`, 200, firstCookie);
    assert(await attachmentDownload.text() === "%PDF-1.7\nprivate attachment", "private attachment content is invalid");
    await expectStatus(`/api/attachments/${createdAttachment.id}`, 404, secondCookie);
    await expectStatus(`/api/attachments?id=${createdAttachment.id}`, 403, firstCookie, { method: "DELETE" });
    await expectStatus(`/api/attachments?id=${createdAttachment.id}`, 200, managerCookie, { method: "DELETE" });
    console.log("document and private attachment API security checks passed");
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
    const directorCalculation = await (await expectStatus(`/api/orders/${firstOrder.id}/calculation`, 200, directorCookie)).json() as Record<string, unknown>;
    assert("grossProfit" in directorCalculation && "totalCost" in directorCalculation, "director calculation is missing management totals");
    const directorCalculatorConfig = await (await expectStatus("/api/calculator-config", 200, directorCookie)).json() as { items: Array<Record<string, unknown>> };
    assert(directorCalculatorConfig.items.some((item) => item.uiName === "Дуб ламель" && item.salePrice === 85000 && item.internalPrice === 60000), "director calculator configuration is incomplete");
    calculatorTariffBackup = directorCalculatorConfig.items.map((item) => ({ code: String(item.code), salePrice: Number(item.salePrice), internalPrice: Number(item.internalPrice) }));
    const changedConfig = { items: directorCalculatorConfig.items.map((item) => item.code === "PINE_STEP" ? { ...item, salePrice: Number(item.salePrice) + 1, internalPrice: Number(item.internalPrice) + 1 } : item) };
    await expectStatus("/api/calculator-config", 200, directorCookie, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changedConfig) });
    const calculationAfterTariffChange = await (await expectStatus(`/api/orders/${firstOrder.id}/calculation`, 200, directorCookie)).json() as Record<string, unknown>;
    assert(String(calculationAfterTariffChange.clientPrice) === String(managerCalculation.clientPrice), "saved calculation changed after tariff update");
    await expectStatus("/api/calculator-config", 200, directorCookie, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(directorCalculatorConfig) });
    calculatorTariffBackup = [];
    const companyKey = `${tag}-company-ledger`;
    const ledgerBody = JSON.stringify({ direction: "EXPENSE", category: "RENT", amount: 100, operationDate: new Date().toISOString(), comment: tag });
    const companyEntry = await (await expectStatus("/api/company-finance", 201, directorCookie, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": companyKey }, body: ledgerBody })).json() as { id: number };
    const repeatedCompanyEntry = await (await expectStatus("/api/company-finance", 200, directorCookie, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": companyKey }, body: ledgerBody })).json() as { id: number };
    assert(companyEntry.id === repeatedCompanyEntry.id, "company ledger idempotency failed");
    await expectStatus("/api/company-finance", 409, directorCookie, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": companyKey }, body: JSON.stringify({ direction: "EXPENSE", category: "RENT", amount: 101, comment: tag }) });
    const personalEntry = await (await expectStatus("/api/personal-finance", 201, directorCookie, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `${tag}-personal-ledger` }, body: JSON.stringify({ direction: "EXPENSE", category: "FOOD", amount: 50, comment: tag }) })).json() as { id: number };
    assert(companyEntry.id > 0 && personalEntry.id > 0, "management ledger creation failed");
    const personalDashboard = await (await expectStatus("/api/personal-finance", 200, directorCookie)).json() as { entries: Array<{ id: number }>; totals: { balance: number } };
    assert(personalDashboard.entries.some((entry) => entry.id === personalEntry.id) && typeof personalDashboard.totals.balance === "number", "personal finance payload is invalid");
    const directorAnalytics = await (await expectStatus("/api/analytics", 200, directorCookie)).json() as { kpi: Record<string, number>; funnel: unknown[]; byManager: Array<{ manager: string }>; byPartner: Array<{ partner: string }>; months: unknown[]; filters: { partners: Array<{ id: number }> } };
    assert(typeof directorAnalytics.kpi.leads === "number" && Array.isArray(directorAnalytics.funnel) && Array.isArray(directorAnalytics.months) && directorAnalytics.byManager.some((item) => item.manager === tag) && directorAnalytics.filters.partners.some((partner) => partner.id === firstPartner.id), "director analytics payload is invalid");
    const directorSettings = await (await expectStatus("/api/settings", 200, directorCookie)).json() as Record<string, unknown>;
    assert(typeof directorSettings === "object" && directorSettings !== null, "director settings payload is invalid");
    const directorEmployees = await (await expectStatus("/api/employees", 200, directorCookie)).json() as Array<{ id: number; role: Role }>;
    assert(Array.isArray(directorEmployees) && directorEmployees.some((employee) => employee.id === director.id && employee.role === Role.DIRECTOR) && directorEmployees.some((employee) => employee.id === manager.id && employee.role === Role.MANAGER), "director employees payload is invalid");
    const directorDocuments = await (await expectStatus("/api/documents", 200, directorCookie)).json() as DocumentPayload[];
    assert(directorDocuments.some((document) => document.id === createdDocument.id && document.order.id === firstOrder.id), "director cannot see the temporary document");
    console.log("manager and director API security matrix passed");
  } finally {
    const cleanupErrors: unknown[] = [];
    try {
      await prisma.companyLedgerEntry.deleteMany({ where: { comment: tag } });
      await prisma.personalLedgerEntry.deleteMany({ where: { comment: tag } });
      if (generatedOrderIds.length) {
        await prisma.leadConversion.deleteMany({ where: { orderId: { in: generatedOrderIds } } });
        await prisma.orderEvent.deleteMany({ where: { orderId: { in: generatedOrderIds } } });
        await prisma.production.deleteMany({ where: { orderId: { in: generatedOrderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: generatedOrderIds } } });
      }
      await prisma.orderEvent.deleteMany({ where: { order: { number: { startsWith: tag } } } });
      await prisma.payment.deleteMany({ where: { order: { number: { startsWith: tag } } } });
      await prisma.materialMovement.deleteMany({ where: { order: { number: { startsWith: tag } } } });
      const attachmentPaths = (await prisma.attachment.findMany({ where: { order: { number: { startsWith: tag } } }, select: { pathname: true } })).map((item) => item.pathname);
      if (attachmentPaths.length) await del(attachmentPaths).catch(() => undefined);
      await prisma.attachment.deleteMany({ where: { order: { number: { startsWith: tag } } } });
      await prisma.document.deleteMany({ where: { order: { number: { startsWith: tag } } } });
      await prisma.measurement.deleteMany({ where: { order: { number: { startsWith: tag } } } });
      await prisma.production.deleteMany({ where: { order: { number: { startsWith: tag } } } });
      await prisma.order.deleteMany({ where: { number: { startsWith: tag } } });
      await prisma.partner.deleteMany({ where: { name: { startsWith: tag } } });
      const leadIds = (await prisma.client.findMany({ where: { comment: { startsWith: tag } }, select: { id: true } })).map(({ id }) => id);
      if (leadIds.length) {
        await prisma.commercialProposal.deleteMany({ where: { clientId: { in: leadIds } } });
        await prisma.leadCalculation.deleteMany({ where: { clientId: { in: leadIds } } });
      }
      await prisma.client.deleteMany({ where: { OR: [{ name: { startsWith: tag } }, { comment: { startsWith: tag } }] } });
      await prisma.authAuditEvent.deleteMany({ where: { email: { startsWith: tag } } });
      await prisma.user.deleteMany({ where: { id: { in: [...userIds, ...measurerUserIds, ...productionUserIds, ...managerUserIds] } } });
      if (temporaryRolePermissions.length) await prisma.rolePermission.deleteMany({ where: { role: Role.ACCOUNTANT, permission: { in: temporaryRolePermissions } } });
      if (calculatorTariffBackup.length) await prisma.$transaction(calculatorTariffBackup.map((item) => prisma.calculatorTariff.update({ where: { code: item.code }, data: { salePrice: item.salePrice, internalPrice: item.internalPrice } })));
      console.log("cleanup completed");
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      if (prisma) await prisma.$disconnect();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await httpAgent.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await stopServer();
      console.log(`server stopped; port ${port} is free`);
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "security harness cleanup failed");
  }

  assert(confirmedSessions > 0, "no authenticated session was confirmed");
  assert(partnerMatrixCompleted, "PARTNER security matrix did not complete");
  console.log(`SECURITY SUMMARY: session=confirmed (${confirmedSessions}); PARTNER matrix=passed; cleanup=completed; server=stopped; port ${port}=free`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
