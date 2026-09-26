import "dotenv/config";

import bcrypt from "bcrypt";
import { Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { runWithSystemAccess } from "@/lib/tenant-context";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is missing`);
  return value;
}

async function main() {
  if (process.env.PREPARE_PRODUCTION_LEADERSHIP !== "confirmed") {
    console.log("Production leadership preparation skipped");
    return;
  }
  if (process.env.VERCEL_ENV !== "production")
    throw new Error("Leadership preparation is allowed only in Vercel production");

  const founderEmail = required("PRODUCTION_FOUNDER_LOGIN").toLowerCase();
  const founderPassword = required("PRODUCTION_FOUNDER_PASSWORD");
  const operationsEmail = required("PRODUCTION_OPERATIONS_DIRECTOR_LOGIN").toLowerCase();
  const operationsPassword = required("PRODUCTION_OPERATIONS_DIRECTOR_PASSWORD");
  const operationsName = required("PRODUCTION_OPERATIONS_DIRECTOR_NAME");
  if (!founderEmail.includes("@") || !operationsEmail.includes("@"))
    throw new Error("Leadership login is invalid");
  if (founderPassword.length < 16 || operationsPassword.length < 16)
    throw new Error("Leadership passwords must contain at least 16 characters");

  const existingDirectors = await prisma.user.findMany({
    where: { role: Role.DIRECTOR },
    orderBy: { id: "asc" },
    select: { id: true, companyId: true, email: true, name: true },
  });
  if (!existingDirectors.length)
    throw new Error("No existing founder account was found");
  const founder = existingDirectors.find(
    (user) => user.email.toLowerCase() === founderEmail,
  ) ?? existingDirectors[0];
  const founderEmailOwner = await prisma.user.findUnique({
    where: { email: founderEmail },
    select: { id: true },
  });
  if (founderEmailOwner && founderEmailOwner.id !== founder.id)
    throw new Error("Founder login belongs to another account");

  const founderPasswordHash = await bcrypt.hash(founderPassword, 12);
  const operationsPasswordHash = await bcrypt.hash(operationsPassword, 12);
  const result = await prisma.$transaction(async (tx) => {
    const founderAccount = await tx.user.update({
      where: { id: founder.id },
      data: {
        email: founderEmail,
        role: Role.DIRECTOR,
        password: founderPasswordHash,
        active: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        sessionVersion: { increment: 1 },
      },
      select: { id: true, companyId: true },
    });
    const existingOperations = await tx.user.findUnique({
      where: { email: operationsEmail },
      select: { id: true, companyId: true },
    });
    if (existingOperations && existingOperations.companyId !== founderAccount.companyId)
      throw new Error("Operations director belongs to another company");
    const operationsAccount = existingOperations
      ? await tx.user.update({
          where: { id: existingOperations.id },
          data: {
            name: operationsName,
            role: Role.OPERATIONS_DIRECTOR,
            password: operationsPasswordHash,
            active: true,
            failedLoginAttempts: 0,
            lockedUntil: null,
            passwordChangedAt: new Date(),
            mustChangePassword: false,
            sessionVersion: { increment: 1 },
          },
        })
      : await tx.user.create({
          data: {
            companyId: founderAccount.companyId,
            name: operationsName,
            email: operationsEmail,
            password: operationsPasswordHash,
            role: Role.OPERATIONS_DIRECTOR,
            active: true,
            mustChangePassword: false,
          },
        });
    for (const account of [
      { ...founderAccount, name: founder.name, email: founderEmail, role: Role.DIRECTOR },
      { ...operationsAccount, role: Role.OPERATIONS_DIRECTOR },
    ]) {
      await tx.employeePayrollProfile.upsert({
        where: { userId: account.id },
        create: {
          companyId: founderAccount.companyId,
          userId: account.id,
          name: account.name,
          email: account.email,
          position: account.role === Role.DIRECTOR ? "Основатель / CEO" : "Директор",
          hiredAt: new Date(),
          active: true,
          payrollEnabled: true,
        },
        update: {
          name: account.name,
          email: account.email,
          position: account.role === Role.DIRECTOR ? "Основатель / CEO" : "Директор",
          active: true,
          payrollEnabled: true,
          terminatedAt: null,
        },
      });
    }
    return { founderId: founderAccount.id, operationsDirectorId: operationsAccount.id };
  });
  console.log(`Production leadership prepared: founder=${result.founderId}, operationsDirector=${result.operationsDirectorId}`);
}

runWithSystemAccess(main).finally(() => prisma.$disconnect());
