import {
  LeadNextActionType,
  LeadSource,
  LeadStage,
  Prisma,
  Role,
} from "@prisma/client";

import { normalizePhone } from "@/lib/leads/domain";
import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";

const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const DISPATCH_ROLES = [Role.MANAGER, Role.OPERATIONS_DIRECTOR, Role.DIRECTOR] as const;
const FIELD_LIMITS = {
  stairs_object_type: 80,
  stairs_floors: 20,
  stairs_step_count: 20,
  stairs_landing_count: 20,
  stairs_scope: 80,
  stairs_style: 120,
  stairs_glass_type: 80,
  stairs_wood_material: 80,
  stairs_wood_warranty: 40,
  stairs_dimensions: 500,
  stairs_measurement_time: 200,
  stairs_photo_count: 20,
  stairs_video_count: 20,
  stairs_media_ai_summary: 1_500,
} as const;

export type WhatsappMeasurementIntake = {
  handoffId: string;
  applicationId: string;
  customer: {
    name: string;
    city: string;
    whatsappE164: string;
    callbackPhoneE164: string | null;
    language: "ru" | "kk" | null;
  };
  summary: string | null;
  fields: Record<string, string | number>;
};

export type WhatsappMeasurementIntakeResult = {
  accepted: true;
  duplicate: boolean;
  clientId: number;
  nextActionId: number;
  managerAssigned: boolean;
};

function boundedText(value: unknown, maximum: number, fallback = "") {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return normalized.slice(0, maximum) || fallback;
}

function optionalPhone(value: unknown) {
  return typeof value === "string" ? normalizePhone(value) : "";
}

function sanitizeFields(value: unknown): Record<string, string | number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: Record<string, string | number> = {};
  for (const [key, limit] of Object.entries(FIELD_LIMITS)) {
    const candidate = source[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      result[key] = candidate;
      continue;
    }
    const text = boundedText(candidate, limit);
    if (text) result[key] = text;
  }
  return result;
}

export function parseWhatsappMeasurementIntake(value: unknown): WhatsappMeasurementIntake | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (body.event !== "whatsapp_measurement_intake") return null;
  const handoffId = boundedText(body.handoffId, 128);
  const applicationId = boundedText(body.applicationId, 128);
  if (!EXTERNAL_ID_PATTERN.test(handoffId) || !EXTERNAL_ID_PATTERN.test(applicationId)) return null;
  if (!body.customer || typeof body.customer !== "object" || Array.isArray(body.customer)) return null;
  const customer = body.customer as Record<string, unknown>;
  const whatsappE164 = optionalPhone(customer.whatsappE164);
  const callbackPhoneE164 = optionalPhone(customer.callbackPhoneE164);
  if (!whatsappE164 && !callbackPhoneE164) return null;
  const language = customer.language === "ru" || customer.language === "kk" ? customer.language : null;
  return {
    handoffId,
    applicationId,
    customer: {
      name: boundedText(customer.name, 200),
      city: boundedText(customer.city, 200),
      whatsappE164: whatsappE164 || callbackPhoneE164,
      callbackPhoneE164: callbackPhoneE164 || null,
      language,
    },
    summary: boundedText(body.summary, 2_000) || null,
    fields: sanitizeFields(body.fields),
  };
}

function workflowKey(applicationId: string) {
  return `whatsapp-measurement:${applicationId}`;
}

function intakeComment(input: WhatsappMeasurementIntake) {
  const preferredTime = input.fields.stairs_measurement_time;
  return [
    "Новая заявка WhatsApp: проверить технический бриф, назначить замерщика и согласовать точные дату и время с клиентом в WhatsApp.",
    preferredTime ? `Предпочтение клиента: ${preferredTime}.` : "Предпочтительное время не указано.",
    input.summary ? `Запрос: ${input.summary}` : "",
    Object.keys(input.fields).length ? `Бриф: ${JSON.stringify(input.fields)}` : "",
  ].filter(Boolean).join("\n").slice(0, 6_000);
}

async function existingResult(key: string): Promise<WhatsappMeasurementIntakeResult | null> {
  const tenant = requireTenantIdentity();
  const existing = await prisma.leadNextAction.findFirst({
    where: { workflowKey: key, client: { companyId: tenant.companyId } },
    select: { id: true, clientId: true, client: { select: { managerUserId: true } } },
  });
  return existing
    ? {
        accepted: true,
        duplicate: true,
        clientId: existing.clientId,
        nextActionId: existing.id,
        managerAssigned: existing.client.managerUserId !== null,
      }
    : null;
}

async function selectDispatcher(tx: Prisma.TransactionClient, currentManagerId: number | null) {
  if (currentManagerId) {
    const current = await tx.user.findFirst({
      where: { id: currentManagerId, active: true, role: { in: [...DISPATCH_ROLES] } },
      select: { id: true, name: true },
    });
    if (current) return current;
  }

  const managers = await tx.user.findMany({
    where: { active: true, role: Role.MANAGER },
    select: {
      id: true,
      name: true,
      _count: { select: { managedClients: { where: { active: true, deletedAt: null } } } },
    },
    orderBy: { id: "asc" },
  });
  const manager = managers.sort(
    (left, right) => left._count.managedClients - right._count.managedClients || left.id - right.id,
  )[0];
  if (manager) return { id: manager.id, name: manager.name };

  return tx.user.findFirst({
    where: { active: true, role: { in: [Role.OPERATIONS_DIRECTOR, Role.DIRECTOR] } },
    select: { id: true, name: true },
    orderBy: [{ role: "asc" }, { id: "asc" }],
  });
}

export async function getWhatsappMeasurementIntakeReadiness() {
  const dispatcherCount = await prisma.user.count({
    where: { active: true, role: { in: [...DISPATCH_ROLES] } },
  });
  return { ready: dispatcherCount > 0, dispatcherCount };
}

export async function createWhatsappMeasurementIntake(
  input: WhatsappMeasurementIntake,
): Promise<WhatsappMeasurementIntakeResult> {
  const key = workflowKey(input.applicationId);
  const replay = await existingResult(key);
  if (replay) return replay;

  const canonicalPhone = input.customer.callbackPhoneE164 || input.customer.whatsappE164;
  const comment = intakeComment(input);
  try {
    return await prisma.$transaction(async (tx) => {
      let client = await tx.client.findFirst({
        where: {
          active: true,
          deletedAt: null,
          OR: [{ phone: canonicalPhone }, { whatsapp: canonicalPhone }],
        },
        select: { id: true, name: true, city: true, managerUserId: true },
      });
      const dispatcher = await selectDispatcher(tx, client?.managerUserId ?? null);
      if (!dispatcher) throw new Error("WHATSAPP_MEASUREMENT_DISPATCHER_UNAVAILABLE");

      if (client) {
        client = await tx.client.update({
          where: { id: client.id },
          data: {
            name: client.name || input.customer.name || `WhatsApp ${canonicalPhone}`,
            city: client.city || input.customer.city,
            whatsapp: input.customer.whatsappE164,
            manager: client.managerUserId ? undefined : dispatcher.name,
            managerUserId: client.managerUserId ?? dispatcher.id,
            nextContactAt: new Date(),
          },
          select: { id: true, name: true, city: true, managerUserId: true },
        });
      } else {
        client = await tx.client.create({
          data: {
            name: input.customer.name || `WhatsApp ${canonicalPhone}`,
            phone: canonicalPhone,
            whatsapp: input.customer.whatsappE164,
            city: input.customer.city,
            manager: dispatcher.name,
            managerUserId: dispatcher.id,
            amount: "0",
            estimatedAmount: 0,
            status: LeadStage.NEW,
            stage: LeadStage.NEW,
            source: "WhatsApp ALTYN SAPA",
            sourceCode: LeadSource.WHATSAPP,
            comment: input.summary ?? "Заявка на замер из WhatsApp",
            estimateNotes: input.summary ?? "",
            nextContactAt: new Date(),
          },
          select: { id: true, name: true, city: true, managerUserId: true },
        });
        await tx.leadStatusHistory.create({
          data: {
            clientId: client.id,
            toStatus: LeadStage.NEW,
            toStage: LeadStage.NEW,
            authorName: "WhatsApp контакт-центр",
            comment: "Обращение на замер автоматически зарегистрировано",
          },
        });
      }

      const action = await tx.leadNextAction.create({
        data: {
          clientId: client.id,
          nextActionType: LeadNextActionType.MEASUREMENT,
          nextActionAt: new Date(),
          nextActionComment: comment,
          createdByUserId: dispatcher.id,
          mandatory: true,
          workflowKey: key,
        },
        select: { id: true },
      });
      await tx.leadActivity.create({
        data: {
          clientId: client.id,
          type: "WHATSAPP_MEASUREMENT_REQUEST",
          comment,
          authorName: "WhatsApp контакт-центр",
        },
      });
      return {
        accepted: true,
        duplicate: false,
        clientId: client.id,
        nextActionId: action.id,
        managerAssigned: client.managerUserId !== null,
      };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await existingResult(key);
      if (duplicate) return duplicate;
    }
    throw error;
  }
}
