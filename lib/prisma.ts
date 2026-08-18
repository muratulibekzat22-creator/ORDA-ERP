import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getPrismaRuntimeContext, getSessionTenantRuntimeContext } from "@/lib/tenant-context";
import { applyTenantScope } from "@/lib/tenant-scope";

const globalForPrisma = globalThis as {
  prisma?: PrismaClient;
};

function verifiedConnectionString(value: string | undefined) {
  if (!value) return "";
  const url = new URL(value);
  if (["prefer", "require", "verify-ca"].includes(url.searchParams.get("sslmode") ?? ""))
    url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}

const adapter = new PrismaPg({
  connectionString: verifiedConnectionString(process.env.DATABASE_URL!),
});

function createPrismaClient() {
  return new PrismaClient({
    adapter,
    log: ["error"],
  }).$extends({
    name: "tenant-isolation",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const runtimeContext = getPrismaRuntimeContext() ?? await getSessionTenantRuntimeContext();
          return query(
            applyTenantScope(
              model,
              operation,
              args as Record<string, unknown>,
              runtimeContext,
            ),
          );
        },
      },
    },
  });
}

export const prisma: PrismaClient = (globalForPrisma.prisma ??
  createPrismaClient()) as unknown as PrismaClient;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
