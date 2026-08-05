import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

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

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
