import { cleanPdfText, DOCUMENT_COLORS, pdfBuffer } from "@/lib/documents/pdf-utils";

export const MEASUREMENT_SHEET_TEMPLATE_VERSION = "ALTYN_SAPA_MEASUREMENT_SHEET_V1";

type Dimension = {
  length?: number | null;
  width?: number | null;
  height?: number | null;
  comment?: string | null;
};

export type MeasurementSheetSnapshot = {
  measurementId: number;
  orderNumber?: string | null;
  status: string;
  visitDate: string;
  completedAt?: string | null;
  client: { name: string; phone: string };
  location: { city: string; address: string };
  measurerName: string;
  managerName?: string | null;
  floorHeight?: number | null;
  staircaseWidth?: number | null;
  stepsCount?: number | null;
  sameSize: boolean;
  stepLength?: number | null;
  stepWidth?: number | null;
  stepHeight?: number | null;
  individualSteps?: Dimension[] | null;
  riserHeight?: number | null;
  winderCount: number;
  winders?: Dimension[] | null;
  platformsCount: number;
  platforms?: Dimension[] | null;
  railingLength?: number | null;
  railingComment?: string | null;
  objectNotes?: string | null;
  comment?: string | null;
  designStyle?: string | null;
  designNotes?: string | null;
};

const PAGE = { width: 595.28, height: 841.89, margin: 40 };
const contentWidth = PAGE.width - PAGE.margin * 2;
const date = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
const number = (value: number | null | undefined, unit = "") =>
  value == null
    ? "—"
    : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}${unit}`;

function pageHeader(document: PDFKit.PDFDocument, snapshot: MeasurementSheetSnapshot, continuation = false) {
  let y = PAGE.margin;
  document
    .font("DejaVuBold")
    .fontSize(9)
    .fillColor(DOCUMENT_COLORS.gold)
    .text("ALTYN SAPA · ORDA ERP", PAGE.margin, y, { characterSpacing: 0.8 });
  document
    .font("DejaVuBold")
    .fontSize(continuation ? 14 : 19)
    .fillColor(DOCUMENT_COLORS.ink)
    .text(
      continuation
        ? `КОНТРОЛЬНЫЙ ЗАМЕРНЫЙ ЛИСТ №${snapshot.measurementId} · ПРОДОЛЖЕНИЕ`
        : "КОНТРОЛЬНЫЙ ЗАМЕРНЫЙ ЛИСТ ЗАКАЗЧИКА",
      PAGE.margin,
      y + 20,
      { width: contentWidth },
    );
  y = document.y + 8;
  document
    .moveTo(PAGE.margin, y)
    .lineTo(PAGE.width - PAGE.margin, y)
    .strokeColor(DOCUMENT_COLORS.gold)
    .lineWidth(1)
    .stroke();
  return y + 12;
}

function ensureSpace(
  document: PDFKit.PDFDocument,
  snapshot: MeasurementSheetSnapshot,
  y: number,
  height: number,
) {
  if (y + height <= PAGE.height - 58) return y;
  document.addPage();
  return pageHeader(document, snapshot, true);
}

function sectionTitle(document: PDFKit.PDFDocument, snapshot: MeasurementSheetSnapshot, title: string, y: number) {
  const nextY = ensureSpace(document, snapshot, y, 32);
  document
    .roundedRect(PAGE.margin, nextY, contentWidth, 24, 4)
    .fill(DOCUMENT_COLORS.goldSoft);
  document
    .font("DejaVuBold")
    .fontSize(10)
    .fillColor(DOCUMENT_COLORS.ink)
    .text(title, PAGE.margin + 10, nextY + 7, { width: contentWidth - 20 });
  return nextY + 32;
}

function detailRow(
  document: PDFKit.PDFDocument,
  snapshot: MeasurementSheetSnapshot,
  label: string,
  value: string,
  y: number,
) {
  const height = Math.max(
    22,
    document.font("DejaVu").fontSize(9).heightOfString(cleanPdfText(value), {
      width: contentWidth - 145,
      lineGap: 1,
    }) + 10,
  );
  const nextY = ensureSpace(document, snapshot, y, height);
  document.rect(PAGE.margin, nextY, 135, height).fillAndStroke(DOCUMENT_COLORS.neutral, DOCUMENT_COLORS.line);
  document.rect(PAGE.margin + 135, nextY, contentWidth - 135, height).strokeColor(DOCUMENT_COLORS.line).stroke();
  document.font("DejaVuBold").fontSize(8.5).fillColor(DOCUMENT_COLORS.graphite)
    .text(label, PAGE.margin + 7, nextY + 6, { width: 121 });
  document.font("DejaVu").fontSize(9).fillColor(DOCUMENT_COLORS.ink)
    .text(cleanPdfText(value), PAGE.margin + 142, nextY + 6, { width: contentWidth - 149, lineGap: 1 });
  return nextY + height;
}

function dimensionTable(
  document: PDFKit.PDFDocument,
  snapshot: MeasurementSheetSnapshot,
  title: string,
  rows: Dimension[] | null | undefined,
  y: number,
) {
  if (!rows?.length) return y;
  let nextY = sectionTitle(document, snapshot, title, y);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    nextY = detailRow(
      document,
      snapshot,
      `№ ${index + 1}`,
      [
        `${number(row.length, " мм")} × ${number(row.width, " мм")}`,
        row.height != null ? `высота / толщина ${number(row.height, " мм")}` : "",
        row.comment ?? "",
      ].filter(Boolean).join(" · "),
      nextY,
    );
  }
  return nextY + 8;
}

export async function buildMeasurementSheetPdf(snapshot: MeasurementSheetSnapshot) {
  return pdfBuffer(
    {
      size: "A4",
      margin: 0,
      bufferPages: true,
      info: {
        Title: `Контрольный замерный лист №${snapshot.measurementId}`,
        Author: "ALTYN SAPA · ORDA ERP",
        Creator: MEASUREMENT_SHEET_TEMPLATE_VERSION,
      },
    },
    (document) => {
      let y = pageHeader(document, snapshot);
      const final = ["COMPLETED", "HANDED_TO_MANAGER"].includes(snapshot.status);
      if (!final) {
        document
          .font("DejaVuBold")
          .fontSize(10)
          .fillColor("#9A3412")
          .text("ЧЕРНОВИК · ПРОВЕРЬТЕ РАЗМЕРЫ ПЕРЕД ПОДПИСАНИЕМ", PAGE.margin, y, {
            width: contentWidth,
            align: "center",
          });
        y = document.y + 10;
      }

      y = sectionTitle(document, snapshot, "ЗАКАЗЧИК И ОБЪЕКТ", y);
      y = detailRow(document, snapshot, "Замер / заказ", `№${snapshot.measurementId}${snapshot.orderNumber ? ` · заказ ${snapshot.orderNumber}` : ""}`, y);
      y = detailRow(document, snapshot, "Дата замера", date(snapshot.visitDate), y);
      y = detailRow(document, snapshot, "Заказчик", `${snapshot.client.name} · ${snapshot.client.phone}`, y);
      y = detailRow(document, snapshot, "Адрес", [snapshot.location.city, snapshot.location.address].filter(Boolean).join(", "), y);
      y = detailRow(document, snapshot, "Ответственные", `Замерщик: ${snapshot.measurerName}${snapshot.managerName ? ` · менеджер: ${snapshot.managerName}` : ""}`, y);
      y += 8;

      y = sectionTitle(document, snapshot, "ОСНОВНЫЕ РАЗМЕРЫ", y);
      y = detailRow(document, snapshot, "Высота помещения", number(snapshot.floorHeight, " м"), y);
      y = detailRow(document, snapshot, "Ширина лестницы", number(snapshot.staircaseWidth, " м"), y);
      y = detailRow(document, snapshot, "Ступени", number(snapshot.stepsCount, " шт."), y);
      y = detailRow(
        document,
        snapshot,
        "Типоразмер ступеней",
        snapshot.sameSize
          ? `${number(snapshot.stepLength, " мм")} × ${number(snapshot.stepWidth, " мм")}${snapshot.stepHeight != null ? ` × ${number(snapshot.stepHeight, " мм")}` : ""}`
          : "Каждая ступень измерена отдельно",
        y,
      );
      y = detailRow(document, snapshot, "Высота подступенка", number(snapshot.riserHeight, " мм"), y);
      y = detailRow(document, snapshot, "Забежные ступени", number(snapshot.winderCount, " шт."), y);
      y = detailRow(document, snapshot, "Площадки", number(snapshot.platformsCount, " шт."), y);
      y = detailRow(document, snapshot, "Ограждение", number(snapshot.railingLength, " м"), y);
      y += 8;

      if (!snapshot.sameSize) {
        y = dimensionTable(document, snapshot, "ИНДИВИДУАЛЬНЫЕ СТУПЕНИ", snapshot.individualSteps, y);
      }
      y = dimensionTable(document, snapshot, "ЗАБЕЖНЫЕ СТУПЕНИ", snapshot.winders, y);
      y = dimensionTable(document, snapshot, "ПЛОЩАДКИ", snapshot.platforms, y);

      const notes = [
        snapshot.railingComment ? `Ограждение: ${snapshot.railingComment}` : "",
        snapshot.objectNotes ? `Особенности объекта: ${snapshot.objectNotes}` : "",
        snapshot.comment ? `Комментарий замерщика: ${snapshot.comment}` : "",
        snapshot.designStyle ? `Выбранный стиль: ${snapshot.designStyle}` : "",
        snapshot.designNotes ? `Комментарий к дизайну: ${snapshot.designNotes}` : "",
      ].filter(Boolean);
      if (notes.length) {
        y = sectionTitle(document, snapshot, "КОММЕНТАРИИ И СОГЛАСОВАНИЯ", y);
        for (const note of notes) y = detailRow(document, snapshot, "", note, y);
        y += 8;
      }

      y = ensureSpace(document, snapshot, y, 132);
      y = sectionTitle(document, snapshot, "КОНТРОЛЬ ЗАКАЗЧИКА", y);
      document
        .font("DejaVu")
        .fontSize(8.7)
        .fillColor(DOCUMENT_COLORS.graphite)
        .text(
          "Заказчик проверил указанные размеры, адрес объекта и комментарии. Подписание листа подтверждает корректность зафиксированных данных на дату замера.",
          PAGE.margin,
          y,
          { width: contentWidth, lineGap: 2 },
        );
      y = document.y + 22;
      document.font("DejaVu").fontSize(9).fillColor(DOCUMENT_COLORS.ink)
        .text("Заказчик: ____________________________", PAGE.margin, y, { width: 245 })
        .text("Замерщик: ____________________________", PAGE.width / 2 + 5, y, { width: 250 });
      document
        .text("Подпись: _____________________________", PAGE.margin, y + 28, { width: 245 })
        .text("Подпись: _____________________________", PAGE.width / 2 + 5, y + 28, { width: 250 })
        .text("Дата: _______________________________", PAGE.margin, y + 56, { width: 245 })
        .text("Дата: _______________________________", PAGE.width / 2 + 5, y + 56, { width: 250 });

      const range = document.bufferedPageRange();
      for (let index = 0; index < range.count; index += 1) {
        document.switchToPage(range.start + index);
        document.font("DejaVu").fontSize(7).fillColor(DOCUMENT_COLORS.muted)
          .text(
            `Замер №${snapshot.measurementId} · ${MEASUREMENT_SHEET_TEMPLATE_VERSION} · Страница ${index + 1} из ${range.count}`,
            PAGE.margin,
            PAGE.height - 30,
            { width: contentWidth, align: "center", lineBreak: false },
          );
      }
    },
  );
}
