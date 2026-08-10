import "./require-test-database";

import { CalendarTaskStatus, CalendarTaskType, MeasurementStatus, Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { listCalendarTasks } from "@/lib/services/calendar.service";
import { getFinanceJournal } from "@/lib/services/finance-journal.service";
import { measurementWorkspace } from "@/lib/services/measurement.service";
import { searchOrderOptions } from "@/lib/services/order.service";
import { getProductionCounters, getProductions } from "@/lib/services/production.service";

const PREFIX = "PERF-AUDIT-20260810";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function bytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value));
}

async function timed<T>(label: string, operation: () => Promise<T>) {
  const started = performance.now();
  const value = await operation();
  const result = { label, durationMs: Math.round((performance.now() - started) * 100) / 100, payloadBytes: bytes(value) };
  console.log(JSON.stringify(result));
  return { value, result };
}

async function main() {
  const [director, manager, measurer] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email: `${PREFIX.toLowerCase()}-director@example.test` } }),
    prisma.user.findUniqueOrThrow({ where: { email: `${PREFIX.toLowerCase()}-manager@example.test` } }),
    prisma.user.findUniqueOrThrow({ where: { email: `${PREFIX.toLowerCase()}-measurer@example.test` } }),
  ]);
  const directorActor = { userId: director.id, role: Role.DIRECTOR, name: director.name };
  const managerActor = { userId: manager.id, role: Role.MANAGER, name: manager.name };
  const measurerActor = { userId: measurer.id, role: Role.MEASURER, name: measurer.name };
  const measurements = await prisma.measurement.count({ where: { measurer: measurer.name } });
  const calendarTasks = await prisma.calendarTask.count({ where: { title: { startsWith: PREFIX } } });
  const financeOperations = (await prisma.payment.count({ where: { comment: { startsWith: PREFIX } } })) +
    (await prisma.companyLedgerEntry.count({ where: { comment: { startsWith: PREFIX } } }));
  const productions = await prisma.production.count({ where: { master: `${PREFIX} Master` } });
  const orders = await prisma.order.count({ where: { number: { startsWith: `${PREFIX}-ORD-` } } });
  check(measurements >= 10_000 && calendarTasks >= 30_000 && financeOperations >= 30_000 && productions >= 10_000 && orders >= 10_000, "Phase 2 synthetic dataset is incomplete");

  const measurementIds = new Set<number>();
  let measurementCursor: string | undefined;
  let measurementPages = 0;
  const measurementRun = await timed("measurements-cursor-all", async () => {
    do {
      const page = await measurementWorkspace(directorActor, { filter: "all", cursor: measurementCursor, limit: 100, sort: "asc" });
      check(page.measurements.length <= 100, "Measurement page exceeded limit");
      for (const row of page.measurements) {
        check(!measurementIds.has(row.id), `Duplicate measurement ${row.id}`);
        measurementIds.add(row.id);
      }
      measurementCursor = page.pagination.nextCursor ?? undefined;
      measurementPages += 1;
      if (measurementPages > 110) throw new Error("Measurement cursor did not terminate");
    } while (measurementCursor);
    return { pages: measurementPages, rows: measurementIds.size };
  });
  check(measurementIds.size === measurements, `Measurement cursor missed rows: ${measurementIds.size}/${measurements}`);
  for (const filter of ["today", "completed", "cancelled"] as const) {
    const page = await measurementWorkspace(directorActor, { filter, limit: 30 });
    check(page.measurements.length <= 30, `${filter} measurement page exceeded limit`);
    if (filter === "completed") check(page.measurements.every((row) => ([MeasurementStatus.COMPLETED, MeasurementStatus.HANDED_TO_MANAGER] as MeasurementStatus[]).includes(row.status)), "Completed filter leaked statuses");
    if (filter === "cancelled") check(page.measurements.every((row) => row.status === MeasurementStatus.CANCELLED), "Cancelled filter leaked statuses");
  }
  const measurementClientSearch = await measurementWorkspace(directorActor, { filter: "all", search: `${PREFIX} Client 04999`, limit: 30 });
  const measurementPhoneSearch = await measurementWorkspace(directorActor, { filter: "all", search: "+77000004999", limit: 30 });
  check(measurementClientSearch.measurements.length > 0 && measurementPhoneSearch.measurements.length > 0, "Global measurement search failed");
  const managerSearch = await measurementWorkspace(managerActor, { filter: "all", search: `${PREFIX} Client`, limit: 10 });
  const measurerSearch = await measurementWorkspace(measurerActor, { filter: "all", search: `${PREFIX} Client`, limit: 10 });
  check(managerSearch.measurements.every((row) => row.client.managerUserId === manager.id), "Manager measurement scope leaked");
  check(measurerSearch.measurements.every((row) => row.measurerUserId === measurer.id), "Measurer scope leaked");

  const now = new Date();
  const monthFrom = new Date(now); monthFrom.setDate(1); monthFrom.setHours(0, 0, 0, 0);
  const monthTo = new Date(monthFrom); monthTo.setMonth(monthTo.getMonth() + 1);
  const calendarIds = new Set<number>();
  let calendarCursor: string | undefined;
  let calendarPages = 0;
  const calendarRun = await timed("calendar-month-cursor", async () => {
    do {
      const page = await listCalendarTasks(directorActor, { from: monthFrom, to: monthTo, cursor: calendarCursor, limit: 200 });
      check(page.tasks.length <= 200, "Calendar page exceeded limit");
      for (const task of page.tasks) {
        check(!calendarIds.has(task.id), `Duplicate calendar task ${task.id}`);
        calendarIds.add(task.id);
      }
      calendarCursor = page.pagination.nextCursor ?? undefined;
      calendarPages += 1;
      if (calendarPages > 30) throw new Error("Calendar cursor did not terminate");
    } while (calendarCursor);
    return { pages: calendarPages, rows: calendarIds.size };
  });
  const day = await listCalendarTasks(directorActor, { from: new Date(now.getTime() - 86_400_000), to: now, limit: 200 });
  const week = await listCalendarTasks(directorActor, { from: new Date(now.getTime() - 7 * 86_400_000), to: now, limit: 200 });
  const filteredCalendar = await listCalendarTasks(directorActor, { from: monthFrom, to: monthTo, assigneeId: measurer.id, assigneeRole: Role.MEASURER, status: CalendarTaskStatus.PLANNED, type: CalendarTaskType.MEASUREMENT, limit: 200 });
  check(day.tasks.length <= 200 && week.tasks.length <= 200 && filteredCalendar.tasks.every((task) => task.assigneeId === measurer.id && task.type === CalendarTaskType.MEASUREMENT && task.status === CalendarTaskStatus.PLANNED), "Calendar backend filters failed");

  const financeResults = [];
  for (const search of ["PHASE2-DEEP-PAYMENT-COMMENT", "PHASE2-DEEP-LEDGER-COMMENT", `${PREFIX} Partner`, `${PREFIX} Director`, `${PREFIX}-ORD-00450`, "Synthetic category"]) {
    const result = await timed(`finance-search:${search}`, () => getFinanceJournal({ period: "all", search, page: 1, pageSize: 50 }));
    check(result.value.operations.length > 0, `Finance global search failed for ${search}`);
    financeResults.push(result.result);
  }

  const deepProduction = await timed("production-deep-search", () => getProductions(directorActor, { take: 50, filters: { query: `${PREFIX}-ORD-09000`, stage: "Покраска" } }));
  check(deepProduction.value.some((row) => row.order.number === `${PREFIX}-ORD-09000`), "Production backend search did not find a deep row");
  const productionCounters = await getProductionCounters(directorActor, { stage: "Покраска" });
  check(productionCounters.total === 2_500 && productionCounters.byStage["Покраска"] === 2_500, "Production backend counters are page-bound or incorrect");

  const order450 = `${PREFIX}-ORD-00450`;
  const [directorOrders, managerOrders, measurerOrders] = await Promise.all([
    searchOrderOptions(directorActor, order450, 20),
    searchOrderOptions(managerActor, order450, 20),
    searchOrderOptions(measurerActor, order450, 20),
  ]);
  check(directorOrders.some((row) => row.number === order450), "Order #450 missing from server search/Documents selector");
  check(managerOrders.some((row) => row.number === order450), "Order #450 missing from manager server search");
  check(measurerOrders.every((row) => row.number === order450), "Order search scope leaked for measurer");

  console.log(JSON.stringify({
    dataset: { measurements, calendarTasks, financeOperations, productions, orders },
    measurements: measurementRun.result,
    calendar: calendarRun.result,
    finance: financeResults,
    production: { ...deepProduction.result, counters: productionCounters },
    order450: { director: directorOrders.length, manager: managerOrders.length, measurer: measurerOrders.length },
    status: "PASS",
  }, null, 2));
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
