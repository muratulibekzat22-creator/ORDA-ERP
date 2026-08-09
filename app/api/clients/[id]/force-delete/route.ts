import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { ClientDeletionError, forceDeleteClient, previewClientForceDelete } from "@/lib/services/client-force-delete.service";

type Context = { params: Promise<{ id: string }> };
const actor = (session: { user: { id: string; role: string; name?: string | null } }) => ({ userId: Number(session.user.id), role: session.user.role as Role, name: session.user.name ?? "" });
const idOf = async (context: Context) => { const id = Number((await context.params).id); return Number.isInteger(id) && id > 0 ? id : null; };
const failure = (error: unknown) => {
  if (!(error instanceof ClientDeletionError)) return NextResponse.json({ error: "Не удалось выполнить контролируемое удаление" }, { status: 500 });
  const status = error.message === "FORBIDDEN" ? 403 : error.message === "CLIENT_NOT_FOUND" ? 404 : 409;
  const labels: Record<string, string> = { FORBIDDEN: "Только директор может удалять связанные данные", CLIENT_NOT_FOUND: "Заявка не найдена", CONFIRMATION_REQUIRED: "Введите слово УДАЛИТЬ", REASON_REQUIRED: "Укажите причину удаления", FINANCIAL_OR_OPERATIONAL_RECORDS_EXIST: "Удаление заблокировано: есть платежи, выплаты или складские движения. Используйте аннулирование и сторно." };
  return NextResponse.json({ error: labels[error.message] ?? error.message, code: error.message }, { status });
};

export async function GET(_: Request, context: Context) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  const id = await idOf(context); if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try { return NextResponse.json(await previewClientForceDelete(id, actor(auth.session!))); } catch (error) { return failure(error); }
}

export async function DELETE(request: Request, context: Context) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  const id = await idOf(context); if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try { const body = await request.json() as { confirmation?: string; reason?: string }; return NextResponse.json(await forceDeleteClient({ clientId: id, confirmation: body.confirmation ?? "", reason: body.reason ?? "" }, actor(auth.session!))); } catch (error) { return failure(error); }
}
