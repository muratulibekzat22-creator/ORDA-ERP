import { createHash } from "crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const sourceUrl = process.env.SOURCE_DATABASE_URL;
const restoreUrl = process.env.RESTORE_DATABASE_URL;
if (!sourceUrl || !restoreUrl) throw new Error("SOURCE_DATABASE_URL and RESTORE_DATABASE_URL are required");
if (sourceUrl === restoreUrl) throw new Error("Source and restore targets must be different");
if (process.env.RESTORE_DRILL_CONFIRM_ISOLATED !== "true") throw new Error("Set RESTORE_DRILL_CONFIRM_ISOLATED=true after confirming both targets are non-production isolated branches");

const tables = ["User", "Client", "Order", "OrderCalculation", "Payment", "Material", "MaterialMovement", "Document"] as const;
const excludedColumns: Record<(typeof tables)[number], string[]> = {
  User: ["password", "email", "phone", "name", "ipHash"],
  Client: ["name", "phone", "whatsapp", "address", "comment"],
  Order: ["address", "manager", "partnerComment"],
  OrderCalculation: [],
  Payment: ["comment", "author"],
  Material: ["supplier"],
  MaterialMovement: ["supplier", "comment"],
  Document: [],
};

function client(url: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value, (_key, item) => {
    if (item instanceof Date) return item.toISOString();
    if (item && typeof item === "object" && "toJSON" in item && typeof item.toJSON === "function") return item.toJSON();
    return item;
  })).digest("hex");
}

async function snapshot(database: PrismaClient) {
  const result: Record<string, { count: number; minId: number | null; maxId: number | null; hash: string }> = {};
  for (const table of tables) {
    const exclusions = excludedColumns[table].map((column) => `'${column.replaceAll("'", "''")}'`).join(",");
    const expression = exclusions ? `to_jsonb(t) - ARRAY[${exclusions}]::text[]` : "to_jsonb(t)";
    const rows = await database.$queryRawUnsafe<Array<{ id: number; content: unknown }>>(`SELECT id, ${expression} AS content FROM "${table}" t ORDER BY id`);
    result[table] = { count: rows.length, minId: rows[0]?.id ?? null, maxId: rows.at(-1)?.id ?? null, hash: hash(rows.map((row) => row.content)) };
  }
  const migrations = await database.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  const relations = await database.$queryRaw<Array<{ orphan_orders: bigint; orphan_calculations: bigint; orphan_payments: bigint; orphan_movements: bigint; orphan_documents: bigint }>>`
    SELECT
      (SELECT count(*) FROM "Order" o LEFT JOIN "Client" c ON c.id=o."clientId" WHERE c.id IS NULL)::bigint AS orphan_orders,
      (SELECT count(*) FROM "OrderCalculation" x LEFT JOIN "Order" o ON o.id=x."orderId" WHERE o.id IS NULL)::bigint AS orphan_calculations,
      (SELECT count(*) FROM "Payment" p LEFT JOIN "Order" o ON o.id=p."orderId" WHERE p."orderId" IS NOT NULL AND o.id IS NULL)::bigint AS orphan_payments,
      (SELECT count(*) FROM "MaterialMovement" m LEFT JOIN "Material" x ON x.id=m."materialId" WHERE x.id IS NULL)::bigint AS orphan_movements,
      (SELECT count(*) FROM "Document" d LEFT JOIN "Order" o ON o.id=d."orderId" WHERE o.id IS NULL)::bigint AS orphan_documents`;
  return { tables: result, migrations: Number(migrations[0]?.count ?? 0), relations: Object.fromEntries(Object.entries(relations[0] ?? {}).map(([key, value]) => [key, Number(value)])) };
}

const source = client(sourceUrl);
const restored = client(restoreUrl);
try {
  const [before, after] = await Promise.all([snapshot(source), snapshot(restored)]);
  if (before.migrations !== 33 || after.migrations !== 33) throw new Error(`Expected 33 applied migrations; source=${before.migrations}, restore=${after.migrations}`);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Restore verification failed: safe counts, hashes, identifiers or relations differ");
  if (Object.values(before.relations).some((count) => count !== 0)) throw new Error("Restore verification failed: orphan relations detected");
  console.log(JSON.stringify({ status: "passed", appliedMigrations: after.migrations, tables: after.tables, relations: after.relations }, null, 2));
} finally {
  await Promise.allSettled([source.$disconnect(), restored.$disconnect()]);
}
