import { prisma } from "@/lib/prisma";

export type AuditActor = {
  companyId: number;
  userId?: number;
  role?: string;
};

export async function writeAuditLog(input: {
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
  ipHash?: string | null;
  userAgentClass?: string | null;
}) {
  await prisma.auditLog.create({
    data: {
      companyId: input.actor.companyId,
      actorUserId: input.actor.userId,
      actorRole: input.actor.role,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId === undefined || input.entityId === null ? "" : String(input.entityId),
      reason: "",
      before: input.before as never,
      after: input.after as never,
      requestId: input.requestId ?? null,
      ipHash: input.ipHash ?? null,
      userAgent: input.userAgentClass ?? null,
    },
  });
}
