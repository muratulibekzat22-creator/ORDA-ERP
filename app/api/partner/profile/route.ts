import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

const select = { id: true, name: true, phone: true, email: true, city: true, active: true } as const;
async function own(userId: string) { return prisma.partner.findUnique({ where: { userId: Number(userId) }, select }); }
export async function GET() { const auth = await requirePermission("partners"); if (auth.response) return auth.response; if (auth.session!.user.role !== Role.PARTNER) return NextResponse.json({ error: "Partner access only" }, { status: 403 }); const partner = await own(auth.session!.user.id); return partner ? NextResponse.json(partner) : NextResponse.json({ error: "Partner profile not found" }, { status: 404 }); }
export async function PATCH(request: Request) { const auth = await requirePermission("partners"); if (auth.response) return auth.response; if (auth.session!.user.role !== Role.PARTNER) return NextResponse.json({ error: "Partner access only" }, { status: 403 }); const partner = await own(auth.session!.user.id); if (!partner) return NextResponse.json({ error: "Partner profile not found" }, { status: 404 }); const body = await request.json() as Record<string, unknown>; if (typeof body.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 }); return NextResponse.json(await prisma.partner.update({ where: { id: partner.id }, select, data: { name: body.name.trim(), phone: typeof body.phone === "string" ? body.phone.trim() || null : partner.phone, email: typeof body.email === "string" ? body.email.trim() || null : partner.email, city: typeof body.city === "string" ? body.city.trim() || null : partner.city } })); }
