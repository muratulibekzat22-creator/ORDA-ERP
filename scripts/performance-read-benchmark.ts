import "./require-test-database";

import { Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { listCalendarTasks } from "@/lib/services/calendar.service";
import { getDashboardSummary } from "@/lib/services/dashboard.service";
import { getDocuments } from "@/lib/services/document.service";
import { getFinanceJournal } from "@/lib/services/finance-journal.service";
import { measurementWorkspace } from "@/lib/services/measurement.service";
import { getOrders } from "@/lib/services/order.service";
import { getProductions } from "@/lib/services/production.service";
import { getReportsReadModel } from "@/lib/services/report.service";

type StatsRow = {
  calls: bigint | number;
  rows: bigint | number;
  total_exec_ms: number;
  max_exec_ms: number;
};

type TopQueryRow = {
  calls: bigint | number;
  rows: bigint | number;
  total_exec_ms: number;
  max_exec_ms: number;
  query: string;
};

function jsonBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value));
}

async function resetQueryStats() {
  await prisma.$queryRawUnsafe("SELECT pg_stat_statements_reset()");
}

async function queryStats() {
  const [summary] = await prisma.$queryRaw<StatsRow[]>`
    SELECT
      COALESCE(SUM(calls), 0)::bigint AS calls,
      COALESCE(SUM(rows), 0)::bigint AS rows,
      COALESCE(SUM(total_exec_time), 0)::double precision AS total_exec_ms,
      COALESCE(MAX(max_exec_time), 0)::double precision AS max_exec_ms
    FROM pg_stat_statements
    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND query NOT ILIKE '%pg_stat_statements%'
  `;
  const top = await prisma.$queryRaw<TopQueryRow[]>`
    SELECT
      calls::bigint,
      rows::bigint,
      total_exec_time::double precision AS total_exec_ms,
      max_exec_time::double precision AS max_exec_ms,
      LEFT(REGEXP_REPLACE(query, '\\s+', ' ', 'g'), 280) AS query
    FROM pg_stat_statements
    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND query NOT ILIKE '%pg_stat_statements%'
    ORDER BY total_exec_time DESC
    LIMIT 3
  `;
  return {
    calls: Number(summary?.calls ?? 0),
    rows: Number(summary?.rows ?? 0),
    totalExecMs: Number(summary?.total_exec_ms ?? 0),
    maxExecMs: Number(summary?.max_exec_ms ?? 0),
    topQueries: top.map((row) => ({
      calls: Number(row.calls),
      rows: Number(row.rows),
      totalExecMs: Math.round(row.total_exec_ms * 100) / 100,
      maxExecMs: Math.round(row.max_exec_ms * 100) / 100,
      query: row.query,
    })),
  };
}

async function measure(label: string, operation: () => Promise<unknown>) {
  await operation();
  await resetQueryStats();
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  const result = await operation();
  const durationMs = performance.now() - start;
  const heapAfter = process.memoryUsage().heapUsed;
  const stats = await queryStats();
  return {
    label,
    durationMs: Math.round(durationMs * 100) / 100,
    payloadBytes: jsonBytes(result),
    rows:
      Array.isArray(result)
        ? result.length
        : result && typeof result === "object" && "operations" in result
          ? (result as { operations?: unknown[] }).operations?.length ?? null
          : null,
    heapDeltaBytes: heapAfter - heapBefore,
    database: stats,
  };
}

async function main() {
  const [director, manager, measurer] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email: "perf-audit-20260810-director@example.test" } }),
    prisma.user.findUniqueOrThrow({ where: { email: "perf-audit-20260810-manager@example.test" } }),
    prisma.user.findUniqueOrThrow({ where: { email: "perf-audit-20260810-measurer@example.test" } }),
  ]);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const results = [];

  results.push(
    await measure("clients-page-1", async () => {
      const [data, total] = await Promise.all([
        prisma.client.findMany({
          where: { active: true, deletedAt: null },
          orderBy: { updatedAt: "desc" },
          take: 20,
          select: { id: true, name: true, phone: true, city: true, stage: true, managerUserId: true, updatedAt: true },
        }),
        prisma.client.count({ where: { active: true, deletedAt: null } }),
      ]);
      return { data, total };
    }),
  );
  results.push(await measure("orders-all", () => getOrders({ deletedAt: null })));
  results.push(
    await measure("measurements-workspace", () =>
      measurementWorkspace({ userId: director.id, role: Role.DIRECTOR, name: director.name }),
    ),
  );
  results.push(
    await measure("calendar-month", () =>
      listCalendarTasks(
        { userId: director.id, role: Role.DIRECTOR, name: director.name },
        { from: monthStart, to: monthEnd },
      ),
    ),
  );
  results.push(await measure("finance-all", () => getFinanceJournal({ period: "all" })));
  results.push(
    await measure("documents-all", () =>
      getDocuments({ userId: director.id, role: Role.DIRECTOR, name: director.name }),
    ),
  );
  results.push(
    await measure("reports-month", () =>
      getReportsReadModel(new URLSearchParams({ period: "month" }), {
        id: director.id,
        role: Role.DIRECTOR,
      }),
    ),
  );
  results.push(
    await measure("dashboard-director-month", () =>
      getDashboardSummary({ role: Role.DIRECTOR, userId: director.id, period: "month" }),
    ),
  );
  results.push(
    await measure("dashboard-manager-month", () =>
      getDashboardSummary({ role: Role.MANAGER, userId: manager.id, period: "month" }),
    ),
  );
  results.push(
    await measure("dashboard-accountant-month", () =>
      getDashboardSummary({ role: Role.ACCOUNTANT, userId: director.id, period: "month" }),
    ),
  );
  results.push(
    await measure("dashboard-production", () =>
      getDashboardSummary({ role: Role.PRODUCTION, userId: director.id, period: "month" }),
    ),
  );
  results.push(
    await measure("production-all", () =>
      getProductions({ role: Role.DIRECTOR, userId: director.id, name: director.name }),
    ),
  );
  results.push(
    await measure("measurer-workspace", () =>
      measurementWorkspace({ userId: measurer.id, role: Role.MEASURER, name: measurer.name }),
    ),
  );

  if (process.argv.includes("--assert")) {
    const byLabel = new Map(results.map((result) => [result.label, result]));
    const assertBudget = (
      label: string,
      budget: { rows?: number; payloadBytes: number; queries: number },
    ) => {
      const result = byLabel.get(label);
      if (!result) throw new Error(`Missing performance result: ${label}`);
      if (budget.rows !== undefined && result.rows !== null && result.rows > budget.rows)
        throw new Error(`${label} returned ${result.rows} rows (budget ${budget.rows})`);
      if (result.payloadBytes > budget.payloadBytes)
        throw new Error(`${label} payload ${result.payloadBytes} bytes (budget ${budget.payloadBytes})`);
      if (result.database.calls > budget.queries)
        throw new Error(`${label} used ${result.database.calls} queries (budget ${budget.queries})`);
    };
    assertBudget("orders-all", { rows: 100, payloadBytes: 250_000, queries: 12 });
    assertBudget("measurements-workspace", { payloadBytes: 750_000, queries: 35 });
    assertBudget("calendar-month", { rows: 500, payloadBytes: 750_000, queries: 10 });
    assertBudget("finance-all", { rows: 50, payloadBytes: 250_000, queries: 30 });
    assertBudget("documents-all", { rows: 100, payloadBytes: 150_000, queries: 20 });
    assertBudget("reports-month", { payloadBytes: 20_000, queries: 25 });
    assertBudget("dashboard-director-month", { payloadBytes: 20_000, queries: 45 });
    assertBudget("dashboard-manager-month", { payloadBytes: 20_000, queries: 35 });
    assertBudget("dashboard-accountant-month", { payloadBytes: 30_000, queries: 15 });
    assertBudget("dashboard-production", { payloadBytes: 100_000, queries: 10 });
    assertBudget("production-all", { rows: 100, payloadBytes: 150_000, queries: 10 });

    const [orderPageOne, orderPageTwo, documentPageOne, documentPageTwo, productionPageOne, productionPageTwo, financePageOne, financePageTwo] =
      await Promise.all([
        getOrders({ deletedAt: null }, { take: 100 }),
        getOrders({ deletedAt: null }, { skip: 100, take: 100 }),
        getDocuments({ userId: director.id, role: Role.DIRECTOR, name: director.name }, { take: 100 }),
        getDocuments({ userId: director.id, role: Role.DIRECTOR, name: director.name }, { skip: 100, take: 100 }),
        getProductions({ role: Role.DIRECTOR, userId: director.id, name: director.name }, { take: 100 }),
        getProductions({ role: Role.DIRECTOR, userId: director.id, name: director.name }, { skip: 100, take: 100 }),
        getFinanceJournal({ period: "all", page: 1, pageSize: 50 }),
        getFinanceJournal({ period: "all", page: 2, pageSize: 50 }),
      ]);
    const rowId = (row: unknown) => {
      if (!row || typeof row !== "object" || !("id" in row))
        throw new Error("Paginated result is missing an id");
      return String((row as { id: unknown }).id);
    };
    const assertNoOverlap = (label: string, first: unknown[], second: unknown[]) => {
      const ids = new Set(first.map(rowId));
      if (second.some((row) => ids.has(rowId(row))))
        throw new Error(`${label} pagination returned duplicate rows`);
    };
    assertNoOverlap("orders", orderPageOne, orderPageTwo);
    assertNoOverlap("documents", documentPageOne, documentPageTwo);
    assertNoOverlap("production", productionPageOne, productionPageTwo);
    assertNoOverlap("finance", financePageOne.operations, financePageTwo.operations);
  }

  console.log(
    JSON.stringify(
      {
        label: process.argv[2] ?? "unlabeled",
        dataset: {
          clients: 5_000,
          orders: 10_000,
          measurements: 10_000,
          calendarTasks: 30_000,
          financeOperations: 30_000,
          documents: 5_000,
          payrollHistory: 2_200,
          productionRows: 10_000,
        },
        results,
      },
      (_key, value) => (typeof value === "bigint" ? Number(value) : value),
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
