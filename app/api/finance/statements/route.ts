import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { BANK_STATEMENT_EXTENSIONS, MAX_BANK_STATEMENT_SIZE } from "@/lib/bank-statements/parser";
import { logRequestFailure } from "@/lib/observability";
import { requirePermission } from "@/lib/server-auth";
import { getBankStatementWorkspace, importKaspiStatement } from "@/lib/services/bank-statement.service";

export const runtime = "nodejs";
export const maxDuration = 60;

function allowed(role: Role) {
  return role === Role.DIRECTOR || role === Role.OPERATIONS_DIRECTOR || role === Role.ACCOUNTANT;
}

function positiveId(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function errorResponse(error: unknown) {
  const key = error instanceof Error ? error.message : "";
  const messages: Record<string, [string, number]> = {
    PDF_USE_EXCEL: ["Для точного расчёта выгрузите выписку Kaspi в формате Excel (.xlsx), а не PDF.", 400],
    UNSUPPORTED_STATEMENT_FORMAT: ["Поддерживаются выписки Kaspi в форматах Excel (.xlsx), CSV и 1C (.txt).", 400],
    INVALID_STATEMENT_SIZE: ["Файл пустой или превышает 10 МБ.", 400],
    INVALID_STATEMENT_CONTENT: ["Содержимое файла не соответствует выбранному формату.", 400],
    STATEMENT_HEADER_NOT_FOUND: ["Не найдены колонки даты и суммы. Выгрузите полную выписку Kaspi в Excel.", 400],
    STATEMENT_ROWS_NOT_FOUND: ["В выписке не найдено операций с датой, направлением и суммой.", 400],
    STATEMENT_TOO_MANY_ROWS: ["В одном файле допускается не более 2 000 операций. Выберите меньший период.", 400],
  };
  return messages[key] ?? null;
}

export async function GET(request: Request) {
  const auth = await requirePermission("finance");
  if (auth.response) return auth.response;
  if (!allowed(auth.session!.user.role as Role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const rawImportId = new URL(request.url).searchParams.get("importId");
  const importId = rawImportId ? positiveId(rawImportId) ?? undefined : undefined;
  if (rawImportId && !importId) return NextResponse.json({ error: "Некорректный importId" }, { status: 400 });
  try {
    return NextResponse.json(await getBankStatementWorkspace(importId));
  } catch (error) {
    logRequestFailure("bank_statement.read_failed", request, error);
    return NextResponse.json({ error: "Не удалось загрузить сверку выписки" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission("finance");
  if (auth.response) return auth.response;
  if (!allowed(auth.session!.user.role as Role)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.name || file.size <= 0 || file.size > MAX_BANK_STATEMENT_SIZE)
      return NextResponse.json({ error: "Выберите выписку Kaspi до 10 МБ." }, { status: 400 });
    const ext = file.name.toLocaleLowerCase("en").split(".").pop() ?? "";
    if (ext !== "pdf" && !BANK_STATEMENT_EXTENSIONS.has(ext))
      return NextResponse.json({ error: "Поддерживаются Excel (.xlsx), CSV и 1C (.txt)." }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await importKaspiStatement({ fileName: file.name, contentType: file.type, size: file.size, bytes }, { userId: Number(auth.session!.user.id), name: auth.session!.user.name ?? "System" });
    return NextResponse.json(result, { status: result.replay ? 200 : 201 });
  } catch (error) {
    const mapped = errorResponse(error);
    if (mapped) return NextResponse.json({ error: mapped[0] }, { status: mapped[1] });
    logRequestFailure("bank_statement.import_failed", request, error);
    return NextResponse.json({ error: "Не удалось разобрать выписку Kaspi" }, { status: 500 });
  }
}
