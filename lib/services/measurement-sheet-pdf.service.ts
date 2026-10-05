import path from "node:path";
import PDFDocument from "pdfkit";

type SheetData = Record<string, unknown>;
const money = (value: unknown) => `${Number(value ?? 0).toLocaleString("ru-RU")} ₸`;
const clean = (value: unknown, fallback = "—") => String(value ?? "").trim() || fallback;
const date = (value: unknown) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "long", timeStyle: "short" }).format(new Date(String(value)));

export async function buildMeasurementSheetPdf(data: SheetData) {
  const chunks: Buffer[] = [];
  const document = new PDFDocument({ size: "A4", margin: 42, compress: true, info: { Title: `Замерный лист №${clean(data.id)}`, Author: "ORDA ERP" } });
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve, reject) => { document.on("end", () => resolve(Buffer.concat(chunks))); document.on("error", reject); });
  const fontRoot = path.join(process.cwd(), "node_modules", "dejavu-fonts-ttf", "ttf");
  document.registerFont("Regular", path.join(fontRoot, "DejaVuSans.ttf"));
  document.registerFont("Bold", path.join(fontRoot, "DejaVuSans-Bold.ttf"));
  const client = data.client as Record<string, unknown>;
  const order = data.order as Record<string, unknown> | null;
  const measurer = data.measurerUser as Record<string, unknown> | null;
  const row = (label: string, value: unknown) => { document.font("Regular").fontSize(9).fillColor("#64748B").text(label, 42, document.y, { continued: true, width: 170 }); document.font("Bold").fillColor("#0F172A").text(clean(value)); document.moveDown(0.35); };
  document.rect(42, 42, 5, 74).fill("#2563EB");
  document.font("Bold").fontSize(20).fillColor("#0F172A").text("ЗАМЕРНЫЙ ЛИСТ", 60, 45);
  document.font("Bold").fontSize(11).fillColor("#2563EB").text(`№ ZM-${data.id}`, 60, 75);
  document.font("Regular").fontSize(9).fillColor("#64748B").text(`Сформирован ORDA ERP · ${date(data.completedAt ?? data.updatedAt)}`, 60, 94);
  document.moveDown(3);
  document.font("Bold").fontSize(12).fillColor("#0F172A").text("Клиент и объект"); document.moveDown(0.6);
  row("Клиент", client.name); row("Телефон", client.phone); row("Город", data.city ?? client.city); row("Адрес", data.address ?? client.address);
  row("Заказ", order ? `${clean(order.number)} (${clean(order.status)})` : "Ещё не привязан"); row("Дата выезда", date(data.visitDate)); row("Замерщик", measurer?.name ?? data.measurer);
  document.moveDown(0.8); document.font("Bold").fontSize(12).text("Размеры лестницы"); document.moveDown(0.6);
  row("Количество ступеней", data.stepsCount); row("Размер ступени", data.sameSize ? `${clean(data.stepLength)} × ${clean(data.stepWidth)} × ${clean(data.stepHeight)} мм` : "Индивидуальные размеры — в приложении замера");
  row("Высота этажа", data.floorHeight ? `${data.floorHeight} мм` : "—"); row("Ширина лестницы", data.staircaseWidth ? `${data.staircaseWidth} мм` : "—");
  row("Высота подступенка", data.riserHeight ? `${data.riserHeight} мм` : "—"); row("Забежные / площадки", `${clean(data.winderCount, "0")} / ${clean(data.platformsCount, "0")}`);
  row("Ограждение", `${clean(data.railingLength, "0")} м`); row("Примечания", data.objectNotes);
  document.moveDown(0.8); document.font("Bold").fontSize(12).text("Окончательное предложение после замера"); document.moveDown(0.6);
  if (data.redactCommercial === true) {
    row("Материал", data.quoteMaterial);
    row("Коммерческая информация", "Доступна менеджеру и руководству компании");
  } else {
    row("Материал", data.quoteMaterial); row("Цена до скидки", data.quoteBasePrice ? money(data.quoteBasePrice) : "—"); row("Скидка на объекте", money(data.quoteDiscount));
    row("Окончательная цена", data.quoteFinalPrice ? money(data.quoteFinalPrice) : "Не согласована"); row("Комментарий", data.quoteComment); row("Окончательное КП", (data.finalProposal as Record<string, unknown> | null)?.number);
  }
  document.moveDown(1); const noticeY = document.y; document.roundedRect(42, noticeY, 511, 48, 6).fill("#EFF6FF");
  document.font("Regular").fontSize(8).fillColor("#334155").text("Документ сформирован из зафиксированных данных замера. Изменение завершённого замера требует нового визита или отдельного согласования в ORDA ERP.", 55, noticeY + 14, { width: 485 });
  document.end(); return complete;
}
