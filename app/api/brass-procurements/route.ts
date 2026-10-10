import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireInternalEmployee } from "@/lib/server-auth";
import {
  BrassProcurementError,
  getBrassProcurementWorkspace,
  listBrassProcurements,
} from "@/lib/services/brass-procurement.service";
import { createSupplier, PurchaseError } from "@/lib/services/purchase.service";

const actor = (session: {
  user: { id: string; role: string; accountRole?: string; name?: string | null };
}) => ({
  userId: Number(session.user.id),
  role: (session.user.accountRole || session.user.role) as Role,
  name: session.user.name ?? "Сотрудник ORDA",
});

export async function GET(request: Request) {
  const auth = await requireInternalEmployee();
  if (auth.response) return auth.response;
  try {
    const requestActor = actor(auth.session!);
    return NextResponse.json(
      new URL(request.url).searchParams.get("workspace") === "1"
        ? await getBrassProcurementWorkspace(requestActor)
        : await listBrassProcurements(requestActor),
    );
  } catch (error) {
    return error instanceof BrassProcurementError
      ? NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
      : NextResponse.json(
          { error: "Не удалось загрузить заявки на латунь" },
          { status: 500 },
        );
  }
}

export async function POST(request: Request) {
  const auth = await requireInternalEmployee();
  if (auth.response) return auth.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    if (!name)
      return NextResponse.json({ error: "Укажите поставщика" }, { status: 400 });
    const supplier = await createSupplier(
      {
        name,
        country: String(body.country ?? "").trim(),
        defaultCurrency: String(body.defaultCurrency ?? "KZT")
          .trim()
          .toUpperCase()
          .slice(0, 8),
        contact: String(body.contact ?? "").trim(),
        comment: String(body.comment ?? "").trim(),
      },
      actor(auth.session!),
      { workflow: "BRASS_PROCUREMENT" },
    );
    return NextResponse.json(supplier, { status: 201 });
  } catch (error) {
    if (error instanceof PurchaseError)
      return NextResponse.json(
        { error: error.code === "FORBIDDEN" ? "Недостаточно прав" : "Не удалось добавить поставщика" },
        { status: error.code === "FORBIDDEN" ? 403 : 400 },
      );
    return NextResponse.json(
      { error: "Не удалось добавить поставщика" },
      { status: 500 },
    );
  }
}
