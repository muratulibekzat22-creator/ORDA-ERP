import { Role } from "./roles";

export function canViewFinance(role: Role) {
  return role === Role.DIRECTOR || role === Role.ACCOUNTANT;
}

export function canViewProfit(role: Role) {
  return role === Role.DIRECTOR;
}

export function canViewPartnerPrice(role: Role) {
  return role === Role.DIRECTOR;
}

export function canEditExpenses(role: Role) {
  return role === Role.DIRECTOR || role === Role.ACCOUNTANT;
}

export function canManageUsers(role: Role) {
  return role === Role.DIRECTOR;
}