import assert from "node:assert/strict";

import {
  CalendarTaskType,
  DocumentSource,
  DocumentStatus,
  DocumentType,
  MeasurementStatus,
  Role,
} from "@prisma/client";

import { prisma } from "../lib/prisma";
import {
  runWithSystemAccess,
  runWithTenant,
  type TenantIdentity,
} from "../lib/tenant-context";
import { assertSafeTestDatabaseUrl } from "./test-database-safety";

assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
assert.equal(process.env.DATABASE_URL, process.env.TEST_DATABASE_URL);

const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const live: TenantIdentity = {
  companyId: 1,
  companySlug: "altyn-sapa-company",
  companyName: "ТОО ALTYN SAPA COMPANY",
  isDemo: false,
};
const demo: TenantIdentity = {
  companyId: 2,
  companySlug: "orda-demo",
  companyName: "ORDA DEMO",
  isDemo: true,
};

type Fixture = {
  userId: number;
  clientId: number;
  partnerId: number;
  orderId: number;
  taskId: number;
  measurementId: number;
  calculationId: number;
  proposalId: number;
  documentId: number;
  paymentId: number;
  profileId: number;
  periodId: number;
  ledgerId: number;
  materialId: number;
  productionId: number;
};

async function createFixture(tenant: TenantIdentity, label: string): Promise<Fixture> {
  return runWithTenant(tenant, async () => {
    const user = await prisma.user.create({ data: {
      name: `${label} manager ${nonce}`,
      email: `${label}.${nonce}@tenant.test`,
      password: "not-a-login-password-hash",
      role: Role.MANAGER,
    } });
    const client = await prisma.client.create({ data: {
      name: `${label} client ${nonce}`,
      phone: `+7000${user.id}`,
      city: "Алматы",
      manager: user.name,
      managerUserId: user.id,
      amount: "1000000",
      status: "Новая",
    } });
    const partner = await prisma.partner.create({ data: { name: `${label} partner ${nonce}` } });
    const order = await prisma.order.create({ data: {
      number: `${label.toUpperCase()}-ORDER-${nonce}`,
      clientId: client.id,
      partnerId: partner.id,
      address: "Тестовый адрес",
      staircase: "Каркас",
      material: "Сосна",
      amount: 1_000_000,
      manager: user.name,
      managerUserId: user.id,
    } });
    const task = await prisma.calendarTask.create({ data: {
      title: `${label} measurement`,
      type: CalendarTaskType.MEASUREMENT,
      dueAt: new Date(Date.now() + 86_400_000),
      assigneeId: user.id,
      creatorId: user.id,
      clientId: client.id,
      orderId: order.id,
    } });
    const measurement = await prisma.measurement.create({ data: {
      orderId: order.id,
      clientId: client.id,
      calendarTaskId: task.id,
      measurer: user.name,
      measurerUserId: user.id,
      visitDate: task.dueAt,
      status: MeasurementStatus.ASSIGNED,
      city: "Алматы",
      address: "Тестовый адрес",
    } });
    const calculation = await prisma.leadCalculation.create({ data: {
      clientId: client.id,
      material: "Сосна",
      baseClientPrice: 1_000_000,
      clientPrice: 1_000_000,
      internalCost: 500_000,
      snapshot: { tenant: label },
      authorId: user.id,
      authorName: user.name,
    } });
    const proposal = await prisma.commercialProposal.create({ data: {
      clientId: client.id,
      calculationId: calculation.id,
      number: `${label.toUpperCase()}-KP-${nonce}`,
      snapshot: { tenant: label },
      validUntil: new Date(Date.now() + 259_200_000),
      executionTerm: "40–50 календарных дней",
      paymentTerms: "70/30",
      warranty: "1 год",
      managerContact: user.name,
      createdById: user.id,
      createdByName: user.name,
    } });
    const document = await prisma.document.create({ data: {
      orderId: order.id,
      clientId: client.id,
      type: DocumentType.OTHER,
      number: `${label.toUpperCase()}-DOC-${nonce}`,
      title: `${label} tenant document`,
      documentDate: new Date(),
      status: DocumentStatus.READY,
      source: DocumentSource.GENERATED_ORDER,
      authorId: user.id,
    } });
    const payment = await prisma.payment.create({ data: {
      orderId: order.id,
      amount: 1000,
      type: "CLIENT_PAYMENT",
      method: "BANK_TRANSFER",
      registeredByUserId: user.id,
    } });
    const profile = await prisma.employeePayrollProfile.create({ data: {
      userId: user.id,
      name: user.name,
      position: "Менеджер",
      hiredAt: new Date(),
    } });
    const period = await prisma.payrollPeriod.create({ data: { year: 2099, month: label === "live" ? 1 : 2 } });
    const ledger = await prisma.companyLedgerEntry.create({ data: {
      type: "MANUAL",
      category: "TENANT_TEST",
      direction: "INCOME",
      amount: 1000,
      authorId: user.id,
      orderId: order.id,
    } });
    const material = await prisma.material.create({ data: {
      name: `${label} material ${nonce}`,
      category: "Тест",
      unit: "шт",
      lookupKey: `${label}-material-${nonce}`,
    } });
    const production = await prisma.production.create({ data: {
      orderId: order.id,
      stage: "NEW",
      master: user.name,
      masterUserId: user.id,
    } });
    return {
      userId: user.id, clientId: client.id, partnerId: partner.id,
      orderId: order.id, taskId: task.id, measurementId: measurement.id,
      calculationId: calculation.id, proposalId: proposal.id,
      documentId: document.id, paymentId: payment.id, profileId: profile.id,
      periodId: period.id, ledgerId: ledger.id, materialId: material.id,
      productionId: production.id,
    };
  });
}

async function cleanup(fixture: Fixture) {
  await runWithSystemAccess(async () => {
    await prisma.production.deleteMany({ where: { id: fixture.productionId } });
    await prisma.companyLedgerEntry.deleteMany({ where: { id: fixture.ledgerId } });
    await prisma.payrollPeriod.deleteMany({ where: { id: fixture.periodId } });
    await prisma.employeePayrollProfile.deleteMany({ where: { id: fixture.profileId } });
    await prisma.payment.deleteMany({ where: { id: fixture.paymentId } });
    await prisma.document.deleteMany({ where: { id: fixture.documentId } });
    await prisma.commercialProposal.deleteMany({ where: { id: fixture.proposalId } });
    await prisma.leadCalculation.deleteMany({ where: { id: fixture.calculationId } });
    await prisma.measurement.deleteMany({ where: { id: fixture.measurementId } });
    await prisma.calendarTask.deleteMany({ where: { id: fixture.taskId } });
    await prisma.order.deleteMany({ where: { id: fixture.orderId } });
    await prisma.partner.deleteMany({ where: { id: fixture.partnerId } });
    await prisma.material.deleteMany({ where: { id: fixture.materialId } });
    await prisma.client.deleteMany({ where: { id: fixture.clientId } });
    await prisma.user.deleteMany({ where: { id: fixture.userId } });
  });
}

async function main() {
  let liveFixture: Fixture | undefined;
  let demoFixture: Fixture | undefined;
  try {
  await runWithSystemAccess(async () => {
    const companies = await prisma.company.findMany({ orderBy: { id: "asc" } });
    assert.equal(companies.find((row) => row.id === 1)?.isDemo, false);
    assert.equal(companies.find((row) => row.id === 2)?.isDemo, true);
  });

  liveFixture = await createFixture(live, "live");
  demoFixture = await createFixture(demo, "demo");

  await runWithTenant(live, async () => {
    assert.ok(await prisma.client.findUnique({ where: { id: liveFixture!.clientId } }));
    assert.equal(await prisma.client.findUnique({ where: { id: demoFixture!.clientId } }), null);
    assert.equal(await prisma.order.findUnique({ where: { id: demoFixture!.orderId } }), null);
    assert.equal(await prisma.measurement.findUnique({ where: { id: demoFixture!.measurementId } }), null);
    assert.equal(await prisma.calendarTask.findUnique({ where: { id: demoFixture!.taskId } }), null);
    assert.equal(await prisma.commercialProposal.findUnique({ where: { id: demoFixture!.proposalId } }), null);
    assert.equal(await prisma.document.findUnique({ where: { id: demoFixture!.documentId } }), null);
    assert.equal(await prisma.payment.findUnique({ where: { id: demoFixture!.paymentId } }), null);
    assert.equal(await prisma.employeePayrollProfile.findUnique({ where: { id: demoFixture!.profileId } }), null);
    assert.equal(await prisma.companyLedgerEntry.findUnique({ where: { id: demoFixture!.ledgerId } }), null);
    assert.equal(await prisma.material.findUnique({ where: { id: demoFixture!.materialId } }), null);
    await assert.rejects(
      prisma.client.create({ data: { companyId: demo.companyId, name: "violation", phone: "+70000000000", city: "", manager: "", amount: "0", status: "" } }),
      /TENANT_SCOPE_VIOLATION/,
    );
  });

  await runWithTenant(demo, async () => {
    assert.ok(await prisma.client.findUnique({ where: { id: demoFixture!.clientId } }));
    assert.equal(await prisma.client.findUnique({ where: { id: liveFixture!.clientId } }), null);
  });

  const mutableEnv = process.env as Record<string, string | undefined>;
  const nodeEnv = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "production";
  await assert.rejects(prisma.client.count(), /TENANT_CONTEXT_REQUIRED/);
  mutableEnv.NODE_ENV = nodeEnv;

    console.log("Tenant isolation integration passed");
  } finally {
    if (demoFixture) await cleanup(demoFixture);
    if (liveFixture) await cleanup(liveFixture);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "TENANT_ISOLATION_TEST_FAILED");
  process.exitCode = 1;
});
