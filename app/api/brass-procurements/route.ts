import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import {
  BrassProcurementError,
  listBrassProcurements,
} from "@/lib/services/brass-procurement.service";

export async function GET() {
  const auth = await requirePermission("warehouse");
  if (auth.response) return auth.response;
  try {
    return NextResponse.json(
      await listBrassProcurements({
        userId: Number(auth.session!.user.id),
        role: (auth.session!.user.accountRole || auth.session!.user.role) as Role,
        name: auth.session!.user.name ?? "Сотрудник ORDA",
      }),
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
