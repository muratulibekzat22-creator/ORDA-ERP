import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const walk = (directory: string): string[] => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
  const relative = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(relative) : [relative];
});

const sourceFiles = [...walk("app"), ...walk("components"), ...walk("lib")]
  .filter((file) => /\.(?:ts|tsx)$/u.test(file));

for (const file of sourceFiles) {
  const source = read(file);
  assert.doesNotMatch(source, /\bDemo(?:Dashboard|Clients|Orders)\b/u, `${file} contains a forbidden parallel demo UI`);
}

assert.equal(fs.existsSync(path.join(root, "app", "api", "demo")), false, "parallel demo API routes are forbidden");
assert.equal(fs.existsSync(path.join(root, "app", "demo")), false, "parallel demo UI routes are forbidden");

const routeShell = read("components/layout/RouteShell.tsx");
for (const label of ["Главная", "Заявки", "Заказы", "Замеры", "Календарь", "Производство", "Склад", "Сотрудники", "Зарплаты", "Финансы", "Отчёты", "Документы", "Настройки"]) {
  assert.ok(routeShell.includes(`"${label}"`), `approved navigation label is missing: ${label}`);
}
assert.doesNotMatch(routeShell, /"Калькулятор"|"КП"|"Цех"/u, "standalone calculator/proposal/workshop navigation is forbidden");
assert.match(routeShell, /session\?\.user\.companyName/u);
assert.match(routeShell, /session\?\.user\.isDemo/u);

const auth = read("app/api/auth/[...nextauth]/route.ts");
assert.match(auth, /include:\s*\{\s*company:\s*true\s*\}/u);
assert.match(auth, /runWithSystemAccess/u);
assert.doesNotMatch(auth, /credentials\.(?:tenantId|companyId)/u, "tenant identity must not come from credentials");

const tenantScope = read("lib/tenant-scope.ts");
for (const model of ["User", "Client", "Order", "Measurement", "CalendarTask", "CommercialProposal", "Document", "Payment", "EmployeePayrollProfile", "PayrollPeriod", "CompanyLedgerEntry", "Material", "Partner", "RolePermission"]) {
  assert.ok(tenantScope.includes(`"${model}"`), `tenant model is missing from fail-closed scope: ${model}`);
}
assert.match(tenantScope, /TENANT_CONTEXT_REQUIRED/u);
assert.match(tenantScope, /TENANT_SCOPE_VIOLATION/u);

for (const file of ["lib/services/dashboard.service.ts", "lib/services/finance-journal.service.ts", "lib/services/measurement.service.ts", "lib/services/report.service.ts"]) {
  const source = read(file);
  assert.match(source, /companyId/u, `${file} raw aggregates must be tenant-scoped`);
}

for (const file of walk("scripts").filter((item) => /\.(?:ts|tsx|mjs)$/u.test(item))) {
  const source = read(file);
  assert.doesNotMatch(source, /(?:=|return)\s*(?:process\.env\.)?TEST_DATABASE_URL\s*(?:\|\||\?\?)\s*(?:process\.env\.)?DATABASE_URL/u, `${file} falls back from TEST_DATABASE_URL to production`);
}

console.log("Tenant and approved UI static safety passed");
