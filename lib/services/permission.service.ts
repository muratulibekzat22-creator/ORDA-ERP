import { Permission as PrismaPermission, Role as PrismaRole } from "@prisma/client";

import { defaultPermissions, filterRolePermissions, isRolePermissionAllowed, permissionKeys, type Permission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Role } from "@/lib/roles";
import { requireTenantIdentity } from "@/lib/tenant-context";

const criticalDirectorPermissions: Permission[] = ["settings", "employees"];

function isRole(value: string): value is Role {
  return Object.values(Role).includes(value as Role);
}

export async function ensureRolePermissions() {
  await prisma.rolePermission.createMany({
    data: Object.entries(defaultPermissions).flatMap(([role, values]) => values.map((permission) => ({ role: role as PrismaRole, permission: permission as PrismaPermission }))),
    skipDuplicates: true,
  });
}

export async function hasPermission(role: Role, permission: Permission) {
  if (!isRolePermissionAllowed(role, permission)) return false;
  await ensureRolePermissions();
  return Boolean(await prisma.rolePermission.findUnique({ where: { companyId_role_permission: { companyId: requireTenantIdentity().companyId, role: role as PrismaRole, permission: permission as PrismaPermission } }, select: { id: true } }));
}

export async function getPermissionMatrix() {
  await ensureRolePermissions();
  const rows = await prisma.rolePermission.findMany({ select: { role: true, permission: true } });
  return Object.values(Role).reduce<Record<Role, Permission[]>>((matrix, role) => {
    matrix[role] = filterRolePermissions(role, rows
      .filter((row) => row.role === role && permissionKeys.includes(row.permission as Permission))
      .map((row) => row.permission as Permission)
      .sort((a, b) => permissionKeys.indexOf(a) - permissionKeys.indexOf(b)));
    return matrix;
  }, {} as Record<Role, Permission[]>);
}

export async function getRolePermissions(role: Role) {
  await ensureRolePermissions();
  const rows = await prisma.rolePermission.findMany({
    where: { role: role as PrismaRole },
    select: { permission: true },
  });
  return filterRolePermissions(role, rows
    .map((row) => row.permission as Permission)
    .filter((permission) => permissionKeys.includes(permission))
    .sort((left, right) => permissionKeys.indexOf(left) - permissionKeys.indexOf(right)));
}

export async function replaceRolePermissions(role: Role, permissions: Permission[]) {
  const companyId = requireTenantIdentity().companyId;
  const next = filterRolePermissions(role, permissions);
  if (role === Role.DIRECTOR && criticalDirectorPermissions.some((permission) => !next.includes(permission)))
    throw new Error("DIRECTOR_CRITICAL_PERMISSION");
  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { companyId, role: role as PrismaRole } });
    if (next.length)
      await tx.rolePermission.createMany({
        data: next.map((permission) => ({ companyId, role: role as PrismaRole, permission: permission as PrismaPermission })),
      });
  });
  return next;
}

export async function replacePermissionMatrix(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_PERMISSIONS");
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.every(([role, permissions]) => isRole(role) && Array.isArray(permissions) && permissions.every((permission) => typeof permission === "string" && permissionKeys.includes(permission as Permission)))) throw new Error("INVALID_PERMISSIONS");
  const next = Object.values(Role).reduce<Record<Role, Permission[]>>((matrix, role) => {
    const permissions = (value as Record<string, unknown>)[role];
    matrix[role] = filterRolePermissions(role, Array.isArray(permissions) ? permissions as Permission[] : defaultPermissions[role]);
    return matrix;
  }, {} as Record<Role, Permission[]>);
  if (criticalDirectorPermissions.some((permission) => !next.DIRECTOR.includes(permission))) throw new Error("DIRECTOR_CRITICAL_PERMISSION");

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({
      where: { permission: { in: [...permissionKeys] as PrismaPermission[] } },
    });
    await tx.rolePermission.createMany({ data: Object.entries(next).flatMap(([role, permissions]) => permissions.map((permission) => ({ role: role as PrismaRole, permission: permission as PrismaPermission }))) });
  });
  return next;
}
