import "./require-test-database";

import crypto from "crypto";
import path from "path";
import dotenv from "dotenv";
import { Role, type PrismaClient } from "@prisma/client";

const parsed = dotenv.config({ path: path.join(process.cwd(), ".env.test.local"), quiet: true }).parsed;
const testUrl = process.env.TEST_DATABASE_URL ?? parsed?.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = testUrl;
const tag = `partner-settlement-${Date.now()}`;
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const ensure = (value: unknown, message: string) => { if (!value) throw new Error(message); };
let prisma!: PrismaClient;

async function main() {
  ({ prisma } = await import("@/lib/prisma"));
  const { createFinanceOperation } = await import("@/lib/services/payment.service");
  const { assignPartnerToOrder } = await import("@/lib/services/partner.service");
  const { buildOrderSettlement } = await import("@/lib/services/order-settlement.service");
  let userId = 0, managerId = 0, clientId = 0, partnerId = 0, orderId = 0;
  try {
    userId = (await prisma.user.create({ data: { name: tag, email: `${tag}@test.local`, password: "not-used", role: Role.DIRECTOR } })).id;
    const manager = await prisma.user.create({ data: { name: `${tag}-manager`, email: `${tag}-manager@test.local`, password: "not-used", role: Role.MANAGER } });
    managerId = manager.id;
    clientId = (await prisma.client.create({ data: { name: tag, phone: `+7${Date.now()}`, city: "TEST", manager: manager.name, managerUserId: manager.id, amount: "3000000", status: "New" } })).id;
    partnerId = (await prisma.partner.create({ data: { name: tag } })).id;
    orderId = (await prisma.order.create({ data: { number: tag, clientId, address: "TEST", staircase: "Straight", material: "Oak", amount: "3000000", balance: "3000000", manager: manager.name, managerUserId: manager.id, status: "New" } })).id;
    await createFinanceOperation({ type: "CLIENT_PAYMENT", orderId, amount: 2_000_000, method: "bank_transfer", idempotencyKey: `${tag}-client`, requestHash: hash("client") });
    const agreedAt = new Date("2026-08-09T00:00:00.000Z");
    await assignPartnerToOrder({ orderId, partnerId, partnerPrice: 1_500_000, partnerAgreedAt: agreedAt, authorId: userId, manager: tag, reason: "Signed partner agreement" });
    for (const [index, amount] of [300_000, 200_000, 300_000].entries()) await createFinanceOperation({ type: "PARTNER_PAYOUT", orderId, amount, method: "bank_transfer", author: tag, authorId: userId, idempotencyKey: `${tag}-payout-${index}`, requestHash: hash(`payout-${index}`) });
    const replay = await createFinanceOperation({ type: "PARTNER_PAYOUT", orderId, amount: 300_000, method: "bank_transfer", author: tag, authorId: userId, idempotencyKey: `${tag}-payout-2`, requestHash: hash("payout-2") });
    ensure(replay?.created === false, "idempotent payout replay created a duplicate");
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { partner: true, payments: { include: { partner: true } }, partnerAssignmentHistory: { include: { author: { select: { name: true } } } } } });
    const settlement = buildOrderSettlement(order);
    ensure(settlement.client.total === 3_000_000 && settlement.client.received === 2_000_000 && settlement.client.remaining === 1_000_000, "client settlement is incorrect");
    ensure(settlement.partner.agreed === 1_500_000 && settlement.partner.paid === 800_000 && settlement.partner.remaining === 700_000, "partner settlement is incorrect");
    ensure(settlement.partner.payouts.length === 3, "partner payout history is not immutable/idempotent");
    ensure(await prisma.financeAuditEvent.count({ where: { orderId, action: "PARTNER_PAYOUT_CREATED" } }) === 3, "partner payout audit is incomplete");
    const changedAt = new Date("2026-08-10T00:00:00.000Z");
    await assignPartnerToOrder({ orderId, partnerId, partnerPrice: 1_600_000, partnerAgreedAt: changedAt, authorId: userId, manager: tag, reason: "Workshop changed agreed amount" });
    const changed = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    ensure(Number(changed.partnerPrice) === 1_600_000 && changed.partnerAgreedAt?.getTime() === changedAt.getTime(), "workshop agreement amount/date was not updated");
    const audit = await prisma.financeAuditEvent.findFirst({ where: { orderId, action: "PARTNER_AGREED_AMOUNT_CHANGED" }, orderBy: { createdAt: "desc" } });
    ensure(Boolean(audit?.before) && Boolean(audit?.after) && audit?.reason === "Workshop changed agreed amount", "workshop agreement immutable before/after/reason audit is incomplete");
    ensure(await prisma.partnerAssignmentHistory.count({ where: { orderId } }) === 2, "workshop agreement history is incomplete");
    console.log("PARTNER SETTLEMENT SUMMARY: client=3m/2m/1m; partner=1.5m/800k/700k; payouts=300k+200k+300k; idempotency=passed");
  } finally {
    if (orderId) {
      const cashShiftIds = (await prisma.payment.findMany({ where: { orderId, cashShiftId: { not: null } }, select: { cashShiftId: true } })).flatMap((item) => item.cashShiftId == null ? [] : [item.cashShiftId]);
      const receiptDocumentIds = (await prisma.paymentReceipt.findMany({ where: { orderId }, select: { documentId: true } })).map((item) => item.documentId);
      if (receiptDocumentIds.length) { await prisma.documentAudit.deleteMany({ where: { documentId: { in: receiptDocumentIds } } }); await prisma.documentVersion.deleteMany({ where: { documentId: { in: receiptDocumentIds } } }); await prisma.paymentReceipt.deleteMany({ where: { orderId } }); await prisma.document.deleteMany({ where: { id: { in: receiptDocumentIds } } }); }
      await prisma.companyLedgerEntry.deleteMany({ where: { orderId } }); await prisma.financeAuditEvent.deleteMany({ where: { orderId } }); await prisma.partnerAssignmentHistory.deleteMany({ where: { orderId } }); await prisma.orderEvent.deleteMany({ where: { orderId } }); await prisma.production.deleteMany({ where: { orderId } }); await prisma.payment.deleteMany({ where: { orderId } });
      if (cashShiftIds.length) await prisma.cashShift.deleteMany({ where: { id: { in: cashShiftIds }, payments: { none: {} }, receipts: { none: {} } } });
      await prisma.order.deleteMany({ where: { id: orderId } });
    }
    if (partnerId) await prisma.partner.deleteMany({ where: { id: partnerId } });
    if (clientId) await prisma.client.deleteMany({ where: { id: clientId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (managerId) await prisma.user.deleteMany({ where: { id: managerId } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
