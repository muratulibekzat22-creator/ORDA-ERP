import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { createRequestHash, idempotencyConflict, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import { COMPANY_EXPENSE_CATEGORIES, createCompanyEntry, getCompanyFinance } from "@/lib/services/management-finance.service";

function date(value: string | null) { if (!value) return undefined; const result = new Date(value); return Number.isNaN(result.getTime()) ? null : result; }
export async function GET(request: Request) {
  const auth = await requirePermission("finance"); if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR && auth.session!.user.role !== Role.ACCOUNTANT) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const url = new URL(request.url), from = date(url.searchParams.get("from")), to = date(url.searchParams.get("to"));
  if (from === null || to === null) return NextResponse.json({ error: "Некорректный период" }, { status: 400 });
  return NextResponse.json(await getCompanyFinance(from, to));
}
export async function POST(request: Request) {
  const auth = await requirePermission("finance"); if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR && auth.session!.user.role !== Role.ACCOUNTANT) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const idempotency = readIdempotencyKey(request); if ("response" in idempotency) return idempotency.response;
  try {
    const body = await request.json() as Record<string, unknown>, amount = Number(body.amount), operationDate = date(typeof body.operationDate === "string" ? body.operationDate : null);
    const direction = body.direction === "INCOME" || body.direction === "EXPENSE" ? body.direction : null;
    const category = typeof body.category === "string" && (direction === "INCOME" || COMPANY_EXPENSE_CATEGORIES.includes(body.category as typeof COMPANY_EXPENSE_CATEGORIES[number])) ? body.category : null;
    const orderId = body.orderId == null || body.orderId === "" ? undefined : Number(body.orderId);
    if (!direction || !category || !Number.isFinite(amount) || amount <= 0 || operationDate === null || (orderId !== undefined && (!Number.isInteger(orderId) || orderId <= 0))) return NextResponse.json({ error: "Некорректная операция" }, { status: 400 });
    const payload = { type: typeof body.type === "string" ? body.type.slice(0, 80) : direction, category, direction, amount, operationDate: operationDate ?? new Date(), comment: typeof body.comment === "string" ? body.comment.trim().slice(0, 2000) : undefined, orderId, authorId: Number(auth.session!.user.id) } as const;
    const result = await createCompanyEntry({ ...payload, idempotencyKey: idempotency.key, requestHash: createRequestHash(payload) });
    return NextResponse.json(result.entry, { status: result.created ? 201 : 200 });
  } catch (error) { if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") return idempotencyConflict(); return NextResponse.json({ error: "Не удалось сохранить операцию" }, { status: 500 }); }
}
