import { spawnSync } from "node:child_process";
import pg from "pg";

const migrationName = "20261007120000_payments_warehouse_retail_documents";
const connectionString =
  process.env.MIGRATION_DATABASE_URL?.trim() ||
  process.env.DIRECT_URL?.trim() ||
  process.env.DATABASE_URL?.trim();

if (!connectionString) {
  throw new Error("A database connection is required to repair the migration state.");
}

const client = new pg.Client({ connectionString });
await client.connect();

let latest;
try {
  const result = await client.query(
    `SELECT "finished_at", "rolled_back_at"
       FROM "_prisma_migrations"
      WHERE "migration_name" = $1
      ORDER BY "started_at" DESC
      LIMIT 1`,
    [migrationName],
  );
  [latest] = result.rows;
} finally {
  await client.end();
}

if (!latest || latest.finished_at || latest.rolled_back_at) {
  console.log("Warehouse migration does not need failed-state recovery.");
  process.exit(0);
}

console.log("Marking the interrupted warehouse migration attempt as rolled back.");
const npmCli = process.env.npm_execpath;
const command = npmCli ? process.execPath : "npm";
const args = npmCli
  ? [
      npmCli,
      "exec",
      "--",
      "prisma",
      "migrate",
      "resolve",
      "--rolled-back",
      migrationName,
    ]
  : [
      "exec",
      "--",
      "prisma",
      "migrate",
      "resolve",
      "--rolled-back",
      migrationName,
    ];
const result = spawnSync(command, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: connectionString,
  },
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
