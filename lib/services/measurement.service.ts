import {
  BonusPaymentMode,
  CalendarTaskPriority,
  CalendarTaskStatus,
  CalendarTaskType,
  MeasurementPhotoType,
  MeasurementStatus,
  PayrollAccrualType,
  PayrollDirection,
  Prisma,
  Role,
  LeadNextActionType,
  LeadLostReason,
  LeadSource,
  LeadStage,
  MeasurementClientOutcome,
} from "@prisma/client";
import { createRequestHash } from "@/lib/idempotency";
import { BUSINESS_TIME_ZONE } from "@/lib/calendar-time";
import {
  decodeDateIdCursor,
  encodeDateIdCursor,
} from "@/lib/pagination/date-id-cursor";
import { prisma } from "@/lib/prisma";
import { hasTrainingClearance } from "@/lib/services/training.service";

export type MeasurementActor = { userId: number; role: Role; name: string };
export class MeasurementError extends Error {}
const EDITABLE_STATUSES: MeasurementStatus[] = [
  MeasurementStatus.ASSIGNED,
  MeasurementStatus.IN_PROGRESS,
];
const COMPLETED_STATUSES: MeasurementStatus[] = [
  MeasurementStatus.COMPLETED,
  MeasurementStatus.HANDED_TO_MANAGER,
];

export type MeasurementDraft = {
  stepsCount: number;
  sameSize: boolean;
  stepLength?: number | null;
  stepWidth?: number | null;
  stepHeight?: number | null;
  individualSteps?: Array<{
    length: number | null;
    width: number | null;
    height?: number | null;
  }>;
  riserHeight?: number | null;
  winderCount: number;
  winders?: Array<{ length?: number; width?: number; comment?: string }>;
  platformsCount: number;
  platforms?: Array<{ length: number | null; width: number | null }>;
  railingLength: number;
  railingComment?: string | null;
  objectNotes?: string | null;
  comment?: string | null;
};

export type MeasurementOutcomeInput = {
  clientOutcome: MeasurementClientOutcome;
  refusalReason?: LeadLostReason;
  outcomeComment?: string;
};

export type ScheduleMeasurementInput = {
  clientId: number;
  orderId?: number;
  measurerUserId: number;
  visitDate: Date;
  city?: string;
  address?: string;
  mapLink?: string;
  comment?: string;
};

export type SelfScheduleMeasurementInput = {
  clientName?: string;
  phone: string;
  city: string;
  visitDate: Date;
  address: string;
  mapLink?: string;
  comment?: string;
};

export async function selfScheduleMeasurement(actor: MeasurementActor, input: SelfScheduleMeasurementInput) {
  if (actor.role !== Role.MEASURER) throw new MeasurementError("FORBIDDEN");
  const phone = input.phone.trim(), city = trim(input.city, 200), address = trim(input.address, 1000);
  if (!phone || !city || !address || Number.isNaN(input.visitDate.getTime())) throw new MeasurementError("INVALID_INPUT");
  return prisma.$transaction(async (tx) => {
    const measurer = await tx.user.findUnique({ where: { id: actor.userId }, select: { id: true, name: true, role: true, active: true } });
    if (!measurer?.active || measurer.role !== Role.MEASURER) throw new MeasurementError("FORBIDDEN");
    let client = await tx.client.findFirst({
      where: {
        active: true,
        deletedAt: null,
        OR: [{ phone }, { whatsapp: phone }],
      },
    });
    const existingClient = Boolean(client);
    if (!client) client = await tx.client.create({ data: {
      name: trim(input.clientName, 200) ?? "", phone, whatsapp: phone, city, address,
      manager: "Менеджер не назначен", amount: "0", status: LeadStage.NEW, stage: LeadStage.NEW,
      source: "MEASURER_SELF_CREATED", sourceCode: LeadSource.OTHER, comment: trim(input.comment, 2000) ?? "",
    } });
    const mapLink = trim(input.mapLink, 2000), note = trim(input.comment, 2000);
    const task = await tx.calendarTask.create({ data: {
      title: `Замер: ${client.name || client.phone}`, description: [city, address, mapLink, note].filter(Boolean).join(" · "),
      type: CalendarTaskType.MEASUREMENT, dueAt: input.visitDate, priority: CalendarTaskPriority.IMPORTANT,
      assigneeId: measurer.id, creatorId: measurer.id, clientId: client.id,
    } });
    await tx.calendarTaskAudit.create({ data: { taskId: task.id, action: "CREATED_BY_MEASURER", actorId: measurer.id, after: { dueAt: input.visitDate, assigneeId: measurer.id, clientId: client.id } } });
    const measurement = await tx.measurement.create({ data: {
      clientId: client.id, calendarTaskId: task.id, measurer: measurer.name, measurerUserId: measurer.id,
      visitDate: input.visitDate, city, address, mapLink, managerComment: note,
    }, include: measurementInclude });
    await tx.measurementAudit.create({ data: { measurementId: measurement.id, action: "SELF_CREATED", actorId: measurer.id, after: { clientId: client.id, existingClient, visitDate: input.visitDate } } });
    if (!client.managerUserId) await tx.leadNextAction.create({ data: {
      clientId: client.id, nextActionType: LeadNextActionType.OTHER, nextActionAt: new Date(),
      nextActionComment: "Новый замер от замерщика — назначить менеджера", createdByUserId: measurer.id,
    } });
    return { measurement, existingClient };
  });
}

const measurementInclude = {
  measurerUser: { select: { id: true, name: true } },
  client: {
    select: {
      id: true,
      name: true,
      phone: true,
      whatsapp: true,
      city: true,
      address: true,
      manager: true,
      managerUserId: true,
      managerUser: { select: { id: true, name: true, phone: true } },
    },
  },
  order: { select: { id: true, number: true } },
  attachments: {
    select: {
      id: true,
      type: true,
      fileName: true,
      contentType: true,
      size: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" as const },
  },
  auditEvents: {
    select: {
      id: true,
      action: true,
      comment: true,
      before: true,
      after: true,
      createdAt: true,
      actor: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" as const },
    take: 30,
  },
} satisfies Prisma.MeasurementInclude;

type MeasurementRow = Prisma.MeasurementGetPayload<{
  include: typeof measurementInclude;
}>;

export type MeasurementWorkspaceFilter =
  | "today"
  | "upcoming"
  | "needs-closing"
  | "completed"
  | "cancelled"
  | "all";

export type MeasurementWorkspaceFilters = {
  filter?: MeasurementWorkspaceFilter;
  measurerUserId?: number;
  managerUserId?: number;
  from?: Date;
  to?: Date;
  search?: string;
  cursor?: string;
  limit?: number;
  sort?: "asc" | "desc";
};

function jsonObject(value: Prisma.JsonValue | null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Prisma.JsonObject)
    : null;
}

function jsonString(value: Prisma.JsonValue | undefined) {
  return typeof value === "string" ? value : null;
}

export function measurementOperationalView(
  measurement: MeasurementRow,
  now = new Date(),
) {
  const active = EDITABLE_STATUSES.includes(measurement.status);
  const overdueMs = active
    ? Math.max(0, now.getTime() - measurement.visitDate.getTime())
    : 0;
  const reschedule = measurement.auditEvents.find((event) =>
    ["RESCHEDULED", "REASSIGNED"].includes(event.action),
  );
  const cancellation = measurement.auditEvents.find((event) =>
    ["MEASUREMENT_CANCELLED", "CANCELLED"].includes(event.action),
  );
  const rescheduleBefore = jsonObject(reschedule?.before ?? null);
  const rescheduleAfter = jsonObject(reschedule?.after ?? null);
  const cancellationAfter = jsonObject(cancellation?.after ?? null);

  return {
    ...measurement,
    operational: {
      needsClosing: overdueMs > 0,
      overdueMs,
    },
    latestReschedule: reschedule
      ? {
          previousVisitDate: jsonString(rescheduleBefore?.visitDate),
          visitDate:
            jsonString(rescheduleAfter?.visitDate) ??
            measurement.visitDate.toISOString(),
          comment:
            jsonString(rescheduleAfter?.comment) ?? reschedule.comment ?? null,
          changedAt: reschedule.createdAt,
          changedBy: reschedule.actor,
          reassigned: reschedule.action === "REASSIGNED",
        }
      : null,
    cancellation: cancellation
      ? {
          reason: jsonString(cancellationAfter?.reason),
          comment:
            jsonString(cancellationAfter?.comment) ??
            cancellation.comment ??
            null,
          cancelledAt: cancellation.createdAt,
          cancelledBy: cancellation.actor,
        }
      : null,
  };
}

export function measurementScope(
  actor: MeasurementActor,
): Prisma.MeasurementWhereInput {
  if (actor.role === Role.DIRECTOR) return {};
  if (actor.role === Role.MEASURER) return { measurerUserId: actor.userId };
  if (actor.role === Role.MANAGER)
    return {
      client: {
        OR: [
          { managerUserId: actor.userId },
          { managerUserId: null, manager: actor.name },
        ],
      },
    };
  return { id: -1 };
}

function canManage(
  actor: MeasurementActor,
  measurement: { client: { managerUserId: number | null; manager?: string } },
) {
  return (
    actor.role === Role.DIRECTOR ||
    (actor.role === Role.MANAGER &&
      (measurement.client.managerUserId === actor.userId ||
        (!measurement.client.managerUserId &&
          measurement.client.manager === actor.name)))
  );
}

function dateKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function dayBounds(value = new Date()) {
  const start = new Date(`${dateKey(value)}T00:00:00+05:00`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

function monthBounds(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(value);
  const year = Number(parts.find((item) => item.type === "year")?.value);
  const month = Number(parts.find((item) => item.type === "month")?.value);
  const start = new Date(
    `${year}-${String(month).padStart(2, "0")}-01T00:00:00+05:00`,
  );
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    year,
    month,
    start,
    end: new Date(
      `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+05:00`,
    ),
  };
}

function trim(value: string | undefined, max = 4000) {
  return value?.trim().slice(0, max) || null;
}

function positive(value: unknown, optional = false) {
  if ((value === null || value === undefined || value === "") && optional)
    return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0)
    throw new MeasurementError("INVALID_DIMENSIONS");
  return number;
}

function nonNegativeInteger(value: unknown) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 500)
    throw new MeasurementError("INVALID_DIMENSIONS");
  return number;
}

export function parseMeasurementDraft(
  body: Record<string, unknown>,
  strict = true,
): MeasurementDraft {
  const stepsCount = nonNegativeInteger(body.stepsCount);
  if (strict && stepsCount < 1)
    throw new MeasurementError("INVALID_DIMENSIONS");
  const sameSize = body.sameSize !== false;
  const individualSteps = Array.isArray(body.individualSteps)
    ? body.individualSteps.map((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row))
          throw new MeasurementError("INVALID_DIMENSIONS");
        const item = row as Record<string, unknown>;
        return {
          length: positive(item.length, !strict),
          width: positive(item.width, !strict),
          ...(item.height != null && item.height !== "" ? { height: positive(item.height, true) } : {}),
        };
      })
    : undefined;
  const platformsCount = nonNegativeInteger(body.platformsCount ?? 0);
  const platforms = Array.isArray(body.platforms)
    ? body.platforms.map((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row))
          throw new MeasurementError("INVALID_DIMENSIONS");
        const item = row as Record<string, unknown>;
        return { length: positive(item.length, !strict), width: positive(item.width, !strict) };
      })
    : undefined;
  const winderCount = nonNegativeInteger(body.winderCount ?? 0);
  const winders = Array.isArray(body.winders)
    ? body.winders.map((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row))
          throw new MeasurementError("INVALID_DIMENSIONS");
        const item = row as Record<string, unknown>;
        return {
          ...(item.length ? { length: positive(item.length)! } : {}),
          ...(item.width ? { width: positive(item.width)! } : {}),
          ...(typeof item.comment === "string"
            ? { comment: item.comment.trim().slice(0, 500) }
            : {}),
        };
      })
    : undefined;
  if (strict && sameSize && (!body.stepLength || !body.stepWidth))
    throw new MeasurementError("INVALID_DIMENSIONS");
  if (strict && !sameSize && individualSteps?.length !== stepsCount)
    throw new MeasurementError("INVALID_DIMENSIONS");
  if (strict && platformsCount !== (platforms?.length ?? 0))
    throw new MeasurementError("INVALID_DIMENSIONS");
  if (strict && winders && winders.length !== winderCount)
    throw new MeasurementError("INVALID_DIMENSIONS");
  return {
    stepsCount,
    sameSize,
    stepLength: sameSize ? positive(body.stepLength, !strict) : null,
    stepWidth: sameSize ? positive(body.stepWidth, !strict) : null,
    stepHeight: sameSize ? positive(body.stepHeight, true) : null,
    individualSteps,
    riserHeight: positive(body.riserHeight, true),
    winderCount,
    winders,
    platformsCount,
    platforms,
    railingLength: positive(body.railingLength, !strict) ?? 0,
    railingComment: trim(
      typeof body.railingComment === "string" ? body.railingComment : undefined,
      1000,
    ),
    objectNotes: trim(
      typeof body.objectNotes === "string" ? body.objectNotes : undefined,
    ),
    comment: trim(typeof body.comment === "string" ? body.comment : undefined),
  };
}

function draftData(input: MeasurementDraft): Prisma.MeasurementUpdateInput {
  return {
    stepsCount: input.stepsCount,
    sameSize: input.sameSize,
    stepLength: input.stepLength,
    stepWidth: input.stepWidth,
    stepHeight: input.stepHeight,
    individualSteps: input.individualSteps as Prisma.InputJsonValue | undefined,
    riserHeight: input.riserHeight,
    winderCount: input.winderCount,
    winders: input.winders as Prisma.InputJsonValue | undefined,
    platformsCount: input.platformsCount,
    platforms: input.platforms as Prisma.InputJsonValue | undefined,
    railingLength: input.railingLength,
    railingComment: input.railingComment,
    objectNotes: input.objectNotes,
    comment: input.comment,
  };
}

export function measurementWhatsAppText(input: {
  clientName: string;
  clientPhone: string;
  visitDate: Date;
  city: string;
  address: string;
  mapLink?: string | null;
  measurerName: string;
  managerName: string;
  comment?: string | null;
}) {
  const when = new Intl.DateTimeFormat("ru-RU", {
    timeZone: BUSINESS_TIME_ZONE,
    dateStyle: "long",
    timeStyle: "short",
  }).format(input.visitDate);
  return [
    "📐 Новый замер",
    `Клиент: ${input.clientName}`,
    `Телефон: ${input.clientPhone}`,
    `Дата и время: ${when}`,
    `Город: ${input.city || "не указан"}`,
    `Адрес: ${input.address || "по ссылке"}`,
    input.mapLink ? `Локация: ${input.mapLink}` : "",
    `Замерщик: ${input.measurerName}`,
    `Менеджер: ${input.managerName}`,
    input.comment ? `Комментарий: ${input.comment}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function listMeasurements(
  actor: MeasurementActor,
  filters: { clientId?: number; orderId?: number; from?: Date; to?: Date } = {},
) {
  const where: Prisma.MeasurementWhereInput = {
    AND: [measurementScope(actor)],
  };
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.orderId) where.orderId = filters.orderId;
  if (filters.from || filters.to)
    where.visitDate = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lt: filters.to } : {}),
    };
  const measurements = await prisma.measurement.findMany({
    where,
    include: measurementInclude,
    orderBy: [{ visitDate: "asc" }, { id: "asc" }],
    take: 500,
  });
  return measurements.map((measurement) =>
    measurementOperationalView(measurement),
  );
}

export async function getMeasurement(actor: MeasurementActor, id: number) {
  const measurement = await prisma.measurement.findFirst({
    where: { id, AND: [measurementScope(actor)] },
    include: measurementInclude,
  });
  return measurement ? measurementOperationalView(measurement) : null;
}

export async function measurementWorkspace(
  actor: MeasurementActor,
  filters: MeasurementWorkspaceFilters = {},
) {
  const now = new Date();
  const today = dayBounds(now),
    month = monthBounds(now);
  const scope = measurementScope(actor);
  const sort = filters.sort === "desc" ? "desc" : "asc";
  const limit = Math.min(100, Math.max(1, Math.trunc(filters.limit ?? 30)));
  const cursor = decodeDateIdCursor(filters.cursor);
  const active: MeasurementStatus[] = [
    MeasurementStatus.ASSIGNED,
    MeasurementStatus.IN_PROGRESS,
  ];
  const workspaceWhere: Prisma.MeasurementWhereInput = { AND: [scope] };
  if (filters.filter === "today") {
    workspaceWhere.visitDate = { gte: today.start, lt: today.end };
  } else if (filters.filter === "upcoming") {
    workspaceWhere.visitDate = { gt: now };
    workspaceWhere.status = { in: active };
  } else if (filters.filter === "needs-closing") {
    workspaceWhere.visitDate = { lt: now };
    workspaceWhere.status = { in: active };
  } else if (filters.filter === "completed") {
    workspaceWhere.status = { in: COMPLETED_STATUSES };
  } else if (filters.filter === "cancelled") {
    workspaceWhere.status = MeasurementStatus.CANCELLED;
  }
  if (filters.from || filters.to) {
    workspaceWhere.visitDate = {
      ...(workspaceWhere.visitDate && typeof workspaceWhere.visitDate === "object"
        ? workspaceWhere.visitDate
        : {}),
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lt: filters.to } : {}),
    };
  } else if (!filters.filter) {
    workspaceWhere.visitDate = {
      gte: new Date(now.getTime() - 30 * 86_400_000),
    };
  }
  if (actor.role === Role.DIRECTOR && filters.measurerUserId)
    workspaceWhere.measurerUserId = filters.measurerUserId;
  if (actor.role === Role.DIRECTOR && filters.managerUserId)
    workspaceWhere.client = { managerUserId: filters.managerUserId };
  const search = filters.search?.trim().slice(0, 120);
  if (search) {
    const digits = search.replace(/\D/g, "");
    const searchOr: Prisma.ClientWhereInput[] = [
      { name: { contains: search, mode: "insensitive" } },
      { city: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
      { whatsapp: { contains: search } },
    ];
    if (digits.length >= 3 && digits !== search) {
      searchOr.push(
        { phone: { contains: digits } },
        { whatsapp: { contains: digits } },
      );
    }
    workspaceWhere.AND = [
      ...(Array.isArray(workspaceWhere.AND) ? workspaceWhere.AND : [scope]),
      { client: { OR: searchOr } },
    ];
  }
  if (filters.cursor && !cursor) throw new MeasurementError("INVALID_CURSOR");
  if (cursor) {
    const after: Prisma.MeasurementWhereInput = sort === "asc"
      ? {
          OR: [
            { visitDate: { gt: cursor.at } },
            { visitDate: cursor.at, id: { gt: cursor.id } },
          ],
        }
      : {
          OR: [
            { visitDate: { lt: cursor.at } },
            { visitDate: cursor.at, id: { lt: cursor.id } },
          ],
        };
    workspaceWhere.AND = [
      ...(Array.isArray(workspaceWhere.AND) ? workspaceWhere.AND : [scope]),
      after,
    ];
  }

  type MeasurementSummaryRow = {
    kind: "NEXT" | "OVERDUE";
    id: number;
    visit_date: Date;
    status: MeasurementStatus;
    city: string;
    address: string;
    map_link: string | null;
    client_id: number;
    client_name: string;
    client_phone: string;
    client_whatsapp: string;
    manager_id: number | null;
    manager_name: string | null;
  };
  const summaryScopeSql = actor.role === Role.DIRECTOR
    ? Prisma.sql`TRUE`
    : actor.role === Role.MEASURER
      ? Prisma.sql`m."measurerUserId" = ${actor.userId}`
      : Prisma.sql`(
          c."managerUserId" = ${actor.userId}
          OR (c."managerUserId" IS NULL AND c.manager = ${actor.name})
        )`;

  const [
    measurements,
    todayCount,
    upcoming,
    overdue,
    handed,
    monthCompleted,
    monthAssigned,
    monthOrders,
    settings,
    measurementSummaries,
  ] = await Promise.all([
    prisma.measurement.findMany({
      where: workspaceWhere,
      include: measurementInclude,
      orderBy: [{ visitDate: sort }, { id: sort }],
      take: limit + 1,
    }),
    prisma.measurement.count({
      where: {
        AND: [scope],
        visitDate: { gte: today.start, lt: today.end },
        status: { not: MeasurementStatus.CANCELLED },
      },
    }),
    prisma.measurement.count({
      where: {
        AND: [scope],
        visitDate: { gt: now },
        status: { in: active },
      },
    }),
    prisma.measurement.count({
      where: { AND: [scope], visitDate: { lt: now }, status: { in: active } },
    }),
    prisma.measurement.count({
      where: { AND: [scope], handedAt: { gte: month.start, lt: month.end } },
    }),
    prisma.measurement.count({
      where: { AND: [scope], completedAt: { gte: month.start, lt: month.end } },
    }),
    prisma.measurement.count({
      where: {
        AND: [scope],
        visitDate: { gte: month.start, lt: month.end },
        status: { not: MeasurementStatus.CANCELLED },
      },
    }),
    prisma.measurement.count({
      where: {
        AND: [scope],
        completedAt: { gte: month.start, lt: month.end },
        order: { is: { deletedAt: null, lifecycle: { not: "CANCELLED" } } },
      },
    }),
    prisma.systemSettings.findUnique({
      where: { id: 1 },
      select: { measurerOrderBonus: true },
    }),
    prisma.$queryRaw<MeasurementSummaryRow[]>(Prisma.sql`
      (
        SELECT
          'NEXT'::text AS kind,
          m.id,
          m."visitDate" AS visit_date,
          m.status,
          m.city,
          m.address,
          m."mapLink" AS map_link,
          c.id AS client_id,
          c.name AS client_name,
          c.phone AS client_phone,
          c.whatsapp AS client_whatsapp,
          manager.id AS manager_id,
          manager.name AS manager_name
        FROM "Measurement" m
        JOIN "Client" c ON c.id = m."clientId"
        LEFT JOIN "User" manager ON manager.id = c."managerUserId"
        WHERE ${summaryScopeSql}
          AND m."visitDate" >= ${now}
          AND m.status IN (
            'ASSIGNED'::"MeasurementStatus",
            'IN_PROGRESS'::"MeasurementStatus"
          )
        ORDER BY m."visitDate" ASC, m.id ASC
        LIMIT 1
      )
      UNION ALL
      (
        SELECT
          'OVERDUE'::text AS kind,
          m.id,
          m."visitDate" AS visit_date,
          m.status,
          m.city,
          m.address,
          m."mapLink" AS map_link,
          c.id AS client_id,
          c.name AS client_name,
          c.phone AS client_phone,
          c.whatsapp AS client_whatsapp,
          manager.id AS manager_id,
          manager.name AS manager_name
        FROM "Measurement" m
        JOIN "Client" c ON c.id = m."clientId"
        LEFT JOIN "User" manager ON manager.id = c."managerUserId"
        WHERE ${summaryScopeSql}
          AND m."visitDate" < ${now}
          AND m.status IN (
            'ASSIGNED'::"MeasurementStatus",
            'IN_PROGRESS'::"MeasurementStatus"
          )
        ORDER BY m."visitDate" ASC, m.id ASC
        LIMIT 1
      )
    `),
  ]);
  let monthBonus = 0,
    payable = 0;
  if (actor.role === Role.MEASURER) {
    const profile = await prisma.employeePayrollProfile.findUnique({
      where: { userId: actor.userId },
      select: { id: true },
    });
    const period = await prisma.payrollPeriod.findUnique({
      where: { year_month: { year: month.year, month: month.month } },
      select: { id: true },
    });
    if (profile && period) {
      const accruals = await prisma.payrollAccrual.findMany({
        where: { employeeId: profile.id, periodId: period.id },
        select: { type: true, direction: true, amount: true },
      });
      const payments = await prisma.payrollPayment.findMany({
        where: { employeeId: profile.id, periodId: period.id },
        select: { type: true, amount: true },
      });
      monthBonus = accruals
        .filter((row) => row.type === PayrollAccrualType.MEASUREMENT_BONUS)
        .reduce(
          (sum, row) =>
            sum +
            Number(row.amount) *
              (row.direction === PayrollDirection.INCREASE ? 1 : -1),
          0,
        );
      const accrued = accruals.reduce(
        (sum, row) =>
          sum +
          Number(row.amount) *
            (row.direction === PayrollDirection.INCREASE ? 1 : -1),
        0,
      );
      const paid = payments.reduce(
        (sum, row) =>
          sum + Number(row.amount) * (row.type === "EMPLOYEE_REFUND" ? -1 : 1),
        0,
      );
      payable = accrued - paid;
    }
  }
  const conversion =
    monthCompleted > 0
      ? Math.round((monthOrders / monthCompleted) * 1000) / 10
      : 0;
  const measurementSummaryView = (row: MeasurementSummaryRow | undefined) =>
    row
      ? {
          id: row.id,
          visitDate: row.visit_date,
          status: row.status,
          city: row.city,
          address: row.address,
          mapLink: row.map_link,
          client: {
            id: row.client_id,
            name: row.client_name,
            phone: row.client_phone,
            whatsapp: row.client_whatsapp,
            managerUser: row.manager_id
              ? { id: row.manager_id, name: row.manager_name ?? "" }
              : null,
          },
          operational: {
            needsClosing: row.visit_date < now,
            overdueMs: Math.max(0, now.getTime() - row.visit_date.getTime()),
          },
        }
      : null;
  const measurerStats = actor.role === Role.DIRECTOR
    ? await prisma.$queryRaw<
        Array<{
          id: number;
          name: string;
          assigned: bigint;
          completed: bigint;
          orders: bigint;
          bonus: Prisma.Decimal;
        }>
      >(Prisma.sql`
        WITH measurement_stats AS (
          SELECT
            m."measurerUserId" AS id,
            COUNT(*) FILTER (
              WHERE m."visitDate" >= ${month.start}
                AND m."visitDate" < ${month.end}
                AND m.status <> 'CANCELLED'::"MeasurementStatus"
            ) AS assigned,
            COUNT(*) FILTER (
              WHERE m."completedAt" >= ${month.start}
                AND m."completedAt" < ${month.end}
            ) AS completed,
            COUNT(*) FILTER (
              WHERE m."completedAt" >= ${month.start}
                AND m."completedAt" < ${month.end}
                AND o.id IS NOT NULL
                AND o."deletedAt" IS NULL
                AND o.lifecycle <> 'CANCELLED'::"OrderLifecycle"
            ) AS orders
          FROM "Measurement" m
          LEFT JOIN "Order" o ON o.id = m."orderId"
          WHERE m."measurerUserId" IS NOT NULL
          GROUP BY m."measurerUserId"
        ), bonus_stats AS (
          SELECT
            m."measurerUserId" AS id,
            COALESCE(SUM(
              CASE WHEN pa.direction = 'INCREASE'::"PayrollDirection"
                THEN pa.amount ELSE -pa.amount END
            ), 0) AS bonus
          FROM "PayrollAccrual" pa
          JOIN "Measurement" m ON m.id = pa."measurementId"
          WHERE pa.type = 'MEASUREMENT_BONUS'::"PayrollAccrualType"
            AND pa."createdAt" >= ${month.start}
            AND pa."createdAt" < ${month.end}
            AND m."measurerUserId" IS NOT NULL
          GROUP BY m."measurerUserId"
        )
        SELECT
          u.id,
          u.name,
          COALESCE(ms.assigned, 0)::bigint AS assigned,
          COALESCE(ms.completed, 0)::bigint AS completed,
          COALESCE(ms.orders, 0)::bigint AS orders,
          COALESCE(bs.bonus, 0) AS bonus
        FROM "User" u
        LEFT JOIN measurement_stats ms ON ms.id = u.id
        LEFT JOIN bonus_stats bs ON bs.id = u.id
        WHERE u.role = 'MEASURER'::"Role" AND u.active = true
        ORDER BY u.name ASC
      `).then((rows) => rows.map((row) => {
        const assigned = Number(row.assigned);
        const completed = Number(row.completed);
        const orders = Number(row.orders);
        return {
          id: row.id,
          name: row.name,
          assigned,
          completed,
          orders,
          conversion:
            completed > 0 ? Math.round((orders / completed) * 1000) / 10 : 0,
          bonus: Number(row.bonus),
        };
      }))
    : [];
  const hasMore = measurements.length > limit;
  const page = hasMore ? measurements.slice(0, limit) : measurements;
  const last = page.at(-1);
  return {
    measurements: page.map((measurement) =>
      measurementOperationalView(measurement, now),
    ),
    pagination: {
      limit,
      sort,
      hasMore,
      nextCursor:
        hasMore && last ? encodeDateIdCursor(last.visitDate, last.id) : null,
    },
    nextMeasurement: measurementSummaryView(
      measurementSummaries.find((row) => row.kind === "NEXT"),
    ),
    needsClosingMeasurement: measurementSummaryView(
      measurementSummaries.find((row) => row.kind === "OVERDUE"),
    ),
    measurerStats,
    kpi: {
      today: todayCount,
      upcoming,
      overdue,
      handed,
      monthAssigned,
      monthCompleted,
      monthOrders,
      conversion,
      monthBonus,
      payable,
      bonusRate: settings?.measurerOrderBonus ?? 20_000,
    },
  };
}

export async function scheduleMeasurement(
  actor: MeasurementActor,
  input: ScheduleMeasurementInput,
) {
  if (actor.role !== Role.DIRECTOR && actor.role !== Role.MANAGER)
    throw new MeasurementError("FORBIDDEN");
  if (
    !Number.isInteger(input.clientId) ||
    !Number.isInteger(input.measurerUserId) ||
    Number.isNaN(input.visitDate.getTime())
  )
    throw new MeasurementError("INVALID_INPUT");
  return prisma.$transaction(
    async (tx) => {
      // PrismaPg interactive transactions use one checked-out connection; keep
      // statements sequential so pg never receives overlapping client.query calls.
      const client = await tx.client.findUnique({
        where: { id: input.clientId },
        select: {
          id: true,
          name: true,
          phone: true,
          whatsapp: true,
          city: true,
          address: true,
          manager: true,
          managerUserId: true,
          active: true,
          deletedAt: true,
          stage: true,
          status: true,
        },
      });
      const measurer = await tx.user.findUnique({
        where: { id: input.measurerUserId },
        select: { id: true, name: true, role: true, active: true },
      });
      const order = input.orderId
        ? await tx.order.findFirst({
            where: { id: input.orderId, deletedAt: null },
            select: { id: true, clientId: true },
          })
        : null;
      if (
        !client ||
        !client.active ||
        client.deletedAt ||
        (actor.role === Role.MANAGER &&
          client.managerUserId !== actor.userId &&
          (client.managerUserId || client.manager !== actor.name))
      )
        throw new MeasurementError("CLIENT_NOT_FOUND");
      if (!client.phone.trim())
        throw new MeasurementError("CLIENT_PHONE_REQUIRED");
      if (!measurer?.active || measurer.role !== Role.MEASURER)
        throw new MeasurementError("MEASURER_NOT_FOUND");
      if (input.orderId && (!order || order.clientId !== client.id))
        throw new MeasurementError("INVALID_INPUT");
      const city = trim(input.city, 200) ?? client.city.trim();
      const address = trim(input.address, 1000) ?? client.address.trim();
      const mapLink = trim(input.mapLink, 2000);
      if (!address && !mapLink) throw new MeasurementError("LOCATION_REQUIRED");
      const task = await tx.calendarTask.create({
        data: {
          title: `Замер: ${client.name}`,
          description: [city, address, mapLink, trim(input.comment)]
            .filter(Boolean)
            .join(" · "),
          type: CalendarTaskType.MEASUREMENT,
          dueAt: input.visitDate,
          priority: CalendarTaskPriority.IMPORTANT,
          assigneeId: measurer.id,
          creatorId: actor.userId,
          clientId: client.id,
          orderId: order?.id,
        },
      });
      await tx.calendarTaskAudit.create({
        data: {
          taskId: task.id,
          action: "CREATED",
          actorId: actor.userId,
          after: {
            dueAt: input.visitDate,
            assigneeId: measurer.id,
            clientId: client.id,
          },
        },
      });
      const measurement = await tx.measurement.create({
        data: {
          clientId: client.id,
          orderId: order?.id,
          calendarTaskId: task.id,
          measurer: measurer.name,
          measurerUserId: measurer.id,
          visitDate: input.visitDate,
          city,
          address,
          mapLink,
          managerComment: trim(input.comment),
        },
      });
      await tx.measurementAudit.create({
        data: {
          measurementId: measurement.id,
          action: "SCHEDULED",
          actorId: actor.userId,
          after: {
            visitDate: input.visitDate,
            measurerUserId: measurer.id,
            city,
            address,
            mapLink,
          },
        },
      });
      await tx.leadNextAction.updateMany({
        where: { clientId: client.id, completedAt: null },
        data: {
          completedAt: new Date(),
          completedByUserId: actor.userId,
          resultComment: "Назначен замер",
        },
      });
      await tx.leadNextAction.create({
        data: {
          clientId: client.id,
          nextActionType: "MEASUREMENT",
          nextActionAt: input.visitDate,
          nextActionComment: trim(input.comment),
          createdByUserId: actor.userId,
        },
      });
      if (client.stage !== "MEASUREMENT_SCHEDULED") {
        await tx.client.update({
          where: { id: client.id },
          data: {
            stage: "MEASUREMENT_SCHEDULED",
            status: "MEASUREMENT_SCHEDULED",
            nextContactAt: input.visitDate,
          },
        });
        await tx.leadStatusHistory.create({
          data: {
            clientId: client.id,
            fromStatus: client.status,
            toStatus: "MEASUREMENT_SCHEDULED",
            fromStage: client.stage,
            toStage: "MEASUREMENT_SCHEDULED",
            authorId: actor.userId,
            authorName: actor.name,
            comment: `Замер назначен на ${input.visitDate.toISOString()}`,
          },
        });
      }
      await tx.leadActivity.create({
        data: {
          clientId: client.id,
          type: "MEASUREMENT_SCHEDULED",
          comment: `${measurer.name} · ${input.visitDate.toISOString()}`,
          authorId: actor.userId,
          authorName: actor.name,
        },
      });
      return {
        measurement,
        whatsappText: measurementWhatsAppText({
          clientName: client.name,
          clientPhone: client.whatsapp || client.phone,
          visitDate: input.visitDate,
          city,
          address,
          mapLink,
          measurerName: measurer.name,
          managerName: client.manager,
          comment: trim(input.comment),
        }),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function editableMeasurement(
  tx: Prisma.TransactionClient,
  actor: MeasurementActor,
  id: number,
) {
  const measurement = await tx.measurement.findUnique({ where: { id } });
  if (!measurement) throw new MeasurementError("NOT_FOUND");
  if (
    actor.role === Role.MEASURER &&
    measurement.measurerUserId !== actor.userId
  )
    throw new MeasurementError("NOT_FOUND");
  const client = await tx.client.findUniqueOrThrow({
    where: { id: measurement.clientId },
    select: { managerUserId: true, manager: true },
  });
  const attachments = await tx.measurementAttachment.findMany({
    where: { measurementId: id },
    select: { type: true },
  });
  return { ...measurement, client, attachments };
}

export async function startMeasurement(actor: MeasurementActor, id: number) {
  if (actor.role !== Role.MEASURER) throw new MeasurementError("FORBIDDEN");
  return prisma.$transaction(async (tx) => {
    if (!(await hasTrainingClearance(tx, actor.userId)))
      throw new MeasurementError("TRAINING_REQUIRED");
    const current = await editableMeasurement(tx, actor, id);
    if (current.status !== MeasurementStatus.ASSIGNED)
      throw new MeasurementError("INVALID_STATE");
    const now = new Date();
    const result = await tx.measurement.update({
      where: { id },
      data: { status: MeasurementStatus.IN_PROGRESS, startedAt: now },
    });
    if (current.calendarTaskId)
      await tx.calendarTask.update({
        where: { id: current.calendarTaskId },
        data: { status: CalendarTaskStatus.IN_PROGRESS },
      });
    await tx.measurementAudit.create({
      data: {
        measurementId: id,
        action: "STARTED",
        actorId: actor.userId,
        before: { status: current.status },
        after: { status: result.status },
      },
    });
    return result;
  });
}

export async function saveMeasurementDraft(
  actor: MeasurementActor,
  id: number,
  draft: MeasurementDraft,
) {
  if (actor.role !== Role.MEASURER) throw new MeasurementError("FORBIDDEN");
  return prisma.$transaction(async (tx) => {
    const current = await editableMeasurement(tx, actor, id);
    if (!EDITABLE_STATUSES.includes(current.status))
      throw new MeasurementError("IMMUTABLE_MEASUREMENT");
    const result = await tx.measurement.update({
      where: { id },
      data: {
        ...draftData(draft),
        ...(current.status === MeasurementStatus.ASSIGNED
          ? { status: MeasurementStatus.IN_PROGRESS, startedAt: new Date() }
          : {}),
      },
    });
    await tx.measurementAudit.create({
      data: {
        measurementId: id,
        action: "DRAFT_SAVED",
        actorId: actor.userId,
        after: {
          stepsCount: draft.stepsCount,
          sameSize: draft.sameSize,
          platformsCount: draft.platformsCount,
          winderCount: draft.winderCount,
          railingLength: draft.railingLength,
        },
      },
    });
    return result;
  });
}

export async function saveMeasurementComment(
  actor: MeasurementActor,
  id: number,
  comment: string,
) {
  if (actor.role !== Role.MEASURER) throw new MeasurementError("FORBIDDEN");
  return prisma.$transaction(async (tx) => {
    const current = await editableMeasurement(tx, actor, id);
    if (!EDITABLE_STATUSES.includes(current.status))
      throw new MeasurementError("IMMUTABLE_MEASUREMENT");
    const value = trim(comment);
    const result = await tx.measurement.update({
      where: { id },
      data: { comment: value },
    });
    await tx.measurementAudit.create({
      data: {
        measurementId: id,
        action: "DRAFT_SAVED",
        actorId: actor.userId,
        before: { comment: current.comment },
        after: { comment: value },
      },
    });
    return result;
  });
}

export async function completeMeasurement(
  actor: MeasurementActor,
  id: number,
  draft: MeasurementDraft,
  outcome?: MeasurementOutcomeInput,
) {
  if (actor.role !== Role.MEASURER) throw new MeasurementError("FORBIDDEN");
  return prisma.$transaction(async (tx) => {
    const current = await editableMeasurement(tx, actor, id);
    if (!EDITABLE_STATUSES.includes(current.status))
      throw new MeasurementError("IMMUTABLE_MEASUREMENT");
    if (
      !current.attachments.some(
        (photo) => photo.type === MeasurementPhotoType.SHEET,
      )
    )
      throw new MeasurementError("SHEET_PHOTO_REQUIRED");
    if (!outcome) throw new MeasurementError("CLIENT_OUTCOME_REQUIRED");
    const outcomeComment = trim(outcome?.outcomeComment, 2000);
    if (
      outcome?.clientOutcome === MeasurementClientOutcome.RETURN_TO_MANAGER &&
      !outcomeComment
    )
      throw new MeasurementError("OUTCOME_COMMENT_REQUIRED");
    if (
      outcome?.clientOutcome === MeasurementClientOutcome.REFUSED &&
      (!outcome.refusalReason ||
        (outcome.refusalReason === LeadLostReason.OTHER && !outcomeComment))
    )
      throw new MeasurementError("REFUSAL_REASON_REQUIRED");
    const now = new Date();
    const result = await tx.measurement.update({
      where: { id },
      data: {
        ...draftData(draft),
        status: MeasurementStatus.COMPLETED,
        completedAt: now,
        completedSnapshot: draft as unknown as Prisma.InputJsonValue,
        ...(outcome
          ? {
              clientOutcome: outcome.clientOutcome,
              outcomeComment,
              refusalReason:
                outcome.clientOutcome === MeasurementClientOutcome.REFUSED
                  ? outcome.refusalReason
                  : null,
              outcomeAt: now,
              ...(outcome.clientOutcome !== MeasurementClientOutcome.REFUSED
                ? { handedAt: now }
                : {}),
            }
          : {}),
      },
    });
    if (current.calendarTaskId) {
      await tx.calendarTask.update({
        where: { id: current.calendarTaskId },
        data: {
          status: CalendarTaskStatus.COMPLETED,
          completedAt: now,
          completedById: actor.userId,
        },
      });
      await tx.calendarTaskAudit.create({
        data: {
          taskId: current.calendarTaskId,
          action: "COMPLETED",
          actorId: actor.userId,
          after: { completedAt: now },
        },
      });
    }
    const client = await tx.client.findUniqueOrThrow({
      where: { id: current.clientId },
      select: {
        id: true,
        name: true,
        stage: true,
        status: true,
        managerUserId: true,
      },
    });
    await tx.leadNextAction.updateMany({
      where: {
        clientId: current.clientId,
        nextActionType: "MEASUREMENT",
        nextActionAt: current.visitDate,
        completedAt: null,
      },
      data: {
        completedAt: now,
        completedByUserId: actor.userId,
        resultComment: "Замер завершён",
      },
    });
    const refused =
      outcome?.clientOutcome === MeasurementClientOutcome.REFUSED;
    const nextStage = refused ? LeadStage.LOST : LeadStage.MEASUREMENT_COMPLETED;
    await tx.client.update({
      where: { id: current.clientId },
      data: {
        stage: nextStage,
        status: nextStage,
        nextContactAt: null,
        ...(refused
          ? {
              lostReason: outcome.refusalReason,
              lostComment: outcomeComment,
              lostAt: now,
              lostByUserId: actor.userId,
            }
          : {}),
      },
    });
    await tx.leadStatusHistory.create({
      data: {
        clientId: current.clientId,
        fromStatus: client.status,
        toStatus: nextStage,
        fromStage: client.stage,
        toStage: nextStage,
        authorId: actor.userId,
        authorName: actor.name,
        comment: refused
          ? `Замер завершён; клиент отказался: ${outcome.refusalReason}`
          : outcome?.clientOutcome === MeasurementClientOutcome.READY_TO_CONTINUE
            ? "Замер завершён — клиент готов продолжать"
            : outcome?.clientOutcome === MeasurementClientOutcome.RETURN_TO_MANAGER
              ? "Замер завершён — требуется работа менеджера"
              : "Замер завершён",
      },
    });
    await tx.leadActivity.create({
      data: {
        clientId: current.clientId,
        type: "MEASUREMENT_COMPLETED",
        comment: "Фактические размеры и лист замера сохранены",
        authorId: actor.userId,
        authorName: actor.name,
      },
    });
    await tx.measurementAudit.create({
      data: {
        measurementId: id,
        action: "COMPLETED",
        actorId: actor.userId,
        after: draft as unknown as Prisma.InputJsonValue,
      },
    });
    if (outcome) {
      let managerTaskId: number | null = null;
      if (
        outcome.clientOutcome !== MeasurementClientOutcome.REFUSED &&
        client.managerUserId
      ) {
        const ready =
          outcome.clientOutcome === MeasurementClientOutcome.READY_TO_CONTINUE;
        const task = await tx.calendarTask.create({
          data: {
            title: ready
              ? `Замер завершён — клиент готов: ${client.name}`
              : `Замер завершён — требуется работа: ${client.name}`,
            description: [
              `Замер №${id}`,
              outcomeComment,
            ]
              .filter(Boolean)
              .join(" · "),
            type: CalendarTaskType.TASK,
            dueAt: ready ? now : new Date(now.getTime() + 3_600_000),
            priority: ready
              ? CalendarTaskPriority.URGENT
              : CalendarTaskPriority.IMPORTANT,
            assigneeId: client.managerUserId,
            creatorId: actor.userId,
            clientId: client.id,
            orderId: current.orderId,
          },
        });
        managerTaskId = task.id;
        await tx.calendarTaskAudit.create({
          data: {
            taskId: task.id,
            action: "CREATED_FROM_MEASUREMENT_OUTCOME",
            actorId: actor.userId,
            after: { measurementId: id, outcome: outcome.clientOutcome },
          },
        });
      }
      if (outcome.clientOutcome !== MeasurementClientOutcome.REFUSED) {
        const ready =
          outcome.clientOutcome === MeasurementClientOutcome.READY_TO_CONTINUE;
        await tx.leadNextAction.create({
          data: {
            clientId: client.id,
            nextActionType: client.managerUserId
              ? LeadNextActionType.FOLLOW_UP
              : LeadNextActionType.OTHER,
            nextActionAt: ready ? now : new Date(now.getTime() + 3_600_000),
            nextActionComment: ready
              ? `Замер №${id}: клиент готов продолжать`
              : `Замер №${id}: требуется работа менеджера — ${outcomeComment}`,
            createdByUserId: actor.userId,
          },
        });
      }
      await tx.leadActivity.create({
        data: {
          clientId: client.id,
          type:
            outcome.clientOutcome === MeasurementClientOutcome.READY_TO_CONTINUE
              ? "MEASUREMENT_READY_TO_CONTINUE"
              : outcome.clientOutcome === MeasurementClientOutcome.RETURN_TO_MANAGER
                ? "MEASUREMENT_RETURNED_TO_MANAGER"
                : "MEASUREMENT_CLIENT_REFUSED",
          comment:
            outcome.clientOutcome === MeasurementClientOutcome.REFUSED
              ? `${outcome.refusalReason}${outcomeComment ? ` · ${outcomeComment}` : ""}`
              : outcomeComment || "Результат общения сохранён",
          authorId: actor.userId,
          authorName: actor.name,
        },
      });
      await tx.measurementAudit.create({
        data: {
          measurementId: id,
          action: "CLIENT_OUTCOME_RECORDED",
          actorId: actor.userId,
          comment: outcomeComment,
          after: {
            clientOutcome: outcome.clientOutcome,
            refusalReason: outcome.refusalReason ?? null,
            managerTaskId,
          },
        },
      });
    }
    return result;
  });
}

export async function handMeasurementToManager(
  actor: MeasurementActor,
  id: number,
) {
  if (actor.role !== Role.MEASURER && actor.role !== Role.DIRECTOR)
    throw new MeasurementError("FORBIDDEN");
  return prisma.$transaction(async (tx) => {
    const current = await editableMeasurement(tx, actor, id);
    if (current.status === MeasurementStatus.HANDED_TO_MANAGER)
      return tx.measurement.findUniqueOrThrow({ where: { id } });
    if (current.status !== MeasurementStatus.COMPLETED)
      throw new MeasurementError("INVALID_STATE");
    const client = await tx.client.findUniqueOrThrow({
      where: { id: current.clientId },
      select: { id: true, name: true, managerUserId: true },
    });
    const now = new Date(),
      dueAt = new Date(now.getTime() + 3_600_000);
    const task = client.managerUserId ? await tx.calendarTask.create({
      data: {
        title: `Обработать замер: ${client.name}`,
        description: `Замер №${id} передан менеджеру`,
        type: CalendarTaskType.TASK,
        dueAt,
        priority: CalendarTaskPriority.IMPORTANT,
        assigneeId: client.managerUserId,
        creatorId: actor.userId,
        clientId: client.id,
        orderId: current.orderId,
      },
    }) : null;
    if (task) await tx.calendarTaskAudit.create({
      data: {
        taskId: task.id,
        action: "CREATED_FROM_MEASUREMENT",
        actorId: actor.userId,
        after: { measurementId: id },
      },
    });
    if (client.managerUserId) await tx.leadNextAction.updateMany({
      where: { clientId: client.id, completedAt: null },
      data: {
        completedAt: now,
        completedByUserId: actor.userId,
        resultComment: "Замер передан менеджеру",
      },
    });
    const existingAttention = client.managerUserId ? null : await tx.leadNextAction.findFirst({ where: { clientId: client.id, completedAt: null, nextActionType: "OTHER", nextActionComment: "Новый замер от замерщика — назначить менеджера" } });
    if (!existingAttention) await tx.leadNextAction.create({
      data: {
        clientId: client.id,
        nextActionType: client.managerUserId ? "FOLLOW_UP" : "OTHER",
        nextActionAt: dueAt,
        nextActionComment: client.managerUserId ? `Обработать замер №${id}` : "Новый замер от замерщика — назначить менеджера",
        createdByUserId: actor.userId,
      },
    });
    await tx.leadActivity.create({
      data: {
        clientId: client.id,
        type: "MEASUREMENT_HANDED",
        comment: `Замер №${id} передан ответственному менеджеру`,
        authorId: actor.userId,
        authorName: actor.name,
      },
    });
    await tx.measurementAudit.create({
      data: {
        measurementId: id,
        action: "HANDED_TO_MANAGER",
        actorId: actor.userId,
        after: { managerUserId: client.managerUserId, taskId: task?.id ?? null, attentionRequired: !client.managerUserId },
      },
    });
    return tx.measurement.update({
      where: { id },
      data: { status: MeasurementStatus.HANDED_TO_MANAGER, handedAt: now },
    });
  });
}

export async function markReadyForContract(
  actor: MeasurementActor,
  id: number,
) {
  return prisma.$transaction(async (tx) => {
    const current = await editableMeasurement(tx, actor, id);
    if (!canManage(actor, current) && actor.role !== Role.MEASURER)
      throw new MeasurementError("NOT_FOUND");
    if (
      current.status !== MeasurementStatus.HANDED_TO_MANAGER &&
      !(
        current.status === MeasurementStatus.COMPLETED &&
        current.clientOutcome &&
        current.clientOutcome !== MeasurementClientOutcome.REFUSED
      )
    )
      throw new MeasurementError("INVALID_STATE");
    if (current.readyForContractAt)
      return tx.measurement.findUniqueOrThrow({ where: { id } });
    const client = await tx.client.findUniqueOrThrow({
      where: { id: current.clientId },
      select: { id: true, name: true, managerUserId: true },
    });
    const assigneeId = client.managerUserId ?? actor.userId,
      now = new Date();
    const task = await tx.calendarTask.create({
      data: {
        title: `Клиент готов к договору: ${client.name}`,
        description: `Приоритетная обработка замера №${id}. Это задача, договор автоматически не создаётся.`,
        type: CalendarTaskType.TASK,
        dueAt: now,
        priority: CalendarTaskPriority.URGENT,
        assigneeId,
        creatorId: actor.userId,
        clientId: client.id,
        orderId: current.orderId,
      },
    });
    await tx.leadNextAction.updateMany({
      where: { clientId: client.id, completedAt: null },
      data: {
        completedAt: now,
        completedByUserId: actor.userId,
        resultComment: "Клиент готов к договору",
      },
    });
    await tx.leadNextAction.create({
      data: {
        clientId: client.id,
        nextActionType: "FOLLOW_UP",
        nextActionAt: now,
        nextActionComment:
          "Клиент готов к договору — связаться в приоритетном порядке",
        createdByUserId: actor.userId,
      },
    });
    await tx.leadActivity.create({
      data: {
        clientId: client.id,
        type: "READY_FOR_CONTRACT",
        comment: "Создана приоритетная задача менеджеру; договор не создавался",
        authorId: actor.userId,
        authorName: actor.name,
      },
    });
    await tx.measurementAudit.create({
      data: {
        measurementId: id,
        action: "READY_FOR_CONTRACT",
        actorId: actor.userId,
        after: { taskId: task.id },
      },
    });
    return tx.measurement.update({
      where: { id },
      data: { readyForContractAt: now },
    });
  });
}

export async function inviteClientToOffice(
  actor: MeasurementActor,
  id: number,
  dueAt: Date,
  comment?: string,
) {
  if (Number.isNaN(dueAt.getTime()))
    throw new MeasurementError("INVALID_INPUT");
  return prisma.$transaction(async (tx) => {
    const current = await editableMeasurement(tx, actor, id);
    if (!canManage(actor, current) && actor.role !== Role.MEASURER)
      throw new MeasurementError("NOT_FOUND");
    if (
      current.status !== MeasurementStatus.HANDED_TO_MANAGER &&
      !(
        current.status === MeasurementStatus.COMPLETED &&
        current.clientOutcome &&
        current.clientOutcome !== MeasurementClientOutcome.REFUSED
      )
    )
      throw new MeasurementError("INVALID_STATE");
    const client = await tx.client.findUniqueOrThrow({
      where: { id: current.clientId },
      select: { id: true, name: true, managerUserId: true },
    });
    const assigneeId = client.managerUserId ?? actor.userId;
    const task = await tx.calendarTask.create({
      data: {
        title: `Встреча в офисе: ${client.name}`,
        description: trim(comment),
        type: CalendarTaskType.MEETING,
        dueAt,
        priority: CalendarTaskPriority.IMPORTANT,
        assigneeId,
        creatorId: actor.userId,
        clientId: client.id,
        orderId: current.orderId,
      },
    });
    await tx.leadNextAction.updateMany({
      where: { clientId: client.id, completedAt: null },
      data: {
        completedAt: new Date(),
        completedByUserId: actor.userId,
        resultComment: "Назначена встреча в офисе",
      },
    });
    await tx.leadNextAction.create({
      data: {
        clientId: client.id,
        nextActionType: "MEETING",
        nextActionAt: dueAt,
        nextActionComment: trim(comment) ?? "Встреча в офисе",
        createdByUserId: actor.userId,
      },
    });
    await tx.leadActivity.create({
      data: {
        clientId: client.id,
        type: "OFFICE_INVITATION",
        comment: `${dueAt.toISOString()}${comment ? ` · ${comment}` : ""}`,
        authorId: actor.userId,
        authorName: actor.name,
      },
    });
    await tx.measurementAudit.create({
      data: {
        measurementId: id,
        action: "OFFICE_INVITATION",
        actorId: actor.userId,
        after: { taskId: task.id, dueAt },
      },
    });
    return task;
  });
}

export async function rescheduleMeasurement(
  actor: MeasurementActor,
  id: number,
  input: {
    visitDate: Date;
    measurerUserId: number;
    city?: string;
    address?: string;
    mapLink?: string;
    comment?: string;
  },
) {
  return prisma.$transaction(async (tx) => {
    const current = await editableMeasurement(tx, actor, id);
    const ownMeasurement =
      actor.role === Role.MEASURER && current.measurerUserId === actor.userId;
    if (!canManage(actor, current) && !ownMeasurement)
      throw new MeasurementError("NOT_FOUND");
    if (!EDITABLE_STATUSES.includes(current.status))
      throw new MeasurementError("IMMUTABLE_MEASUREMENT");
    if (ownMeasurement && input.measurerUserId !== actor.userId)
      throw new MeasurementError("FORBIDDEN");
    const measurer = await tx.user.findFirst({
      where: { id: input.measurerUserId, role: Role.MEASURER, active: true },
      select: { id: true, name: true },
    });
    if (!measurer || Number.isNaN(input.visitDate.getTime()))
      throw new MeasurementError("MEASURER_NOT_FOUND");
    const city = trim(input.city, 200) ?? current.city,
      address = trim(input.address, 1000) ?? current.address,
      mapLink = trim(input.mapLink, 2000) ?? current.mapLink;
    if (!address && !mapLink) throw new MeasurementError("LOCATION_REQUIRED");
    if (current.calendarTaskId) {
      await tx.calendarTask.update({
        where: { id: current.calendarTaskId },
        data: {
          dueAt: input.visitDate,
          assigneeId: measurer.id,
          description: [city, address, mapLink, trim(input.comment)]
            .filter(Boolean)
            .join(" · "),
        },
      });
      await tx.calendarTaskAudit.create({
        data: {
          taskId: current.calendarTaskId,
          action:
            current.measurerUserId !== measurer.id
              ? "REASSIGNED"
              : "RESCHEDULED",
          actorId: actor.userId,
          before: {
            dueAt: current.visitDate,
            assigneeId: current.measurerUserId,
          },
          after: {
            dueAt: input.visitDate,
            assigneeId: measurer.id,
            comment: trim(input.comment),
          },
        },
      });
    }
    await tx.measurementAudit.create({
      data: {
        measurementId: id,
        action:
          current.measurerUserId !== measurer.id ? "REASSIGNED" : "RESCHEDULED",
        actorId: actor.userId,
        before: {
          visitDate: current.visitDate,
          measurerUserId: current.measurerUserId,
        },
        comment: trim(input.comment),
        after: {
          visitDate: input.visitDate,
          measurerUserId: measurer.id,
          comment: trim(input.comment),
        },
      },
    });
    await tx.leadNextAction.updateMany({
      where: {
        clientId: current.clientId,
        nextActionType: LeadNextActionType.MEASUREMENT,
        nextActionAt: current.visitDate,
        completedAt: null,
      },
      data: {
        nextActionAt: input.visitDate,
        nextActionComment: trim(input.comment),
      },
    });
    return tx.measurement.update({
      where: { id },
      data: {
        visitDate: input.visitDate,
        measurerUserId: measurer.id,
        measurer: measurer.name,
        city,
        address,
        mapLink,
        managerComment: trim(input.comment),
      },
    });
  });
}

export async function cancelMeasurement(
  actor: MeasurementActor,
  id: number,
  input?: string | { reason?: string; comment?: string },
) {
  return prisma.$transaction(async (tx) => {
    const current = await editableMeasurement(tx, actor, id);
    const ownMeasurement =
      actor.role === Role.MEASURER && current.measurerUserId === actor.userId;
    if (!canManage(actor, current) && !ownMeasurement)
      throw new MeasurementError("NOT_FOUND");
    if (current.status === MeasurementStatus.CANCELLED)
      return tx.measurement.findUniqueOrThrow({ where: { id } });
    if (COMPLETED_STATUSES.includes(current.status))
      throw new MeasurementError("IMMUTABLE_MEASUREMENT");
    const now = new Date();
    const reason = trim(typeof input === "string" ? undefined : input?.reason, 300);
    const comment = trim(typeof input === "string" ? input : input?.comment, 1000);
    if (!reason) throw new MeasurementError("CANCELLATION_REASON_REQUIRED");
    const cancellationComment = [reason, comment].filter(Boolean).join(" · ");
    if (current.calendarTaskId) {
      await tx.calendarTask.update({
        where: { id: current.calendarTaskId },
        data: { status: CalendarTaskStatus.CANCELLED, cancelledAt: now },
      });
      await tx.calendarTaskAudit.create({
        data: {
          taskId: current.calendarTaskId,
          action: "CANCELLED",
          actorId: actor.userId,
          after: { cancelledAt: now, reason: reason ?? null },
        },
      });
    }
    await tx.leadActivity.create({
      data: {
        clientId: current.clientId,
        type: "MEASUREMENT_CANCELLED",
        comment: cancellationComment || "Замер отменён",
        authorId: actor.userId,
        authorName: actor.name,
      },
    });
    await tx.leadNextAction.updateMany({
      where: {
        clientId: current.clientId,
        nextActionType: LeadNextActionType.MEASUREMENT,
        nextActionAt: current.visitDate,
        completedAt: null,
      },
      data: {
        completedAt: now,
        completedByUserId: actor.userId,
        resultComment: cancellationComment || "Замер отменён",
      },
    });
    await tx.measurementAudit.create({
      data: {
        measurementId: id,
        action: "MEASUREMENT_CANCELLED",
        actorId: actor.userId,
        comment: cancellationComment || null,
        before: { status: current.status },
        after: {
          status: MeasurementStatus.CANCELLED,
          reason,
          comment,
        },
      },
    });
    return tx.measurement.update({
      where: { id },
      data: { status: MeasurementStatus.CANCELLED, cancelledAt: now },
    });
  });
}

export async function ensureMeasurerBonusForOrder(
  tx: Prisma.TransactionClient,
  orderId: number,
  actor: MeasurementActor,
) {
  const order = await tx.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { id: true, clientId: true, createdAt: true, lifecycle: true },
  });
  if (!order || order.lifecycle === "CANCELLED")
    return { created: false, reason: "ORDER_NOT_ELIGIBLE" as const };
  const orderBonus = await tx.payrollAccrual.findFirst({
    where: { orderId, type: PayrollAccrualType.MEASUREMENT_BONUS },
  });
  if (orderBonus) return { created: false, accrual: orderBonus };
  const measurement = await tx.measurement.findFirst({
    where: {
      clientId: order.clientId,
      status: {
        in: [MeasurementStatus.COMPLETED, MeasurementStatus.HANDED_TO_MANAGER],
      },
      OR: [
        { clientOutcome: null },
        { clientOutcome: { not: MeasurementClientOutcome.REFUSED } },
      ],
      measurerUserId: { not: null },
      bonusAccrual: null,
    },
    orderBy: [{ handedAt: "desc" }, { id: "desc" }],
    select: { id: true, measurerUserId: true },
  });
  if (!measurement?.measurerUserId)
    return { created: false, reason: "MEASUREMENT_NOT_ELIGIBLE" as const };
  const user = await tx.user.findFirst({
    where: {
      id: measurement.measurerUserId,
      role: Role.MEASURER,
      active: true,
    },
    select: { id: true, name: true },
  });
  if (!user) return { created: false, reason: "MEASURER_NOT_ACTIVE" as const };
  const settings = await tx.systemSettings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
    select: { measurerOrderBonus: true },
  });
  if (settings.measurerOrderBonus <= 0)
    return { created: false, reason: "BONUS_DISABLED" as const };
  const profile = await tx.employeePayrollProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      hiredAt: new Date(),
      baseSalary: 0,
      defaultGuaranteedBonus: 0,
      comment: "Профиль создан автоматически для бонуса за замер",
    },
    update: {},
  });
  if (!profile.active || !profile.payrollEnabled)
    return { created: false, reason: "PAYROLL_DISABLED" as const };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(order.createdAt);
  const year = Number(parts.find((item) => item.type === "year")?.value),
    month = Number(parts.find((item) => item.type === "month")?.value);
  const period = await tx.payrollPeriod.upsert({
    where: { year_month: { year, month } },
    create: { year, month },
    update: {},
  });
  if (period.status === "CLOSED")
    return { created: false, reason: "PERIOD_CLOSED" as const };
  const key = `measurement-bonus:${measurement.id}:${order.id}`;
  const existing = await tx.payrollAccrual.findUnique({
    where: { idempotencyKey: key },
  });
  if (existing) return { created: false, accrual: existing };
  const requestHash = createRequestHash({
    measurementId: measurement.id,
    orderId: order.id,
    employeeId: profile.id,
    amount: settings.measurerOrderBonus,
  });
  const accrual = await tx.payrollAccrual.create({
    data: {
      employeeId: profile.id,
      periodId: period.id,
      type: PayrollAccrualType.MEASUREMENT_BONUS,
      direction: PayrollDirection.INCREASE,
      amount: settings.measurerOrderBonus,
      orderId: order.id,
      measurementId: measurement.id,
      reason: `Бонус за замер, заказ ${order.id}`,
      paymentMode: BonusPaymentMode.ACCUMULATE,
      approvedById: actor.userId,
      createdById: actor.userId,
      idempotencyKey: key,
      requestHash,
    },
  });
  await tx.measurement.update({
    where: { id: measurement.id },
    data: { orderId: order.id },
  });
  await tx.companyLedgerEntry.create({
    data: {
      type: "PAYROLL_ACCRUAL",
      category: "SALARY",
      direction: "EXPENSE",
      amount: accrual.amount,
      operationDate: accrual.createdAt,
      comment: accrual.reason,
      orderId: order.id,
      authorId: actor.userId,
      idempotencyKey: `payroll-accrual:${accrual.id}`,
      requestHash,
      affectsProfit: true,
      payrollAccrualId: accrual.id,
    },
  });
  await tx.payrollAuditEvent.create({
    data: {
      action: "MEASUREMENT_BONUS_ACCRUED",
      actorId: actor.userId,
      periodId: period.id,
      employeeId: profile.id,
      after: {
        measurementId: measurement.id,
        orderId: order.id,
        amount: settings.measurerOrderBonus,
      },
      reason: accrual.reason,
      idempotencyKey: `audit:${key}`,
    },
  });
  await tx.measurementAudit.create({
    data: {
      measurementId: measurement.id,
      action: "BONUS_ACCRUED",
      actorId: actor.userId,
      after: {
        accrualId: accrual.id,
        orderId: order.id,
        amount: settings.measurerOrderBonus,
      },
    },
  });
  return { created: true, accrual };
}

export async function reverseMeasurerBonusForCancelledOrder(
  tx: Prisma.TransactionClient,
  orderId: number,
  actor: MeasurementActor,
) {
  const originals = await tx.payrollAccrual.findMany({
    where: {
      orderId,
      type: PayrollAccrualType.MEASUREMENT_BONUS,
      reversedBy: null,
      measurementId: { not: null },
    },
  });
  if (!originals.length) return { created: 0 };
  const now = new Date(),
    bounds = monthBounds(now);
  let year = bounds.year,
    month = bounds.month;
  let period = await tx.payrollPeriod.upsert({
    where: { year_month: { year, month } },
    create: { year, month },
    update: {},
  });
  if (period.status === "CLOSED") {
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
    period = await tx.payrollPeriod.upsert({
      where: { year_month: { year, month } },
      create: { year, month },
      update: {},
    });
  }
  let created = 0;
  for (const original of originals) {
    const key = `measurement-bonus-reversal:${original.id}:${orderId}`;
    if (await tx.payrollAccrual.findUnique({ where: { idempotencyKey: key } }))
      continue;
    const requestHash = createRequestHash({
      originalId: original.id,
      orderId,
      amount: Number(original.amount),
    });
    const reversal = await tx.payrollAccrual.create({
      data: {
        employeeId: original.employeeId,
        periodId: period.id,
        earnedPeriodId: original.periodId,
        type: PayrollAccrualType.BONUS_REVERSAL,
        direction: PayrollDirection.DECREASE,
        amount: original.amount,
        orderId,
        reason: `Сторно бонуса замерщика: заказ ${orderId} отменён`,
        approvedById: actor.userId,
        createdById: actor.userId,
        reversalOfId: original.id,
        idempotencyKey: key,
        requestHash,
      },
    });
    await tx.companyLedgerEntry.create({
      data: {
        type: "PAYROLL_ACCRUAL",
        category: "SALARY",
        direction: "INCOME",
        amount: reversal.amount,
        operationDate: reversal.createdAt,
        comment: reversal.reason,
        orderId,
        authorId: actor.userId,
        idempotencyKey: `payroll-accrual:${reversal.id}`,
        requestHash,
        affectsProfit: true,
        payrollAccrualId: reversal.id,
      },
    });
    await tx.payrollAuditEvent.create({
      data: {
        action: "MEASUREMENT_BONUS_REVERSED",
        actorId: actor.userId,
        periodId: period.id,
        employeeId: original.employeeId,
        before: { accrualId: original.id, amount: Number(original.amount) },
        after: { reversalId: reversal.id },
        reason: reversal.reason,
        idempotencyKey: `audit:${key}`,
      },
    });
    if (original.measurementId)
      await tx.measurementAudit.create({
        data: {
          measurementId: original.measurementId,
          action: "BONUS_REVERSED",
          actorId: actor.userId,
          after: { reversalId: reversal.id, orderId },
        },
      });
    created += 1;
  }
  return { created };
}

export const measurementPhotoTypes = Object.values(MeasurementPhotoType);
