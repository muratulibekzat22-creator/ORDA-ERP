import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const schema = read("prisma/schema.prisma");
const listApi = read("app/api/clients/route.ts");
const detailApi = read("app/api/clients/[id]/route.ts");
const card = read("components/clients/ClientCard.tsx");
const attachments = read("lib/services/client-attachment.service.ts");

for (const expected of ["whatsapp", "address", "ClientInteraction", "ClientAttachment"]) if (!schema.includes(expected)) throw new Error(`Missing client domain field: ${expected}`);
for (const filter of ["city", "manager", "status", "source"]) if (!listApi.includes(`params.get(\"${filter}\")`)) throw new Error(`Missing clients filter: ${filter}`);
for (const relation of ["orders:", "interactions:", "attachments:"]) if (!detailApi.includes(relation)) throw new Error(`Missing client detail relation: ${relation}`);
for (const section of ["Предварительный расчёт", "История общения", "Прикреплённые файлы", "Связанные заказы", "Финансы клиента", "Последняя активность"]) if (!card.includes(section)) throw new Error(`Missing client UI section: ${section}`);
for (const type of ["video/mp4", "application/pdf", "image/jpeg"]) if (!attachments.includes(type)) throw new Error(`Missing client attachment type: ${type}`);
if (!attachments.includes('access: "private"')) throw new Error("Client files must remain private");
console.log("clients workspace checks passed");
