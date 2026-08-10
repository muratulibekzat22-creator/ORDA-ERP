import { LeadStage, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { readIdempotencyKey } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import { buildProposalPdf } from "@/lib/services/proposal-pdf.service";

export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  const id = Number((await params).id),
    role = auth.session!.user.role as Role;
  if (!Number.isInteger(id) || (role !== Role.DIRECTOR && role !== Role.MANAGER))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  const proposal = await prisma.commercialProposal.findFirst({
    where: {
      id,
      ...(role === Role.MANAGER
        ? { client: { managerUserId: Number(auth.session!.user.id) } }
        : {}),
    },
    include: { client: true },
  });
  if (!proposal)
    return NextResponse.json({ error: "КП не найдено" }, { status: 404 });
  if (
    proposal.status === "SENT" &&
    proposal.sendIdempotencyKey === idempotency.key
  )
    return NextResponse.json({ status: "SENT", sentAt: proposal.sentAt });
  const token = process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId)
    return NextResponse.json(
      { error: "Официальная отправка WhatsApp не настроена" },
      { status: 503 },
    );
  try {
    const pdf = await buildProposalPdf(proposal.snapshot);
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", "application/pdf");
    form.set(
      "file",
      new Blob([new Uint8Array(pdf)], { type: "application/pdf" }),
      `proposal-${proposal.number}.pdf`,
    );
    const mediaResponse = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/media`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!mediaResponse.ok)
      return NextResponse.json(
        { error: "WhatsApp не принял PDF" },
        { status: 502 },
      );
    const media = (await mediaResponse.json()) as { id?: string };
    if (!media.id)
      return NextResponse.json(
        { error: "WhatsApp не вернул идентификатор PDF" },
        { status: 502 },
      );
    const sendResponse = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: proposal.client.whatsapp.replace(/\D/g, ""),
          type: "document",
          document: {
            id: media.id,
            filename: `proposal-${proposal.number}.pdf`,
            caption: `Коммерческое предложение №${proposal.rootNumber ?? proposal.number}`,
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!sendResponse.ok)
      return NextResponse.json(
        { error: "WhatsApp не подтвердил отправку PDF" },
        { status: 502 },
      );
    const sent = (await sendResponse.json()) as {
        messages?: Array<{ id?: string }>;
      },
      providerMessageId = sent.messages?.[0]?.id;
    if (!providerMessageId)
      return NextResponse.json(
        { error: "WhatsApp не подтвердил отправку PDF" },
        { status: 502 },
      );
    const now = new Date();
    await prisma.$transaction([
      prisma.commercialProposal.update({
        where: { id },
        data: {
          status: "SENT",
          sentAt: now,
          providerMessageId,
          sendIdempotencyKey: idempotency.key,
        },
      }),
      prisma.client.update({
        where: { id: proposal.clientId },
        data: { stage: LeadStage.PROPOSAL_SENT, status: "КП отправлено" },
      }),
      prisma.leadStatusHistory.create({
        data: {
          clientId: proposal.clientId,
          fromStage: proposal.client.stage,
          toStage: LeadStage.PROPOSAL_SENT,
          fromStatus: proposal.client.status,
          toStatus: "КП отправлено",
          authorId: Number(auth.session!.user.id),
          authorName: auth.session!.user.name ?? proposal.createdByName,
          comment: `WhatsApp PDF КП №${proposal.rootNumber ?? proposal.number}`,
        },
      }),
    ]);
    return NextResponse.json({ status: "SENT", sentAt: now });
  } catch {
    return NextResponse.json(
      { error: "Ошибка официальной отправки WhatsApp" },
      { status: 502 },
    );
  }
}
