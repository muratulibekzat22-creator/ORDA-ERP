import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { readIdempotencyKey } from "@/lib/idempotency";
import { requireOrder360Actor } from "@/lib/order360-auth";
import { buildContractSnapshot, generateContract, getContractDefaults, type ContractActor, type ContractInput } from "@/lib/services/contract.service";
import { ensureContractPackage } from "@/lib/services/contract-package.service";
import { getDocument } from "@/lib/services/document.service";

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "CONTRACT_FAILED";
  const status = code === "NOT_FOUND" ? 404 : code === "FORBIDDEN" ? 403 : code.endsWith("_REQUIRED") || code.startsWith("INVALID_") ? 400 : 500;
  const labels: Record<string, string> = { CLIENT_NAME_REQUIRED: "Укажите ФИО клиента", CLIENT_IIN_REQUIRED: "Укажите ИИН клиента (12 цифр)", DIRECTOR_REQUIRED: "Заполните ФИО директора в настройках компании", WARRANTY_REQUIRED: "Укажите гарантию в материале или форме договора", INVALID_PAYMENT: "Проверьте первый платёж", INVALID_CONDITION: "Выберите разрешённое условие оплаты/срока" };
  return NextResponse.json({ error: labels[code] ?? code }, { status });
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOrder360Actor(); if (auth.response) return auth.response;
  const id = Number((await params).id); if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try { return NextResponse.json(await getContractDefaults(id, auth.actor as ContractActor)); } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOrder360Actor(); if (auth.response) return auth.response;
  if (auth.actor!.role !== Role.DIRECTOR && auth.actor!.role !== Role.MANAGER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const id = Number((await params).id); if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const body = await request.json() as { action?: "preview" | "generate"; input?: ContractInput };
    if (body.action === "preview") return NextResponse.json(await buildContractSnapshot(id, auth.actor as ContractActor, body.input ?? {}));
    if (body.action !== "generate") return NextResponse.json({ error: "Некорректное действие" }, { status: 400 });
    const key = readIdempotencyKey(request); if ("response" in key) return key.response;
    const document = await generateContract(id, auth.actor as ContractActor, body.input ?? {}, key.key);
    const packageResult = await ensureContractPackage(document.id, auth.actor as ContractActor);
    const refreshed = await getDocument(document.id, auth.actor as ContractActor);
    return NextResponse.json({ ...refreshed, packagePdfError: packageResult.pdfError }, { status: 201 });
  } catch (error) { return error instanceof SyntaxError ? NextResponse.json({ error: "Некорректный JSON" }, { status: 400 }) : errorResponse(error); }
}
