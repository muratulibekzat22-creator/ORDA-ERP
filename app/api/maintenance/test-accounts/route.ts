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

export async function DELETE(request: Request) {
  const auth = await requirePermission("employees");
  if (auth.response) return auth.response;
  const role = (auth.session!.user.accountRole || auth.session!.user.role) as Role;
  if (role !== Role.DIRECTOR)
    return NextResponse.json({ error: "Только основатель может удалять тестовые аккаунты" }, { status: 403 });

  const body = await request.json() as { confirmation?: string; expectedCandidateCount?: number };
  if (body.confirmation !== "DELETE_CONFIRMED_TEST_ACCOUNTS")
    return NextResponse.json({ error: "Неверное подтверждение удаления" }, { status: 400 });

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, active: true },
    orderBy: { id: "asc" },
  });
  const candidates = users.filter(isTestAccount);
  const candidateIds = candidates.map((user) => user.id);
  if (body.expectedCandidateCount !== candidates.length)
    return NextResponse.json({ error: "Список изменился. Обновите аудит перед удалением", candidateCount: candidates.length }, { status: 409 });
  if (candidateIds.includes(Number(auth.session!.user.id)))
    return NextResponse.json({ error: "Текущий аккаунт попал в список удаления" }, { status: 409 });
  if (!users.some((user) => user.role === Role.DIRECTOR && user.active && !candidateIds.includes(user.id)))
    return NextResponse.json({ error: "Удаление оставит систему без действующего основателя" }, { status: 409 });

  const profiles = await prisma.employeePayrollProfile.findMany({
    where: { userId: { in: candidateIds } },
    select: {
      id: true,
      name: true,
      _count: { select: { salaryRates: true, accruals: true, payments: true, paymentConfirmations: true, advanceRequests: true, companyLedgerEntries: true } },
    },
  });
  const profilesWithHistory = profiles.filter((profile) => Object.values(profile._count).some((count) => count > 0));
  if (profilesWithHistory.length)
    return NextResponse.json({
      error: "У тестовых профилей обнаружена история зарплаты. Удаление отменено без изменений",
      blockedProfiles: profilesWithHistory,
    }, { status: 409 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const profileIds = profiles.map((profile) => profile.id);
      if (profileIds.length)
        await tx.payrollAuditEvent.deleteMany({ where: { employeeId: { in: profileIds } } });
      const deletedProfiles = await tx.employeePayrollProfile.deleteMany({ where: { id: { in: profileIds } } });
      const deletedUsers = await tx.user.deleteMany({ where: { id: { in: candidateIds } } });
      if (deletedUsers.count !== candidateIds.length)
        throw new Error(`Ожидалось ${candidateIds.length} удалений, выполнено ${deletedUsers.count}`);
      return { deletedUsers: deletedUsers.count, deletedProfiles: deletedProfiles.count };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const relationConflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
    return NextResponse.json({
      error: relationConflict
        ? "У тестовых аккаунтов остались связанные записи. Удаление отменено без изменений"
        : "Не удалось удалить тестовые аккаунты. Изменения отменены",
    }, { status: 409 });
  }
}
