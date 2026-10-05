import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACCOUNT_FAILURE_LIMIT, AUTH_AUDIT_RETENTION_DAYS, IP_ABUSE_FAILURE_LIMIT } from "../lib/auth-security";

const read = (path: string) => readFileSync(path, "utf8");
const auth = read("app/api/auth/[...nextauth]/route.ts"), login = read("app/login/page.tsx"), schema = read("prisma/schema.prisma"), proxy = read("proxy.ts"), serverAuth = read("lib/server-auth.ts"), layout = read("app/layout.tsx"), css = read("app/globals.css"), shell = read("components/layout/RouteShell.tsx"), manager = read("components/dashboard/ManagerToday.tsx"), cockpit = read("components/dashboard/DirectorCockpit.tsx"), passwordReset = read("app/api/employees/[id]/password/route.ts"), employees = read("components/pages/EmployeesPage.tsx"), payroll = read("app/payroll/page.tsx"), selfPayrollApi = read("app/api/payroll/self/route.ts");

assert.equal(ACCOUNT_FAILURE_LIMIT, 5);
assert.equal(IP_ABUSE_FAILURE_LIMIT, Number(process.env.AUTH_IP_ABUSE_FAILURE_LIMIT ?? 100));
assert.equal(AUTH_AUDIT_RETENTION_DAYS, 90);
for (const value of ["accountIdentifierHash", "requestId", "userAgentClass"]) assert(schema.includes(value), `audit field missing: ${value}`);
assert(!auth.includes("email, success") && auth.includes("email: null"), "new auth audit must not store raw email");
for (const reason of ["INVALID_CREDENTIALS", "TEMPORARILY_LOCKED", "RATE_LIMITED"]) assert(auth.includes(reason), `auth reason missing: ${reason}`);
assert(auth.includes('reason: invalidReason') && auth.includes('reason: "RATE_LIMITED"'), "blocked retries must not count as password failures");
assert(auth.includes("accountFailureWindowStart(user?.passwordChangedAt)"), "director password reset does not clear the account/IP failure window");
assert(proxy.includes('reason", "SESSION_INVALID"') && auth.includes("sessionVersion") && auth.includes("mustChangePassword"), "session invalidation flow is incomplete");
assert(serverAuth.includes('code: "SESSION_INVALID"') && serverAuth.includes("status: 401"), "stale API sessions can still masquerade as RBAC failures");
assert(proxy.includes('const selfPayroll = firstSegment === "payroll" && role !== "PARTNER"') && proxy.includes("!selfPayroll"), "self payroll route is blocked by page RBAC");
assert(
  proxy.includes('PARTNER: ["partner"]') &&
    proxy.includes('role === "PARTNER"') &&
    proxy.includes('firstSegment !== "partner"') &&
    proxy.includes('firstSegment !== "change-password"'),
  "partner can open general ERP pages instead of the dedicated redacted cabinet",
);
assert(shell.includes('["/", "/clients", "/orders", "/sales-plan", "/measurements", "/catalog", "/calendar", "/production", "/payroll", "/kpi"]'), "manager navigation contract changed");
assert(shell.includes('["/", "/marketing", "/calendar", "/payroll", "/kpi"]'), "marketer personal payroll and KPI navigation is missing");
assert(shell.includes('accountRole === "DIRECTOR"') && shell.includes("if (founder) return true"), "Founder navigation must retain every management section");
assert(shell.includes('accountRole === "OPERATIONS_DIRECTOR"') && shell.includes('/api/session/permissions') && shell.includes("grantedPermissions.includes"), "Operations director navigation must use the founder-controlled permission matrix");
assert(cockpit.includes("FounderDashboard") && cockpit.includes("Чистая прибыль") && cockpit.includes("Маржа") && cockpit.includes("Оборот компании"), "Founder cockpit must show final financial and sales indicators");
assert(payroll.includes("Заявка на аванс") && payroll.includes("Запросить аванс") && payroll.includes("не считается выплатой"), "safe advance request is missing from personal payroll");
assert(payroll.includes('year: String(period.year)') && payroll.includes('month: String(period.month)') && payroll.includes("Сначала оформите заказ"), "payroll order bonus is not scoped to the selected month");
assert(selfPayrollApi.includes('body.action === "request-advance"') && selfPayrollApi.includes("PayrollPaymentType.ADVANCE"), "advance self-request is not constrained to advances");
assert(selfPayrollApi.includes("undefined, true"), "self payroll API does not force personal data scope for privileged employee roles");
assert(payroll.includes("adminView = founder || operationsDirector || accountant") && payroll.includes("advanceSelfService = managerSelfService"), "operations director payroll administration scope is missing");
assert(payroll.includes("loadRequest.current += 1") && payroll.includes("detailLoadRequest.current += 1"), "payroll month changes do not invalidate in-flight table and drawer requests");
assert(/setOperation\(null\);\s*closeDetails\(\);/.test(payroll), "payroll operations can leave a stale drawer employee id behind");
assert(payroll.includes('canManageSalary || approvalStatus === "PRELIMINARY"'), "manager bonus controls stay active after a calculation snapshot is confirmed");
assert(!payroll.includes("История бонуса ("), "bonus audit history is duplicated outside the collapsed operation history");
assert(passwordReset.includes("actorRole !== Role.DIRECTOR") && passwordReset.includes("existing.role === Role.DIRECTOR") && passwordReset.includes("mustChangePassword: false") && passwordReset.includes("sessionVersion: { increment: 1 }"), "protected founder password reset contract is incomplete");
assert(employees.includes("Изменить пароль") && employees.includes("Повторить пароль") && !shell.includes('href="/change-password"'), "employee password UI is not director-managed");
assert(proxy.includes('!token.mustChangePassword && request.nextUrl.pathname === "/change-password"'), "ordinary users can still open self-service password change");
assert(auth.includes('useSecureCookies: process.env.VERCEL === "1"') && auth.includes('NEXTAUTH_URL?.startsWith("https://")'), "production Secure cookie configuration is missing");
for (const text of ["Показать пароль", "autoComplete=\"username\"", "inputMode=\"email\"", "if (loading) return", "Ответ занимает больше времени", "Не удалось связаться с сервером"]) assert(login.includes(text), `mobile login behavior missing: ${text}`);
assert(layout.includes('interactiveWidget: "resizes-content"') && layout.includes("NetworkStatus"), "mobile viewport/offline support missing");
assert(css.includes("min-height: 44px") && shell.includes('document.body.style.overflow = "hidden"'), "touch target or drawer scroll lock missing");
for (const kind of ["OVERDUE", "TODAY", "NEW", "PROPOSAL_WITHOUT_FOLLOW_UP", "APPROVED_PRICE"]) assert(manager.includes(kind), `manager queue kind missing: ${kind}`);
for (const metric of ["revenue", "received", "directExpenses", "operatingExpenses", "payrollAccrued", "payrollPaid", "netProfit", "netMargin"]) assert(cockpit.includes(metric), `dashboard metric missing: ${metric}`);
const viewports = [320, 360, 375, 390, 393, 412, 430, 768, 1280];
for (const viewport of viewports) assert(viewport >= 320, `unsupported viewport ${viewport}`);
for (const route of ["/login", "/", "/clients", "/calculator", "/orders", "/production", "/price-approvals", "/partner"]) assert(route.startsWith("/"));
console.log(`mobile auth and viewport contracts passed (${viewports.join(", ")})`);
