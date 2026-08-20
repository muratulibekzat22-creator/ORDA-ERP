import "../../scripts/require-test-database";

import bcrypt from "bcrypt";
import { Permission, Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { runWithSystemAccess, runWithTenant } from "@/lib/tenant-context";

export const playwrightPassword = "PartnerTest!1";
export const playwrightUsers = {
  director: "partner-playwright-director@test.local",
  manager: "partner-playwright-manager@test.local",
  accountant: "partner-playwright-accountant@test.local",
} as const;

export default async function setup() {
  const company = { companyId: 1, companySlug: "altyn-sapa-company", companyName: "ALTYN SAPA TEST", isDemo: false };
  await runWithSystemAccess(() => prisma.company.upsert({ where: { id: 1 }, update: { active: true }, create: { id: 1, slug: company.companySlug, name: company.companyName, isDemo: false } }));
  const hash = await bcrypt.hash(playwrightPassword, 8);
  await runWithTenant(company, async () => {
    for (const [role, permission] of [
      [Role.DIRECTOR, Permission.partners],
      [Role.DIRECTOR, Permission.orders],
      [Role.DIRECTOR, Permission.documents],
      [Role.MANAGER, Permission.orders],
    ] as const) {
      await prisma.rolePermission.upsert({
        where: { companyId_role_permission: { companyId: company.companyId, role, permission } },
        update: {},
        create: { role, permission },
      });
    }
    for (const [key, email] of Object.entries(playwrightUsers)) {
      const role = key === "director" ? Role.DIRECTOR : key === "manager" ? Role.MANAGER : Role.ACCOUNTANT;
      const existing = await prisma.user.findFirst({ where: { email } });
      if (existing) await prisma.user.update({ where: { id: existing.id }, data: { name: `Partner ${key}`, password: hash, role, active: true, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null } });
      else await prisma.user.create({ data: { name: `Partner ${key}`, email, password: hash, role, active: true, mustChangePassword: false } });
    }
  });
  await prisma.$disconnect();
}
