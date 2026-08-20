import "../../scripts/require-test-database";

import bcrypt from "bcrypt";
import { Permission, Role } from "@prisma/client";

import { defaultPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { runWithSystemAccess, runWithTenant } from "@/lib/tenant-context";

export const playwrightPassword = "PartnerTest!1";
export const playwrightUsers = {
  director: "partner-playwright-director@test.local",
  manager: "partner-playwright-manager@test.local",
  accountant: "partner-playwright-accountant@test.local",
  measurer: "partner-playwright-measurer@test.local",
  production: "partner-playwright-production@test.local",
  installer: "partner-playwright-installer@test.local",
} as const;

const roles = {
  director: Role.DIRECTOR,
  manager: Role.MANAGER,
  accountant: Role.ACCOUNTANT,
  measurer: Role.MEASURER,
  production: Role.PRODUCTION,
  installer: Role.INSTALLER,
} as const;

export default async function setup() {
  const company = { companyId: 1, companySlug: "altyn-sapa-company", companyName: "ALTYN SAPA TEST", isDemo: false };
  await runWithSystemAccess(() => prisma.company.upsert({ where: { id: 1 }, update: { active: true }, create: { id: 1, slug: company.companySlug, name: company.companyName, isDemo: false } }));
  const hash = await bcrypt.hash(playwrightPassword, 8);
  await runWithTenant(company, async () => {
    await prisma.rolePermission.createMany({
      data: Object.entries(defaultPermissions).flatMap(([role, permissions]) =>
        permissions.map((permission) => ({
          role: role as Role,
          permission: permission as Permission,
        })),
      ),
      skipDuplicates: true,
    });
    for (const [key, email] of Object.entries(playwrightUsers)) {
      const role = roles[key as keyof typeof roles];
      const existing = await prisma.user.findFirst({ where: { email } });
      if (existing) await prisma.user.update({ where: { id: existing.id }, data: { name: `Partner ${key}`, password: hash, role, active: true, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null } });
      else await prisma.user.create({ data: { name: `Partner ${key}`, email, password: hash, role, active: true, mustChangePassword: false } });
    }
  });
  await prisma.$disconnect();
}
