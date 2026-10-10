import { Role } from "./roles";

export const permissionKeys = ["employees", "clients", "orders", "measurements", "calendar", "documents", "finance", "partners", "reports", "settings", "design", "production", "installation", "warehouse", "payroll", "marketing"] as const;
export type Permission = (typeof permissionKeys)[number];

const fixedDeniedPermissions: Partial<Record<Role, readonly Permission[]>> = {
  // The operations director runs daily operations, but company margin and
  // workshop settlements remain founder-only management information.
  OPERATIONS_DIRECTOR: ["partners", "reports"],
  MARKETER: ["finance"],
  MANAGER: ["finance"],
  ACCOUNTANT: ["finance"],
  MEASURER: ["finance"],
  DESIGNER: ["finance"],
  PRODUCTION: ["finance"],
  INSTALLER: ["finance"],
  PARTNER: ["finance"],
};

export const isRolePermissionAllowed = (role: Role, permission: Permission) =>
  !fixedDeniedPermissions[role]?.includes(permission);

export const filterRolePermissions = (role: Role, permissions: Permission[]) =>
  [...new Set(permissions)].filter((permission) =>
    permissionKeys.includes(permission) && isRolePermissionAllowed(role, permission),
  );

const all: Permission[] = [...permissionKeys];
export const defaultPermissions: Record<Role, Permission[]> = {
  DIRECTOR: all,
  OPERATIONS_DIRECTOR: ["employees", "clients", "orders", "measurements", "calendar", "documents", "finance", "production", "warehouse", "payroll", "marketing"],
  MARKETER: ["marketing", "calendar", "warehouse", "payroll"],
  MANAGER: ["clients", "orders", "measurements", "calendar", "documents", "production", "warehouse", "partners", "payroll"],
  ACCOUNTANT: ["documents", "partners", "reports", "warehouse", "payroll"],
  MEASURER: ["measurements", "calendar", "documents", "warehouse"],
  DESIGNER: ["design", "orders", "warehouse"],
  PRODUCTION: ["production", "calendar", "documents", "warehouse"],
  INSTALLER: ["production", "installation", "calendar", "documents", "warehouse"],
  PARTNER: ["orders", "partners", "documents"],
};

export const hasDefaultPermission = (role: Role, permission: Permission) => defaultPermissions[role].includes(permission);
// Kept for synchronous UI callers; server-side guards use the persisted matrix.
export const hasPermission = hasDefaultPermission;
