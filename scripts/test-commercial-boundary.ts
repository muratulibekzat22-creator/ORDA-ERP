import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const orderDetail = read("app/api/orders/[id]/route.ts");
const calculationApi = read("app/api/orders/[id]/calculation/route.ts");
const calculator = read("components/calculator/StairCalculator.tsx");
const configApi = read("app/api/calculator-config/route.ts");
const settings = read("components/pages/SettingsPage.tsx");
const navigation = read("components/layout/RouteShell.tsx");

for (const field of [
  "companyProfit",
  "partnerPrice",
  "partnerBalance",
  "workshopCost",
  "totalCost",
  "grossProfit",
]) {
  if (
    !orderDetail.includes(`delete result[field]`) &&
    !orderDetail.includes(`delete calculation[field]`)
  )
    throw new Error(`Order detail lacks redaction for ${field}`);
}
for (const field of ["workshopCost", "totalCost", "grossProfit"])
  if (!calculationApi.includes(field))
    throw new Error(`Calculation API lacks protected field ${field}`);
if (
  !calculator.includes("canSeeInternal") ||
  !calculator.includes('session?.user.role === "ACCOUNTANT"')
)
  throw new Error("Calculator UI lacks internal-finance visibility boundary");
if (
  !configApi.includes("role !== Role.DIRECTOR && role !== Role.ACCOUNTANT") ||
  !configApi.includes("auth.session!.user.role !== Role.DIRECTOR")
)
  throw new Error("Calculator configuration role policy is incomplete");
if (settings.includes("Цены калькулятора"))
  throw new Error(
    "Calculator configuration still exists inside general settings",
  );
if (
  !navigation.includes('session?.user.role === "DIRECTOR"') ||
  !navigation.includes("Конфигурация калькулятора")
)
  throw new Error("Protected calculator configuration navigation is missing");
console.log("commercial and management boundary checks passed");
