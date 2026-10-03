import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const npmCli = process.env.npm_execpath;

function run(script) {
  const command = npmCli ? process.execPath : "npm";
  const args = npmCli ? [npmCli, "run", script] : ["run", script];
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function resolveFailedPayrollVerification() {
  const migrationName = "20261004104000_verify_payroll_period_corrections";
  const prismaCli = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [prismaCli, "migrate", "resolve", "--rolled-back", migrationName],
    {
      encoding: "utf8",
      env: process.env,
    },
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const alreadyResolved = output.includes("P3012") || output.includes("not in a failed state");
  if (result.status !== 0 && !alreadyResolved) process.exit(result.status ?? 1);
  if (alreadyResolved) {
    console.log(`${migrationName} is already resolved or applied; continuing with migrate deploy.`);
  }
}

if (process.env.DATABASE_URL?.trim()) {
  if (
    process.env.VERCEL_ENV === "production" &&
    process.env.DEMO_STAGING_MIGRATION_REPAIR === "true"
  ) {
    resolveFailedPayrollVerification();
  }
  run("prisma:migrate:deploy");
} else {
  console.log("DATABASE_URL is not configured; skipping database migrations for this preview build.");
}

run("prisma:generate");

if (process.env.DATABASE_URL?.trim() && process.env.RUN_RELEASE_PREPARATION === "true") {
  run("seed:training");
  run("prepare:director:release");
  run("prepare:whatsapp-partners:release");
  run("prepare:sales-plan:release");
  run("prepare:daily-operations:release");
} else if (process.env.DATABASE_URL?.trim()) {
  console.log("Release preparation is disabled for this build; scheduled operations continue through cron jobs.");
} else {
  console.log("DATABASE_URL is not configured; skipping database preparation for this preview build.");
}

run("build");
