import { Role } from "./roles";

export const permissionKeys = ["employees", "clients", "orders", "measurements", "calendar", "documents", "finance", "partners", "reports", "settings", "design", "production", "installation", "warehouse"] as const;
export type Permission = (typeof permissionKeys)[number];

const all: Permission[] = [...permissionKeys];
export const defaultPermissions: Record<Role, Permission[]> = {
  DIRECTOR: all,
  MANAGER: ["clients", "orders", "measurements", "calendar", "documents", "production", "warehouse"],
  ACCOUNTANT: ["finance", "partners", "reports", "warehouse"],
  MEASURER: ["measurements", "calendar"],
  DESIGNER: ["design", "orders"],
  PRODUCTION: ["production", "calendar", "warehouse"],
  INSTALLER: ["production", "installation", "calendar", "warehouse"],
  PARTNER: ["orders", "finance", "partners", "documents"],
};

export const hasDefaultPermission = (role: Role, permission: Permission) => defaultPermissions[role].includes(permission);
// Kept for synchronous UI callers; server-side guards use the persisted matrix.
export const hasPermission = hasDefaultPermission;
