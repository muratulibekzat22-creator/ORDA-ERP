import "dotenv/config";

import bcrypt from "bcrypt";
import { Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";

async function main() {
  const email = process.env.FIRST_DIRECTOR_EMAIL;
  const password = process.env.FIRST_DIRECTOR_PASSWORD;
  const name = process.env.FIRST_DIRECTOR_NAME ?? "\u0414\u0438\u0440\u0435\u043a\u0442\u043e\u0440";

  if (!email || !password) {
    throw new Error("Set FIRST_DIRECTOR_EMAIL and FIRST_DIRECTOR_PASSWORD");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { email },
    update: {
      name,
      password: passwordHash,
      role: Role.DIRECTOR,
      active: true,
    },
    create: {
      name,
      email,
      password: passwordHash,
      role: Role.DIRECTOR,
      active: true,
    },
  });
}

main().finally(() => prisma.$disconnect());
