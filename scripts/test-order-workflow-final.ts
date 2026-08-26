import "./require-test-database";

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MarketingContentTaskStatus, OrderLifecycle, PartnerSettlementOperationStatus, Role } from "@prisma/client";

import { createRequestHash } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { OrderDetailsError, updateOrderDetails } from "@/lib/services/order-details.service";
import { getMarketingContentAsset, getMarketingContentTasks, MarketingContentError, updateMarketingContentTask, uploadMarketingContentAsset } from "@/lib/services/marketing-content.service";
import { closeOrderFinancially, completeDeliveredOrder, OrderCompletionError } from "@/lib/services/order-completion.service";
import { createFinanceOperation } from "@/lib/services/payment.service";
import {
  PartnerManagementError,
  requestPartnerPayoutForOrder,
  reviewPartnerPayoutRequest,
  setOrderPartnerAgreement,
  withdrawPartnerPayoutRequest,
} from "@/lib/services/partner-management.service";
import { runWithSystemAccess, runWithTenant, type TenantIdentity } from "@/lib/tenant-context";

const tenant: TenantIdentity = {
  companyId: 1,
  companySlug: "altyn-sapa-company",
  companyName: "ALTYN SAPA TEST",
  isDemo: false,
};
const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function main() {
  await runWithSystemAccess(() => prisma.company.upsert({
    where: { id: tenant.companyId },
    update: { active: true },
    create: { id: tenant.companyId, slug: tenant.companySlug, name: tenant.companyName },
  }));
  await runWithTenant(tenant, async () => {
    const director = await prisma.user.create({ data: { name: `Workflow Director ${nonce}`, email: `workflow-director-${nonce}@test.local`, password: "not-a-login-hash", role: Role.DIRECTOR, active: true } });
    const manager = await prisma.user.create({ data: { name: `Workflow Manager ${nonce}`, email: `workflow-manager-${nonce}@test.local`, password: "not-a-login-hash", role: Role.MANAGER, active: true } });
    const otherManager = await prisma.user.create({ data: { name: `Workflow Other Manager ${nonce}`, email: `workflow-other-manager-${nonce}@test.local`, password: "not-a-login-hash", role: Role.MANAGER, active: true } });
    await prisma.user.create({ data: { name: `Workflow Marketer ${nonce}`, email: `workflow-marketer-${nonce}@test.local`, password: "not-a-login-hash", role: Role.MARKETER, active: true } });
    const partner = await prisma.partner.create({ data: { name: `Workflow Workshop ${nonce}`, active: true, archived: false, isTest: false } });
    const phone = `+7708${String(Date.now()).slice(-7)}`;
    const client = await prisma.client.create({ data: { name: `Workflow Client ${nonce}`, phone, whatsapp: phone, city: "Алматы", address: "Абая 1", manager: manager.name, managerUserId: manager.id, amount: "1000000", status: "Новая" } });
    const order = await prisma.order.create({ data: { number: `WORKFLOW-${nonce}`, clientId: client.id, address: "Абая 1", staircase: "Прямая", material: "Сосна", amount: "1000000", balance: "1000000", manager: manager.name, managerUserId: manager.id, status: "Оформлен" } });
    const managerActor = { userId: manager.id, role: Role.MANAGER, name: manager.name };
    const otherManagerActor = { userId: otherManager.id, role: Role.MANAGER, name: otherManager.name };
    const directorActor = { userId: director.id, role: Role.DIRECTOR, name: director.name };

    const detailsPayload = { orderId: order.id, amount: "1100000", phone };
    const details = await updateOrderDetails(order.id, {
      clientName: `${client.name} updated`, phone: `8${phone.slice(2)}`, whatsapp: phone,
      city: "Алматы", clientAddress: "Абая 2", orderAddress: "Абая 2", staircase: "П-образная", material: "Карагач",
      amount: "1100000", reason: "Согласовано с клиентом", idempotencyKey: `workflow-details-${nonce}`, requestHash: createRequestHash(detailsPayload),
    }, managerActor);
    assert.equal(details.amountChanged, true, "manager updates own canonical order and client atomically");
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: client.id } })).phone, phone, "phone normalized");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).amount.toFixed(2), "1100000.00", "sale amount updated");
    await createFinanceOperation({ type: "CLIENT_PAYMENT", orderId: order.id, amount: 200000, method: "bank_transfer", author: director.name, authorId: director.id, idempotencyKey: `workflow-client-payment-${nonce}`, requestHash: createRequestHash({ orderId: order.id, amount: 200000 }) });

    const linked = await setOrderPartnerAgreement({ orderId: order.id, partnerId: partner.id, amount: "600000", comment: "Согласовано с основным цехом" }, managerActor);
    assert.equal(linked.orderId, order.id, "manager transfers own order to workshop");
    assert.equal(await prisma.partnerOrderRelation.count({ where: { orderId: order.id } }), 1, "one canonical workshop relation");

    const competingRequests = await Promise.allSettled([0, 1].map((index) => {
      const payload = { orderId: order.id, amount: "550000", index };
      return requestPartnerPayoutForOrder({
        orderId: order.id,
        amount: "550000",
        operationDate: new Date(),
        method: "bank_transfer",
        comment: "Проверка конкурентного лимита",
        idempotencyKey: `workflow-payout-race-${nonce}-${index}`,
        requestHash: createRequestHash(payload),
      }, managerActor);
    }));
    const acceptedRace = competingRequests.filter((result) => result.status === "fulfilled");
    const rejectedRace = competingRequests.filter((result) => result.status === "rejected");
    assert.equal(acceptedRace.length, 1, "concurrent payout requests cannot overbook workshop balance");
    assert.equal(rejectedRace.length, 1, "one competing payout request is rejected");
    if (rejectedRace[0]?.status === "rejected")
      assert.ok(
        rejectedRace[0].reason instanceof PartnerManagementError &&
          rejectedRace[0].reason.message === "PAYOUT_EXCEEDS_PARTNER_BALANCE",
        "competing payout receives the canonical balance conflict",
      );
    if (acceptedRace[0]?.status === "fulfilled")
      await withdrawPartnerPayoutRequest(acceptedRace[0].value.operation.id, managerActor);

    const requestKey = `workflow-payout-request-${nonce}`;
    const requestPayload = { orderId: order.id, amount: "100000" };
    const requested = await requestPartnerPayoutForOrder({ orderId: order.id, amount: "100000", operationDate: new Date(), method: "bank_transfer", comment: "Оплачено менеджером", idempotencyKey: requestKey, requestHash: createRequestHash(requestPayload) }, managerActor);
    assert.equal(requested.operation.status, PartnerSettlementOperationStatus.PENDING, "manager payout remains pending");
    assert.equal(await prisma.payment.count({ where: { orderId: order.id, type: "PARTNER_PAYOUT" } }), 0, "pending request creates no canonical payout Payment");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).partnerPaid.toFixed(2), "0.00", "pending request does not change partnerPaid");

    const reviewPayload = { operationId: requested.operation.id, decision: "CONFIRM" };
    const confirmed = await reviewPartnerPayoutRequest({ operationId: requested.operation.id, decision: "CONFIRM", idempotencyKey: `workflow-payout-review-${nonce}`, requestHash: createRequestHash(reviewPayload) }, directorActor);
    assert.equal(confirmed.operation.status, PartnerSettlementOperationStatus.POSTED, "director confirms payout");
    assert.equal(await prisma.payment.count({ where: { orderId: order.id, type: "PARTNER_PAYOUT" } }), 1, "confirmation creates one canonical Payment");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).partnerPaid.toFixed(2), "100000.00", "confirmed payout updates partnerPaid");
    await reviewPartnerPayoutRequest({ operationId: requested.operation.id, decision: "CONFIRM", idempotencyKey: `workflow-payout-review-repeat-${nonce}`, requestHash: createRequestHash(reviewPayload) }, directorActor);
    assert.equal(await prisma.payment.count({ where: { orderId: order.id, type: "PARTNER_PAYOUT" } }), 1, "repeated confirmation does not duplicate canonical Payment");

    await assert.rejects(
      () => setOrderPartnerAgreement({ orderId: order.id, partnerId: partner.id, amount: "650000", comment: "После выплаты" }, managerActor),
      (error: unknown) => error instanceof PartnerManagementError && error.message === "DIRECTOR_CONFIRMATION_REQUIRED",
      "manager cannot directly change workshop cost after payout",
    );
    await assert.rejects(
      () => updateOrderDetails(order.id, { clientName: client.name, phone: "+77000000000", city: "Алматы", orderAddress: "Абая 2", staircase: "Прямая", material: "Сосна", amount: "50000", reason: "Too low", idempotencyKey: `workflow-low-${nonce}`, requestHash: createRequestHash({ low: true }) }, managerActor),
      (error: unknown) => error instanceof OrderDetailsError && error.message.startsWith("AMOUNT_BELOW_RECEIVED:"),
      "sale amount cannot go below received client payment",
    );

    const completionPayload = {
      orderId: order.id,
      completedAt: new Date(),
      comment: "Клиент принял объект",
      clientAccepted: true,
      contactConsent: "YES" as const,
      photoVideoConsent: "YES" as const,
    };
    const expectedMarketer = await prisma.user.findFirstOrThrow({
      where: { active: true, role: Role.MARKETER },
      orderBy: { id: "asc" },
    });
    const assignedMarketerActor = {
      userId: expectedMarketer.id,
      role: Role.MARKETER,
      name: expectedMarketer.name,
    };
    await assert.rejects(
      () => completeDeliveredOrder({
        ...completionPayload,
        idempotencyKey: `workflow-completion-forbidden-${nonce}`,
        requestHash: createRequestHash(completionPayload),
      }, otherManagerActor),
      (error: unknown) => error instanceof OrderCompletionError && error.message === "ORDER_NOT_FOUND",
      "manager cannot complete another manager's order",
    );
    const completed = await completeDeliveredOrder({
      ...completionPayload,
      idempotencyKey: `workflow-completion-${nonce}`,
      requestHash: createRequestHash(completionPayload),
    }, managerActor);
    assert.equal(completed.created, true, "manager completes own delivered order");
    assert.ok(completed.task, "completion creates or returns a marketing task");
    assert.equal(completed.task.assignedMarketerId, expectedMarketer.id, "completion assigns the first active marketer deterministically");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).lifecycle, OrderLifecycle.COMPLETED, "order lifecycle is completed");
    assert.equal(await prisma.marketingContentTask.count({ where: { orderId: order.id } }), 1, "one marketing task per order");
    await completeDeliveredOrder({
      ...completionPayload,
      idempotencyKey: `workflow-completion-${nonce}`,
      requestHash: createRequestHash(completionPayload),
    }, managerActor);
    assert.equal(await prisma.marketingContentTask.count({ where: { orderId: order.id } }), 1, "completion replay does not duplicate marketing task");

    const contentTasks = await getMarketingContentTasks(assignedMarketerActor);
    assert.equal(contentTasks.tasks.some((task) => task.orderId === order.id), true, "marketer receives the completed order task");
    await updateMarketingContentTask(completed.task.id, {
      status: MarketingContentTaskStatus.CONTACTED,
      reviewText: "Клиент доволен результатом",
    }, assignedMarketerActor);
    assert.equal((await prisma.marketingContentTask.findUniqueOrThrow({ where: { orderId: order.id } })).status, MarketingContentTaskStatus.CONTACTED, "marketer updates the canonical task");
    const blobDir = await mkdtemp(join(tmpdir(), "orda-marketing-content-"));
    process.env.TEST_BLOB_DIR = blobDir;
    try {
      const png = new File([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ], "object.png", { type: "image/png" });
      const uploaded = await uploadMarketingContentAsset({
        orderId: order.id,
        file: png,
        idempotencyKey: `workflow-content-asset-${nonce}`,
        actor: managerActor,
      });
      assert.equal(uploaded.created, true, "manager can attach a real object photo while completing own order");
      assert.ok(await getMarketingContentAsset(uploaded.asset.id, assignedMarketerActor), "assigned marketer can open the protected content asset");
      await assert.rejects(
        () => uploadMarketingContentAsset({
          orderId: order.id,
          file: png,
          idempotencyKey: `workflow-content-asset-forbidden-${nonce}`,
          actor: otherManagerActor,
        }),
        (error: unknown) => error instanceof MarketingContentError && error.message === "NOT_FOUND",
        "another manager cannot upload content to a foreign order",
      );
    } finally {
      delete process.env.TEST_BLOB_DIR;
      await rm(blobDir, { recursive: true, force: true });
    }
    await assert.rejects(
      () => getMarketingContentTasks(managerActor),
      (error: unknown) => error instanceof MarketingContentError && error.message === "FORBIDDEN",
      "manager cannot access marketing content tasks",
    );
    await assert.rejects(
      () => closeOrderFinancially({
        orderId: order.id,
        reason: "Попытка до расчётов",
        idempotencyKey: `workflow-close-blocked-${nonce}`,
        requestHash: createRequestHash({ orderId: order.id, action: "close-blocked" }),
      }, directorActor),
      (error: unknown) => error instanceof OrderCompletionError && error.message.startsWith("OBLIGATIONS_OPEN:"),
      "operational completion does not bypass open financial obligations",
    );

    const zeroOrder = await prisma.order.create({ data: {
      number: `WORKFLOW-ZERO-${nonce}`,
      clientId: client.id,
      address: "Абая 2",
      staircase: "Сервисный заказ",
      material: "Без материала",
      amount: 1,
      balance: 1,
      manager: manager.name,
      managerUserId: manager.id,
      status: "Оформлен",
    } });
    await setOrderPartnerAgreement({
      orderId: zeroOrder.id,
      partnerId: partner.id,
      amount: "1",
      comment: "Полностью оплаченный тестовый расчёт",
    }, directorActor);
    await createFinanceOperation({
      type: "CLIENT_PAYMENT",
      orderId: zeroOrder.id,
      amount: 1,
      method: "cash",
      author: director.name,
      authorId: director.id,
      idempotencyKey: `workflow-zero-client-payment-${nonce}`,
      requestHash: createRequestHash({ orderId: zeroOrder.id, kind: "client" }),
    });
    await createFinanceOperation({
      type: "PARTNER_PAYOUT",
      orderId: zeroOrder.id,
      partnerId: partner.id,
      amount: 1,
      method: "cash",
      author: director.name,
      authorId: director.id,
      idempotencyKey: `workflow-zero-partner-payment-${nonce}`,
      requestHash: createRequestHash({ orderId: zeroOrder.id, kind: "partner" }),
    });
    const zeroCompletionPayload = {
      orderId: zeroOrder.id,
      completedAt: new Date(),
      clientAccepted: true,
      contactConsent: "UNKNOWN" as const,
      photoVideoConsent: "UNKNOWN" as const,
    };
    const activeMarketers = await prisma.user.findMany({
      where: { active: true, role: Role.MARKETER },
      select: { id: true },
    });
    await prisma.user.updateMany({
      where: { id: { in: activeMarketers.map((item) => item.id) } },
      data: { active: false },
    });
    try {
      const unassigned = await completeDeliveredOrder({
        ...zeroCompletionPayload,
        idempotencyKey: `workflow-zero-completion-${nonce}`,
        requestHash: createRequestHash(zeroCompletionPayload),
      }, managerActor);
      assert.equal(unassigned.task?.assignedMarketerId, null, "task stays unassigned when no active marketer exists");
    } finally {
      await prisma.user.updateMany({
        where: { id: { in: activeMarketers.map((item) => item.id) } },
        data: { active: true },
      });
    }
    const closePayload = { orderId: zeroOrder.id, action: "financial-close" };
    const closed = await closeOrderFinancially({
      orderId: zeroOrder.id,
      reason: "Все обязательства закрыты",
      idempotencyKey: `workflow-zero-close-${nonce}`,
      requestHash: createRequestHash(closePayload),
    }, directorActor);
    assert.equal(closed.created, true, "director closes a financially settled completed order");
    assert.ok((await prisma.order.findUniqueOrThrow({ where: { id: zeroOrder.id } })).financialClosedAt, "financial close timestamp is stored separately");
  });
  console.log("Final order workflow integration passed on TEST_DATABASE_URL");
}

main().finally(() => prisma.$disconnect());
