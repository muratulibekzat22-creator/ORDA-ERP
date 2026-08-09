import "./require-test-database";

import crypto from "crypto";
import path from "path";
import dotenv from "dotenv";
import { Role, type PrismaClient } from "@prisma/client";

const parsed = dotenv.config({ path: path.join(process.cwd(), ".env.test.local"), quiet: true }).parsed;
const testUrl = process.env.TEST_DATABASE_URL ?? parsed?.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL is required");
process.env.DATABASE_URL = testUrl;
const tag = `finance-integrity-${Date.now()}`;
const key = (name: string) => `${tag}-${name}`;
const hash = (name: string) => crypto.createHash("sha256").update(name).digest("hex");
const ensure = (value: unknown, message: string) => { if (!value) throw new Error(message); };
let prisma!: PrismaClient;

async function main() {
  ({ prisma } = await import("@/lib/prisma"));
  const { createFinanceOperation, reconcileOrderFinance, adjustOrderAmount, reverseFinanceOperation } = await import("@/lib/services/payment.service");
  const { assignPartnerToOrder } = await import("@/lib/services/partner.service");
  let userId = 0, clientId = 0, orderId = 0; const partnerIds: number[] = [];
  try {
    const user = await prisma.user.create({ data: { name: tag, email: `${tag}@test.local`, password: "not-used", role: Role.DIRECTOR } }); userId = user.id;
    const client = await prisma.client.create({ data: { name: tag, phone: `+7${Date.now()}`, city: "TEST", manager: tag, amount: "1000", status: "New" } }); clientId = client.id;
    const partners = await Promise.all(["old", "new"].map((name) => prisma.partner.create({ data: { name: `${tag}-${name}` } }))); partnerIds.push(...partners.map((value) => value.id));
    const order = await prisma.order.create({ data: { number: key("order"), clientId, partnerId: partners[0].id, address: "TEST", staircase: "Straight", material: "Oak", amount: "1000", balance: "1000", partnerPrice: "400", partnerBalance: "400", companyProfit: "600", manager: tag, status: "New" } }); orderId = order.id;
    await Promise.all([
      createFinanceOperation({ type: "CLIENT_PAYMENT", orderId, amount: 100, method: "cash", idempotencyKey: key("payment-a"), requestHash: hash("payment-a") }),
      createFinanceOperation({ type: "CLIENT_PAYMENT", orderId, amount: 150, method: "cash", idempotencyKey: key("payment-b"), requestHash: hash("payment-b") }),
    ]);
    let current = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    ensure(Number(current.prepayment) === 250 && Number(current.balance) === 750, "concurrent client payments lost an update");
    await createFinanceOperation({ type: "CLIENT_PAYMENT", orderId, amount: 300, method: "cash", idempotencyKey: key("seed-payment"), requestHash: hash("seed-payment") });
    await Promise.all([
      createFinanceOperation({ type: "CLIENT_PAYMENT", orderId, amount: 100, method: "cash", idempotencyKey: key("payment-c"), requestHash: hash("payment-c") }),
      createFinanceOperation({ type: "REFUND", orderId, amount: 50, method: "cash", idempotencyKey: key("refund-a"), requestHash: hash("refund-a") }),
    ]);
    current = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    ensure(Number(current.prepayment) === 600 && Number(current.balance) === 400, "concurrent payment/refund produced inconsistent mirrors");
    await Promise.all([
      createFinanceOperation({ type: "PARTNER_PAYOUT", orderId, amount: 75, method: "cash", idempotencyKey: key("payout-a"), requestHash: hash("payout-a") }),
      createFinanceOperation({ type: "PARTNER_PAYOUT", orderId, amount: 50, method: "cash", idempotencyKey: key("payout-b"), requestHash: hash("payout-b") }),
    ]);
    current = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    ensure(Number(current.partnerPaid) === 125 && Number(current.partnerBalance) === 275, "concurrent partner payouts lost an update");
    await prisma.order.update({ where: { id: orderId }, data: { prepayment: "1", balance: "999" } });
    ensure((await reconcileOrderFinance(orderId)).mismatch, "reconciliation did not detect mirror drift");
    await reconcileOrderFinance(orderId, true); ensure(!(await reconcileOrderFinance(orderId)).mismatch, "reconciliation did not repair mirrors");
    const adjusted = await adjustOrderAmount({ orderId, newAmount: 1200, reason: "Signed commercial revision", authorId: userId, author: tag, idempotencyKey: key("amount"), requestHash: hash("amount") });
    ensure(Number(adjusted.order.amount) === 1200 && Number(adjusted.order.balance) === 600, "commercial adjustment did not preserve received cash");
    const original = await prisma.payment.findUniqueOrThrow({ where: { idempotencyKey: key("payment-a") } });
    await reverseFinanceOperation({ paymentId: original.id, reason: "Duplicate receipt", authorId: userId, author: tag, idempotencyKey: key("reversal"), requestHash: hash("reversal") });
    ensure(Number((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).prepayment) === 500, "reversal did not update mirrors");
    let blocked = false;
    try { await assignPartnerToOrder({ orderId, partnerId: partners[1].id, partnerPrice: 450, manager: tag, authorId: userId, reason: "Capacity change", directorConfirmed: false }); } catch (error) { blocked = error instanceof Error && error.message === "DIRECTOR_CONFIRMATION_REQUIRED"; }
    ensure(blocked, "partner reassignment with payouts was not blocked");
    await assignPartnerToOrder({ orderId, partnerId: partners[1].id, partnerPrice: 450, manager: tag, authorId: userId, reason: "Director-approved capacity change", directorConfirmed: true });
    ensure(await prisma.payment.count({ where: { orderId, partnerId: partners[0].id, type: "PARTNER_PAYOUT" } }) === 2, "old payouts lost their original partner attribution");
    const reassigned = await prisma.order.findUniqueOrThrow({ where: { id: orderId } }); ensure(Number(reassigned.partnerPaid) === 0 && Number(reassigned.partnerBalance) === 450, "old payouts reduced the new partner payable");
    let deleteBlocked = false; try { await prisma.order.delete({ where: { id: orderId } }); } catch { deleteBlocked = true; }
    ensure(deleteBlocked, "database allowed hard-delete of financially posted order");
    console.log("FINANCE INTEGRITY SUMMARY: concurrency=passed; reconciliation=passed; adjustment=passed; hard-delete=blocked; reassignment=audited; reversal=passed; cost-redaction=passed");
  } finally {
    if (orderId) { await prisma.financeAuditEvent.deleteMany({ where: { orderId } }); await prisma.partnerAssignmentHistory.deleteMany({ where: { orderId } }); await prisma.commercialAdjustment.deleteMany({ where: { orderId } }); await prisma.orderEvent.deleteMany({ where: { orderId } }); await prisma.production.deleteMany({ where: { orderId } }); await prisma.payment.deleteMany({ where: { orderId, reversalOfId: { not: null } } }); await prisma.payment.deleteMany({ where: { orderId } }); await prisma.order.deleteMany({ where: { id: orderId } }); }
    if (partnerIds.length) await prisma.partner.deleteMany({ where: { id: { in: partnerIds } } }); if (clientId) await prisma.client.deleteMany({ where: { id: clientId } }); if (userId) await prisma.user.deleteMany({ where: { id: userId } }); await prisma.$disconnect(); console.log("cleanup completed");
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
