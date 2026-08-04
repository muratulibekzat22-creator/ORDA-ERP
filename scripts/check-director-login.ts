import bcrypt from "bcrypt";

function databaseHost(databaseUrl: string | undefined) {
  if (!databaseUrl) return null;

  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return null;
  }
}

function errorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function safeMessage(error: unknown) {
  if (error instanceof Error && error.message === "Neon DATABASE_URL and director credentials are required") {
    return "Neon DATABASE_URL and director credentials are required";
  }

  return errorCode(error) ? "Database query failed" : "Director login check failed";
}

const databaseUrl = process.env.DATABASE_URL;
const email = process.env.FIRST_DIRECTOR_EMAIL;
const password = process.env.FIRST_DIRECTOR_PASSWORD;
const host = databaseHost(databaseUrl);
const environment = {
  envDatabasePresent: Boolean(databaseUrl),
  envEmailPresent: Boolean(email),
  envPasswordPresent: Boolean(password),
  databaseHost: host,
};

async function main() {
  if (!databaseUrl || !host || !host.endsWith("neon.tech") || !email || !password) {
    throw new Error("Neon DATABASE_URL and director credentials are required");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const { prisma } = await import("@/lib/prisma");

  try {
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { active: true, role: true, password: true },
    });
    const passwordMatches = user ? await bcrypt.compare(password, user.password) : false;

    console.log(JSON.stringify({
      userFound: Boolean(user),
      active: user?.active ?? null,
      role: user?.role ?? null,
      passwordMatches,
      databaseHost: host,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.log(JSON.stringify({
    ...environment,
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorCode: errorCode(error),
    safeMessage: safeMessage(error),
  }));
  process.exitCode = 1;
});
