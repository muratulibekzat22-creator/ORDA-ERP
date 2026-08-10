import "./require-test-database";

import { spawnSync } from "node:child_process";

process.env.NEXTAUTH_URL = "http://127.0.0.1:3219";
process.env.NEXTAUTH_SECRET ||= "local-application-lifecycle-go-live-secret";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const documentStep = process.env.BLOB_READ_WRITE_TOKEN
  ? { label: "Documents (private Blob integration)", command: npm, args: ["run", "test:documents"], timeout: 420_000 }
  : { label: "Documents / contracts (Blob token unavailable)", command: npm, args: ["run", "test:contracts"], timeout: 240_000 };
const steps: Array<{ label: string; command: string; args: string[]; timeout: number }> = [
  { label: "Prisma validate", command: npx, args: ["prisma", "validate"], timeout: 120_000 },
  { label: "Prisma migrate deploy (test DB)", command: npx, args: ["prisma", "migrate", "deploy"], timeout: 180_000 },
  { label: "Prisma generate", command: npx, args: ["prisma", "generate"], timeout: 180_000 },
  { label: "TypeScript", command: npx, args: ["tsc", "--noEmit"], timeout: 300_000 },
  { label: "ESLint", command: npm, args: ["run", "lint"], timeout: 300_000 },
  { label: "Production build", command: npm, args: ["run", "build"], timeout: 600_000 },
  { label: "Application / measurement lifecycle", command: npm, args: ["run", "test:application-lifecycle"], timeout: 240_000 },
  { label: "Clients / Application workspace", command: npm, args: ["run", "test:clients"], timeout: 180_000 },
  { label: "Measurements", command: npm, args: ["run", "test:measurements"], timeout: 420_000 },
  { label: "Calendar", command: npm, args: ["run", "test:calendar"], timeout: 180_000 },
  { label: "Proposal preservation / pipeline", command: npm, args: ["run", "test:proposal-pipeline"], timeout: 300_000 },
  documentStep,
  { label: "Orders", command: npm, args: ["run", "test:orders-module"], timeout: 180_000 },
  { label: "Payments / financial model", command: npm, args: ["run", "test:financial-model"], timeout: 180_000 },
  { label: "RBAC / IDOR", command: npm, args: ["run", "test:api:security"], timeout: 900_000 },
  { label: "Role acceptance", command: npm, args: ["run", "test:role-acceptance"], timeout: 180_000 },
  { label: "Database safety", command: npm, args: ["run", "test:database-safety"], timeout: 180_000 },
  { label: "Idempotency", command: npm, args: ["run", "test:idempotency"], timeout: 300_000 },
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
  if (result.status !== 0) throw new Error(`${step.label}: exit ${result.status ?? "timeout"}`);
}

console.log("\nApplication lifecycle go-live checks passed on TEST_DATABASE_URL");
