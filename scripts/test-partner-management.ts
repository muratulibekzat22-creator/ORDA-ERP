import "./require-test-database";

import assert from "node:assert/strict";

import { PartnerBusinessType, PartnerRewardRule, PartnerSettlementOperationType, Role } from "@prisma/client";

import { createRequestHash } from "@/lib/idempotency";
import { partnerStatementCsv, partnerStatementPdf } from "@/lib/partners/statement";
import { prisma } from "@/lib/prisma";
import {
  createManagedPartner, createPartnerOrder, createPartnerSettlementOperation, getManagedPartner,
  getPartnerManagementReadModel, linkHistoricalPartnerPayment, linkPartnerOrder, PartnerManagementError, reversePartnerSettlementOperation,
  searchPartnerClients, searchPartnerOrders, setPartnerAgreedCost, type PartnerManagementActor,
} from "@/lib/services/partner-management.service";
import { getPartners as getWorkshopPartners } from "@/lib/services/partner.service";
import { saveOrderCostPlan } from "@/lib/services/profitability.service";
import { runWithSystemAccess, runWithTenant, type TenantIdentity } from "@/lib/tenant-context";
import { seedPartnerManagementDemo } from "./seed-partner-management-demo";

const live: TenantIdentity = { companyId: 1, companySlug: "altyn-sapa-company", companyName: "ALTYN SAPA TEST", isDemo: false };
const demo: TenantIdentity = { companyId: 2, companySlug: "orda-demo", companyName: "ORDA DEMO", isDemo: true };
const liveReleaseCloneTest = process.env.LIVE_RELEASE_CLONE_TEST === "true";
const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const phone = `+7709${String(Date.now()).slice(-7)}`;

async function ensureCompanies() {
  await runWithSystemAccess(async () => {
    await prisma.company.upsert({ where: { id: 1 }, update: { active: true }, create: { id: 1, slug: live.companySlug, name: live.companyName, isDemo: false } });
    await prisma.company.upsert({ where: { id: 2 }, update: { active: true, isDemo: true }, create: { id: 2, slug: demo.companySlug, name: demo.companyName, isDemo: true } });
  });
}

async function ensureDemoDirector() {
  return runWithTenant(demo, async () => {
    const director = (await prisma.user.findFirst({ where: { role: Role.DIRECTOR, active: true } })) ?? await prisma.user.create({ data: { name: `Demo Director ${nonce}`, email: `demo-director-${nonce}@test.local`, password: "not-a-login-hash", role: Role.DIRECTOR, active: true } });
    const manager = (await prisma.user.findFirst({ where: { role: Role.MANAGER, active: true } })) ?? await prisma.user.create({ data: { name: `Demo Manager ${nonce}`, email: `demo-manager-${nonce}@test.local`, password: "not-a-login-hash", role: Role.MANAGER, active: true } });
    return { director, manager };
  });
}

async function main() {
  await ensureCompanies();
  if (!liveReleaseCloneTest) await ensureDemoDirector();
  await runWithTenant(live, async () => {
    const directorUser = await prisma.user.create({ data: { name: `Partner Director ${nonce}`, email: `partner-director-${nonce}@test.local`, password: "not-a-login-hash", role: Role.DIRECTOR, active: true } });
    const managerUser = await prisma.user.create({ data: { name: `Partner Manager ${nonce}`, email: `partner-manager-${nonce}@test.local`, password: "not-a-login-hash", role: Role.MANAGER, active: true } });
    const actor: PartnerManagementActor = { userId: directorUser.id, name: directorUser.name, role: Role.DIRECTOR };
    const forbiddenActor: PartnerManagementActor = { ...actor, role: Role.MANAGER };
    await assert.rejects(() => createManagedPartner({ name: "Forbidden", kind: PartnerBusinessType.OTHER, defaultRewardRule: PartnerRewardRule.FIXED, defaultRewardFixedAmount: "1" }, forbiddenActor), (error: unknown) => error instanceof PartnerManagementError && error.message === "FORBIDDEN");

    const partner = await createManagedPartner({ name: `Integration Partner ${nonce}`, kind: PartnerBusinessType.SALES_AGENT, phone, city: "Алматы", defaultRewardRule: PartnerRewardRule.FIXED, defaultRewardFixedAmount: "100000", comment: nonce }, actor);
    await prisma.companySettings.upsert({
      where: { companyId: live.companyId },
      create: { defaultWorkshopPartnerId: partner.id },
      update: { defaultWorkshopPartnerId: partner.id },
    });
    assert.equal((await getWorkshopPartners({ includeArchived: true })).some((item) => item.id === partner.id), false, "director partner directory is not exposed through workshop API service");
    const client = await prisma.client.create({ data: { name: `Existing Client ${nonce}`, phone: `+7708${String(Date.now() + 1).slice(-7)}`, city: "Алматы", address: "Абая 1", manager: managerUser.name, managerUserId: managerUser.id, amount: "1000000", status: "Новая" } });
    const existingOrder = await prisma.order.create({ data: { number: `PARTNER-EXISTING-${nonce}`, clientId: client.id, address: "Абая 1", staircase: "Прямая", material: "Дуб", amount: "1000000", balance: "1000000", companyProfit: "900000", manager: managerUser.name, managerUserId: managerUser.id, status: "Новый" } });
    assert.equal(existingOrder.partnerId, null, "default workshop is preselected in UI but never assigned without confirmation");
    const relationsBeforeRead = await prisma.partnerOrderRelation.count({ where: { orderId: existingOrder.id } });
    const unlinkedRead = await getPartnerManagementReadModel({ scope: "active", pageSize: 100 });
    assert.ok(unlinkedRead.orders.some((item) => item.order.id === existingOrder.id && item.relationId === null), "canonical order without partner relation is visible");
    assert.equal(await prisma.partnerOrderRelation.count({ where: { orderId: existingOrder.id } }), relationsBeforeRead, "read model never creates an empty partner relation");
    const linked = await linkPartnerOrder({ partnerId: partner.id, orderId: existingOrder.id }, actor);
    assert.equal(linked.created, true, "existing order linked");
    const replay = await linkPartnerOrder({ partnerId: partner.id, orderId: existingOrder.id }, actor);
    assert.equal(replay.created, false, "re-link returns existing relation");
    assert.equal(await prisma.partnerOrderRelation.count({ where: { orderId: existingOrder.id } }), 1, "one primary partner relation per order");
    assert.equal((await searchPartnerOrders(existingOrder.number))[0]?.id, existingOrder.id, "order search by number");
    console.log("Partner integration stage: canonical order visibility PASS");

    const orderKey = `partner-integration-order-${nonce}`;
    const created = await createPartnerOrder({
      partnerId: partner.id, managerUserId: managerUser.id, client: { name: `New Client ${nonce}`, phone, city: "Алматы", address: "Достык 2" },
      staircase: "П-образная", material: "Ясень", description: "Integration", address: "Достык 2", amount: "1200000.10", status: "В работе",
      reward: { rewardRule: PartnerRewardRule.ORDER_PERCENT, rewardPercent: "10" }, comment: nonce,
      idempotencyKey: orderKey, requestHash: createRequestHash({ orderKey }),
    }, actor);
    assert.equal(created.created, true, "ordinary order created through canonical service");
    assert.equal(created.order.status, "В работе", "requested ordinary order status stored");
    assert.equal(await prisma.leadConversion.count({ where: { orderId: created.order.id } }), 0, "lead/proposal conversion is optional");
    assert.equal((await searchPartnerClients(phone.slice(-7)))[0]?.id, created.order.clientId, "client phone suffix search");
    assert.ok(await prisma.order.findFirst({ where: { id: created.order.id, deletedAt: null } }), "partner order is visible in canonical Order model");
    console.log("Partner integration stage: canonical order creation PASS");

    const operation = async (relationId: number, type: PartnerSettlementOperationType, amount: string, suffix: string) => {
      const key = `partner-integration-${nonce}-${suffix}`;
      return createPartnerSettlementOperation({ relationId, type, amount, operationDate: new Date(), method: "bank", account: "TEST BANK", comment: nonce, idempotencyKey: key, requestHash: createRequestHash({ key, type, amount }) }, actor);
    };
    const companyReceipt = await operation(linked.relation.id, PartnerSettlementOperationType.CLIENT_TO_COMPANY, "400000", "company-receipt");
    assert.equal(companyReceipt.created, true);
    const partnerReceipt = await operation(linked.relation.id, PartnerSettlementOperationType.CLIENT_TO_PARTNER, "300000", "partner-receipt");
    const paymentCountBeforeTransfer = await prisma.payment.count({ where: { orderId: existingOrder.id } });
    const ledgerCountBeforeTransfer = await prisma.companyLedgerEntry.count({ where: { orderId: existingOrder.id } });
    await operation(linked.relation.id, PartnerSettlementOperationType.PARTNER_TO_COMPANY, "100000", "partner-transfer");
    assert.equal(await prisma.payment.count({ where: { orderId: existingOrder.id } }), paymentCountBeforeTransfer, "partner transfer does not duplicate client income Payment");
    assert.equal(await prisma.companyLedgerEntry.count({ where: { orderId: existingOrder.id } }), ledgerCountBeforeTransfer, "partner transfer does not duplicate income ledger");
    const adjustment = await createPartnerSettlementOperation({ relationId: linked.relation.id, type: PartnerSettlementOperationType.ADJUSTMENT, amount: "1", adjustmentEffect: "25000", operationDate: new Date(), comment: nonce, idempotencyKey: `partner-integration-${nonce}-adjustment`, requestHash: createRequestHash({ nonce, adjustment: true }) }, actor);
    assert.equal(adjustment.operation.adjustmentEffect.toFixed(2), "25000.00", "adjustment stored Decimal-safe");
    const reversed = await reversePartnerSettlementOperation({ operationId: partnerReceipt.operation.id, reason: "Integration reversal", idempotencyKey: `partner-integration-${nonce}-reverse`, requestHash: createRequestHash({ nonce, reverse: partnerReceipt.operation.id }) }, actor);
    assert.equal(reversed.created, true, "custom operation reversal created");

    const payout = await operation(created.relation.id, PartnerSettlementOperationType.COMPANY_TO_PARTNER, "50000", "payout");
    assert.ok(payout.operation.paymentId, "company payout creates canonical Payment");
    assert.equal(await prisma.payment.count({ where: { id: payout.operation.paymentId! } }), 1, "one canonical payout Payment");
    const payoutReplay = await createPartnerSettlementOperation({ relationId: created.relation.id, type: PartnerSettlementOperationType.COMPANY_TO_PARTNER, amount: "50000", operationDate: payout.operation.operationDate, method: "bank", account: "TEST BANK", comment: nonce, idempotencyKey: `partner-integration-${nonce}-payout`, requestHash: createRequestHash({ key: `partner-integration-${nonce}-payout`, type: PartnerSettlementOperationType.COMPANY_TO_PARTNER, amount: "50000" }) }, actor);
    assert.equal(payoutReplay.created, false, "operation idempotency replay");
    console.log("Partner integration stage: atomic payout and reversal PASS");

    const model = await getPartnerManagementReadModel({ partnerId: partner.id });
    assert.equal(model.partners.length, 1, "partner search/filter");
    assert.ok(model.orders.some((item) => item.id === created.relation.id), "partner order in read model");
    const createdRow = model.orders.find((item) => item.id === created.relation.id)!;
    assert.equal(createdRow.order.companyProfit.toFixed(2), "1080000.09", "canonical order mirror stores sale minus agreed partner cost");
    assert.equal(model.partners[0].totals.profit.toFixed(2), "1080000.09", "incomplete orders are excluded from partner profit and payments are not deducted twice");
    assert.ok(model.audits.some((item) => item.action === "SETTLEMENT_OPERATION_REVERSED"), "audit log contains reversal");
    assert.equal((await getPartnerManagementReadModel({ query: `Integration Partner ${nonce}` })).partners[0]?.id, partner.id, "partner search by name");
    console.log("Partner integration stage: read model and analytics PASS");
    const detail = await getManagedPartner(partner.id);
    assert.ok(partnerStatementCsv(detail).includes(existingOrder.number), "statement CSV contains order");
    const pdf = await partnerStatementPdf(detail);
    assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-", "statement is a real PDF");
    console.log("Partner integration stage: statement PASS");

    const paidOrderKey = `partner-integration-paid-order-${nonce}`;
    const paidPhone = `+7707${String(Date.now() + 2).slice(-7)}`;
    const paidOrder = await createPartnerOrder({
      partnerId: partner.id, managerUserId: managerUser.id,
      client: { name: `Paid Client ${nonce}`, phone: paidPhone, secondaryPhone: `+7706${String(Date.now() + 3).slice(-7)}`, city: "Алматы", address: "Сейфуллина 3", comment: "Partner client comment" },
      staircase: "Прямая", material: "Дуб", address: "Сейфуллина 3", amount: "500000",
      reward: { rewardRule: PartnerRewardRule.FIXED, fixedAmount: "50000" },
      initialPayment: { confirmed: true, amount: "100000", date: new Date(), receivedBy: directorUser.name, account: "TEST BANK", method: "bank", comment: "Confirmed initial payment" },
      idempotencyKey: paidOrderKey, requestHash: createRequestHash({ paidOrderKey }),
    }, actor);
    assert.equal((await prisma.payment.findMany({ where: { orderId: paidOrder.order.id, type: "CLIENT_PAYMENT" } })).length, 1, "confirmed initial payment creates exactly one canonical Payment");
    const paidClient = await prisma.client.findUniqueOrThrow({ where: { id: paidOrder.order.clientId } });
    assert.notEqual(paidClient.whatsapp, paidClient.phone, "secondary phone is preserved in canonical Client whatsapp field");
    assert.equal(paidClient.comment, "Partner client comment", "new client comment is preserved");
    console.log("Partner integration stage: confirmed client payment PASS");

    const paymentsBeforeAgreedCost = await prisma.payment.count({ where: { orderId: existingOrder.id } });
    const ledgerBeforeAgreedCost = await prisma.companyLedgerEntry.count({ where: { orderId: existingOrder.id } });
    const agreed = await setPartnerAgreedCost(linked.relation.id, "370000", "Integration agreed cost", actor);
    assert.equal(agreed.economy.partner.agreed.toFixed(2), "370000.00", "agreed partner cost is visible in order economy");
    assert.equal(agreed.economy.partner.paid.toFixed(2), "0.00", "agreed cost is not treated as payout");
    assert.equal(agreed.economy.partner.remaining.toFixed(2), "395000.00", "confirmed partner adjustment remains part of accrued payable");
    assert.equal(await prisma.payment.count({ where: { orderId: existingOrder.id } }), paymentsBeforeAgreedCost, "agreed cost created a Payment");
    assert.equal(await prisma.companyLedgerEntry.count({ where: { orderId: existingOrder.id } }), ledgerBeforeAgreedCost, "agreed cost created a Finance ledger entry");
    console.log("Partner integration stage: agreed cost PASS");
    const paymentsBeforePlan = await prisma.payment.count({ where: { orderId: existingOrder.id } });
    const ledgerBeforePlan = await prisma.companyLedgerEntry.count({ where: { orderId: existingOrder.id } });
    const plan = await saveOrderCostPlan(existingOrder.id, {
      materialOutsideWorkshop: "50000",
      delivery: "20000",
      bankFees: "10000",
      otherDirect: "20000",
      confirmed: true,
    }, { userId: actor.userId, name: actor.name });
    assert.equal(plan.materialOutsideWorkshop.toFixed(2), "50000.00", "planned direct costs saved Decimal-safe");
    assert.ok(plan.confirmedAt, "direct costs confirmation stored");
    assert.equal(await prisma.payment.count({ where: { orderId: existingOrder.id } }), paymentsBeforePlan, "planned costs do not create Payment");
    assert.equal(await prisma.companyLedgerEntry.count({ where: { orderId: existingOrder.id } }), ledgerBeforePlan, "planned costs do not create Finance cash expense");
    assert.equal(await prisma.orderCostPlanRevision.count({ where: { orderId: existingOrder.id } }), 1, "cost plan audit revision created");
    console.log("Partner integration stage: order cost plan PASS");

    const historicalPayment = await prisma.payment.create({ data: {
      orderId: existingOrder.id, partnerId: partner.id, amount: "10000", type: "PARTNER_PAYOUT", method: "bank",
      operationDate: new Date(), comment: "Historical fixture", idempotencyKey: `historical-payment-${nonce}`,
      requestHash: createRequestHash({ nonce, historical: true }),
    } });
    const paymentsBeforeHistoricalLink = await prisma.payment.count({ where: { orderId: existingOrder.id } });
    const linkedHistorical = await linkHistoricalPartnerPayment({
      paymentId: historicalPayment.id, orderId: existingOrder.id, partnerId: partner.id,
      comment: "Confirmed historical allocation", idempotencyKey: `historical-link-${nonce}`,
      requestHash: createRequestHash({ nonce, historicalLink: true }),
    }, actor);
    assert.equal(linkedHistorical.created, true, "historical payout linked explicitly");
    assert.equal(await prisma.payment.count({ where: { orderId: existingOrder.id } }), paymentsBeforeHistoricalLink, "historical allocation does not create a second Payment");
    assert.equal((await linkHistoricalPartnerPayment({
      paymentId: historicalPayment.id, orderId: existingOrder.id, partnerId: partner.id,
      comment: "Confirmed historical allocation", idempotencyKey: `historical-link-${nonce}`,
      requestHash: createRequestHash({ nonce, historicalLink: true }),
    }, actor)).created, false, "historical allocation is idempotent");
    assert.ok((await prisma.partnerAuditEvent.findMany({ where: { relationId: linked.relation.id } })).some((event) => event.action === "HISTORICAL_PARTNER_PAYMENT_LINKED"), "historical allocation creates audit log");
    console.log("Partner integration stage: historical payout link PASS");

    await runWithTenant(demo, async () => {
      await assert.rejects(() => getManagedPartner(partner.id), (error: unknown) => error instanceof PartnerManagementError && error.message === "PARTNER_NOT_FOUND");
      assert.equal((await searchPartnerOrders(existingOrder.number)).length, 0, "cross-tenant order search blocked");
      assert.equal((await searchPartnerClients(phone)).length, 0, "cross-tenant client search blocked");
    });
    console.log("Partner integration stage: tenant isolation PASS");
  });

  if (liveReleaseCloneTest) {
    console.log("Partner management integration PASS; Demo seed skipped for LIVE release clone");
  } else {
    const demoFirst = await seedPartnerManagementDemo();
    const demoSecond = await seedPartnerManagementDemo();
    assert.deepEqual(demoSecond, demoFirst, "Demo seed is idempotent");
    assert.equal(demoSecond.partners, 8, "Demo seed has eight partners");
    assert.equal(demoSecond.orders, 16, "Demo seed has sixteen partner orders");
    assert.equal(demoSecond.existingLinked, 4, "Demo seed links four pre-existing canonical orders");
    console.log(`Partner management integration PASS; demo partners=${demoSecond.partners}; demo orders=${demoSecond.orders}; existing-linked=${demoSecond.existingLinked}; operations=${demoSecond.operations}`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
