import bcrypt from "bcrypt";
import {
  CalendarTaskPriority,
  CalendarTaskStatus,
  CalendarTaskType,
  CompanyMode,
  DocumentSource,
  DocumentStatus,
  DocumentType,
  LeadStage,
  MarketingAttributionStatus,
  MarketingCampaignStatus,
  MarketingInquiryStatus,
  MarketingSpendStatus,
  MarketingVerificationStatus,
  MeasurementStatus,
  OrderLifecycle,
  PayrollAccrualType,
  PayrollBonusRule,
  PayrollDirection,
  PayrollPaymentType,
  PrismaClient,
  Role,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { CONTACT_CHANNEL_PRESETS, MARKETING_SOURCE_PRESETS } from "@/lib/marketing/domain";
import { assertFinalPreviewEnvironment } from "./preview-database-safety";

const preview = assertFinalPreviewEnvironment();
const adapter = new PrismaPg({ connectionString: preview.databaseUrl });
const prisma = new PrismaClient({ adapter, log: ["error"] });
const companyId = 2;
const seedVersion = "final-preview-v1";

function requiredSecret(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for Preview seed`);
  return value;
}

function hashKey(value: string) {
  return `preview:${seedVersion}:${value}`;
}

async function ensureDemoCompany() {
  const [byId, bySlug] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId } }),
    prisma.company.findUnique({ where: { slug: "altyn-sapa-demo" } }),
  ]);
  if (byId && !byId.isDemo)
    throw new Error("companyId=2 belongs to a non-Demo tenant");
  if (bySlug && bySlug.id !== companyId)
    throw new Error("Canonical Demo slug belongs to a different companyId");
  const company = byId
    ? await prisma.company.update({
        where: { id: companyId },
        data: { slug: "altyn-sapa-demo", name: "ALTYN SAPA DEMO", mode: CompanyMode.DEMO, isDemo: true, active: true },
      })
    : await prisma.company.create({
        data: { id: companyId, slug: "altyn-sapa-demo", name: "ALTYN SAPA DEMO", mode: CompanyMode.DEMO, isDemo: true, active: true },
      });
  await prisma.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"Company"', 'id'), GREATEST((SELECT MAX("id") FROM "Company"), 2), true)`);
  return company;
}

async function upsertDemoUser(input: { email: string; name: string; role: Role; password: string; employeeCode: string }) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing && existing.companyId !== companyId)
    throw new Error(`Demo login ${input.email} belongs to another tenant`);
  const password = await bcrypt.hash(input.password, 12);
  return prisma.user.upsert({
    where: { email: input.email },
    create: {
      companyId,
      email: input.email,
      name: input.name,
      role: input.role,
      password,
      active: true,
      mustChangePassword: false,
      employeeCode: input.employeeCode,
    },
    update: {
      name: input.name,
      role: input.role,
      password,
      active: true,
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      employeeCode: input.employeeCode,
    },
  });
}

async function seedUsers() {
  const directorPassword = requiredSecret("DEMO_USER_PASSWORD");
  const marketerPassword = requiredSecret("DEMO_MARKETER_PASSWORD");
  const managerPassword = requiredSecret("DEMO_MANAGER_PASSWORD");
  const measurerPassword = requiredSecret("DEMO_MEASURER_PASSWORD");
  const director = await upsertDemoUser({ email: requiredSecret("DEMO_USER_EMAIL"), name: "Demo Director", role: Role.DIRECTOR, password: directorPassword, employeeCode: "DMO-DIR-001" });
  const marketer = await upsertDemoUser({ email: requiredSecret("DEMO_MARKETER_EMAIL"), name: "Demo Marketer", role: Role.MARKETER, password: marketerPassword, employeeCode: "DMO-MKT-001" });
  const manager = await upsertDemoUser({ email: process.env.DEMO_MANAGER_EMAIL ?? "manager@orda-erp.kz", name: "Demo Manager", role: Role.MANAGER, password: managerPassword, employeeCode: "DMO-MGR-001" });
  const measurer = await upsertDemoUser({ email: process.env.DEMO_MEASURER_EMAIL ?? "measurer@orda-erp.kz", name: "Demo Measurer", role: Role.MEASURER, password: measurerPassword, employeeCode: "DMO-MSR-001" });
  return { director, marketer, manager, measurer };
}

async function seedMarketingCatalogs() {
  for (const [code, name, platform, isPaid] of MARKETING_SOURCE_PRESETS)
    await prisma.marketingSource.upsert({
      where: { companyId_code: { companyId, code } },
      create: { companyId, code, name, platform, isPaid, system: true },
      update: { name, platform, isPaid, system: true, active: true },
    });
  for (const [code, name] of CONTACT_CHANNEL_PRESETS)
    await prisma.marketingContactChannel.upsert({
      where: { companyId_code: { companyId, code } },
      create: { companyId, code, name, system: true },
      update: { name, system: true, active: true },
    });
}

async function seedCrmAndMarketing(users: Awaited<ReturnType<typeof seedUsers>>) {
  await seedMarketingCatalogs();
  const sources = await prisma.marketingSource.findMany({ where: { companyId }, orderBy: { id: "asc" } });
  const channels = await prisma.marketingContactChannel.findMany({ where: { companyId }, orderBy: { id: "asc" } });
  const campaignNames = [
    "Instagram · Алматы", "Facebook · Семьи", "Click to WhatsApp", "Instagram Organic",
    "WhatsApp Organic", "TikTok Ads", "TikTok Organic", "Referral",
    "2GIS", "Website", "Google Ads", "Showroom",
  ];
  const campaigns = [];
  for (let index = 0; index < campaignNames.length; index += 1) {
    const source = sources[index % sources.length];
    const month = index % 6;
    const startsAt = new Date(Date.UTC(2026, 2 + month, 1));
    campaigns.push(await prisma.marketingCampaign.upsert({
      where: { companyId_platform_externalId: { companyId, platform: source.platform, externalId: `${seedVersion}-campaign-${index + 1}` } },
      create: {
        companyId,
        sourceId: source.id,
        name: campaignNames[index],
        platform: source.platform,
        startsAt,
        endsAt: new Date(Date.UTC(2026, 3 + month, 0)),
        plannedBudget: 300_000 + index * 10_000,
        dailyBudget: 10_000,
        responsibleId: users.marketer.id,
        status: MarketingCampaignStatus.ACTIVE,
        region: index % 3 === 0 ? "Караганда" : "Алматы",
        externalId: `${seedVersion}-campaign-${index + 1}`,
        comment: seedVersion,
      },
      update: { sourceId: source.id, name: campaignNames[index], responsibleId: users.marketer.id, status: MarketingCampaignStatus.ACTIVE },
    }));
  }

  const clients = [];
  const orders = [];
  for (let index = 0; index < 18; index += 1) {
    const phone = `+7707301${String(index).padStart(4, "0")}`;
    const city = index === 0 ? "Караганда" : index === 1 ? "Отеген батыр" : index % 3 === 0 ? "Астана" : "Алматы";
    const stage = index < 6 ? LeadStage.WON : index < 9 ? LeadStage.MEASUREMENT_COMPLETED : index < 13 ? LeadStage.PROPOSAL_SENT : index < 16 ? LeadStage.QUALIFIED : LeadStage.LOST;
    const existingClient = await prisma.client.findFirst({ where: { companyId, phone } });
    const client = existingClient
      ? await prisma.client.update({ where: { id: existingClient.id }, data: { name: `Demo Marketing Client ${index + 1}`, city, stage, managerUserId: users.manager.id, manager: users.manager.name, active: true } })
      : await prisma.client.create({
          data: {
            companyId,
            name: `Demo Marketing Client ${index + 1}`,
            phone,
            whatsapp: phone,
            city,
            address: `Demo address ${index + 1}`,
            manager: users.manager.name,
            managerUserId: users.manager.id,
            amount: String(1_500_000 + index * 100_000),
            status: stage === LeadStage.LOST ? "Потеряна" : "Активная",
            stage,
            estimatedAmount: 1_500_000 + index * 100_000,
            source: sources[index % sources.length].name,
            comment: seedVersion,
            active: true,
          },
        });
    clients.push(client);

    const campaign = campaigns[index % campaigns.length];
    const source = sources[index % sources.length];
    const channel = channels[index % channels.length];
    const receivedAt = new Date(Date.UTC(2026, 2 + (index % 6), 5 + (index % 20), 8));
    await prisma.marketingInquiry.upsert({
      where: { companyId_externalLeadId: { companyId, externalLeadId: `${seedVersion}-inquiry-${index + 1}` } },
      create: {
        companyId,
        receivedAt,
        name: client.name,
        phone,
        normalizedPhone: phone.replace(/\D/gu, ""),
        instagramUsername: index % 2 ? `demo_client_${index + 1}` : null,
        city,
        sourceId: source.id,
        channelId: channel.id,
        campaignId: campaign.id,
        status: index % 7 === 0 ? MarketingInquiryStatus.DUPLICATE : MarketingInquiryStatus.CONVERTED,
        assignedManagerId: users.manager.id,
        isDuplicate: index % 7 === 0,
        applicationId: client.id,
        externalLeadId: `${seedVersion}-inquiry-${index + 1}`,
        message: "Synthetic Preview inquiry",
        createdById: users.marketer.id,
      },
      update: { applicationId: client.id, assignedManagerId: users.manager.id, status: index % 7 === 0 ? MarketingInquiryStatus.DUPLICATE : MarketingInquiryStatus.CONVERTED },
    });
    await prisma.leadAttribution.upsert({
      where: { applicationId: client.id },
      create: {
        companyId,
        applicationId: client.id,
        sourceId: source.id,
        channelId: channel.id,
        campaignId: campaign.id,
        firstTouchSourceId: source.id,
        lastTouchSourceId: source.id,
        primarySourceId: source.id,
        externalLeadId: `${seedVersion}-inquiry-${index + 1}`,
        firstContactAt: receivedAt,
        attributedById: users.marketer.id,
        attributionStatus: MarketingAttributionStatus.AUTOMATIC,
        verificationStatus: MarketingVerificationStatus.VERIFIED,
      },
      update: { sourceId: source.id, channelId: channel.id, campaignId: campaign.id, primarySourceId: source.id },
    });
    const touchNote = hashKey(`touch-${index + 1}`);
    if (!await prisma.marketingTouch.findFirst({ where: { companyId, applicationId: client.id, note: touchNote } }))
      await prisma.marketingTouch.create({ data: { companyId, applicationId: client.id, sourceId: source.id, channelId: channel.id, campaignId: campaign.id, occurredAt: receivedAt, note: touchNote, createdById: users.marketer.id } });

    if (index < 9) {
      let task = await prisma.calendarTask.findFirst({ where: { companyId, clientId: client.id, title: `${seedVersion} · Контрольный замер` } });
      task ??= await prisma.calendarTask.create({
        data: { companyId, title: `${seedVersion} · Контрольный замер`, description: client.address, type: CalendarTaskType.MEASUREMENT, dueAt: new Date(Date.UTC(2026, 7, 21 + (index % 7), 6)), status: index < 3 ? CalendarTaskStatus.COMPLETED : CalendarTaskStatus.PLANNED, priority: CalendarTaskPriority.IMPORTANT, assigneeId: users.measurer.id, creatorId: users.manager.id, clientId: client.id },
      });
      await prisma.measurement.upsert({
        where: { idempotencyKey: hashKey(`measurement-${index + 1}`) },
        create: { companyId, clientId: client.id, calendarTaskId: task.id, measurer: users.measurer.name, measurerUserId: users.measurer.id, visitDate: task.dueAt, status: index < 3 ? MeasurementStatus.HANDED_TO_MANAGER : MeasurementStatus.ASSIGNED, city, address: client.address, completedAt: index < 3 ? task.dueAt : null, handedAt: index < 3 ? task.dueAt : null, idempotencyKey: hashKey(`measurement-${index + 1}`), requestHash: hashKey(`measurement-${index + 1}`) },
        update: { measurerUserId: users.measurer.id, status: index < 3 ? MeasurementStatus.HANDED_TO_MANAGER : MeasurementStatus.ASSIGNED },
      });
    }

    if (index < 13) {
      let calculation = await prisma.leadCalculation.findFirst({ where: { clientId: client.id, comment: hashKey(`calculation-${index + 1}`) } });
      calculation ??= await prisma.leadCalculation.create({ data: { clientId: client.id, material: index % 2 ? "Ясень" : "Дуб", baseClientPrice: 1_500_000 + index * 100_000, clientPrice: 1_500_000 + index * 100_000, internalCost: 900_000 + index * 50_000, snapshot: { seedVersion, clientId: client.id }, comment: hashKey(`calculation-${index + 1}`), authorId: users.manager.id, authorName: users.manager.name } });
      await prisma.commercialProposal.upsert({
        where: { number: `DEMO-КП-${String(index + 1).padStart(4, "0")}` },
        create: { companyId, clientId: client.id, calculationId: calculation.id, number: `DEMO-КП-${String(index + 1).padStart(4, "0")}`, status: "Отправлено", snapshot: { seedVersion, clientName: client.name }, validUntil: new Date(Date.UTC(2026, 8, 1 + index)), executionTerm: "40–50 календарных дней", paymentTerms: "70/30", warranty: "5 лет", managerContact: users.manager.name, sentAt: receivedAt, createdById: users.manager.id, createdByName: users.manager.name, total: 1_500_000 + index * 100_000, idempotencyKey: hashKey(`proposal-${index + 1}`), requestHash: hashKey(`proposal-${index + 1}`) },
        update: { clientId: client.id, calculationId: calculation.id, total: 1_500_000 + index * 100_000 },
      });
    }

    if (index < 6) {
      const amount = index === 0 ? 5_200_000 : 2_000_000 + index * 250_000;
      const received = index === 0 ? 3_000_000 : 900_000 + index * 100_000;
      const number = `DEMO-ORD-MKT-${String(index + 1).padStart(3, "0")}`;
      const order = await prisma.order.upsert({
        where: { number },
        create: { companyId, number, clientId: client.id, address: client.address, staircase: "П-образная лестница", material: index % 2 ? "Ясень" : "Дуб", amount, prepayment: received, balance: amount - received, manager: users.manager.name, managerUserId: users.manager.id, lifecycle: index === 0 ? OrderLifecycle.PREPARATION : OrderLifecycle.IN_PRODUCTION, status: index === 0 ? "Контрольный замер" : "Заготовка", additionalDetails: seedVersion, promisedAt: new Date(Date.UTC(2026, 9, 15 + index)), companyProfit: Math.round(amount * 0.25) },
        update: { clientId: client.id, amount, prepayment: received, balance: amount - received, managerUserId: users.manager.id, lifecycle: index === 0 ? OrderLifecycle.PREPARATION : OrderLifecycle.IN_PRODUCTION },
      });
      orders.push(order);
      await prisma.payment.upsert({
        where: { idempotencyKey: hashKey(`client-payment-${index + 1}`) },
        create: { companyId, orderId: order.id, amount: received, type: "CLIENT_PAYMENT", method: "BANK", comment: seedVersion, operationDate: receivedAt, author: users.manager.name, registeredByUserId: users.manager.id, idempotencyKey: hashKey(`client-payment-${index + 1}`), requestHash: hashKey(`client-payment-${index + 1}`) },
        update: { amount: received, orderId: order.id },
      });
      await prisma.leadConversion.upsert({ where: { clientId: client.id }, create: { clientId: client.id, proposalId: (await prisma.commercialProposal.findUniqueOrThrow({ where: { number: `DEMO-КП-${String(index + 1).padStart(4, "0")}` } })).id, orderId: order.id, managerId: users.manager.id, managerName: users.manager.name }, update: { orderId: order.id, managerId: users.manager.id } });
      await prisma.document.upsert({
        where: { type_number: { type: DocumentType.CONTRACT, number: `DEMO-ДОГ-${String(index + 1).padStart(4, "0")}` } },
        create: { companyId, orderId: order.id, clientId: client.id, type: DocumentType.CONTRACT, number: `DEMO-ДОГ-${String(index + 1).padStart(4, "0")}`, title: "Demo contract", documentDate: receivedAt, status: DocumentStatus.READY, source: DocumentSource.GENERATED_ORDER, authorId: users.manager.id, snapshot: { seedVersion, client: client.name, order: order.number }, idempotencyKey: hashKey(`contract-${index + 1}`), requestHash: hashKey(`contract-${index + 1}`) },
        update: { orderId: order.id, clientId: client.id },
      });
    }
  }

  const marketingExpenseCategory = await prisma.financeCategory.upsert({
    where: { companyId_direction_code: { companyId, direction: "EXPENSE", code: "MARKETING" } },
    create: { companyId, direction: "EXPENSE", code: "MARKETING", name: "Реклама и маркетинг", system: true },
    update: { active: true, name: "Реклама и маркетинг" },
  });
  for (let index = 0; index < campaigns.length; index += 1) {
    const metricDate = new Date(Date.UTC(2026, 2 + (index % 6), 15));
    const metricKey = hashKey(`metric-${index + 1}`);
    await prisma.marketingMetric.upsert({
      where: { dedupeKey: metricKey },
      create: { companyId, metricDate, platform: campaigns[index].platform, campaignId: campaigns[index].id, reportedSpend: 120_000 + index * 5_000, impressions: 50_000 + index * 2_000, reach: 35_000 + index * 1_500, clicks: 600 + index * 25, linkClicks: 500 + index * 20, messages: 80 + index * 4, platformLeads: 50 + index * 3, videoViews: 20_000 + index * 500, importKey: seedVersion, dedupeKey: metricKey, createdById: users.marketer.id },
      update: { reportedSpend: 120_000 + index * 5_000, impressions: 50_000 + index * 2_000, clicks: 600 + index * 25 },
    });
    const spendKey = hashKey(`spend-${index + 1}`);
    const spend = await prisma.marketingSpend.upsert({
      where: { idempotencyKey: spendKey },
      create: { companyId, spendDate: metricDate, platform: campaigns[index].platform, campaignId: campaigns[index].id, amount: 120_000 + index * 5_000, status: MarketingSpendStatus.APPROVED, comment: seedVersion, financeCategoryId: marketingExpenseCategory.id, paymentAccount: "Demo bank", createdById: users.marketer.id, submittedAt: metricDate, reviewedById: users.director.id, reviewedAt: metricDate, reviewComment: "Synthetic Preview approval", idempotencyKey: spendKey, requestHash: spendKey },
      update: { amount: 120_000 + index * 5_000, status: MarketingSpendStatus.APPROVED, reviewedById: users.director.id, reviewedAt: metricDate },
    });
    const ledger = await prisma.companyLedgerEntry.upsert({
      where: { idempotencyKey: `marketing-spend:${spend.id}` },
      create: { companyId, type: "MARKETING_EXPENSE", category: marketingExpenseCategory.name, categoryId: marketingExpenseCategory.id, direction: "EXPENSE", source: "MARKETING", amount: spend.amount, operationDate: metricDate, method: "BANK", comment: seedVersion, authorId: users.director.id, idempotencyKey: `marketing-spend:${spend.id}`, requestHash: spendKey, affectsProfit: true },
      update: { amount: spend.amount, voidedAt: null, voidReason: null },
    });
    if (spend.financeEntryId !== ledger.id) await prisma.marketingSpend.update({ where: { id: spend.id }, data: { financeEntryId: ledger.id } });
    const month = new Date(Date.UTC(2026, 2 + (index % 6), 1));
    const budget = await prisma.marketingBudget.findFirst({ where: { companyId, month, campaignId: campaigns[index].id } });
    if (budget) await prisma.marketingBudget.update({ where: { id: budget.id }, data: { planned: 300_000 + index * 10_000, comment: seedVersion } });
    else await prisma.marketingBudget.create({ data: { companyId, month, campaignId: campaigns[index].id, sourceId: campaigns[index].sourceId, planned: 300_000 + index * 10_000, comment: seedVersion } });
  }
  return { clients, orders, campaigns };
}

async function seedPayroll(users: Awaited<ReturnType<typeof seedUsers>>, orders: Awaited<ReturnType<typeof seedCrmAndMarketing>>["orders"]) {
  const profile = await prisma.employeePayrollProfile.upsert({
    where: { userId: users.manager.id },
    create: { companyId, userId: users.manager.id, name: users.manager.name, position: users.manager.role, email: users.manager.email, hiredAt: new Date(Date.UTC(2026, 0, 1)), baseSalary: 200_000, defaultGuaranteedBonus: 20_000, comment: seedVersion },
    update: { active: true, payrollEnabled: true, baseSalary: 200_000, comment: seedVersion },
  });
  const currentRate = await prisma.employeeSalaryRate.findFirst({ where: { employeeId: profile.id, effectiveTo: null } });
  if (!currentRate) await prisma.employeeSalaryRate.create({ data: { employeeId: profile.id, amount: 200_000, effectiveFrom: new Date(Date.UTC(2026, 0, 1)), approvedById: users.director.id, comment: seedVersion } });
  const period = await prisma.payrollPeriod.upsert({ where: { companyId_year_month: { companyId, year: 2026, month: 8 } }, create: { companyId, year: 2026, month: 8 }, update: {} });
  const accruals = [
    { type: PayrollAccrualType.BASE_SALARY, amount: 200_000, orderId: null, reason: "Оклад за август" },
    { type: PayrollAccrualType.ORDER_BONUS, amount: 120_000, orderId: orders[0]?.id ?? null, reason: "Бонус по заказу №1" },
    { type: PayrollAccrualType.ORDER_BONUS, amount: 80_000, orderId: orders[1]?.id ?? null, reason: "Бонус по заказу №2" },
    { type: PayrollAccrualType.PREMIUM, amount: 50_000, orderId: null, reason: "Премия" },
  ];
  for (let index = 0; index < accruals.length; index += 1) {
    const item = accruals[index];
    const key = hashKey(`payroll-accrual-${index + 1}`);
    await prisma.payrollAccrual.upsert({
      where: { idempotencyKey: key },
      create: { employeeId: profile.id, periodId: period.id, type: item.type, direction: PayrollDirection.INCREASE, amount: item.amount, orderId: item.orderId, reason: item.reason, bonusRule: item.type === PayrollAccrualType.ORDER_BONUS ? PayrollBonusRule.FIXED : null, bonusValue: item.type === PayrollAccrualType.ORDER_BONUS ? item.amount : null, approvedById: users.director.id, createdById: users.director.id, idempotencyKey: key, requestHash: key },
      update: { amount: item.amount, orderId: item.orderId, reason: item.reason },
    });
  }
  const payments = [
    { type: PayrollPaymentType.ADVANCE, amount: 20_000, comment: "Аванс №1" },
    { type: PayrollPaymentType.ADVANCE, amount: 20_000, comment: "Аванс №2" },
    { type: PayrollPaymentType.SALARY_PAYMENT, amount: 100_000, comment: "Частичная выплата" },
  ];
  for (let index = 0; index < payments.length; index += 1) {
    const item = payments[index];
    const key = hashKey(`payroll-payment-${index + 1}`);
    const payment = await prisma.payrollPayment.upsert({
      where: { idempotencyKey: key },
      create: { employeeId: profile.id, periodId: period.id, amount: item.amount, paymentDate: new Date(Date.UTC(2026, 7, 10 + index)), type: item.type, method: "BANK", comment: item.comment, paidById: users.director.id, idempotencyKey: key, requestHash: key },
      update: { amount: item.amount, comment: item.comment },
    });
    await prisma.companyLedgerEntry.upsert({
      where: { idempotencyKey: `payroll-payment:${payment.id}` },
      create: { companyId, type: "PAYROLL_PAYMENT", category: "SALARY", direction: "EXPENSE", source: "PAYROLL_PAYMENT", amount: payment.amount, operationDate: payment.paymentDate, method: payment.method, employeeId: profile.id, comment: item.comment, authorId: users.director.id, idempotencyKey: `payroll-payment:${payment.id}`, requestHash: key, affectsProfit: false, payrollPaymentId: payment.id },
      update: { amount: payment.amount, voidedAt: null, voidReason: null },
    });
  }
  return { profile, period };
}

async function main() {
  await ensureDemoCompany();
  const users = await seedUsers();
  const crm = await seedCrmAndMarketing(users);
  const payroll = await seedPayroll(users, crm.orders);
  process.env.TEST_DATABASE_URL = preview.databaseUrl;
  const { seedPartnerManagementDemo } = await import("./seed-partner-management-demo");
  const partners = await seedPartnerManagementDemo();
  const [clientCount, orderCount, campaignCount, spendCount, payrollAccrued, payrollPaid] = await Promise.all([
    prisma.client.count({ where: { companyId } }),
    prisma.order.count({ where: { companyId } }),
    prisma.marketingCampaign.count({ where: { companyId } }),
    prisma.marketingSpend.count({ where: { companyId } }),
    prisma.payrollAccrual.aggregate({ where: { employeeId: payroll.profile.id, periodId: payroll.period.id, direction: PayrollDirection.INCREASE }, _sum: { amount: true } }),
    prisma.payrollPayment.aggregate({ where: { employeeId: payroll.profile.id, periodId: payroll.period.id, reversalOfId: null }, _sum: { amount: true } }),
  ]);
  console.log(`Final Preview seed complete: clients=${clientCount}; orders=${orderCount}; partners=${partners.partners}; partnerOrders=${partners.orders}; campaigns=${campaignCount}; spends=${spendCount}; payrollAccrued=${Number(payrollAccrued._sum.amount ?? 0)}; payrollPaid=${Number(payrollPaid._sum.amount ?? 0)}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "FINAL_PREVIEW_SEED_FAILED");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
