import { createHash } from "node:crypto";

const productionDatabases = [
  { host: "ep-quiet-brook-ayd2fvc5-pooler.c-5.us-east-2.aws.neon.tech", database: "neondb" },
  { host: "ep-quiet-brook-ayd2fvc5.c-5.us-east-2.aws.neon.tech", database: "neondb" },
] as const;

export function assertSafeTestDatabaseUrl(value: string | undefined) {
  if (!value) throw new Error("TEST_DATABASE_URL is required; DATABASE_URL fallback is forbidden for mutation tests");
  const url = new URL(value);
  if (!/^postgres(?:ql)?:$/u.test(url.protocol)) throw new Error("TEST_DATABASE_URL must be PostgreSQL");
  const database = url.pathname.slice(1);
  if (productionDatabases.some((identity) => identity.host === url.hostname && identity.database === database)) {
    throw new Error(`Mutation test refused production database identity: ${url.hostname}/${database}`);
  }
  return value;
}

export function databaseFingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function sanitizedTestServerEnv(testDatabaseUrl: string, additions: Record<string, string | undefined> = {}) {
  return {
    ...process.env,
    ...additions,
    DATABASE_URL: testDatabaseUrl,
    TEST_DATABASE_URL: testDatabaseUrl,
    VERCEL: undefined,
    VERCEL_ENV: "",
    VERCEL_OIDC_TOKEN: "",
    VERCEL_TARGET_ENV: "",
    VERCEL_URL: "",
  };
}
