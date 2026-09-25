import "dotenv/config";

import bcrypt from "bcrypt";
import { Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { runWithSystemAccess } from "@/lib/tenant-context";

async function main() {
  if (process.env.PREPARE_PRODUCTION_DIRECTOR !== "confirmed") {
    console.log("Production director preparation skipped");
    return;
  }

  if (process.env.VERCEL_ENV !== "production")
    throw new Error("Director preparation is allowed only in Vercel production");

  const email = process.env.PRODUCTION_DIRECTOR_LOGIN?.trim().toLowerCase();
  const temporaryPassword = process.env.PRODUCTION_DIRECTOR_TEMP_PASSWORD;
  if (!email || !email.includes("@"))
    throw new Error("PRODUCTION_DIRECTOR_LOGIN is missing or invalid");
  if (!temporaryPassword || temporaryPassword.length < 14)
    throw new Error("PRODUCTION_DIRECTOR_TEMP_PASSWORD must contain at least 14 characters");

  const directors = await prisma.user.findMany({
    where: { role: Role.DIRECTOR },
    orderBy: { id: "asc" },
    select: { id: true, email: true },
  });
  if (!directors.length)
    throw new Error("No existing production director account was found");

  const emailOwner = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });
  const target = directors.find((director) => director.email.toLowerCase() === email) ?? directors[0];
  if (emailOwner && emailOwner.id !== target.id)
    throw new Error("The requested director login belongs to another account");

  await prisma.user.update({
    where: { id: target.id },
    data: {
      email,
      password: await bcrypt.hash(temporaryPassword, 12),
      active: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      passwordChangedAt: new Date(),
      mustChangePassword: true,
      sessionVersion: { increment: 1 },
    },
  });
  console.log("Existing production director account prepared for first login");
}

runWithSystemAccess(main).finally(() => prisma.$disconnect());
