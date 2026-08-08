import { NextResponse } from "next/server";
import { parseBusinessDateTime } from "@/lib/calendar-time";
import { measurementActor, measurementError } from "@/lib/measurement-api";
import { requirePermission } from "@/lib/server-auth";
import {
  cancelMeasurement,
  completeMeasurement,
  getMeasurement,
  handMeasurementToManager,
  inviteClientToOffice,
  markReadyForContract,
  parseMeasurementDraft,
  rescheduleMeasurement,
  saveMeasurementComment,
  saveMeasurementDraft,
  startMeasurement,
} from "@/lib/services/measurement.service";

type Context = { params: Promise<{ id: string }> };
const idOf = (value: string) => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; };

export async function GET(_: Request, { params }: Context) {
  const auth = await requirePermission("measurements");
  if (auth.response) return auth.response;
  const id = idOf((await params).id);
  if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const result = await getMeasurement(measurementActor(auth.session!), id);
  return result ? NextResponse.json(result) : NextResponse.json({ error: "Замер не найден" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: Context) {
  const auth = await requirePermission("measurements");
  if (auth.response) return auth.response;
  const id = idOf((await params).id);
  if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action;
    const actor = measurementActor(auth.session!);
    if (action === undefined && typeof body.comment === "string" && Object.keys(body).every((key) => key === "comment")) return NextResponse.json(await saveMeasurementComment(actor, id, body.comment));
    if (action === "start") return NextResponse.json(await startMeasurement(actor, id));
    if (action === "save-draft") return NextResponse.json(await saveMeasurementDraft(actor, id, parseMeasurementDraft(body, false)));
    if (action === "complete") return NextResponse.json(await completeMeasurement(actor, id, parseMeasurementDraft(body)));
    if (action === "handoff") return NextResponse.json(await handMeasurementToManager(actor, id));
    if (action === "ready-contract") return NextResponse.json(await markReadyForContract(actor, id));
    if (action === "invite-office") {
      const dueAt = parseBusinessDateTime(body.dueAt);
      if (!dueAt) return NextResponse.json({ error: "Укажите дату и время встречи" }, { status: 400 });
      return NextResponse.json(await inviteClientToOffice(actor, id, dueAt, typeof body.comment === "string" ? body.comment : undefined));
    }
    if (action === "reschedule") {
      const visitDate = parseBusinessDateTime(body.visitDate), measurerUserId = Number(body.measurerUserId);
      if (!visitDate || !Number.isInteger(measurerUserId) || measurerUserId <= 0) return NextResponse.json({ error: "Укажите дату, время и замерщика" }, { status: 400 });
      return NextResponse.json(await rescheduleMeasurement(actor, id, { visitDate, measurerUserId, city: typeof body.city === "string" ? body.city : undefined, address: typeof body.address === "string" ? body.address : undefined, mapLink: typeof body.mapLink === "string" ? body.mapLink : undefined, comment: typeof body.comment === "string" ? body.comment : undefined }));
    }
    if (action === "cancel") return NextResponse.json(await cancelMeasurement(actor, id, typeof body.comment === "string" ? body.comment : undefined));
    return NextResponse.json({ error: "Неподдерживаемое действие" }, { status: 400 });
  } catch (error) {
    return error instanceof SyntaxError ? NextResponse.json({ error: "Некорректный JSON" }, { status: 400 }) : measurementError(error);
  }
}
