import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

const percent = (value: number, total: number) =>
  total ? Math.round((value / total) * 1000) / 10 : 0;
export async function GET(request: Request) {
  const auth = await requirePermission("reports");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const params = new URL(request.url).searchParams,
    now = new Date(),
    start = params.get("from")
      ? new Date(params.get("from")!)
      : new Date(now.getFullYear(), now.getMonth(), 1),
    end = params.get("to") ? new Date(params.get("to")!) : now;
  if ([start, end].some((date) => Number.isNaN(date.getTime())))
    return NextResponse.json({ error: "Некорректный период" }, { status: 400 });
  const rows = await prisma.commercialProposal.findMany({
    where: {
      createdAt: { gte: start, lte: end },
      ...(role === Role.MANAGER
        ? { client: { managerUserId: Number(auth.session!.user.id) } }
        : {}),
    },
    include: {
      client: { select: { managerUserId: true, manager: true } },
      conversion: {
        select: {
          orderId: true,
          order: {
            select: { measurements: { select: { id: true }, take: 1 } },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  const canonical = [
    ...new Map(rows.map((row) => [row.rootNumber ?? row.number, row])).values(),
  ];
  const sent = canonical.filter((row) => row.sentAt),
    measured = canonical.filter(
      (row) => row.conversion?.order.measurements.length,
    ),
    converted = canonical.filter((row) => row.conversion);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const managers = new Map<number, typeof canonical>();
  for (const row of canonical) {
    const key = row.client.managerUserId ?? 0,
      values = managers.get(key) ?? [];
    values.push(row);
    managers.set(key, values);
  }
  return NextResponse.json({
    period: { start, end },
    createdToday: canonical.filter((row) => row.createdAt >= today).length,
    sentToday: sent.filter((row) => row.sentAt! >= today).length,
    sent: sent.length,
    totalCommercialAmount: canonical.reduce(
      (sum, row) => sum + Number(row.total ?? 0),
      0,
    ),
    measurementConversion: percent(measured.length, sent.length),
    orderConversion: percent(converted.length, sent.length),
    byManager: [...managers.entries()].map(([managerUserId, values]) => ({
      managerUserId,
      manager: values[0]?.client.manager ?? "",
      proposals: values.length,
      sent: values.filter((row) => row.sentAt).length,
      orders: values.filter((row) => row.conversion).length,
    })),
  });
}
