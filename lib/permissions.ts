import { Role } from "./roles";

export const permissionKeys = ["employees", "clients", "orders", "measurements", "calendar", "documents", "finance", "partners", "reports", "settings", "design", "production", "installation", "warehouse", "payroll", "marketing", "operations"] as const;
export type Permission = (typeof permissionKeys)[number];

const all: Permission[] = [...permissionKeys];
export const defaultPermissions: Record<Role, Permission[]> = {
  DIRECTOR: all,
  OPERATIONS_DIRECTOR: ["clients", "orders", "measurements", "calendar", "documents", "partners", "reports", "production", "warehouse", "marketing", "operations"],
  MARKETER: ["marketing", "calendar"],
  MANAGER: ["clients", "orders", "measurements", "calendar", "documents", "production", "warehouse", "partners"],
  ACCOUNTANT: ["documents", "finance", "partners", "reports", "warehouse", "payroll", "marketing"],
  MEASURER: ["measurements", "calendar", "documents"],
  DESIGNER: ["design", "orders"],
  PRODUCTION: ["production", "calendar", "documents", "warehouse"],
  INSTALLER: ["production", "installation", "calendar", "documents", "warehouse"],
  PARTNER: ["orders", "finance", "partners", "documents"],
};

export const hasDefaultPermission = (role: Role, permission: Permission) => defaultPermissions[role].includes(permission);
// Kept for synchronous UI callers; server-side guards use the persisted matrix.
export const hasPermission = hasDefaultPermission;
