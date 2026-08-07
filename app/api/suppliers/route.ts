import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import {
  createSupplier,
  listSuppliers,
  PurchaseError,
} from "@/lib/services/purchase.service";

const actor = (session: {
  user: { id: string; role: string; name?: string | null };
}) => ({
  userId: Number(session.user.id),
  role: session.user.role as Role,
  name: session.user.name ?? null,
});
const failure = (error: unknown) =>
  error instanceof PurchaseError
    ? NextResponse.json(
        { error: error.code },
        { status: error.code === "FORBIDDEN" ? 403 : 400 },
      )
    : NextResponse.json(
        { error: "Не удалось выполнить операцию" },
        { status: 500 },
      );
export async function GET() {
  const auth = await requirePermission("warehouse");
  if (auth.response) return auth.response;
  try {
    return NextResponse.json(await listSuppliers(actor(auth.session!)));
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  const auth = await requirePermission("warehouse");
  if (auth.response) return auth.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.name !== "string" || !body.name.trim())
      return NextResponse.json(
        { error: "Укажите поставщика" },
        { status: 400 },
      );
    return NextResponse.json(
      await createSupplier(
        {
          name: body.name.trim(),
          country: String(body.country ?? ""),
          defaultCurrency: String(body.defaultCurrency ?? "KZT"),
          contact: String(body.contact ?? ""),
          comment: String(body.comment ?? ""),
        },
        actor(auth.session!),
      ),
      { status: 201 },
    );
  } catch (error) {
    return failure(error);
  }
}
