import { NextResponse } from "next/server";

import { buildMeasurementSheetPdf, type MeasurementSheetSnapshot } from "@/lib/documents/measurement-sheet-pdf";
import { measurementActor } from "@/lib/measurement-api";
import { requirePermission } from "@/lib/server-auth";
import { getMeasurement } from "@/lib/services/measurement.service";

type Context = { params: Promise<{ id: string }> };

function measurementId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(request: Request, { params }: Context) {
  const auth = await requirePermission("measurements");
  if (auth.response) return auth.response;
  const id = measurementId((await params).id);
  if (!id) return NextResponse.json({ error: "Некорректный замер" }, { status: 400 });

  const measurement = await getMeasurement(measurementActor(auth.session!), id);
  if (!measurement) return NextResponse.json({ error: "Замер не найден" }, { status: 404 });

  const snapshot: MeasurementSheetSnapshot = {
    measurementId: measurement.id,
    orderNumber: measurement.order?.number,
    status: measurement.status,
    visitDate: measurement.visitDate.toISOString(),
    completedAt: measurement.completedAt?.toISOString(),
    client: { name: measurement.client.name, phone: measurement.client.phone },
    location: { city: measurement.city, address: measurement.address },
    measurerName: measurement.measurerUser?.name ?? measurement.measurer,
    managerName: measurement.client.managerUser?.name ?? measurement.client.manager,
    floorHeight: measurement.floorHeight,
    staircaseWidth: measurement.staircaseWidth,
    stepsCount: measurement.stepsCount,
    sameSize: measurement.sameSize,
    stepLength: measurement.stepLength,
    stepWidth: measurement.stepWidth,
    stepHeight: measurement.stepHeight,
    individualSteps: measurement.individualSteps as MeasurementSheetSnapshot["individualSteps"],
    riserHeight: measurement.riserHeight,
    winderCount: measurement.winderCount,
    winders: measurement.winders as MeasurementSheetSnapshot["winders"],
    platformsCount: measurement.platformsCount,
    platforms: measurement.platforms as MeasurementSheetSnapshot["platforms"],
    railingLength: measurement.railingLength,
    railingComment: measurement.railingComment,
    objectNotes: measurement.objectNotes,
    comment: measurement.comment,
    designStyle: measurement.designStyle,
    designNotes: measurement.designNotes,
  };
  const bytes = await buildMeasurementSheetPdf(snapshot);
  const download = new URL(request.url).searchParams.get("download") === "1";
  const fileName = `Контрольный-замерный-лист-${measurement.id}.pdf`;
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
