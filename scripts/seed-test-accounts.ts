import "dotenv/config";
import bcrypt from "bcrypt";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const accounts = [
  ["DIRECTOR TEST", "director.test@altynsapa.kz", Role.DIRECTOR, "ORDA_TEST_DIRECTOR_PASSWORD"],
  ["MANAGER TEST", "manager.test@altynsapa.kz", Role.MANAGER, "ORDA_TEST_MANAGER_PASSWORD"],
  ["ACCOUNTANT TEST", "accountant.test@altynsapa.kz", Role.ACCOUNTANT, "ORDA_TEST_ACCOUNTANT_PASSWORD"],
  ["MEASURER TEST", "measurer.test@altynsapa.kz", Role.MEASURER, "ORDA_TEST_MEASURER_PASSWORD"],
  ["PRODUCTION TEST", "production.test@altynsapa.kz", Role.PRODUCTION, "ORDA_TEST_PRODUCTION_PASSWORD"],
  ["INSTALLER TEST", "installer.test@altynsapa.kz", Role.INSTALLER, "ORDA_TEST_INSTALLER_PASSWORD"],
  ["ЦЕХ TEST", "workshop.test@altynsapa.kz", Role.PARTNER, "ORDA_TEST_WORKSHOP_PASSWORD"],
] as const;

async function main() {
  const missing = accounts.filter(([, , , variable]) => !process.env[variable]);
  if (missing.length) throw new Error(`Missing ${missing.length} test account password environment variables`);
  const existingWorkshop = await prisma.partner.findFirst({ where: { email: { equals: "workshop.test@altynsapa.kz", mode: "insensitive" } } });
  const workshop = existingWorkshop
    ? await prisma.partner.update({ where: { id: existingWorkshop.id }, data: { name: "ЦЕХ TEST", email: "workshop.test@altynsapa.kz", active: true } })
    : await prisma.partner.create({ data: { name: "ЦЕХ TEST", email: "workshop.test@altynsapa.kz", active: true } });
  for (const [name, email, role, variable] of accounts) {
    const password = await bcrypt.hash(process.env[variable]!, 12);
    const user = await prisma.user.upsert({ where: { email }, create: { name, email, role, password, active: true }, update: { name, role, password, active: true } });
    if (role === Role.PARTNER) {
      await prisma.partner.updateMany({ where: { userId: user.id, id: { not: workshop.id } }, data: { userId: null } });
      await prisma.partner.update({ where: { id: workshop.id }, data: { userId: user.id } });
    }
  }
  console.log(`Test accounts ready: ${accounts.length}`);
}

main().finally(() => prisma.$disconnect());
