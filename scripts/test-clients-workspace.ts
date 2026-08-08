import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const schema = read("prisma/schema.prisma");
const listApi = read("app/api/clients/route.ts");
const detailApi = read("app/api/clients/[id]/route.ts");
const card = read("components/clients/ClientCard.tsx");
const attachments = read("lib/services/client-attachment.service.ts");
const funnel = read("lib/services/lead.service.ts");
const analytics = read("lib/services/analytics.service.ts");
const clientApi = read("app/api/clients/route.ts");
const modal = read("components/clients/ClientModal.tsx");
const proposalWorkspace = read("components/clients/LeadProposalWorkspace.tsx");
const proposalApi = read("app/api/clients/[id]/proposals/route.ts");
const calculator = read("components/calculator/StairCalculator.tsx");
const managersApi = read("app/api/client-managers/route.ts");

for (const expected of [
  "whatsapp",
  "address",
  "ClientInteraction",
  "ClientAttachment",
])
  if (!schema.includes(expected))
    throw new Error(`Missing client domain field: ${expected}`);
for (const filter of ["city", "manager", "status", "source"])
  if (!listApi.includes(`params.get(\"${filter}\")`))
    throw new Error(`Missing clients filter: ${filter}`);
for (const relation of ["orders:", "interactions:", "attachments:"])
  if (!detailApi.includes(relation))
    throw new Error(`Missing client detail relation: ${relation}`);
for (const section of [
  "Что нужно клиенту",
  "Расчёт и КП",
  "История общения",
  "Следующее действие",
])
  if (!card.includes(section))
    throw new Error(`Missing application UI section: ${section}`);
for (const type of ["video/mp4", "application/pdf", "image/jpeg"])
  if (!attachments.includes(type))
    throw new Error(`Missing client attachment type: ${type}`);
if (!attachments.includes('access: "private"'))
  throw new Error("Client files must remain private");
for (const field of [
  "LeadStage",
  "LeadNextAction",
  "managerUserId",
  "lostReason",
  "sourceCode",
])
  if (!schema.includes(field))
    throw new Error(`Missing sales funnel field: ${field}`);
for (const rule of [
  "NEXT_ACTION_REQUIRED",
  "LOST_REASON_REQUIRED",
  "NEXT_ACTION_AFTER_COMPLETION_REQUIRED",
  "ACTION_ALREADY_COMPLETED",
])
  if (!funnel.includes(rule)) throw new Error(`Missing funnel rule: ${rule}`);
if (
  !clientApi.includes("DUPLICATE_PHONE") ||
  !clientApi.includes("allowDuplicate")
)
  throw new Error("Duplicate phone workflow is missing");
if (
  !analytics.includes("qualified") ||
  analytics.includes("leads: orders.length")
)
  throw new Error("Sales analytics must use leads, not orders");
for (const field of [
  "Имя (необязательно)",
  "Номер WhatsApp",
  "Город",
  "Ответственный менеджер",
  "Комментарий (необязательно)",
])
  if (!modal.includes(field))
    throw new Error(`Minimal application field missing: ${field}`);
for (const forbidden of ["Предварительная сумма", "Источник заявки", "Статус"])
  if (modal.includes(forbidden))
    throw new Error(
      `Technical field leaked into minimal application form: ${forbidden}`,
    );
if (
  !managersApi.includes("active: true") ||
  !managersApi.includes("Role.MANAGER")
)
  throw new Error(
    "Responsible manager selector is not restricted to active staff",
  );
for (const material of ["Сосна", "Карагач", "Дуб ламель"])
  if (!calculator.includes(material) || !proposalApi.includes(material))
    throw new Error(`Three-variant flow is missing ${material}`);
for (const action of [
  "Сформировать КП",
  "Открыть / скачать PDF",
  "Отправить PDF в WhatsApp",
  "Оформить заказ",
  "Новая версия",
])
  if (!proposalWorkspace.includes(action))
    throw new Error(`Proposal action missing: ${action}`);
for (const protectedKey of [
  "internalCost",
  "workshopPrice",
  "managerMinimumPrice",
  "grossDifference",
  "companyProfit",
])
  if (!read("lib/lead-calculation-view.ts").includes(protectedKey))
    throw new Error(`Manager redaction misses ${protectedKey}`);
console.log("clients workspace checks passed");
