import "./require-test-database";

import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import {
  AdvanceRequestStatus,
  CompanyMode,
  PayrollAccrualType,
  PayrollBonusRule,
  PayrollPaymentType,
  Permission,
  Role,
} from "@prisma/client";

import { createRequestHash } from "@/lib/idempotency";
import { defaultPermissions } from "@/lib/permissions";
import { partnerStatementCsv, partnerStatementPdf } from "@/lib/partners/statement";
import { prisma } from "@/lib/prisma";
import { getManagedPartner } from "@/lib/services/partner-management.service";
import {
  createAccrual,
  ensurePeriod,
  payrollSummary,
  requestAdvance,
  requestPaymentConfirmation,
  reviewAdvance,
  reviewPaymentConfirmation,
  upsertPayrollProfile,
  type PayrollActor,
} from "@/lib/services/payroll.service";
import { runWithSystemAccess, runWithTenant, type TenantIdentity } from "@/lib/tenant-context";
import { seedPartnerManagementDemo } from "./seed-partner-management-demo";

const DEMO_COMPANY_ID = 2;
const seedVersion = "payroll-partners-preview-v1";
const periodYear = 2026;
const periodMonth = 8;
const directorEmail = "preview.director@orda.demo";
const managerEmail = "preview.manager@orda.demo";

async function liveTenantSnapshot() {
  return runWithSystemAccess(async () => ({
    company: await prisma.company.findUnique({
      where: { id: 1 },
      select: { id: true, slug: true, name: true, mode: true, isDemo: true, active: true, updatedAt: true },
    }),
    users: await prisma.user.count({ where: { companyId: 1 } }),
    clients: await prisma.client.count({ where: { companyId: 1 } }),
    orders: await prisma.order.count({ where: { companyId: 1 } }),
    partners: await prisma.partner.count({ where: { companyId: 1 } }),
    payrollProfiles: await prisma.employeePayrollProfile.count({ where: { companyId: 1 } }),
    payrollPeriods: await prisma.payrollPeriod.count({ where: { companyId: 1 } }),
    ledgerEntries: await prisma.companyLedgerEntry.count({ where: { companyId: 1 } }),
  }));
}

async function setupDemoTenant(password: string) {
  const company = await runWithSystemAccess(async () => {
    const existing = await prisma.company.findUnique({ where: { id: DEMO_COMPANY_ID } });
    if (existing && !existing.isDemo) throw new Error("COMPANY_2_MUST_BE_DEMO");
    return existing ?? prisma.company.create({
      data: {
        id: DEMO_COMPANY_ID,
        slug: "orda-preview-demo",
        name: "ORDA Preview Demo",
        mode: CompanyMode.DEMO,
        isDemo: true,
        active: true,
      },
    });
  });
  const tenant: TenantIdentity = {
    companyId: company.id,
    companySlug: company.slug,
    companyName: company.name,
    isDemo: true,
  };
  const passwordHash = await bcrypt.hash(password, 10);
  const users = await runWithTenant(tenant, async () => {
    const existing = await runWithSystemAccess(() => prisma.user.findMany({
      where: { email: { in: [directorEmail, managerEmail] } },
      select: { id: true, companyId: true, email: true },
    }));
    if (existing.some((user) => user.companyId !== DEMO_COMPANY_ID))
      throw new Error("PREVIEW_DEMO_EMAIL_BELONGS_TO_ANOTHER_TENANT");
    const upsertUser = async (email: string, name: string, role: Role) => {
      const user = existing.find((item) => item.email === email);
      return user
        ? prisma.user.update({
            where: { id: user.id },
            data: { name, role, password: passwordHash, active: true, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null },
          })
        : prisma.user.create({
            data: { email, name, role, password: passwordHash, active: true, mustChangePassword: false },
          });
    };
    const [director, manager] = await Promise.all([
      upsertUser(directorEmail, "Preview Director", Role.DIRECTOR),
      upsertUser(managerEmail, "Preview Manager", Role.MANAGER),
    ]);
    await prisma.rolePermission.createMany({
      data: Object.entries(defaultPermissions).flatMap(([role, permissions]) =>
        permissions.map((permission) => ({
          role: role as Role,
          permission: permission as Permission,
        })),
      ),
      skipDuplicates: true,
    });
    return { director, manager };
  });
  return { tenant, ...users };
}

async function seedPayroll(tenant: TenantIdentity, director: { id: number; name: string }, manager: { id: number; name: string }) {
  return runWithTenant(tenant, async () => {
    const directorActor: PayrollActor = { userId: director.id, name: director.name, role: Role.DIRECTOR };
    const managerActor: PayrollActor = { userId: manager.id, name: manager.name, role: Role.MANAGER };
    const existingProfile = await prisma.employeePayrollProfile.findUnique({
      where: { userId: manager.id },
      include: { salaryRates: { where: { effectiveTo: null }, orderBy: { effectiveFrom: "desc" }, take: 1 } },
    });
    const hasExactProfile = existingProfile?.active && existingProfile.payrollEnabled &&
      Number(existingProfile.baseSalary) === 200_000 && Number(existingProfile.defaultGuaranteedBonus) === 20_000 &&
      Number(existingProfile.salaryRates[0]?.amount) === 200_000;
    const profile = hasExactProfile
      ? existingProfile
      : await upsertPayrollProfile({
          userId: manager.id,
          hiredAt: new Date(Date.UTC(periodYear, periodMonth - 1, 1)),
          baseSalary: 200_000,
          defaultGuaranteedBonus: 20_000,
          comment: seedVersion,
        }, directorActor);
    const period = await ensurePeriod(periodYear, periodMonth, directorActor);
    const relations = await prisma.partnerOrderRelation.findMany({
      where: { companyId: DEMO_COMPANY_ID, comment: "partner-management-demo-v2", order: { managerUserId: manager.id } },
      orderBy: { id: "asc" },
      take: 2,
      select: { orderId: true },
    });
    assert.equal(relations.length, 2, "two demo partner orders must be assigned to Preview Manager");
    for (const [index, relation] of relations.entries()) {
      const key = `${seedVersion}:bonus:${index + 1}`;
      await createAccrual({
        employeeId: profile.id,
        periodId: period.id,
        type: PayrollAccrualType.ORDER_BONUS,
        amount: 100_000,
        orderId: relation.orderId,
        bonusRule: PayrollBonusRule.FIXED,
        bonusValue: 100_000,
        reason: `Demo бонус по заказу №${index + 1}`,
        key,
        requestHash: createRequestHash({ key, employeeId: profile.id, orderId: relation.orderId, amount: 100_000 }),
      }, directorActor);
    }
    const premiumKey = `${seedVersion}:premium`;
    await createAccrual({
      employeeId: profile.id,
      periodId: period.id,
      type: PayrollAccrualType.PREMIUM,
      amount: 50_000,
      reason: "Demo премия директора",
      key: premiumKey,
      requestHash: premiumKey,
    }, directorActor);
    for (const [index, method] of ["cash", "bank_transfer"].entries()) {
      const key = `${seedVersion}:advance:${index + 1}`;
      const requestHash = createRequestHash({ key, amount: 20_000, method });
      const request = await requestAdvance({
        periodId: period.id,
        amount: 20_000,
        method,
        comment: `Demo аванс №${index + 1}`,
        key,
        requestHash,
      }, managerActor);
      const reviewKey = `${key}:review`;
      await reviewAdvance(request.id, {
        status: AdvanceRequestStatus.APPROVED,
        key: reviewKey,
        requestHash: createRequestHash({ reviewKey, decision: "APPROVED" }),
      }, directorActor);
    }
    const confirmationKey = `${seedVersion}:payment-confirmation`;
    const confirmationHash = createRequestHash({ confirmationKey, amount: 100_000, type: PayrollPaymentType.SALARY_PAYMENT });
    const confirmation = await requestPaymentConfirmation({
      periodId: period.id,
      amount: 100_000,
      type: PayrollPaymentType.SALARY_PAYMENT,
      claimedPaymentDate: new Date(Date.UTC(periodYear, periodMonth - 1, 19)),
      method: "bank_transfer",
      comment: "Demo частичная выплата",
      key: confirmationKey,
      requestHash: confirmationHash,
    }, managerActor);
    const reviewKey = `${confirmationKey}:review`;
    await reviewPaymentConfirmation(confirmation.id, {
      decision: "CONFIRM",
      comment: "Demo выплата подтверждена директором",
      key: reviewKey,
      requestHash: createRequestHash({ reviewKey, decision: "CONFIRM" }),
    }, directorActor);
    const summary = await payrollSummary(period.id, directorActor, profile.id);
    assert.equal(summary.rows.length, 1);
    assert.equal(summary.breakdown.salaryAccrued, 200_000);
    assert.equal(summary.breakdown.bonusesAccrued, 200_000);
    assert.equal(summary.breakdown.premiumsAccrued, 50_000);
    assert.equal(summary.breakdown.advancesPaid, 40_000);
    assert.equal(summary.breakdown.partialPayments, 100_000);
    assert.equal(summary.totals.accrued, 450_000);
    assert.equal(summary.totals.paid, 140_000);
    assert.equal(summary.totals.payable, 310_000);
    const ledger = await prisma.companyLedgerEntry.aggregate({
      where: { companyId: DEMO_COMPANY_ID, employeeId: profile.id, source: "PAYROLL_PAYMENT", voidedAt: null },
      _count: { _all: true },
      _sum: { amount: true },
    });
    assert.equal(ledger._count._all, 3);
    assert.equal(Number(ledger._sum.amount), 140_000);
    return { profileId: profile.id, periodId: period.id, summary };
  });
}

export async function seedPayrollPartnersDemo() {
  const password = process.env.PREVIEW_DEMO_PASSWORD?.trim();
  if (!password || password.length < 12) throw new Error("PREVIEW_DEMO_PASSWORD_REQUIRED_MIN_12");
  const liveBefore = await liveTenantSnapshot();
  const { tenant, director, manager } = await setupDemoTenant(password);
  const partnerSeed = await seedPartnerManagementDemo({ directorId: director.id, managerId: manager.id });
  assert.deepEqual(partnerSeed, { partners: 8, orders: 16, operations: 22, existingLinked: 4 });
  const payrollSeed = await seedPayroll(tenant, director, manager);
  await runWithTenant(tenant, async () => {
    const partner = await prisma.partner.findFirstOrThrow({
      where: { companyId: DEMO_COMPANY_ID, name: { startsWith: "Demo ·" } },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const detail = await getManagedPartner(partner.id);
    assert.ok(partnerStatementCsv(detail).includes(detail.partner.name));
    const pdf = await partnerStatementPdf(detail);
    assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  });
  assert.deepEqual(await liveTenantSnapshot(), liveBefore, "companyId=1 must remain byte-for-byte unchanged in this seed scope");
  return {
    companyId: DEMO_COMPANY_ID,
    directorEmail,
    managerEmail,
    partners: partnerSeed,
    payroll: {
      period: `${periodYear}-${String(periodMonth).padStart(2, "0")}`,
      accrued: payrollSeed.summary.totals.accrued,
      paid: payrollSeed.summary.totals.paid,
      payable: payrollSeed.summary.totals.payable,
    },
  };
}

if (process.argv[1]?.endsWith("seed-payroll-partners-demo.ts")) {
  seedPayrollPartnersDemo()
    .then((result) => console.log(
      `Preview Demo seed complete: companyId=${result.companyId}; partners=${result.partners.partners}; ` +
      `partnerOrders=${result.partners.orders}; accrued=${result.payroll.accrued}; paid=${result.payroll.paid}; payable=${result.payroll.payable}`,
    ))
    .catch((error) => { console.error(error instanceof Error ? error.message : "PREVIEW_DEMO_SEED_FAILED"); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
