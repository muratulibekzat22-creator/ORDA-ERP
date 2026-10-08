import { Prisma, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

const testMarker = /(?:^|[._@\s-])(test|demo|api-security|e2e|rbac|acceptance|security|payroll|warehouse)(?:[._@\s-]|$)/iu;
const explicitTestNames = new Set(["contract manager"]);

const isTestAccount = (user: { name: string; email: string }) =>
  testMarker.test(`${user.name} ${user.email}`) ||
  explicitTestNames.has(user.name.trim().toLocaleLowerCase("en"));

export async function GET() {
  const auth = await requirePermission("employees");
  if (auth.response) return auth.response;
  const role = (auth.session!.user.accountRole || auth.session!.user.role) as Role;
  if (role !== Role.DIRECTOR)
    return NextResponse.json({ error: "Только основатель может проверять тестовые аккаунты" }, { status: 403 });

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,
    },
    orderBy: { id: "asc" },
  });
  const candidates = users.filter(isTestAccount);
  const candidateIds = candidates.map((user) => user.id);
  const references: Record<string, number> = {};
  const db = prisma as unknown as Record<string, { count(args: unknown): Promise<number> }>;

  if (candidateIds.length) {
    for (const model of Prisma.dmmf.datamodel.models) {
      if (model.name === "User") continue;
      const clauses = model.fields
        .filter((field) => field.kind === "object" && field.type === "User")
        .flatMap((field) => (field.relationFromFields ?? []).map((foreignKey) => ({ [foreignKey]: { in: candidateIds } })));
      if (!clauses.length) continue;
      const delegateName = `${model.name[0].toLowerCase()}${model.name.slice(1)}`;
      const delegate = db[delegateName];
      if (!delegate) continue;
      const count = await delegate.count({ where: clauses.length === 1 ? clauses[0] : { OR: clauses } });
      if (count) references[model.name] = count;
    }
  }

  return NextResponse.json({
    candidateCount: candidates.length,
    candidates,
    references,
    activeRealEmployees: users.filter((user) => user.active && !candidateIds.includes(user.id)),
    inactiveNonTestAccounts: users.filter((user) => !user.active && !candidateIds.includes(user.id)),
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
