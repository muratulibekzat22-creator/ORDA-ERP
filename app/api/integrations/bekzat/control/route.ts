import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { runWithSystemAccess, runWithTenant } from "@/lib/tenant-context";
import { getFounderControl, runFounderControl } from "@/lib/services/founder-control.service";
import { getDashboardSummary } from "@/lib/services/dashboard.service";

export const maxDuration = 60;
export async function POST(request: Request) {
  const secret = process.env.BEKZAT_CONTROL_SECRET;
  const slug = process.env.FOUNDER_CONTROL_COMPANY_SLUG;
  if (!secret || secret.length < 32 || !slug) return Response.json({ error: "Связь с BEKZAT OS не настроена" }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 65536) return Response.json({ error: "Слишком большой запрос" }, { status: 413 });
  const timestamp = request.headers.get("x-bekzat-timestamp") ?? "";
  const signature = request.headers.get("x-bekzat-signature") ?? "";
  const expected = createHmac("sha256", secret).update(`${timestamp}.POST./api/integrations/bekzat/control.${raw}`).digest("hex");
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
      !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
    return Response.json({ error: "Подпись не подтверждена" }, { status: 401 });
  let body: { action?: string; keys?: string[]; month?: string };
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "Некорректный JSON" }, { status: 400 }); }
  if (!body || !["inspect", "assign"].includes(body.action ?? "") ||
      (body.month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month)) ||
      (body.keys !== undefined && (!Array.isArray(body.keys) || body.keys.length > 500 || body.keys.some(k => typeof k !== "string" || k.length > 100))))
    return Response.json({ error: "Некорректное действие" }, { status: 400 });
  const company = await runWithSystemAccess(() => prisma.company.findUnique({ where: { slug }, select: { id: true, slug: true, name: true, active: true, isDemo: true } }));
  if (!company?.active || company.isDemo) return Response.json({ error: "Компания недоступна" }, { status: 503 });
  return runWithTenant({ companyId: company.id, companySlug: company.slug, companyName: company.name, isDemo: false }, async () => {
    const founders = await prisma.user.findMany({ where: { active: true, role: "DIRECTOR" }, select: { id: true } });
    if (founders.length !== 1) return Response.json({ error: "Не определён единственный основатель" }, { status: 409 });
    const result = body.action === "assign" ? await runFounderControl(founders[0].id, body.keys) : undefined;
    const control = await getFounderControl();
    const dashboard = await getDashboardSummary({ role: "DIRECTOR", userId: founders[0].id, month: body.month });
    const finance = "finance" in dashboard ? dashboard.finance : null;
    return Response.json({ ...control, result, finance, month: "month" in dashboard ? dashboard.month : body.month, company: company.name }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
