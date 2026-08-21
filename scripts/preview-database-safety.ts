import { createHash } from "node:crypto";

const knownProductionDatabases = new Set([
  "ep-quiet-brook-ayd2fvc5-pooler.c-5.us-east-2.aws.neon.tech/neondb",
  "ep-quiet-brook-ayd2fvc5.c-5.us-east-2.aws.neon.tech/neondb",
]);

export function databaseFingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function parsePostgresUrl(value: string, variable: string) {
  const url = new URL(value);
  if (!/^postgres(?:ql)?:$/u.test(url.protocol))
    throw new Error(`${variable} must be a PostgreSQL URL`);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!database) throw new Error(`${variable} database name is missing`);
  return { value, host: url.hostname.toLowerCase(), database };
}

function normalizedHost(host: string) {
  return host.replace("-pooler.", ".");
}

export function maskedHost(host: string) {
  const parts = host.split(".");
  const first = parts[0] ?? "";
  return `${first.slice(0, 3)}***.${parts.slice(1).join(".")}`;
}

export function assertFinalPreviewEnvironment(environment: Readonly<Record<string, string | undefined>> = process.env) {
  const databaseValue = environment.DATABASE_URL;
  const directValue = environment.DIRECT_URL;
  if (!databaseValue || !directValue)
    throw new Error("Preview DATABASE_URL and DIRECT_URL are required");
  if (environment.VERCEL_ENV !== "preview" && environment.PREVIEW_DATABASE_CONFIRMED !== "true")
    throw new Error("Preview preparation refused outside a confirmed Preview environment");
  if (environment.DEMO_MODE_ENABLED !== "true" || environment.DEMO_TENANT_SLUG !== "altyn-sapa-demo")
    throw new Error("Preview preparation requires the canonical Demo tenant configuration");

  const database = parsePostgresUrl(databaseValue, "DATABASE_URL");
  const direct = parsePostgresUrl(directValue, "DIRECT_URL");
  if (database.database !== "orda_erp_final_preview" || direct.database !== database.database)
    throw new Error("Preview database must be the dedicated orda_erp_final_preview database");
  if (normalizedHost(database.host) !== normalizedHost(direct.host))
    throw new Error("DATABASE_URL and DIRECT_URL do not address the same Preview database host");
  if (knownProductionDatabases.has(`${database.host}/${database.database}`) || knownProductionDatabases.has(`${direct.host}/${direct.database}`))
    throw new Error("Preview preparation refused a known Production database identity");

  const fingerprint = databaseFingerprint(databaseValue);
  const expected = environment.PREVIEW_DATABASE_FINGERPRINT;
  if (!expected || expected !== fingerprint)
    throw new Error("PREVIEW_DATABASE_FINGERPRINT does not match DATABASE_URL");
  const productionFingerprint = environment.PRODUCTION_DATABASE_FINGERPRINT;
  if (!productionFingerprint || productionFingerprint === fingerprint)
    throw new Error("Preview DATABASE_URL is not proven different from Production");

  return {
    databaseUrl: databaseValue,
    directUrl: directValue,
    host: database.host,
    database: database.database,
    fingerprint,
    productionFingerprint,
  };
}
