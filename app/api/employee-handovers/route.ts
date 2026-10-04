import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import { confirmHandover, editHandover, HandoverError, listHandovers, listHandoverManagers, parseSelection, prepareHandover, previewHandover, rollbackHandover } from "@/lib/services/employee-handover.service";

async function authorize() {
  const auth = await requirePermission("employees");
  if (auth.response) return { response: auth.response, actorId: 0 };
  if ((auth.session!.user.accountRole || auth.session!.user.role) !== Role.DIRECTOR)
    return { response: NextResponse.json({ error: "Передачу дел подтверждает основатель" }, { status: 403 }), actorId: 0 };
  return { response: null, actorId: Number(auth.session!.user.id) };
}

function failure(error: unknown) {
  if (error instanceof HandoverError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Employee handover error", error);
  return NextResponse.json({ error: "Не удалось обработать передачу дел" }, { status: 500 });
}

export async function GET(request: Request) {
  const auth = await authorize();
  if (auth.response) return auth.response;
  try {
    const params = new URL(request.url).searchParams;
    const fromUserId = Number(params.get("fromUserId"));
    let selected: unknown;
    try { selected = params.get("categories") ? JSON.parse(params.get("categories")!) : undefined; }
    catch { throw new HandoverError("Некорректный выбор категорий"); }
    const preview = Number.isSafeInteger(fromUserId) && fromUserId > 0
      ? await previewHandover(fromUserId, parseSelection(selected))
      : null;
    const [plans, managers] = await Promise.all([listHandovers(), listHandoverManagers()]);
    return NextResponse.json({ plans, managers, preview }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const auth = await authorize();
  if (auth.response) return auth.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const fromUserId = Number(body.fromUserId);
    const toUserId = Number(body.toUserId);
    if (!Number.isSafeInteger(fromUserId) || !Number.isSafeInteger(toUserId)) throw new HandoverError("Выберите сотрудников");
    const result = await prepareHandover({ fromUserId, toUserId, scheduledAt: new Date(String(body.scheduledAt)), categories: parseSelection(body.categories), actorId: auth.actorId });
    return NextResponse.json(result, { status: 201 });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  const auth = await authorize();
  if (auth.response) return auth.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = Number(body.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new HandoverError("Передача не выбрана");
    if (body.action === "confirm") return NextResponse.json(await confirmHandover(id, String(body.fingerprint ?? ""), auth.actorId));
    if (body.action === "rollback") return NextResponse.json(await rollbackHandover(id, auth.actorId));
    if (body.action === "cancel" || body.action === "update") {
      const toUserId = body.toUserId === undefined ? undefined : Number(body.toUserId);
      if (toUserId !== undefined && !Number.isSafeInteger(toUserId)) throw new HandoverError("Неверный сотрудник");
      return NextResponse.json(await editHandover(id, { action: body.action, scheduledAt: body.scheduledAt === undefined ? undefined : new Date(String(body.scheduledAt)), toUserId, categories: body.categories === undefined ? undefined : parseSelection(body.categories) }));
    }
    throw new HandoverError("Неизвестное действие");
  } catch (error) { return failure(error); }
}
