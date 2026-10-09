import { amountToRussianWords } from "@/lib/contracts/domain";
import { cleanPdfText, pdfBuffer } from "@/lib/documents/pdf-utils";

export const WAREHOUSE_SHIPMENT_TEMPLATE_VERSION = "ALTYN_SAPA_OUTGOING_INVOICE_V1";

export type WarehouseShipmentSnapshot = {
  templateVersion: string;
  number: string;
  shippedAt: string;
  company: { name: string; bin: string; address: string; phones: string[]; bankDetails?: string };
  buyer: { name: string; iinBin?: string; phone?: string; address?: string };
  basis: string;
  warehouse: { id: number; name: string; address: string };
  order: { id: number; number: string; contractNumber?: string | null };
  issuedBy: { userId: number; name: string };
  recipientName?: string | null;
  items: Array<{
    sku: string;
    name: string;
    variant?: string | null;
    unit: string;
    quantity: number;
    unitPrice: number;
    discount?: number;
    total: number;
  }>;
  totals: { amount: number; discount: number };
};

const PAGE = { width: 595.28, height: 841.89, margin: 36 };
const table = [24, 58, 165, 34, 64, 76, 86];
const money = (value: number) => value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replaceAll(" ", " ");
const number = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 3 }).replaceAll(" ", " ");

function tiynWord(value: number) {
  const lastTwo = value % 100;
  const last = value % 10;
  if (lastTwo >= 11 && lastTwo <= 19) return "тиынов";
  if (last === 1) return "тиын";
  if (last >= 2 && last <= 4) return "тиына";
  return "тиынов";
}

function amountWords(value: number) {
  const totalTiyn = Math.round(value * 100);
  const tenge = Math.floor(totalTiyn / 100);
  const tiyn = totalTiyn % 100;
  const words = amountToRussianWords(tenge);
  return `${words.slice(0, 1).toUpperCase()}${words.slice(1)} тенге ${String(tiyn).padStart(2, "0")} ${tiynWord(tiyn)}`;
}

function cell(
  document: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: { bold?: boolean; align?: "left" | "center" | "right"; size?: number } = {},
) {
  document.rect(x, y, width, height).strokeColor("#A3A3A3").lineWidth(0.45).stroke();
  document.font(options.bold ? "DejaVuBold" : "DejaVu").fontSize(options.size ?? 7.2).fillColor("#111111")
    .text(cleanPdfText(text, ""), x + 3, y + 4, { width: width - 6, height: height - 7, align: options.align ?? "left", ellipsis: true });
}

function tableHeader(document: PDFKit.PDFDocument, y: number) {
  const labels = ["№", "Артикул", "Товар", "Ед.", "Количество", "Цена", "Сумма"];
  let x = PAGE.margin;
  labels.forEach((label, index) => {
    document.rect(x, y, table[index], 25).fillAndStroke("#F2F2F2", "#777777");
    document.font("DejaVuBold").fontSize(6.6).fillColor("#111111")
      .text(label, x + 2, y + 8, { width: table[index] - 4, align: "center", lineBreak: false, ellipsis: true });
    x += table[index];
  });
  return y + 25;
}

function pageHeading(document: PDFKit.PDFDocument, snapshot: WarehouseShipmentSnapshot, continuation = false) {
  let y = PAGE.margin;
  if (!continuation) {
    document.font("DejaVuBold").fontSize(15).fillColor("#111111")
      .text(`Расходная накладная № ${snapshot.number}`, PAGE.margin, y, { width: PAGE.width - PAGE.margin * 2 });
    y = document.y + 2;
    document.font("DejaVu").fontSize(8).fillColor("#444444")
      .text(`от ${new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "long" }).format(new Date(snapshot.shippedAt))}`, PAGE.margin, y);
    y = document.y + 16;
    const details = [
      ["Поставщик", `${snapshot.company.name}, БИН ${snapshot.company.bin}${snapshot.company.address ? `, ${snapshot.company.address}` : ""}`],
      ["Покупатель", `${snapshot.buyer.name}${snapshot.buyer.iinBin ? `, ИИН/БИН ${snapshot.buyer.iinBin}` : ""}${snapshot.buyer.address ? `, ${snapshot.buyer.address}` : ""}`],
      ["Основание", snapshot.basis],
      ["Склад", `${snapshot.warehouse.name}${snapshot.warehouse.address ? `, ${snapshot.warehouse.address}` : ""}`],
    ];
    details.forEach(([label, value]) => {
      document.font("DejaVuBold").fontSize(7.5).fillColor("#333333").text(`${label}:`, PAGE.margin, y, { width: 70 });
      document.font("DejaVu").text(cleanPdfText(value), PAGE.margin + 72, y, { width: PAGE.width - PAGE.margin * 2 - 72 });
      y = Math.max(document.y + 4, y + 12);
    });
    y += 6;
  } else {
    document.font("DejaVuBold").fontSize(9).fillColor("#333333")
      .text(`Расходная накладная ${snapshot.number} · продолжение`, PAGE.margin, y);
    y = document.y + 10;
  }
  return tableHeader(document, y);
}

export async function buildWarehouseShipmentPdf(snapshot: WarehouseShipmentSnapshot) {
  return pdfBuffer({
    size: "A4",
    margin: 0,
    bufferPages: true,
    info: { Title: `Расходная накладная ${snapshot.number}`, Author: snapshot.company.name },
  }, (document) => {
    let y = pageHeading(document, snapshot);
    snapshot.items.forEach((item, index) => {
      const title = `${item.name}${item.variant ? ` · ${item.variant}` : ""}${item.discount ? ` (скидка ${money(item.discount)} ₸)` : ""}`;
      const nameHeight = document.font("DejaVu").fontSize(7.2).heightOfString(title, { width: table[2] - 6 });
      const rowHeight = Math.max(26, Math.min(58, nameHeight + 9));
      if (y + rowHeight > PAGE.height - 82) {
        document.addPage();
        y = pageHeading(document, snapshot, true);
      }
      const values = [String(index + 1), item.sku || "—", title, item.unit, number(item.quantity), money(item.unitPrice), money(item.total)];
      let x = PAGE.margin;
      values.forEach((value, column) => {
        cell(document, value, x, y, table[column], rowHeight, { align: column === 0 || column === 3 ? "center" : column >= 4 ? "right" : "left" });
        x += table[column];
      });
      y += rowHeight;
    });

    if (y + 125 > PAGE.height - 52) {
      document.addPage();
      y = PAGE.margin;
    } else y += 12;
    const rightX = PAGE.width - PAGE.margin - 230;
    if (snapshot.totals.discount > 0) {
      document.font("DejaVu").fontSize(8).text("Скидка:", rightX, y, { width: 110, align: "right" });
      document.font("DejaVuBold").text(`${money(snapshot.totals.discount)} ₸`, rightX + 116, y, { width: 114, align: "right" });
      y += 15;
    }
    document.font("DejaVuBold").fontSize(10).text("Итого:", rightX, y, { width: 110, align: "right" });
    document.text(`${money(snapshot.totals.amount)} ₸`, rightX + 116, y, { width: 114, align: "right" });
    y += 25;
    document.font("DejaVu").fontSize(8).fillColor("#222222")
      .text(`Всего отпущено на сумму: ${amountWords(snapshot.totals.amount)}.`, PAGE.margin, y, { width: PAGE.width - PAGE.margin * 2, lineGap: 2 });
    y = document.y + 34;
    document.font("DejaVu").fontSize(8).text(`Отпустил: ${snapshot.issuedBy.name}`, PAGE.margin, y, { width: 220 });
    document.text("Подпись: ____________________", PAGE.margin, y + 20, { width: 220 });
    document.text(`Получил: ${snapshot.recipientName || "____________________"}`, PAGE.width / 2 + 5, y, { width: 250 });
    document.text("Подпись: ____________________", PAGE.width / 2 + 5, y + 20, { width: 250 });

    const range = document.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
      document.switchToPage(range.start + index);
      document.font("DejaVu").fontSize(7).fillColor("#777777")
        .text(`Страница ${index + 1} из ${range.count}`, PAGE.margin, PAGE.height - 30, { width: PAGE.width - PAGE.margin * 2, align: "center", lineBreak: false });
    }
  });
}
