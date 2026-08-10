import bcrypt from "bcrypt";
import { Prisma, Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { allocateEmployeeCode } from "@/lib/employee-code";
import { ensureCurrentMeasurerTraining } from "@/lib/services/training.service";

const employeeInclude = {
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      active: true,
      createdAt: true,
      lastLogin: true,
      mustChangePassword: true,
      lockedUntil: true,
      partnerProfile: { select: { id: true, name: true } },
    },
  },
} as const;

type EmployeeWithAccount = Prisma.EmployeePayrollProfileGetPayload<{
  include: typeof employeeInclude;
}>;

export class EmployeeError extends Error {}

export function employeeDto(employee: EmployeeWithAccount) {
  const account = employee.user;
  return {
    id: account?.id ?? employee.id,
    employeeId: employee.id,
    userId: account?.id ?? null,
    name: employee.name || account?.name || "Сотрудник",
    position: employee.position || account?.role || "Сотрудник",
    email: employee.email || account?.email || null,
    phone: employee.phone || account?.phone || null,
    role: account?.role ?? null,
    active: employee.active,
    hasOrdaAccess: Boolean(account),
    accountActive: Boolean(account?.active),
    createdAt: employee.createdAt,
    lastLogin: account?.lastLogin ?? null,
    mustChangePassword: account?.mustChangePassword ?? false,
    lockedUntil: account?.lockedUntil ?? null,
    partnerProfile: account?.partnerProfile ?? null,
  };
}

export async function listEmployees(status: "active" | "inactive" | "all") {
  const active = status === "all" ? undefined : status === "active";
  const employees = await prisma.employeePayrollProfile.findMany({
    where: active === undefined ? undefined : { active },
    include: employeeInclude,
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
  });
  return employees.map(employeeDto);
}

type CreateEmployeeInput = {
  name: string;
  position: string;
  phone?: string;
  email?: string;
  active?: boolean;
  hasOrdaAccess: boolean;
  role?: Role;
  password?: string;
};

function validateIdentity(input: CreateEmployeeInput) {
  const name = input.name.trim();
  const position = input.position.trim();
  const phone = input.phone?.trim() || null;
  const email = input.email?.trim().toLowerCase() || null;
  if (!name || !position) throw new EmployeeError("EMPLOYEE_FIELDS_REQUIRED");
  if (email && !email.includes("@")) throw new EmployeeError("INVALID_EMAIL");
  return { name, position, phone, email };
}

export async function createEmployee(input: CreateEmployeeInput, actorId: number) {
  const identity = validateIdentity(input);
  if (input.hasOrdaAccess) {
    if (!identity.email || !input.password || input.password.length < 12)
      throw new EmployeeError("ACCESS_FIELDS_REQUIRED");
    if (!input.role || input.role === Role.PARTNER)
      throw new EmployeeError("INVALID_EMPLOYEE_ROLE");
  }
  const passwordHash = input.hasOrdaAccess
    ? await bcrypt.hash(input.password!, 12)
    : null;
  const employee = await prisma.$transaction(async (tx) => {
    let userId: number | null = null;
    if (input.hasOrdaAccess) {
      const account = await tx.user.create({
        data: {
          name: identity.name,
          email: identity.email!,
          password: passwordHash!,
          phone: identity.phone,
          role: input.role!,
          active: input.active ?? true,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
          employeeCode: await allocateEmployeeCode(tx, input.role!),
        },
      });
      userId = account.id;
      if (account.role === Role.MEASURER && account.active)
        await ensureCurrentMeasurerTraining(tx, account.id);
    }
    const profile = await tx.employeePayrollProfile.create({
      data: {
        userId,
        ...identity,
        hiredAt: new Date(),
        active: input.active ?? true,
        payrollEnabled: true,
      },
      include: employeeInclude,
    });
    await tx.payrollAuditEvent.create({
      data: {
        action: "EMPLOYEE_CREATED",
        actorId,
        employeeId: profile.id,
        after: {
          name: identity.name,
          position: identity.position,
          hasOrdaAccess: input.hasOrdaAccess,
        },
        reason: "Добавление сотрудника",
      },
    });
    return profile;
  });
  return employeeDto(employee);
}

export async function updateEmployee(
  employeeId: number,
  input: { name?: string; position?: string; phone?: string; email?: string; active?: boolean },
  actorId: number,
) {
  return prisma.$transaction(async (tx) => {
    const previous = await tx.employeePayrollProfile.findUnique({ where: { id: employeeId } });
    if (!previous) throw new EmployeeError("EMPLOYEE_NOT_FOUND");
    const name = typeof input.name === "string" ? input.name.trim() : undefined;
    const position = typeof input.position === "string" ? input.position.trim() : undefined;
    if (name === "" || position === "") throw new EmployeeError("EMPLOYEE_FIELDS_REQUIRED");
    const profile = await tx.employeePayrollProfile.update({
      where: { id: employeeId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(position !== undefined ? { position } : {}),
        ...(typeof input.phone === "string" ? { phone: input.phone.trim() || null } : {}),
        ...(typeof input.email === "string" ? { email: input.email.trim().toLowerCase() || null } : {}),
        ...(typeof input.active === "boolean"
          ? { active: input.active, terminatedAt: input.active ? null : new Date() }
          : {}),
      },
      include: employeeInclude,
    });
    if (profile.userId) {
      await tx.user.update({
        where: { id: profile.userId },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(typeof input.phone === "string" ? { phone: input.phone.trim() || null } : {}),
          ...(input.active === false
            ? { active: false, sessionVersion: { increment: 1 } }
            : {}),
        },
      });
    }
    await tx.payrollAuditEvent.create({
      data: {
        action: "EMPLOYEE_UPDATED",
        actorId,
        employeeId,
        before: {
          name: previous.name,
          position: previous.position,
          active: previous.active,
        },
        after: {
          name: profile.name,
          position: profile.position,
          active: profile.active,
        },
        reason: input.active === false ? "Деактивация сотрудника" : "Изменение сотрудника",
      },
    });
    const refreshed = await tx.employeePayrollProfile.findUniqueOrThrow({
      where: { id: employeeId },
      include: employeeInclude,
    });
    return employeeDto(refreshed);
  });
}

export async function createEmployeeAccess(
  employeeId: number,
  input: { email: string; password: string; role: Role },
  actorId: number,
) {
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@") || input.password.length < 12)
    throw new EmployeeError("ACCESS_FIELDS_REQUIRED");
  if (!Object.values(Role).includes(input.role) || input.role === Role.PARTNER)
    throw new EmployeeError("INVALID_EMPLOYEE_ROLE");
  const passwordHash = await bcrypt.hash(input.password, 12);
  return prisma.$transaction(async (tx) => {
    const employee = await tx.employeePayrollProfile.findUnique({ where: { id: employeeId } });
    if (!employee) throw new EmployeeError("EMPLOYEE_NOT_FOUND");
    if (employee.userId) throw new EmployeeError("ACCESS_ALREADY_EXISTS");
    const account = await tx.user.create({
      data: {
        name: employee.name,
        email,
        password: passwordHash,
        phone: employee.phone,
        role: input.role,
        active: employee.active,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        employeeCode: await allocateEmployeeCode(tx, input.role),
      },
    });
    await tx.employeePayrollProfile.update({
      where: { id: employeeId },
      data: { userId: account.id, email },
    });
    if (account.role === Role.MEASURER && account.active)
      await ensureCurrentMeasurerTraining(tx, account.id);
    await tx.payrollAuditEvent.create({
      data: {
        action: "ORDA_ACCESS_CREATED",
        actorId,
        employeeId,
        after: { userId: account.id, role: account.role },
        reason: "Создание доступа в ORDA",
      },
    });
    return tx.employeePayrollProfile
      .findUniqueOrThrow({ where: { id: employeeId }, include: employeeInclude })
      .then(employeeDto);
  });
}
