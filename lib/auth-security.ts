import { createHash } from "crypto";
import type { PrismaClient } from "@prisma/client";

export const ACCOUNT_FAILURE_LIMIT = 5;
export const ACCOUNT_IP_FAILURE_LIMIT = Number(process.env.AUTH_ACCOUNT_IP_FAILURE_LIMIT ?? 8);
export const IP_ABUSE_FAILURE_LIMIT = Number(process.env.AUTH_IP_ABUSE_FAILURE_LIMIT ?? 100);
export const AUTH_WINDOW_MS = 15 * 60_000;
export const AUTH_AUDIT_RETENTION_DAYS = 90;

export function accountFailureWindowStart(passwordChangedAt: Date | null | undefined, now = Date.now()) {
  const windowStart = new Date(now - AUTH_WINDOW_MS);
  return passwordChangedAt && passwordChangedAt > windowStart ? passwordChangedAt : windowStart;
}

export type SafeAuthReason = "INVALID_CREDENTIALS" | "TEMPORARILY_LOCKED" | "RATE_LIMITED" | "SESSION_INVALID" | "PASSWORD_CHANGE_REQUIRED" | "CSRF_OR_AUTH_FLOW_ERROR" | "NETWORK_ERROR" | "TEMPORARY_ACCESS_EXPIRED" | "OPERATIONAL_ACCESS_REVOKED";

type RequestLike = { headers?: Record<string, string | string[] | undefined> };

function keyedHash(namespace: string, value: string) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  return createHash("sha256").update(`${namespace}:${secret}:${value}`).digest("hex");
}

export function normalizeAccountIdentifier(value: string) { return value.trim().toLowerCase(); }
export function accountIdentifierHash(value: string) { return keyedHash("account", normalizeAccountIdentifier(value)); }

export function requestIpHash(request: RequestLike) {
  const forwarded = request.headers?.["x-forwarded-for"];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return ip ? keyedHash("ip", ip) : null;
}

export function requestId(request: RequestLike) {
  const value = request.headers?.["x-request-id"];
  const first = Array.isArray(value) ? value[0] : value;
  return first && /^[0-9a-f-]{36}$/i.test(first) ? first : null;
}

export function userAgentClass(request: RequestLike) {
  const value = request.headers?.["user-agent"], ua = (Array.isArray(value) ? value[0] : value)?.toLowerCase() ?? "";
  if (/bot|crawler|spider/.test(ua)) return "BOT";
  if (/iphone|ipad|ios/.test(ua)) return "IOS";
  if (/android/.test(ua)) return "ANDROID";
  if (/mobile/.test(ua)) return "MOBILE_OTHER";
  return ua ? "DESKTOP" : "UNKNOWN";
}

export async function writeAuthAudit(prisma: PrismaClient, input: { userId?: number; success: boolean; reason: string; identifierHash: string | null; ipHash: string | null; requestId: string | null; userAgentClass: string }) {
  await prisma.authAuditEvent.create({ data: { userId: input.userId, email: null, success: input.success, reason: input.reason, accountIdentifierHash: input.identifierHash, ipHash: input.ipHash, requestId: input.requestId, userAgentClass: input.userAgentClass } }).catch(() => undefined);
}

export async function pruneAuthAudit(prisma: PrismaClient) {
  if (Math.random() > 0.01) return;
  const before = new Date(Date.now() - AUTH_AUDIT_RETENTION_DAYS * 86_400_000);
  await prisma.authAuditEvent.deleteMany({ where: { createdAt: { lt: before } } }).catch(() => undefined);
}
