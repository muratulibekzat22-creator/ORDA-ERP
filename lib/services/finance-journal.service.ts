import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { compareRequestHash } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";

export type FinanceDirection = "INCOME" | "EXPENSE";
export type FinanceSource =
  | "MANUAL"
  | "BANK_STATEMENT"
  | "RECURRING_EXPENSE"
  | "CLIENT_PAYMENT"
  | "PARTNER_PAYOUT"
  | "PAYROLL_PAYMENT"
  | "REFUND"
  | "OTHER_SYSTEM";

export type FinanceJournalFilters = {
  period?: "all" | "today" | "week" | "month" | "previous_month" | "year";
  from?: Date;
  to?: Date;
  direction?: FinanceDirection;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type ManualFinanceInput = {
  direction: FinanceDirection;
  categoryId: number;
  amount: number;
  operationDate: Date;
  method: string;
  counterparty?: string | null;
  comment?: string | null;
  orderId?: number | null;
  clientId?: number | null;
  partnerId?: number | null;
  employeeId?: number | null;
};

const clientPaymentTypes = new Set([
  "CLIENT_PAYMENT",
  "payment",
  "PREPAYMENT",
  "ADDITIONAL_PAYMENT",
]);

const BUSINESS_TIME_ZONE = "Asia/Almaty";
const BUSINESS_OFFSET = "+05:00";
const businessDateKey = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
const businessBoundary = (date: string, end = false) =>
  new Date(`${date}T${end ? "23:59:59.999" : "00:00:00.000"}${BUSINESS_OFFSET}`);

export function selectedFinanceJournalRange(
  filters: FinanceJournalFilters,
  now = new Date(),
) {
  if (filters.from || filters.to) return { from: filters.from, to: filters.to };
  if (!filters.period || filters.period === "all") return {};
  const today = businessDateKey(now);
  let fromDate = today;
  let to = now;
  if (filters.period === "week") {
    fromDate = businessDateKey(
      new Date(businessBoundary(today).getTime() - 6 * 86_400_000),
    );
  }
  if (filters.period === "month") fromDate = `${today.slice(0, 7)}-01`;
  if (filters.period === "previous_month") {
    const previousLast = new Date(
      businessBoundary(`${today.slice(0, 7)}-01`).getTime() - 1,
    );
    const previousLastDate = businessDateKey(previousLast);
    fromDate = `${previousLastDate.slice(0, 7)}-01`;
    to = businessBoundary(previousLastDate, true);
  }
  if (filters.period === "year") fromDate = `${today.slice(0, 4)}-01-01`;
  return { from: businessBoundary(fromDate), to };
}

function paymentCategory(type: string) {
  if (type === "ADDITIONAL_PAYMENT")
    return { code: "ADDITIONAL_PAYMENT", name: "Доплата клиента" };
  if (clientPaymentTypes.has(type))
    return { code: "CLIENT_PAYMENT", name: "Оплата клиента" };
  if (type === "REFUND")
    return { code: "CLIENT_REFUND", name: "Возврат клиенту" };
  if (type === "PARTNER_PAYOUT")
    return { code: "PARTNER_PAYOUT", name: "Цех / партнёр" };
  if (type === "PARTNER_PAYOUT_REVERSAL")
    return { code: "PARTNER_PAYOUT_REVERSAL", name: "Сторно выплаты цеху" };
  return { code: type, name: "Системная операция" };
}

function paymentSource(type: string): FinanceSource {
  if (clientPaymentTypes.has(type)) return "CLIENT_PAYMENT";
  if (type === "REFUND") return "REFUND";
  if (type === "PARTNER_PAYOUT" || type === "PARTNER_PAYOUT_REVERSAL")
    return "PARTNER_PAYOUT";
  return "OTHER_SYSTEM";
}

function payrollCategory(type: string | null | undefined) {
  if (type === "ADVANCE") return { code: "ADVANCE", name: "Аванс" };
  if (type?.includes("BONUS"))
    return { code: "EMPLOYEE_BONUS", name: "Бонус сотруднику" };
  return { code: "SALARY", name: "Зарплата" };
}

function auditSnapshot(entry: {
  direction: string;
  categoryId: number | null;
  amount: Prisma.Decimal;
  operationDate: Date;
  method: string | null;
  counterparty: string | null;
  comment: string | null;
  orderId: number | null;
  clientId: number | null;
  partnerId: number | null;
  employeeId: number | null;
}) {
  return {
    direction: entry.direction,
    categoryId: entry.categoryId,
    amount: entry.amount.toString(),
    operationDate: entry.operationDate.toISOString(),
    method: entry.method,
    counterparty: entry.counterparty,
    comment: entry.comment,
    orderId: entry.orderId,
    clientId: entry.clientId,
    partnerId: entry.partnerId,
    employeeId: entry.employeeId,
  };
}

export async function getFinanceJournal(filters: FinanceJournalFilters = {}) {
  const companyId = requireTenantIdentity().companyId;
  const range = selectedFinanceJournalRange(filters);
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  const pageSize = Math.min(100, Math.max(10, Math.trunc(filters.pageSize ?? 50)));
  const offset = (page - 1) * pageSize;
  const fromSql = range.from
    ? Prisma.sql`AND payment."operationDate" >= ${range.from}`
    : Prisma.empty;
  const toSql = range.to
    ? Prisma.sql`AND payment."operationDate" <= ${range.to}`
    : Prisma.empty;
  const search = filters.search?.trim().toLocaleLowerCase("ru").slice(0, 120);
  const resultWhereSql = Prisma.sql`WHERE TRUE
    ${filters.direction ? Prisma.sql`AND direction = ${filters.direction}` : Prisma.empty}
    ${search ? Prisma.sql`AND search_text ILIKE ${`%${search}%`}` : Prisma.empty}`;
  const operationCte = Prisma.sql`
    WITH operations AS (
      SELECT
        'PAYMENT'::text AS source,
        payment.id,
        CASE
          WHEN payment.type IN ('REFUND', 'PARTNER_PAYOUT', 'PARTNER_PAYOUT_REVERSAL')
            OR (payment.type = 'ADJUSTMENT' AND payment.comment LIKE '%[EXPENSE]%')
          THEN 'EXPENSE'
          ELSE 'INCOME'
        END::text AS direction,
        CASE
          WHEN payment.type IN ('PARTNER_PAYOUT', 'PARTNER_PAYOUT_REVERSAL') THEN 'PRODUCTION'
          WHEN payment.type = 'REFUND'
            OR (payment.type = 'ADJUSTMENT' AND payment.comment LIKE '%[EXPENSE]%') THEN 'ONE_TIME'
          ELSE 'INCOME'
        END::text AS expense_kind,
        payment.type::text AS category_code,
        CASE
          WHEN payment.type = 'ADDITIONAL_PAYMENT' THEN 'Доплата клиента'
          WHEN payment.type IN ('CLIENT_PAYMENT', 'payment', 'PREPAYMENT') THEN 'Оплата клиента'
          WHEN payment.type = 'REFUND' THEN 'Возврат клиенту'
          WHEN payment.type = 'PARTNER_PAYOUT' THEN 'Цех / партнёр'
          WHEN payment.type = 'PARTNER_PAYOUT_REVERSAL' THEN 'Сторно выплаты цеху'
          ELSE 'Системная операция'
        END::text AS category_name,
        payment."operationDate" AS operation_date,
        payment.amount,
        LOWER(CONCAT_WS(' ', payment.type, payment.method, payment.comment, payment.author,
          payment.amount::text, orders.number, clients.name, clients.phone, partners.name)) AS search_text
      FROM "Payment" payment
      LEFT JOIN "Order" orders ON orders.id = payment."orderId"
      LEFT JOIN "Client" clients ON clients.id = orders."clientId"
      LEFT JOIN "Partner" partners ON partners.id = payment."partnerId"
      WHERE payment."companyId" = ${companyId} AND payment."deletedAt" IS NULL ${fromSql} ${toSql}
      UNION ALL
      SELECT
        'LEDGER'::text AS source,
        ledger.id,
        ledger.direction::text,
        CASE
          WHEN ledger.direction = 'INCOME' THEN 'INCOME'
          WHEN ledger."recurringExpensePlanId" IS NOT NULL OR ledger.source = 'RECURRING_EXPENSE' THEN 'FIXED'
          WHEN ledger."payrollPaymentId" IS NOT NULL THEN 'PAYROLL'
          WHEN ledger."partnerId" IS NOT NULL OR COALESCE(category.code, ledger.category) IN ('PARTNER_PAYOUT', 'MATERIALS', 'DELIVERY') THEN 'PRODUCTION'
          ELSE 'ONE_TIME'
        END::text AS expense_kind,
        COALESCE(category.code, ledger.category)::text AS category_code,
        COALESCE(category.name, ledger.category)::text AS category_name,
        ledger."operationDate" AS operation_date,
        ledger.amount,
        LOWER(CONCAT_WS(' ', ledger.type, ledger.category, category.code, category.name,
          ledger.method, ledger.counterparty, ledger.comment, ledger.amount::text,
          orders.number, COALESCE(clients.name, order_clients.name), partners.name,
          employees.name, employee_users.name, payroll_employees.name,
          payroll_users.name, authors.name)) AS search_text
      FROM "CompanyLedgerEntry" ledger
      LEFT JOIN "FinanceCategory" category ON category.id = ledger."categoryId"
      LEFT JOIN "Order" orders ON orders.id = ledger."orderId"
      LEFT JOIN "Client" order_clients ON order_clients.id = orders."clientId"
      LEFT JOIN "Client" clients ON clients.id = ledger."clientId"
      LEFT JOIN "Partner" partners ON partners.id = ledger."partnerId"
      LEFT JOIN "EmployeePayrollProfile" employees ON employees.id = ledger."employeeId"
      LEFT JOIN "User" employee_users ON employee_users.id = employees."userId"
      LEFT JOIN "PayrollPayment" payroll_payments ON payroll_payments.id = ledger."payrollPaymentId"
      LEFT JOIN "EmployeePayrollProfile" payroll_employees ON payroll_employees.id = payroll_payments."employeeId"
      LEFT JOIN "User" payroll_users ON payroll_users.id = payroll_employees."userId"
      LEFT JOIN "User" authors ON authors.id = ledger."authorId"
      WHERE ledger."voidedAt" IS NULL
        AND ledger."companyId" = ${companyId}
        AND (ledger."payrollPaymentId" IS NOT NULL OR ledger."payrollAccrualId" IS NULL)
        ${range.from ? Prisma.sql`AND ledger."operationDate" >= ${range.from}` : Prisma.empty}
        ${range.to ? Prisma.sql`AND ledger."operationDate" <= ${range.to}` : Prisma.empty}
    )`;
  type PageRow = { source: "PAYMENT" | "LEDGER"; id: number; total: bigint };
  type AggregateRow = {
    direction: FinanceDirection;
    expense_kind: "INCOME" | "FIXED" | "ONE_TIME" | "PRODUCTION" | "PAYROLL";
    category_code: string;
    category_name: string;
    operation_day: Date;
    amount: Prisma.Decimal;
  };
  const [pageRows, aggregateRows, categories, orders, clients, partners, employees] =
    await Promise.all([
      prisma.$queryRaw<PageRow[]>`${operationCte}
        SELECT source, id, COUNT(*) OVER()::bigint AS total
        FROM operations
        ${resultWhereSql}
        ORDER BY operation_date DESC, id DESC
        OFFSET ${offset}
        LIMIT ${pageSize}`,
      prisma.$queryRaw<AggregateRow[]>`${operationCte}
        SELECT
          direction,
          expense_kind,
          category_code,
          category_name,
          DATE_TRUNC('day', operation_date) AS operation_day,
          SUM(amount) AS amount
        FROM operations
        ${resultWhereSql}
        GROUP BY direction, expense_kind, category_code, category_name, DATE_TRUNC('day', operation_date)`,
      prisma.financeCategory.findMany({
        orderBy: [
          { direction: "asc" },
          { system: "desc" },
          { name: "asc" },
        ],
      }),
      prisma.order.findMany({
        where: { deletedAt: null, lifecycle: { not: "CANCELLED" } },
        select: {
          id: true,
          number: true,
          client: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 250,
      }),
      prisma.client.findMany({
        where: { active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 250,
      }),
      prisma.partner.findMany({
        where: { active: true, archived: false, isTest: false },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.employeePayrollProfile.findMany({
        where: { active: true, payrollEnabled: true },
        select: {
          id: true,
          name: true,
          user: { select: { name: true } },
        },
        orderBy: { name: "asc" },
      }),
    ]);

  const paymentIds = pageRows
    .filter((row) => row.source === "PAYMENT")
    .map((row) => row.id);
  const ledgerIds = pageRows
    .filter((row) => row.source === "LEDGER")
    .map((row) => row.id);
  const [payments, ledger] = await Promise.all([
    prisma.payment.findMany({
      where: { id: { in: paymentIds } },
      include: {
        order: {
          select: {
            id: true,
            number: true,
            client: { select: { id: true, name: true } },
          },
        },
        partner: { select: { id: true, name: true } },
      },
    }),
    prisma.companyLedgerEntry.findMany({
      where: { id: { in: ledgerIds } },
      include: {
        categoryRef: true,
        order: {
          select: {
            id: true,
            number: true,
            client: { select: { id: true, name: true } },
          },
        },
        client: { select: { id: true, name: true } },
        partner: { select: { id: true, name: true } },
        employee: {
          select: {
            id: true,
            name: true,
            user: { select: { name: true } },
          },
        },
        author: { select: { name: true } },
        payrollPayment: {
          select: {
            method: true,
            type: true,
            employee: {
              select: {
                id: true,
                name: true,
                user: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const paymentRows = payments.map((item) => {
    const category = paymentCategory(item.type);
    const expense =
      item.type === "REFUND" ||
      item.type === "PARTNER_PAYOUT" ||
      (item.type === "ADJUSTMENT" && item.comment?.includes("[EXPENSE]"));
    return {
      id: `payment-${item.id}`,
      sourceId: item.id,
      source: paymentSource(item.type),
      system: true,
      editable: false,
      voided: false,
      direction: expense ? ("EXPENSE" as const) : ("INCOME" as const),
      categoryId: null,
      categoryCode: category.code,
      categoryName: category.name,
      amount: Number(item.amount),
      method: item.method,
      counterparty: item.partner?.name ?? item.order?.client.name ?? null,
      comment: item.comment,
      author: item.author,
      operationDate: item.operationDate,
      order: item.order,
      client: item.order?.client ?? null,
      partner: item.partner,
      employee: null,
    };
  });
  const ledgerRows = ledger.map((item) => {
    const source = (item.payrollPaymentId
      ? "PAYROLL_PAYMENT"
      : item.source) as FinanceSource;
    const payroll =
      source === "PAYROLL_PAYMENT"
        ? payrollCategory(item.payrollPayment?.type)
        : null;
    const employee = item.employee ?? item.payrollPayment?.employee ?? null;
    return {
      id: `ledger-${item.id}`,
      sourceId: item.id,
      source,
      system: source !== "MANUAL",
      editable: source === "MANUAL" && !item.voidedAt,
      voided: Boolean(item.voidedAt),
      direction:
        item.direction === "INCOME"
          ? ("INCOME" as const)
          : ("EXPENSE" as const),
      categoryId: item.categoryId,
      categoryCode: payroll?.code ?? item.categoryRef?.code ?? item.category,
      categoryName: payroll?.name ?? item.categoryRef?.name ?? item.category,
      amount: Number(item.amount),
      method: item.method ?? item.payrollPayment?.method ?? "other",
      counterparty:
        item.counterparty ??
        item.partner?.name ??
        employee?.user?.name ??
        employee?.name ??
        item.client?.name ??
        null,
      comment: item.comment,
      author: item.author?.name ?? null,
      operationDate: item.operationDate,
      order: item.order,
      client: item.client ?? item.order?.client ?? null,
      partner: item.partner,
      employee: employee
        ? { id: employee.id, name: employee.user?.name ?? employee.name }
        : null,
    };
  });
  const operationMap = new Map(
    [...paymentRows, ...ledgerRows].map((row) => [row.id, row]),
  );
  const operations = pageRows
    .map((row) => operationMap.get(`${row.source === "PAYMENT" ? "payment" : "ledger"}-${row.id}`))
    .filter((row): row is (typeof paymentRows)[number] | (typeof ledgerRows)[number] => Boolean(row));
  const totals = aggregateRows.reduce(
    (result, item) => {
      result[item.direction === "INCOME" ? "income" : "expense"] += Number(item.amount);
      return result;
    },
    { income: 0, expense: 0 },
  );
  const grouped = (direction: FinanceDirection) => {
    const map = new Map<
      string,
      { code: string; name: string; amount: number }
    >();
    aggregateRows
      .filter((item) => item.direction === direction)
      .forEach((item) => {
        const payment = item.category_name ? null : paymentCategory(item.category_code);
        const code = payment?.code ?? item.category_code;
        const current = map.get(code) ?? {
          code,
          name: payment?.name ?? item.category_name,
          amount: 0,
        };
        current.amount += Number(item.amount);
        map.set(code, current);
      });
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  };
  const timelineMap = new Map<
    string,
    { date: string; income: number; expense: number }
  >();
  aggregateRows.forEach((item) => {
    const date = item.operation_day.toISOString().slice(0, 10);
    const current = timelineMap.get(date) ?? { date, income: 0, expense: 0 };
    current[item.direction === "INCOME" ? "income" : "expense"] += Number(item.amount);
    timelineMap.set(date, current);
  });
  const expenseGroupLabels = {
    FIXED: {
      name: "Постоянные расходы",
      description: "Аренда, интернет, уборка и другие ежемесячные обязательства",
    },
    ONE_TIME: {
      name: "Разовые расходы",
      description: "Реклама, подписки, съёмки, бензин, транспорт, налоги и офис",
    },
    PRODUCTION: {
      name: "Прямая себестоимость заказов",
      description: "Фактические расчёты с цехами и прямые затраты. Это не операционный расход; сумма уменьшает маржу соответствующего заказа автоматически",
    },
    PAYROLL: {
      name: "Зарплаты и авансы",
      description: "Фактически выплаченные зарплаты, бонусы и авансы",
    },
  } as const;
  const expenseGroupTotals = aggregateRows.reduce<Record<keyof typeof expenseGroupLabels, number>>(
    (result, item) => {
      if (item.direction === "EXPENSE" && item.expense_kind !== "INCOME")
        result[item.expense_kind] += Number(item.amount);
      return result;
    },
    { FIXED: 0, ONE_TIME: 0, PRODUCTION: 0, PAYROLL: 0 },
  );
  const expenseGroups = (Object.keys(expenseGroupLabels) as Array<keyof typeof expenseGroupLabels>).map((key) => ({
    key,
    ...expenseGroupLabels[key],
    amount: expenseGroupTotals[key],
  }));
  return {
    operations,
    pagination: {
      page,
      pageSize,
      total: Number(pageRows[0]?.total ?? 0),
      totalPages: Math.ceil(Number(pageRows[0]?.total ?? 0) / pageSize),
    },
    totals: { ...totals, cashResult: totals.income - totals.expense },
    incomeByCategory: grouped("INCOME"),
    expenseByCategory: grouped("EXPENSE"),
    expenseGroups,
    timeline: [...timelineMap.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    categories,
    options: {
      orders: orders.map((item) => ({
        id: item.id,
        name: `${item.number} — ${item.client.name}`,
      })),
      clients,
      partners,
      employees: employees.map((item) => ({
        id: item.id,
        name: item.user?.name ?? item.name,
      })),
    },
  };
}

export async function createManualFinanceEntry(
  input: ManualFinanceInput & {
    authorId: number;
    idempotencyKey: string;
    requestHash: string;
  },
) {
  return prisma.$transaction(async (tx) => {
    const replay = await tx.companyLedgerEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (replay) {
      if (!compareRequestHash(replay.requestHash, input.requestHash))
        throw new Error("IDEMPOTENCY_CONFLICT");
      return { entry: replay, created: false };
    }
    const category = await tx.financeCategory.findFirst({
      where: {
        id: input.categoryId,
        direction: input.direction,
        active: true,
      },
    });
    if (!category) throw new Error("CATEGORY_NOT_FOUND");
    const entry = await tx.companyLedgerEntry.create({
      data: {
        type: input.direction === "INCOME" ? "MANUAL_INCOME" : "MANUAL_EXPENSE",
        category: category.code,
        categoryId: category.id,
        direction: input.direction,
        source: "MANUAL",
        amount: input.amount,
        operationDate: input.operationDate,
        method: input.method,
        counterparty: input.counterparty,
        comment: input.comment,
        orderId: input.orderId,
        clientId: input.clientId,
        partnerId: input.partnerId,
        employeeId: input.employeeId,
        authorId: input.authorId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      },
    });
    await tx.financeAuditEvent.create({
      data: {
        orderId: entry.orderId,
        action: "MANUAL_FINANCE_CREATED",
        entityType: "CompanyLedgerEntry",
        entityId: entry.id,
        after: auditSnapshot(entry),
        reason: input.comment || "Ручная операция",
        authorId: input.authorId,
      },
    });
    return { entry, created: true };
  });
}

export async function updateManualFinanceEntry(
  id: number,
  input: ManualFinanceInput & { authorId: number; reason?: string },
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.companyLedgerEntry.findUnique({ where: { id } });
    if (!current) throw new Error("ENTRY_NOT_FOUND");
    if (
      current.source !== "MANUAL" ||
      current.payrollPaymentId ||
      current.payrollAccrualId
    )
      throw new Error("SYSTEM_ENTRY_IMMUTABLE");
    if (current.voidedAt) throw new Error("ENTRY_VOIDED");
    const category = await tx.financeCategory.findFirst({
      where: {
        id: input.categoryId,
        direction: input.direction,
        active: true,
      },
    });
    if (!category) throw new Error("CATEGORY_NOT_FOUND");
    const updated = await tx.companyLedgerEntry.update({
      where: { id },
      data: {
        type: input.direction === "INCOME" ? "MANUAL_INCOME" : "MANUAL_EXPENSE",
        category: category.code,
        categoryId: category.id,
        direction: input.direction,
        amount: input.amount,
        operationDate: input.operationDate,
        method: input.method,
        counterparty: input.counterparty,
        comment: input.comment,
        orderId: input.orderId,
        clientId: input.clientId,
        partnerId: input.partnerId,
        employeeId: input.employeeId,
      },
    });
    await tx.financeAuditEvent.create({
      data: {
        orderId: updated.orderId,
        action: "MANUAL_FINANCE_UPDATED",
        entityType: "CompanyLedgerEntry",
        entityId: updated.id,
        before: auditSnapshot(current),
        after: auditSnapshot(updated),
        reason:
          input.reason?.trim() || "Редактирование ручной операции",
        authorId: input.authorId,
      },
    });
    return updated;
  });
}

export async function voidManualFinanceEntry(
  id: number,
  reason: string,
  authorId: number,
) {
  if (!reason.trim()) throw new Error("REASON_REQUIRED");
  return prisma.$transaction(async (tx) => {
    const current = await tx.companyLedgerEntry.findUnique({ where: { id } });
    if (!current) throw new Error("ENTRY_NOT_FOUND");
    if (
      current.source !== "MANUAL" ||
      current.payrollPaymentId ||
      current.payrollAccrualId
    )
      throw new Error("SYSTEM_ENTRY_IMMUTABLE");
    if (current.voidedAt) return current;
    const updated = await tx.companyLedgerEntry.update({
      where: { id },
      data: { voidedAt: new Date(), voidReason: reason.trim() },
    });
    await tx.financeAuditEvent.create({
      data: {
        orderId: updated.orderId,
        action: "MANUAL_FINANCE_VOIDED",
        entityType: "CompanyLedgerEntry",
        entityId: updated.id,
        before: auditSnapshot(current),
        after: { voidedAt: updated.voidedAt?.toISOString() },
        reason: reason.trim(),
        authorId,
      },
    });
    return updated;
  });
}

export async function createFinanceCategory(
  name: string,
  direction: FinanceDirection,
) {
  const clean = name.trim().slice(0, 100);
  if (!clean) throw new Error("CATEGORY_NAME_REQUIRED");
  const duplicate = await prisma.financeCategory.findFirst({
    where: { direction, name: { equals: clean, mode: "insensitive" } },
  });
  if (duplicate) throw new Error("CATEGORY_EXISTS");
  return prisma.financeCategory.create({
    data: {
      code: `CUSTOM_${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`,
      name: clean,
      direction,
    },
  });
}

export async function updateFinanceCategory(
  id: number,
  input: { name?: string; active?: boolean },
) {
  const current = await prisma.financeCategory.findUnique({ where: { id } });
  if (!current) throw new Error("CATEGORY_NOT_FOUND");
  if (current.system) throw new Error("SYSTEM_CATEGORY_IMMUTABLE");
  const name = input.name === undefined ? undefined : input.name.trim().slice(0, 100);
  if (name === "") throw new Error("CATEGORY_NAME_REQUIRED");
  if (
    name &&
    (await prisma.financeCategory.findFirst({
      where: {
        direction: current.direction,
        name: { equals: name, mode: "insensitive" },
        id: { not: id },
      },
    }))
  )
    throw new Error("CATEGORY_EXISTS");
  return prisma.financeCategory.update({
    where: { id },
    data: {
      ...(name ? { name } : {}),
      ...(input.active === undefined ? {} : { active: input.active }),
    },
  });
}
