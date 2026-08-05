import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { createRequestHash, idempotencyConflict, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import { createPersonalEntry, getPersonalFinance, PERSONAL_CATEGORIES } from "@/lib/services/management-finance.service";

function date(value: string | null) { if (!value) return undefined; const result = new Date(value); return Number.isNaN(result.getTime()) ? null : result; }
async function director() { const auth = await requirePermission("finance"); if (auth.response) return auth; if (auth.session!.user.role !== Role.DIRECTOR) return { response: NextResponse.json({ error: "Доступ только директору" }, { status: 403 }) }; return auth; }
export async function GET(request: Request) {
  const auth = await director(); if (auth.response) return auth.response;
  const url = new URL(request.url), from = date(url.searchParams.get("from")), to = date(url.searchParams.get("to"));
  if (from === null || to === null) return NextResponse.json({ error: "Некорректный период" }, { status: 400 });
  return NextResponse.json(await getPersonalFinance(from, to));
}
export async function POST(request: Request) {
  const auth = await director(); if (auth.response || !auth.session) return auth.response;
  const idempotency = readIdempotencyKey(request); if ("response" in idempotency) return idempotency.response;
  try {
    const body = await request.json() as Record<string, unknown>, amount = Number(body.amount), operationDate = date(typeof body.operationDate === "string" ? body.operationDate : null);
    const direction = body.direction === "INCOME" || body.direction === "EXPENSE" ? body.direction : null;
    const category = typeof body.category === "string" && (direction === "INCOME" || PERSONAL_CATEGORIES.includes(body.category as typeof PERSONAL_CATEGORIES[number])) ? body.category : null;
    if (!direction || !category || !Number.isFinite(amount) || amount <= 0 || operationDate === null) return NextResponse.json({ error: "Некорректная операция" }, { status: 400 });
    const payload = { type: typeof body.type === "string" ? body.type.slice(0, 80) : direction, category, direction, amount, operationDate: operationDate ?? new Date(), comment: typeof body.comment === "string" ? body.comment.trim().slice(0, 2000) : undefined, authorId: Number(auth.session.user.id) } as const;
    const result = await createPersonalEntry({ ...payload, idempotencyKey: idempotency.key, requestHash: createRequestHash(payload) });
    return NextResponse.json(result.entry, { status: result.created ? 201 : 200 });
  } catch (error) { if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") return idempotencyConflict(); return NextResponse.json({ error: "Не удалось сохранить личную операцию" }, { status: 500 }); }
}
