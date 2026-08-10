import { testDatabaseFingerprint } from "./require-test-database";
import { Role } from "@prisma/client";

const configuredBaseUrl = process.env.ORDA_TEST_BASE_URL;
if (!configuredBaseUrl || !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(configuredBaseUrl)) throw new Error("Role login mutation test requires an explicit loopback ORDA_TEST_BASE_URL");
const baseUrl: string = configuredBaseUrl;
const configuredProbeToken = process.env.TEST_DATABASE_PROBE_TOKEN;
if (!configuredProbeToken) throw new Error("Role login mutation test requires TEST_DATABASE_PROBE_TOKEN");
const databaseProbeToken: string = configuredProbeToken;
const accounts = [
  [Role.DIRECTOR, "director.test@altynsapa.kz", "ORDA_TEST_DIRECTOR_PASSWORD"],
  [Role.MANAGER, "manager.test@altynsapa.kz", "ORDA_TEST_MANAGER_PASSWORD"],
  [Role.ACCOUNTANT, "accountant.test@altynsapa.kz", "ORDA_TEST_ACCOUNTANT_PASSWORD"],
  [Role.MEASURER, "measurer.test@altynsapa.kz", "ORDA_TEST_MEASURER_PASSWORD"],
  [Role.PRODUCTION, "production.test@altynsapa.kz", "ORDA_TEST_PRODUCTION_PASSWORD"],
  [Role.INSTALLER, "installer.test@altynsapa.kz", "ORDA_TEST_INSTALLER_PASSWORD"],
  [Role.PARTNER, "workshop.test@altynsapa.kz", "ORDA_TEST_WORKSHOP_PASSWORD"],
] as const;
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function cookies(response: Response) { const headers = response.headers as Headers & { getSetCookie?: () => string[] }; return (headers.getSetCookie?.() ?? [headers.get("set-cookie") ?? ""]).filter(Boolean).map((value) => value.split(";", 1)[0]).join("; "); }
async function login(email: string, password: string) {
  const csrf = await fetch(`${baseUrl}/api/auth/csrf`), initial = cookies(csrf), token = (await csrf.json() as { csrfToken: string }).csrfToken;
  const response = await fetch(`${baseUrl}/api/auth/callback/credentials`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: initial }, body: new URLSearchParams({ csrfToken: token, email, password, callbackUrl: baseUrl, json: "true" }), redirect: "manual" });
  const cookie = [initial, cookies(response)].filter(Boolean).join("; ");
  const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } });
  return { cookie, session: await session.json() as { user?: { role?: string } } };
}
async function status(path: string, cookie: string) { return (await fetch(`${baseUrl}${path}`, { headers: { Cookie: cookie }, redirect: "manual" })).status; }

async function main() {
  const probe = await fetch(`${baseUrl}/api/internal/test-database-identity`, { headers: { "x-test-database-probe-token": databaseProbeToken } });
  const identity = probe.ok ? await probe.json() as { fingerprint?: string } : null;
  check(identity?.fingerprint === testDatabaseFingerprint, "Role login server database identity does not match TEST_DATABASE_URL");
  const missing = accounts.filter(([, , variable]) => !process.env[variable]); check(!missing.length, "Test account password variables are missing");
  let directorCookie = "";
  for (const [role, email, variable] of accounts) {
    const result = await login(email, process.env[variable]!); check(result.session.user?.role === role, `${role} login failed`);
    if (role === Role.DIRECTOR) directorCookie = result.cookie;
    const expected: Partial<Record<Role, string[]>> = {
      DIRECTOR: ["/api/employees", "/api/settings", "/api/finance", "/api/company-finance", "/api/personal-finance", "/api/warehouse"],
      MANAGER: ["/api/clients", "/api/orders", "/api/partners", "/api/documents", "/api/calendar", "/api/production", "/api/warehouse"],
      ACCOUNTANT: ["/api/finance", "/api/company-finance", "/api/reports", "/api/warehouse"],
      MEASURER: ["/api/measurements", "/api/calendar"], PRODUCTION: ["/api/production", "/api/calendar", "/api/warehouse"], INSTALLER: ["/api/production", "/api/calendar", "/api/warehouse"], PARTNER: ["/api/partner/dashboard", "/api/orders", "/api/finance", "/api/partners", "/api/documents"],
    };
    for (const path of expected[role] ?? []) check((await status(path, result.cookie)) === 200, `${role} cannot access ${path}`);
    if (role === Role.MANAGER) {
      for (const path of ["/api/finance", "/api/company-finance", "/api/personal-finance", "/api/employees", "/api/settings", "/api/reports"]) check((await status(path, result.cookie)) === 403, `MANAGER accessed ${path}`);
      const orderPayload = await (await fetch(`${baseUrl}/api/orders?page=1&limit=100`, { headers: { Cookie: result.cookie } })).json() as { data: Array<Record<string, unknown>> };
      const orders = orderPayload.data;
      check(orders.every((order) => !["companyProfit", "partnerPrice", "partnerPaid", "partnerBalance"].some((field) => field in order)), "MANAGER order payload leaks finance");
    }
    if (role === Role.ACCOUNTANT) check((await status("/api/personal-finance", result.cookie)) === 403, "ACCOUNTANT accessed personal finance");
    if (role === Role.PARTNER) { check((await status("/api/warehouse", result.cookie)) === 403, "WORKSHOP accessed warehouse"); check((await status("/api/employees", result.cookie)) === 403, "WORKSHOP accessed employees"); }
  }
  const directorPassword = process.env.ORDA_TEST_DIRECTOR_PASSWORD!;
  check((await login("  DIRECTOR.TEST@ALTYNSAPA.KZ  ", directorPassword)).session.user?.role === Role.DIRECTOR, "normalized email login failed");
  check(!(await login("director.test@altynsapa.kz", `${directorPassword}-wrong`)).session.user, "wrong password was accepted");
  const disabledEmail = `disabled-login-${Date.now()}@test.local`, disabledPassword = `Disabled-${crypto.randomUUID()}`;
  const createDisabled = await fetch(`${baseUrl}/api/employees`, { method: "POST", headers: { Cookie: directorCookie, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Disabled login test", email: disabledEmail, password: disabledPassword, role: Role.MANAGER, active: false }) });
  check(createDisabled.status === 201, "disabled account fixture creation failed");
  const disabled = await createDisabled.json() as { id: number };
  try { check(!(await login(disabledEmail, disabledPassword)).session.user, "disabled account was accepted"); } finally { await fetch(`${baseUrl}/api/employees/${disabled.id}`, { method: "DELETE", headers: { Cookie: directorCookie } }); }
  check((await status("/api/orders", "")) === 401, "anonymous API access was not rejected");
  console.log(`Production role login checks passed: ${accounts.length}`);
}

void main();
