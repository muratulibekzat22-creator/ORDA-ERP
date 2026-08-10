import { del } from "@/lib/private-blob";
import { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ClientDeletionActor = { userId: number; role: Role; name: string };
export class ClientDeletionError extends Error {}
type Database = Prisma.TransactionClient | typeof prisma;

async function buildImpact(db: Database, clientId: number) {
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, phone: true, city: true, managerUserId: true, createdAt: true, orders: { select: { id: true } }, measurements: { select: { id: true } }, documents: { select: { id: true } } },
  });
  if (!client) throw new ClientDeletionError("CLIENT_NOT_FOUND");
  const orderIds = client.orders.map((row) => row.id), measurementIds = client.measurements.map((row) => row.id);
  const orderDocuments = orderIds.length ? await db.document.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } }) : [];
  const documentIds = [...new Set([...client.documents.map((row) => row.id), ...orderDocuments.map((row) => row.id)])];
  const accruals = orderIds.length ? await db.payrollAccrual.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } }) : [];
  const accrualIds = accruals.map((row) => row.id);
  const [payments, partnerPayouts, payrollPayments, ledgerEntries, materialMovements, reservations, cogs, counts, blobRows] = await Promise.all([
    orderIds.length ? db.payment.count({ where: { orderId: { in: orderIds } } }) : 0,
    orderIds.length ? db.payment.count({ where: { orderId: { in: orderIds }, type: { in: ["PARTNER_PAYOUT", "PARTNER_PAYOUT_REVERSAL"] } } }) : 0,
    accrualIds.length ? db.payrollPayment.count({ where: { relatedAccrualId: { in: accrualIds } } }) : 0,
    orderIds.length || accrualIds.length ? db.companyLedgerEntry.count({ where: { OR: [{ orderId: { in: orderIds.length ? orderIds : [-1] } }, { payrollAccrualId: { in: accrualIds.length ? accrualIds : [-1] } }] } }) : 0,
    orderIds.length ? db.materialMovement.count({ where: { orderId: { in: orderIds } } }) : 0,
    orderIds.length ? db.materialReservation.count({ where: { orderId: { in: orderIds } } }) : 0,
    orderIds.length ? db.inventoryCogsEntry.count({ where: { orderId: { in: orderIds } } }) : 0,
    Promise.all([
      db.commercialProposal.count({ where: { clientId } }), db.leadCalculation.count({ where: { clientId } }), db.priceApprovalRequest.count({ where: { clientId } }), db.leadFollowUp.count({ where: { clientId } }), db.clientInteraction.count({ where: { clientId } }), db.clientAttachment.count({ where: { clientId } }), db.calendarTask.count({ where: { OR: [{ clientId }, ...(orderIds.length ? [{ orderId: { in: orderIds } }] : [])] } }),
      documentIds.length ? db.documentVersion.count({ where: { documentId: { in: documentIds } } }) : 0,
      orderIds.length || documentIds.length ? db.attachment.count({ where: { OR: [{ orderId: { in: orderIds.length ? orderIds : [-1] } }, { documentId: { in: documentIds.length ? documentIds : [-1] } }] } }) : 0,
      measurementIds.length ? db.measurementAttachment.count({ where: { measurementId: { in: measurementIds } } }) : 0,
      orderIds.length ? db.production.count({ where: { orderId: { in: orderIds } } }) : 0,
    ]),
    Promise.all([
      db.clientAttachment.findMany({ where: { clientId }, select: { pathname: true } }),
      orderIds.length || documentIds.length ? db.attachment.findMany({ where: { OR: [{ orderId: { in: orderIds.length ? orderIds : [-1] } }, { documentId: { in: documentIds.length ? documentIds : [-1] } }] }, select: { pathname: true } }) : [],
      measurementIds.length ? db.measurementAttachment.findMany({ where: { measurementId: { in: measurementIds } }, select: { pathname: true } }) : [],
      documentIds.length ? db.document.findMany({ where: { id: { in: documentIds } }, select: { signedPathname: true } }) : [],
      documentIds.length ? db.documentVersion.findMany({ where: { documentId: { in: documentIds } }, select: { pathname: true } }) : [],
    ]),
  ]);
  const cashLedgerEntries = orderIds.length ? await db.companyLedgerEntry.count({ where: { orderId: { in: orderIds }, payrollAccrualId: null } }) : 0;
  const [proposals, calculations, approvals, followUps, interactions, clientAttachments, calendarTasks, documentVersions, attachments, measurementAttachments, productions] = counts;
  const blobPaths = blobRows.flatMap((rows) => rows.map((row) => "pathname" in row ? row.pathname : row.signedPathname).filter((value): value is string => Boolean(value)));
  const blockers = [payments ? `PAYMENTS:${payments}` : null, partnerPayouts ? `PARTNER_PAYOUTS:${partnerPayouts}` : null, payrollPayments ? `PAYROLL_PAYMENTS:${payrollPayments}` : null, cashLedgerEntries ? `FINANCE_LEDGER:${cashLedgerEntries}` : null, materialMovements ? `WAREHOUSE_MOVEMENTS:${materialMovements}` : null, reservations ? `WAREHOUSE_RESERVATIONS:${reservations}` : null, cogs ? `INVENTORY_COGS:${cogs}` : null].filter((value): value is string => Boolean(value));
  return {
    client: { id: client.id, name: client.name, phone: client.phone, city: client.city, managerUserId: client.managerUserId, createdAt: client.createdAt },
    ids: { orderIds, measurementIds, documentIds, accrualIds },
    impact: { orders: orderIds.length, payments, partnerPayouts, payrollAccruals: accrualIds.length, payrollPayments, ledgerEntries, cashLedgerEntries, measurements: measurementIds.length, calendarTasks, documents: documentIds.length, documentVersions, clientAttachments, attachments, measurementAttachments, proposals, calculations, approvals, followUps, interactions, productions, materialMovements, reservations, cogs },
    blockers,
    blobPaths,
  };
}

export async function previewClientForceDelete(clientId: number, actor: ClientDeletionActor) {
  if (actor.role !== Role.DIRECTOR) throw new ClientDeletionError("FORBIDDEN");
  const preview = await buildImpact(prisma, clientId);
  return { client: preview.client, impact: preview.impact, blocked: preview.blockers.length > 0, blockers: preview.blockers };
}

export async function forceDeleteClient(input: { clientId: number; confirmation: string; reason: string }, actor: ClientDeletionActor) {
  if (actor.role !== Role.DIRECTOR) throw new ClientDeletionError("FORBIDDEN");
  if (input.confirmation !== "УДАЛИТЬ") throw new ClientDeletionError("CONFIRMATION_REQUIRED");
  const reason = input.reason.trim();
  if (reason.length < 5) throw new ClientDeletionError("REASON_REQUIRED");
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${80_000_000 + input.clientId})`;
    const preview = await buildImpact(tx, input.clientId);
    if (preview.blockers.length) throw new ClientDeletionError("FINANCIAL_OR_OPERATIONAL_RECORDS_EXIST");
    const { orderIds, measurementIds, documentIds, accrualIds } = preview.ids;
    if (documentIds.length) {
      await tx.documentAudit.deleteMany({ where: { documentId: { in: documentIds } } });
      await tx.documentVersion.deleteMany({ where: { documentId: { in: documentIds } } });
      await tx.attachment.deleteMany({ where: { documentId: { in: documentIds } } });
      await tx.document.deleteMany({ where: { id: { in: documentIds } } });
    }
    if (measurementIds.length) {
      await tx.measurementAudit.deleteMany({ where: { measurementId: { in: measurementIds } } });
      await tx.measurementAttachment.deleteMany({ where: { measurementId: { in: measurementIds } } });
    }
    if (accrualIds.length) {
      await tx.companyLedgerEntry.deleteMany({ where: { payrollAccrualId: { in: accrualIds } } });
      await tx.payrollAccrual.deleteMany({ where: { id: { in: accrualIds }, reversalOfId: { not: null } } });
      await tx.payrollAccrual.deleteMany({ where: { id: { in: accrualIds } } });
    }
    const taskWhere: Prisma.CalendarTaskWhereInput = { OR: [{ clientId: input.clientId }, ...(orderIds.length ? [{ orderId: { in: orderIds } }] : [])] };
    const taskIds = (await tx.calendarTask.findMany({ where: taskWhere, select: { id: true } })).map((row) => row.id);
    if (measurementIds.length) await tx.measurement.deleteMany({ where: { id: { in: measurementIds } } });
    if (taskIds.length) { await tx.calendarTaskAudit.deleteMany({ where: { taskId: { in: taskIds } } }); await tx.calendarTask.deleteMany({ where: { id: { in: taskIds } } }); }
    if (orderIds.length) {
      await tx.financeAuditEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.partnerAssignmentHistory.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.commercialAdjustment.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.orderBlocker.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.orderGateOverride.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.orderLifecycleEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.orderInstallation.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.production.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.attachment.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.companyLedgerEntry.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.leadConversion.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await tx.priceApprovalRequest.deleteMany({ where: { clientId: input.clientId } });
    await tx.leadFollowUp.deleteMany({ where: { clientId: input.clientId } });
    await tx.leadConversion.deleteMany({ where: { clientId: input.clientId } });
    await tx.commercialProposal.deleteMany({ where: { clientId: input.clientId } });
    await tx.leadCalculation.deleteMany({ where: { clientId: input.clientId } });
    await tx.client.delete({ where: { id: input.clientId } });
    await tx.clientDeletionAudit.create({ data: { deletedClientId: input.clientId, clientSnapshot: preview.client, impact: preview.impact, reason, actorId: actor.userId } });
    return preview;
  }, { maxWait: 10_000, timeout: 30_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  let blobCleanupFailed = 0;
  if (result.blobPaths.length && process.env.BLOB_READ_WRITE_TOKEN) {
    try { await del(result.blobPaths); } catch { blobCleanupFailed = result.blobPaths.length; }
  }
  return { deleted: true, impact: result.impact, blobCleanupFailed };
}
