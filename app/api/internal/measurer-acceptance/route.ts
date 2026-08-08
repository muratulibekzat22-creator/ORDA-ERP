import { Role } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { scheduleMeasurement } from "@/lib/services/measurement.service";

const managerEmail = "manager.test@altynsapa.kz";
const measurerEmail = "measurer.test@altynsapa.kz";

function authorized(request: Request) {
  const expected = process.env.MEASURER_ACCEPTANCE_TOKEN;
  const url = new URL(request.url);
  return Boolean(
    expected &&
    (request.headers.get("x-acceptance-token") === expected ||
      url.searchParams.get("token") === expected),
  );
}

export async function GET(request: Request) {
  if (!authorized(request))
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const url = new URL(request.url);
  const role =
    url.searchParams.get("as") === "manager" ? Role.MANAGER : Role.MEASURER;
  const email = role === Role.MANAGER ? managerEmail : measurerEmail;
  const user = await prisma.user.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      role,
      active: true,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      sessionVersion: true,
      mustChangePassword: true,
    },
  });
  if (!user || !process.env.NEXTAUTH_SECRET)
    return NextResponse.json(
      { error: "TEST_ACCOUNT_NOT_FOUND" },
      { status: 404 },
    );
  const maxAge = 8 * 60 * 60;
  const token = await encode({
    secret: process.env.NEXTAUTH_SECRET,
    maxAge,
    token: {
      id: String(user.id),
      sub: String(user.id),
      name: user.name,
      email: user.email,
      role: user.role,
      sessionVersion: user.sessionVersion,
      mustChangePassword: user.mustChangePassword,
      invalid: false,
    },
  });
  const response = NextResponse.redirect(
    new URL(role === Role.MANAGER ? "/clients" : "/", request.url),
  );
  response.cookies.set("__Secure-next-auth.session-token", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  return response;
}

export async function POST(request: Request) {
  if (!authorized(request))
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    clientId?: number;
    measurementId?: number;
    visitDate?: string;
  };
  const [manager, measurer] = await Promise.all([
    prisma.user.findFirst({
      where: {
        email: { equals: managerEmail, mode: "insensitive" },
        role: Role.MANAGER,
      },
      select: { id: true, name: true, email: true, active: true },
    }),
    prisma.user.findFirst({
      where: {
        email: { equals: measurerEmail, mode: "insensitive" },
        role: Role.MEASURER,
      },
      select: { id: true, name: true, email: true, active: true },
    }),
  ]);
  if (!manager || !measurer)
    return NextResponse.json(
      { error: "TEST_ACCOUNT_NOT_FOUND" },
      { status: 404 },
    );
  if (body.action === "context") {
    const client = await prisma.client.findFirst({
      where: {
        managerUserId: manager.id,
        active: true,
        OR: [
          { name: { contains: "test", mode: "insensitive" } },
          { source: { contains: "test", mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        phone: true,
        city: true,
        address: true,
        managerUserId: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({ manager, measurer, client });
  }
  if (
    body.action === "schedule" &&
    Number.isInteger(body.clientId) &&
    typeof body.visitDate === "string"
  ) {
    const visitDate = new Date(body.visitDate);
    if (Number.isNaN(visitDate.getTime())) {
      return NextResponse.json({ error: "INVALID_DATE" }, { status: 400 });
    }
    const measurement = await scheduleMeasurement(
      { userId: manager.id, name: manager.name, role: Role.MANAGER },
      {
        clientId: body.clientId!,
        measurerUserId: measurer.id,
        visitDate,
        city: "Алматы",
        address: "Алматы, проспект Абая 1",
        mapLink: "https://maps.google.com/?q=43.238949,76.889709",
        comment: "Production acceptance MEASURER TEST",
      },
    );
    return NextResponse.json({ measurement });
  }
  if (body.action === "inspect" && Number.isInteger(body.measurementId)) {
    const measurement = await prisma.measurement.findUnique({
      where: { id: body.measurementId },
      select: {
        id: true,
        clientId: true,
        status: true,
        visitDate: true,
        city: true,
        address: true,
        mapLink: true,
        measurerUserId: true,
        measurer: true,
        calendarTaskId: true,
        client: { select: { name: true, managerUserId: true } },
        calendarTask: {
          select: {
            id: true,
            assigneeId: true,
            clientId: true,
            dueAt: true,
            status: true,
            type: true,
          },
        },
      },
    });
    const payroll = await prisma.employeePayrollProfile.findUnique({
      where: { userId: measurer.id },
      select: { id: true, userId: true },
    });
    return NextResponse.json({ manager, measurer, payroll, measurement });
  }
  return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
}
