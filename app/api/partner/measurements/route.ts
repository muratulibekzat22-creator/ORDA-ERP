import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { parseBusinessDateTime } from "@/lib/calendar-time";
import {
  createRequestHash,
  idempotencyConflict,
  readIdempotencyKey,
} from "@/lib/idempotency";
import { measurementActor, measurementError } from "@/lib/measurement-api";
import { requirePermission } from "@/lib/server-auth";
import {
  createPartnerControlMeasurement,
  MeasurementError,
  parseMeasurementDraft,
} from "@/lib/services/measurement.service";

export async function POST(request: Request) {
  const auth = await requirePermission("partners");
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.PARTNER)
    return NextResponse.json({ error: "Раздел доступен только партнёрам" }, { status: 403 });

  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const orderId = Number(body.orderId);
    const visitDate =
      parseBusinessDateTime(body.visitDate) ??
      (typeof body.visitDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.visitDate)
        ? parseBusinessDateTime(`${body.visitDate}T12:00`)
        : null);
    if (!Number.isInteger(orderId) || orderId <= 0 || !visitDate)
      return NextResponse.json({ error: "Проверьте заказ и дату контрольного замера" }, { status: 400 });

    const draft = parseMeasurementDraft(body);
    if (!draft.floorHeight || !draft.staircaseWidth)
      return NextResponse.json({ error: "Укажите высоту этажа и ширину лестницы" }, { status: 400 });
    const requestHash = createRequestHash({
      orderId,
      visitDate: visitDate.toISOString(),
      draft,
    });
    const result = await createPartnerControlMeasurement(
      measurementActor(auth.session!),
      {
        orderId,
        visitDate,
        draft,
        idempotencyKey: idempotency.key,
        requestHash,
      },
    );
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    if (error instanceof MeasurementError && error.message === "IDEMPOTENCY_CONFLICT")
      return idempotencyConflict();
    return measurementError(error);
  }
}
