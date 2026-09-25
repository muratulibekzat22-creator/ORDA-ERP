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

if (process.env.DATABASE_URL?.trim()) {
  run("prisma:migrate:deploy");
} else {
  console.log("DATABASE_URL is not configured; skipping database migrations for this preview build.");
}

run("prisma:generate");

if (process.env.DATABASE_URL?.trim()) {
  run("seed:training");
  run("prepare:director:release");
} else {
  console.log("DATABASE_URL is not configured; skipping database preparation for this preview build.");
}

run("build");
