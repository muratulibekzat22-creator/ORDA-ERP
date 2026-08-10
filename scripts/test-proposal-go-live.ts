import "./require-test-database";

import { spawnSync } from "node:child_process";

process.env.NEXTAUTH_URL = "http://127.0.0.1:3219";
process.env.NEXTAUTH_SECRET ||= "local-proposal-go-live-test-secret";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const steps: Array<{
  label: string;
  command: string;
  args: string[];
  timeout: number;
}> = [
  {
    label: "Prisma validate",
    command: npx,
    args: ["prisma", "validate"],
    timeout: 120_000,
  },
  {
    label: "Prisma generate",
    command: npx,
    args: ["prisma", "generate"],
    timeout: 180_000,
  },
  {
    label: "TypeScript",
    command: npx,
    args: ["tsc", "--noEmit"],
    timeout: 240_000,
  },
  {
    label: "ESLint",
    command: npm,
    args: ["run", "lint"],
    timeout: 240_000,
  },
  {
    label: "Production build",
    command: npm,
    args: ["run", "build"],
    timeout: 420_000,
  },
  {
    label: "Proposal generation / PDF",
    command: npm,
    args: ["run", "test:proposal-pipeline"],
    timeout: 240_000,
  },
  {
    label: "Client proposal workspace",
    command: npm,
    args: ["run", "test:clients"],
    timeout: 240_000,
  },
  {
    label: "Commercial boundary",
    command: npm,
    args: ["run", "test:commercial-boundary"],
    timeout: 240_000,
  },
  {
    label: "RBAC / IDOR",
    command: npm,
    args: ["run", "test:api:security"],
    timeout: 600_000,
  },
  {
    label: "Database safety",
    command: npm,
    args: ["run", "test:database-safety"],
    timeout: 120_000,
  },
  {
    label: "git diff --check",
    command: "git",
    args: ["diff", "--check"],
    timeout: 60_000,
  },
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

console.log("\nAll proposal go-live checks passed on TEST_DATABASE_URL");
