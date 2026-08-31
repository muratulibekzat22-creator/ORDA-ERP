import { randomBytes } from "node:crypto";

import { Role } from "@prisma/client";

export const OPERATIONS_DIRECTOR_EMAIL = "alikhanmamelyanov@bekzatmuratuly.kz";
export const OPERATIONS_DIRECTOR_NAME = "Алихан Мамельянов";
export const OPERATIONS_ACCESS_DAYS = 30;

export type OperationalAccessCode =
  | "TEMPORARY_ACCESS_EXPIRED"
  | "OPERATIONAL_ACCESS_REVOKED";

export type OperationalAccessState = {
  role: Role | string;
  active: boolean;
  temporaryAccess: boolean;
  accessExpiresAt: Date | string | null;
  accessRevokedAt: Date | string | null;
};

export function operationalAccessFailure(
  user: OperationalAccessState,
  now = new Date(),
): OperationalAccessCode | null {
  if (user.role !== Role.OPERATIONS_DIRECTOR) return null;
  const expiresAt = user.accessExpiresAt
    ? new Date(user.accessExpiresAt)
    : null;
  if (!user.temporaryAccess || !expiresAt || expiresAt <= now)
    return "TEMPORARY_ACCESS_EXPIRED";
  if (!user.active || user.accessRevokedAt)
    return "OPERATIONAL_ACCESS_REVOKED";
  return null;
}

export function accessExpiry(from = new Date(), days = OPERATIONS_ACCESS_DAYS) {
  return new Date(from.getTime() + days * 86_400_000);
}

export function remainingAccessDays(expiresAt: Date | string | null, now = new Date()) {
  if (!expiresAt) return 0;
  return Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 86_400_000),
  );
}

export function generateTemporaryPassword(length = 20) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const required = ["A", "a", "7", "!"];
  const random = randomBytes(Math.max(length, 16));
  const characters = [...required];
  for (let index = required.length; index < Math.max(length, 16); index += 1)
    characters.push(alphabet[random[index] % alphabet.length]);
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = random[index] % (index + 1);
    [characters[index], characters[swap]] = [characters[swap], characters[index]];
  }
  return characters.join("");
}

export function isSafeOperationalUrl(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 500) throw new Error("INVALID_URL");
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("INVALID_URL");
  return url.toString();
}
