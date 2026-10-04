import { RecruitmentCandidateStatus, RecruitmentVacancyStatus, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

const clean = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const validId = (value: unknown) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

async function access() {
  const auth = await requirePermission("employees");
  if (auth.response) return { response: auth.response };
  const role = (auth.session!.user.accountRole || auth.session!.user.role) as Role;
  if (role !== Role.DIRECTOR && role !== Role.OPERATIONS_DIRECTOR)
    return { response: NextResponse.json({ error: "Найм ведёт директор" }, { status: 403 }) };
  return { companyId: Number(auth.session!.user.companyId), userId: Number(auth.session!.user.id), response: null };
}

export async function GET() {
  const auth = await access();
  if (auth.response) return auth.response;
  const companyId = auth.companyId!;
  const [vacancies, assignees] = await Promise.all([
    prisma.recruitmentVacancy.findMany({
      where: { companyId },
      include: {
        createdBy: { select: { name: true } },
        candidateRecords: { include: { responsibleUser: { select: { id: true, name: true } } }, orderBy: { updatedAt: "desc" } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.user.findMany({ where: { companyId, active: true, role: { in: [Role.DIRECTOR, Role.OPERATIONS_DIRECTOR] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ vacancies, assignees });
}

export async function POST(request: Request) {
  const auth = await access();
  if (auth.response) return auth.response;
  const companyId = auth.companyId!;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "vacancy") {
      const title = clean(body.title, 200);
      if (!title) return NextResponse.json({ error: "Укажите должность" }, { status: 400 });
      const vacancy = await prisma.recruitmentVacancy.create({ data: { companyId, title, note: clean(body.note, 2000) || null, createdById: auth.userId! } });
      return NextResponse.json(vacancy, { status: 201 });
    }
    if (body.action === "candidate") {
      const vacancyId = validId(body.vacancyId);
      const name = clean(body.name, 200);
      const responsibleUserId = body.responsibleUserId ? validId(body.responsibleUserId) : null;
      if (!vacancyId || !name || (body.responsibleUserId && !responsibleUserId)) return NextResponse.json({ error: "Укажите вакансию, имя и ответственного" }, { status: 400 });
      const vacancy = await prisma.recruitmentVacancy.findFirst({ where: { id: vacancyId, companyId }, select: { id: true } });
      if (!vacancy) return NextResponse.json({ error: "Вакансия не найдена" }, { status: 404 });
      if (responsibleUserId) {
        const user = await prisma.user.findFirst({ where: { id: responsibleUserId, companyId, active: true, role: { in: [Role.DIRECTOR, Role.OPERATIONS_DIRECTOR] } }, select: { id: true } });
        if (!user) return NextResponse.json({ error: "Ответственный не найден" }, { status: 400 });
      }
      const candidate = await prisma.$transaction(async (tx) => {
        const created = await tx.recruitmentCandidate.create({ data: { companyId, vacancyId, name, phone: clean(body.phone, 60) || null, note: clean(body.note, 2000) || null, responsibleUserId, createdById: auth.userId! } });
        await tx.recruitmentVacancy.update({ where: { id: vacancyId }, data: { candidates: { increment: 1 } } });
        return created;
      });
      return NextResponse.json(candidate, { status: 201 });
    }
    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Не удалось сохранить" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await access();
  if (auth.response) return auth.response;
  const companyId = auth.companyId!;
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = validId(body.id);
    if (!id) return NextResponse.json({ error: "Некорректная запись" }, { status: 400 });
    if (body.action === "vacancy") {
      const status = body.status as RecruitmentVacancyStatus;
      const title = clean(body.title, 200);
      if (!title || !Object.values(RecruitmentVacancyStatus).includes(status)) return NextResponse.json({ error: "Проверьте вакансию" }, { status: 400 });
      const updated = await prisma.recruitmentVacancy.updateMany({ where: { id, companyId }, data: { title, note: clean(body.note, 2000) || null, status } });
      if (!updated.count) return NextResponse.json({ error: "Вакансия не найдена" }, { status: 404 });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "candidate") {
      const status = body.status as RecruitmentCandidateStatus;
      const name = clean(body.name, 200);
      const responsibleUserId = body.responsibleUserId ? validId(body.responsibleUserId) : null;
      if (!name || !Object.values(RecruitmentCandidateStatus).includes(status) || (body.responsibleUserId && !responsibleUserId)) return NextResponse.json({ error: "Проверьте кандидата" }, { status: 400 });
      const candidate = await prisma.recruitmentCandidate.findFirst({ where: { id, companyId }, select: { vacancyId: true } });
      if (!candidate) return NextResponse.json({ error: "Кандидат не найден" }, { status: 404 });
      if (responsibleUserId) {
        const user = await prisma.user.findFirst({ where: { id: responsibleUserId, companyId, active: true, role: { in: [Role.DIRECTOR, Role.OPERATIONS_DIRECTOR] } }, select: { id: true } });
        if (!user) return NextResponse.json({ error: "Ответственный не найден" }, { status: 400 });
      }
      await prisma.$transaction(async (tx) => {
        await tx.recruitmentCandidate.update({ where: { id }, data: { name, phone: clean(body.phone, 60) || null, note: clean(body.note, 2000) || null, status, responsibleUserId } });
        if (status === RecruitmentCandidateStatus.HIRED) await tx.recruitmentVacancy.update({ where: { id: candidate.vacancyId }, data: { status: RecruitmentVacancyStatus.HIRED } });
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Не удалось обновить" }, { status: 500 });
  }
}
