import { spawnSync } from "node:child_process";

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

run("prisma:generate");

if (
  process.env.VERCEL_ENV === "production" &&
  process.env.RUN_RELEASE_MIGRATIONS === "true"
) {
  run("prisma:migrate:deploy");
}

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
