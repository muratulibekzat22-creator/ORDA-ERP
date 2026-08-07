import { NextResponse } from "next/server";
import { requireOrder360Actor } from "@/lib/order360-auth";
import {
  availableTransitions,
  orderAttention,
  orderDocuments,
  orderFinance,
  orderOverview,
  Order360Error,
  orderTimeline,
} from "@/lib/services/order360.service";

type Context = { params: Promise<{ id: string; view: string }> };
const failure = (error: unknown) => error instanceof Order360Error
  ? NextResponse.json({ error: error.message }, { status: error.message === "NOT_FOUND" ? 404 : error.message === "FORBIDDEN" ? 403 : 409 })
  : NextResponse.json({ error: "ORDER_360_FAILED" }, { status: 500 });

export async function GET(request: Request, { params }: Context) {
  const auth = await requireOrder360Actor();
  if (auth.response) return auth.response;
  const { id: rawId, view } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });
  const p = new URL(request.url).searchParams;
  try {
    if (view === "overview") return NextResponse.json(await orderOverview(id, auth.actor!));
    if (view === "finance" || view === "commerce") return NextResponse.json(await orderFinance(id, auth.actor!));
    if (view === "attention") return NextResponse.json(await orderAttention(id, auth.actor!));
    if (view === "timeline") return NextResponse.json(await orderTimeline(id, auth.actor!, Number(p.get("page") ?? 1), Number(p.get("pageSize") ?? 20)));
    if (view === "documents") return NextResponse.json(await orderDocuments(id, auth.actor!, Number(p.get("page") ?? 1), Number(p.get("pageSize") ?? 20)));
    if (view === "available-transitions") return NextResponse.json(await availableTransitions(id, auth.actor!));
    if (view === "delivery") {
      const overview = await orderOverview(id, auth.actor!);
      return NextResponse.json({ lifecycle: overview.lifecycle, delivery: overview.delivery });
    }
    return NextResponse.json({ error: "VIEW_NOT_FOUND" }, { status: 404 });
  } catch (error) { return failure(error); }
}
