import bcrypt from "bcrypt";
import { Prisma, Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import QRCode from "qrcode";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { writeAuditLog } from "@/lib/audit";
import { decryptTotpSecret, encryptTotpSecret, generateRecoveryCodes, generateTotpSecret, provisioningUri, recoveryCodeHash, verifyTotp } from "@/lib/mfa";
import { prisma } from "@/lib/prisma";
import { enterTenantFromSession } from "@/lib/tenant-context";

const privileged = new Set<Role>([Role.DIRECTOR, Role.OPERATIONS_DIRECTOR]);
const noStore = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", Vary: "Cookie" };

async function context() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !enterTenantFromSession(session)) return null;
  const role = session.user.accountRole as Role;
  if (!privileged.has(role)) return null;
  return { session, role, userId: Number(session.user.id) };
}

export async function GET() {
  const auth = await context();
  if (!auth) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403, headers: noStore });
  const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { mfaEnabled: true, mfaSetupCompletedAt: true } });
  return NextResponse.json({ enabled: user?.mfaEnabled === true, setupCompletedAt: user?.mfaSetupCompletedAt ?? null }, { headers: noStore });
}

export async function POST(request: Request) {
  const auth = await context();
  if (!auth) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403, headers: noStore });
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { id: true, email: true, password: true, mfaEnabled: true, mfaSecretEncrypted: true } });
    if (!user) return NextResponse.json({ error: "Сессия завершена" }, { status: 401, headers: noStore });

    if (action === "begin") {
      if (user.mfaEnabled) return NextResponse.json({ error: "MFA уже включена" }, { status: 409, headers: noStore });
      const secret = generateTotpSecret();
      const uri = provisioningUri(secret, user.email);
      await prisma.user.update({ where: { id: user.id }, data: { mfaSecretEncrypted: encryptTotpSecret(secret), mfaRecoveryHashes: Prisma.DbNull } });
      await writeAuditLog({ actor: { companyId: auth.session.user.companyId, userId: user.id, role: auth.role }, action: "MFA_ENROLLMENT_STARTED", entityType: "User", entityId: user.id, requestId: request.headers.get("x-request-id") });
      return NextResponse.json({ secret, provisioningUri: uri, qrDataUrl: await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 1, width: 240 }) }, { headers: noStore });
    }

    if (action === "confirm") {
      const code = typeof body.code === "string" ? body.code : "";
      if (!user.mfaSecretEncrypted || !verifyTotp(decryptTotpSecret(user.mfaSecretEncrypted), code))
        return NextResponse.json({ error: "Неверный код" }, { status: 400, headers: noStore });
      const recoveryCodes = generateRecoveryCodes();
      await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true, mfaRecoveryHashes: recoveryCodes.map(recoveryCodeHash), mfaSetupCompletedAt: new Date(), sessionVersion: { increment: 1 } } });
      await writeAuditLog({ actor: { companyId: auth.session.user.companyId, userId: user.id, role: auth.role }, action: "MFA_ENABLED", entityType: "User", entityId: user.id, requestId: request.headers.get("x-request-id") });
      return NextResponse.json({ enabled: true, recoveryCodes }, { headers: noStore });
    }

    if (action === "disable") {
      const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
      const code = typeof body.code === "string" ? body.code : "";
      if (!user.mfaEnabled || !user.mfaSecretEncrypted || !await bcrypt.compare(currentPassword, user.password) || !verifyTotp(decryptTotpSecret(user.mfaSecretEncrypted), code))
        return NextResponse.json({ error: "Не удалось подтвердить действие" }, { status: 400, headers: noStore });
      await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecretEncrypted: null, mfaRecoveryHashes: Prisma.DbNull, mfaSetupCompletedAt: null, sessionVersion: { increment: 1 } } });
      await writeAuditLog({ actor: { companyId: auth.session.user.companyId, userId: user.id, role: auth.role }, action: "MFA_DISABLED", entityType: "User", entityId: user.id, requestId: request.headers.get("x-request-id") });
      return NextResponse.json({ enabled: false }, { headers: noStore });
    }

    return NextResponse.json({ error: "Некорректное действие" }, { status: 400, headers: noStore });
  } catch {
    return NextResponse.json({ error: "Не удалось изменить MFA", requestId: request.headers.get("x-request-id") }, { status: 500, headers: noStore });
  }
}
