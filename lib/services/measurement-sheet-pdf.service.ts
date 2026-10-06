import path from "node:path";
import PDFDocument from "pdfkit";

type SheetData = Record<string, unknown>;
const money = (value: unknown) => `${Number(value ?? 0).toLocaleString("ru-RU")} ₸`;
const clean = (value: unknown, fallback = "—") => String(value ?? "").trim() || fallback;
const copy = {
  ru: {
    title: "ЗАМЕРНЫЙ ЛИСТ", generated: "Сформирован ORDA ERP", clientObject: "Клиент и объект",
    client: "Клиент", phone: "Телефон", city: "Город", address: "Адрес", order: "Заказ",
    notLinked: "Ещё не привязан", visitDate: "Дата выезда", measurer: "Замерщик",
    dimensions: "Размеры лестницы", steps: "Количество ступеней", stepSize: "Размер ступени",
    individual: "Индивидуальные размеры — в приложении замера", floorHeight: "Высота этажа",
    staircaseWidth: "Ширина лестницы", riserHeight: "Высота подступенка",
    windersPlatforms: "Забежные / площадки", railing: "Ограждение", notes: "Примечания",
    offer: "Окончательное предложение после замера", material: "Материал",
    commercial: "Коммерческая информация", commercialPrivate: "Доступна менеджеру и руководству компании",
    priceBefore: "Цена до скидки", discount: "Скидка на объекте", finalPrice: "Окончательная цена",
    notAgreed: "Не согласована", comment: "Комментарий", finalOffer: "Окончательное КП",
    notice: "Документ сформирован из зафиксированных данных замера. Изменение завершённого замера требует нового визита или отдельного согласования в ORDA ERP.",
  },
  uz: {
    title: "O‘LCHOV VARAQASI", generated: "ORDA ERP tizimida yaratildi", clientObject: "Mijoz va obyekt",
    client: "Mijoz", phone: "Telefon", city: "Shahar", address: "Manzil", order: "Buyurtma",
    notLinked: "Hali biriktirilmagan", visitDate: "O‘lchov sanasi", measurer: "O‘lchovni bajardi",
    dimensions: "Zina o‘lchamlari", steps: "Pog‘onalar soni", stepSize: "Pog‘ona o‘lchami",
    individual: "Har bir pog‘ona o‘lchami alohida kiritilgan", floorHeight: "Qavat balandligi",
    staircaseWidth: "Zina kengligi", riserHeight: "Podstupenok balandligi",
    windersPlatforms: "Zabejniy pog‘ona / maydoncha", railing: "Perila", notes: "Izohlar",
    offer: "O‘lchovdan keyingi yakuniy taklif", material: "Material",
    commercial: "Tijorat ma’lumoti", commercialPrivate: "Menejer va kompaniya rahbariyatiga ko‘rinadi",
    priceBefore: "Chegirmagacha narx", discount: "Obyektdagi chegirma", finalPrice: "Yakuniy narx",
    notAgreed: "Kelishilmagan", comment: "Izoh", finalOffer: "Yakuniy tijorat taklifi",
    notice: "Hujjat saqlangan o‘lchov ma’lumotlari asosida yaratildi. Yakunlangan o‘lchovni o‘zgartirish uchun yangi nazorat o‘lchovi yarating.",
  },
} as const;

export async function buildMeasurementSheetPdf(data: SheetData) {
  const language = data.language === "uz" ? "uz" : "ru";
  const text = copy[language];
  const date = (value: unknown) => new Intl.DateTimeFormat(language === "uz" ? "uz-UZ" : "ru-RU", { timeZone: "Asia/Almaty", dateStyle: "long", timeStyle: "short" }).format(new Date(String(value)));
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
  document.font("Bold").fontSize(20).fillColor("#0F172A").text(text.title, 60, 45);
  document.font("Bold").fontSize(11).fillColor("#2563EB").text(`№ ZM-${data.id}`, 60, 75);
  document.font("Regular").fontSize(9).fillColor("#64748B").text(`${text.generated} · ${date(data.completedAt ?? data.updatedAt)}`, 60, 94);
  document.moveDown(3);
  document.font("Bold").fontSize(12).fillColor("#0F172A").text(text.clientObject); document.moveDown(0.6);
  row(text.client, client.name); row(text.phone, client.phone); row(text.city, data.city ?? client.city); row(text.address, data.address ?? client.address);
  row(text.order, order ? `${clean(order.number)} (${clean(order.status)})` : text.notLinked); row(text.visitDate, date(data.visitDate)); row(text.measurer, measurer?.name ?? data.measurer);
  document.moveDown(0.8); document.font("Bold").fontSize(12).text(text.dimensions); document.moveDown(0.6);
  row(text.steps, data.stepsCount); row(text.stepSize, data.sameSize ? `${clean(data.stepLength)} × ${clean(data.stepWidth)} × ${clean(data.stepHeight)} мм` : text.individual);
  row(text.floorHeight, data.floorHeight ? `${data.floorHeight} мм` : "—"); row(text.staircaseWidth, data.staircaseWidth ? `${data.staircaseWidth} мм` : "—");
  row(text.riserHeight, data.riserHeight ? `${data.riserHeight} мм` : "—"); row(text.windersPlatforms, `${clean(data.winderCount, "0")} / ${clean(data.platformsCount, "0")}`);
  row(text.railing, `${clean(data.railingLength, "0")} м`); row(text.notes, data.objectNotes);
  document.moveDown(0.8); document.font("Bold").fontSize(12).text(text.offer); document.moveDown(0.6);
  if (data.redactCommercial === true) {
    row(text.material, data.quoteMaterial);
    row(text.commercial, text.commercialPrivate);
  } else {
    row(text.material, data.quoteMaterial); row(text.priceBefore, data.quoteBasePrice ? money(data.quoteBasePrice) : "—"); row(text.discount, money(data.quoteDiscount));
    row(text.finalPrice, data.quoteFinalPrice ? money(data.quoteFinalPrice) : text.notAgreed); row(text.comment, data.quoteComment); row(text.finalOffer, (data.finalProposal as Record<string, unknown> | null)?.number);
  }
  document.moveDown(1); const noticeY = document.y; document.roundedRect(42, noticeY, 511, 48, 6).fill("#EFF6FF");
  document.font("Regular").fontSize(8).fillColor("#334155").text(text.notice, 55, noticeY + 14, { width: 485 });
  document.end(); return complete;
}
