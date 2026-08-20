import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { assertFinalPreviewEnvironment, maskedHost } from "./preview-database-safety";

const preview = assertFinalPreviewEnvironment();
process.env.TEST_DATABASE_URL = preview.databaseUrl;

const prismaCli = join(process.cwd(), "node_modules", "prisma", "build", "index.js");
const tsxCli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const run = (entrypoint: string, args: string[], timeout = 600_000) => {
  const result = spawnSync(process.execPath, [entrypoint, ...args], {
    env: process.env,
    encoding: "utf8",
    stdio: "inherit",
    timeout,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
};

console.log(`Confirmed Preview database: ${maskedHost(preview.host)}/${preview.database}; fingerprint=${preview.fingerprint.slice(0, 12)}`);
run(prismaCli, ["format"]);
run(prismaCli, ["validate"]);
run(prismaCli, ["generate"]);
run(prismaCli, ["migrate", "deploy"]);
run(prismaCli, ["migrate", "status"]);
run(tsxCli, ["scripts/seed-final-preview.ts"]);
console.log("Final Preview database preparation completed");
