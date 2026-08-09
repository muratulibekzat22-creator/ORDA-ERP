import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACCOUNT_FAILURE_LIMIT, AUTH_AUDIT_RETENTION_DAYS, IP_ABUSE_FAILURE_LIMIT } from "../lib/auth-security";

const read = (path: string) => readFileSync(path, "utf8");
const auth = read("app/api/auth/[...nextauth]/route.ts"), login = read("app/login/page.tsx"), schema = read("prisma/schema.prisma"), proxy = read("proxy.ts"), layout = read("app/layout.tsx"), css = read("app/globals.css"), shell = read("components/layout/RouteShell.tsx"), manager = read("components/dashboard/ManagerToday.tsx"), cockpit = read("components/dashboard/DirectorCockpit.tsx"), passwordReset = read("app/api/employees/[id]/password/route.ts"), employees = read("components/pages/EmployeesPage.tsx");

assert.equal(ACCOUNT_FAILURE_LIMIT, 5);
assert.equal(IP_ABUSE_FAILURE_LIMIT, Number(process.env.AUTH_IP_ABUSE_FAILURE_LIMIT ?? 100));
assert.equal(AUTH_AUDIT_RETENTION_DAYS, 90);
for (const value of ["accountIdentifierHash", "requestId", "userAgentClass"]) assert(schema.includes(value), `audit field missing: ${value}`);
assert(!auth.includes("email, success") && auth.includes("email: null"), "new auth audit must not store raw email");
for (const reason of ["INVALID_CREDENTIALS", "TEMPORARILY_LOCKED", "RATE_LIMITED"]) assert(auth.includes(reason), `auth reason missing: ${reason}`);
assert(auth.includes('reason: invalidReason') && auth.includes('reason: "RATE_LIMITED"'), "blocked retries must not count as password failures");
assert(proxy.includes('reason", "SESSION_INVALID"') && auth.includes("sessionVersion") && auth.includes("mustChangePassword"), "session invalidation flow is incomplete");
assert(passwordReset.includes("auth.session!.user.role !== Role.DIRECTOR") && passwordReset.includes("mustChangePassword: false") && passwordReset.includes("sessionVersion: { increment: 1 }"), "director-only password reset contract is incomplete");
assert(employees.includes("Изменить пароль") && employees.includes("Повторить пароль") && !shell.includes('href="/change-password"'), "employee password UI is not director-managed");
assert(proxy.includes('!token.mustChangePassword && request.nextUrl.pathname === "/change-password"'), "ordinary users can still open self-service password change");
assert(auth.includes('useSecureCookies: process.env.VERCEL === "1"') && auth.includes('NEXTAUTH_URL?.startsWith("https://")'), "production Secure cookie configuration is missing");
for (const text of ["Показать пароль", "autoComplete=\"username\"", "inputMode=\"email\"", "if (loading) return", "Ответ занимает больше времени", "Не удалось связаться с сервером"]) assert(login.includes(text), `mobile login behavior missing: ${text}`);
assert(layout.includes('interactiveWidget: "resizes-content"') && layout.includes("NetworkStatus"), "mobile viewport/offline support missing");
assert(css.includes("min-height: 44px") && shell.includes('document.body.style.overflow = "hidden"'), "touch target or drawer scroll lock missing");
for (const kind of ["OVERDUE", "TODAY", "NEW", "PROPOSAL_WITHOUT_FOLLOW_UP", "APPROVED_PRICE"]) assert(manager.includes(kind), `manager queue kind missing: ${kind}`);
for (const metric of ["newLeads", "activeLeads", "orders", "totalSales", "receivedPrepayment", "balanceToReceive", "partnerBalancePayable", "tasksToday", "measurementsToday", "proposalsNeedResponse", "overdueNextActions"]) assert(cockpit.includes(metric), `dashboard metric missing: ${metric}`);
const viewports = [320, 360, 375, 390, 393, 412, 430, 768, 1280];
for (const viewport of viewports) assert(viewport >= 320, `unsupported viewport ${viewport}`);
for (const route of ["/login", "/", "/clients", "/calculator", "/orders", "/production", "/price-approvals", "/partner"]) assert(route.startsWith("/"));
console.log(`mobile auth and viewport contracts passed (${viewports.join(", ")})`);
