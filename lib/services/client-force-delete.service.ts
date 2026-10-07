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

export async function forceDeleteClient(
  input: { clientId: number; confirmation: string; reason: string },
  actor: ClientDeletionActor,
): Promise<never> {
  void input;
  void actor;
  throw new ClientDeletionError("PHYSICAL_DELETE_FORBIDDEN");
}
