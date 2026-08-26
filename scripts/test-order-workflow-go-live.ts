import "./require-test-database";

import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const steps: Array<{
  label: string;
  command: string;
  args: string[];
  timeout: number;
}> = [
  { label: "Prisma validate", command: npx, args: ["prisma", "validate"], timeout: 120_000 },
  { label: "Prisma migrate deploy", command: npx, args: ["prisma", "migrate", "deploy"], timeout: 180_000 },
  { label: "Prisma generate", command: npx, args: ["prisma", "generate"], timeout: 180_000 },
  { label: "TypeScript", command: npx, args: ["tsc", "--noEmit"], timeout: 300_000 },
  { label: "ESLint", command: npm, args: ["run", "lint"], timeout: 300_000 },
  { label: "Production build", command: npm, args: ["run", "build"], timeout: 600_000 },
  { label: "Proposal pipeline", command: npm, args: ["run", "test:proposal-pipeline"], timeout: 300_000 },
  { label: "Final order workflow", command: npm, args: ["run", "test:order-workflow-final"], timeout: 300_000 },
  { label: "Order 360", command: npm, args: ["run", "test:order360"], timeout: 300_000 },
  { label: "Partner management", command: npm, args: ["run", "test:partner-management"], timeout: 300_000 },
  { label: "Partner finance", command: npm, args: ["run", "test:partner-finance"], timeout: 300_000 },
  { label: "Payroll", command: npm, args: ["run", "test:payroll"], timeout: 300_000 },
  { label: "Finance integrity", command: npm, args: ["run", "test:finance-integrity"], timeout: 300_000 },
  { label: "Director Dashboard", command: npm, args: ["run", "test:dashboard-director"], timeout: 300_000 },
  { label: "Role acceptance", command: npm, args: ["run", "test:role-acceptance"], timeout: 300_000 },
  { label: "Database safety", command: npm, args: ["run", "test:database-safety"], timeout: 180_000 },
  { label: "git diff --check", command: "git", args: ["diff", "--check"], timeout: 60_000 },
];

for (const step of steps) {
  console.log(`\n=== ${step.label} ===`);
  const result = spawnSync(step.command, step.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    timeout: step.timeout,
    shell: true,
  });
  if (result.error) throw new Error(`${step.label}: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`${step.label}: exit ${result.status ?? "timeout"}`);
}

console.log("\nOrder workflow go-live checks passed on TEST_DATABASE_URL");
