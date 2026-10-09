import QRCode from "qrcode";

import { cleanPdfText, pdfBuffer } from "@/lib/documents/pdf-utils";

export const PAYMENT_RECEIPT_TEMPLATE_VERSION = "ALTYN_SAPA_PAYMENT_RECEIPT_V2";

export type PaymentReceiptLineSnapshot = {
  sku?: string | null;
  name: string;
  variant?: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
};

export type PaymentReceiptSnapshot = {
  templateVersion: string;
  receiptNumber: number;
  displayNumber?: string;
  shiftNumber?: number;
  createdAt: string;
  businessDate: string;
  company: { name: string; bin: string; address: string; phones: string[] };
  client: { name: string; maskedName: string; city: string };
  order: { id: number; number: string };
  contract: { number: string | null; total: number };
  responsibleManager: { name: string; employeeCode?: string };
  registeredBy: { userId: number; name: string };
  payment: {
    id: number;
    amount: number;
    method: string;
    methodLabel: string;
    basis: string;
    operationDate: string;
    parts?: Array<{ method: string; methodLabel: string; amount: number; reference?: string | null }>;
  };
  totals: { paidBefore: number; paidAfter: number; remaining: number; overpayment: number };
  items: PaymentReceiptLineSnapshot[] | string[];
  verificationPath: string;
};

type ReceiptPaper = 80 | 58;
const POINTS_PER_MM = 72 / 25.4;
const money = (value: number) =>
  `${value.toLocaleString("ru-RU", { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 }).replaceAll(" ", " ")} ₸`;
const quantity = (value: number) =>
  value.toLocaleString("ru-RU", { maximumFractionDigits: 3 }).replaceAll(" ", " ");

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function normalizedItems(snapshot: PaymentReceiptSnapshot): PaymentReceiptLineSnapshot[] {
  return snapshot.items.map((item) => typeof item === "string" ? {
    name: item,
    unit: "усл.",
    quantity: 1,
    unitPrice: 0,
    discount: 0,
    total: 0,
  } : item);
}

function divider(document: PDFKit.PDFDocument, margin: number, width: number, y: number) {
  document.save().strokeColor("#B7B7B7").lineWidth(0.45)
    .moveTo(margin, y).lineTo(width - margin, y).stroke().restore();
}

function pair(
  document: PDFKit.PDFDocument,
  margin: number,
  width: number,
  label: string,
  value: string,
  y: number,
  bold = false,
) {
  const contentWidth = width - margin * 2;
  document.font("DejaVu").fontSize(6.6).fillColor("#555555")
    .text(label, margin, y, { width: contentWidth * 0.42, lineBreak: false });
  document.font(bold ? "DejaVuBold" : "DejaVu").fontSize(bold ? 7.7 : 7.1).fillColor("#111111")
    .text(cleanPdfText(value), margin + contentWidth * 0.42, y, {
      width: contentWidth * 0.58,
      align: "right",
      lineBreak: false,
      ellipsis: true,
    });
}

export async function buildPaymentReceiptPdf(
  snapshot: PaymentReceiptSnapshot,
  publicBaseUrl: string,
  paper: ReceiptPaper = 80,
) {
  const verificationUrl = `${publicBaseUrl.replace(/\/+$/, "")}${snapshot.verificationPath}`;
  const qr = await QRCode.toBuffer(verificationUrl, {
    type: "png",
    width: 240,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#FFFFFF" },
  });
  const items = normalizedItems(snapshot);
  const width = paper * POINTS_PER_MM;
  const margin = paper === 58 ? 7 : 10;
  const charsPerLine = paper === 58 ? 24 : 36;
  const itemHeight = items.reduce((sum, item) => {
    const title = `${item.sku ? `${item.sku} · ` : ""}${item.name}${item.variant ? ` · ${item.variant}` : ""}`;
    return sum + Math.max(1, Math.ceil(title.length / charsPerLine)) * 8 + 14;
  }, 0);
  const parts = snapshot.payment.parts?.length ? snapshot.payment.parts : [{
    method: snapshot.payment.method,
    methodLabel: snapshot.payment.methodLabel,
    amount: snapshot.payment.amount,
  }];
  const conditionalRows =
    (Math.abs(new Date(snapshot.createdAt).getTime() - new Date(snapshot.payment.operationDate).getTime()) > 60_000 ? 12 : 0) +
    (snapshot.totals.overpayment > 0 ? 12 : 0);
  const height = Math.max(paper === 58 ? 560 : 535, 456 + itemHeight + parts.length * 11 + conditionalRows);
  const displayNumber = snapshot.displayNumber ?? `PAY-${new Date(snapshot.payment.operationDate).getFullYear()}-${String(snapshot.receiptNumber).padStart(6, "0")}`;

  return pdfBuffer(
    {
      size: [width, height],
      margin: 0,
      autoFirstPage: true,
      info: {
        Title: `Квитанция об оплате ${displayNumber}`,
        Author: snapshot.company.name,
        Subject: "Подтверждение зарегистрированной оплаты в ORDA",
      },
    },
    (document) => {
      const contentWidth = width - margin * 2;
      document.rect(0, 0, width, height).fill("#FFFFFF");
      let y = 13;
      document.font("DejaVuBold").fontSize(paper === 58 ? 8.5 : 9.5).fillColor("#111111")
        .text(cleanPdfText(snapshot.company.name), margin, y, { width: contentWidth, align: "center" });
      y = document.y + 2;
      document.font("DejaVu").fontSize(6.5).fillColor("#444444")
        .text(`БИН ${cleanPdfText(snapshot.company.bin)}`, margin, y, { width: contentWidth, align: "center" });
      y = document.y + 1;
      if (snapshot.company.address) {
        document.text(cleanPdfText(snapshot.company.address), margin, y, { width: contentWidth, align: "center" });
        y = document.y + 1;
      }
      if (snapshot.company.phones.length) {
        document.text(snapshot.company.phones.join(" · "), margin, y, { width: contentWidth, align: "center" });
        y = document.y + 7;
      } else y += 7;
      divider(document, margin, width, y);
      y += 9;

      document.font("DejaVuBold").fontSize(paper === 58 ? 11 : 13).fillColor("#000000")
        .text("КВИТАНЦИЯ ОБ ОПЛАТЕ", margin, y, { width: contentWidth, align: "center" });
      y = document.y + 3;
      document.font("DejaVuBold").fontSize(8).text(displayNumber, margin, y, { width: contentWidth, align: "center" });
      y = document.y + 9;

      pair(document, margin, width, "Дата платежа", formatDateTime(snapshot.payment.operationDate), y);
      y += 12;
      if (Math.abs(new Date(snapshot.createdAt).getTime() - new Date(snapshot.payment.operationDate).getTime()) > 60_000) {
        pair(document, margin, width, "Сформировано", formatDateTime(snapshot.createdAt), y);
        y += 12;
      }
      pair(document, margin, width, "Операция", snapshot.payment.basis, y);
      y += 12;
      pair(document, margin, width, "Клиент", snapshot.client.name || "Не указан", y);
      y += 12;
      pair(document, margin, width, "Заказ", `№ ${snapshot.order.number}`, y);
      y += 12;
      pair(document, margin, width, "Договор", snapshot.contract.number ? `№ ${snapshot.contract.number}` : "Не указан", y);
      y += 12;
      pair(document, margin, width, "Менеджер", snapshot.responsibleManager.name, y);
      y += 12;
      pair(document, margin, width, "Оплату принял", snapshot.registeredBy.name, y, true);
      y += 15;
      divider(document, margin, width, y);
      y += 8;

      document.font("DejaVuBold").fontSize(7.5).fillColor("#111111")
        .text("ТОВАРЫ И УСЛУГИ", margin, y, { width: contentWidth });
      y = document.y + 5;
      items.forEach((item, index) => {
        const title = `${index + 1}. ${item.sku ? `${item.sku} · ` : ""}${item.name}${item.variant ? ` · ${item.variant}` : ""}`;
        document.font("DejaVuBold").fontSize(7).fillColor("#111111")
          .text(cleanPdfText(title), margin, y, { width: contentWidth, lineGap: 1 });
        y = document.y + 2;
        const detail = item.unitPrice || item.total
          ? `${quantity(item.quantity)} ${item.unit} × ${money(item.unitPrice)}${item.discount > 0 ? ` · скидка ${money(item.discount)}` : ""}`
          : `${quantity(item.quantity)} ${item.unit}`;
        document.font("DejaVu").fontSize(6.7).fillColor("#555555")
          .text(detail, margin, y, { width: contentWidth * 0.68 });
        document.font("DejaVuBold").fontSize(7).fillColor("#111111")
          .text(item.total ? money(item.total) : "", margin + contentWidth * 0.68, y, { width: contentWidth * 0.32, align: "right" });
        y = Math.max(document.y, y + 8) + 6;
      });
      divider(document, margin, width, y);
      y += 8;

      pair(document, margin, width, "Стоимость заказа", money(snapshot.contract.total), y);
      y += 12;
      pair(document, margin, width, "Оплачено ранее", money(snapshot.totals.paidBefore), y);
      y += 12;
      pair(document, margin, width, "Остаток после платежа", money(snapshot.totals.remaining), y);
      y += 12;
      if (snapshot.totals.overpayment > 0) {
        pair(document, margin, width, "Переплата", money(snapshot.totals.overpayment), y);
        y += 12;
      }
      document.font("DejaVuBold").fontSize(7).fillColor("#111111").text("СПОСОБ ОПЛАТЫ", margin, y);
      y += 10;
      parts.forEach((part) => {
        pair(document, margin, width, part.methodLabel, money(part.amount), y);
        y += 11;
      });
      y += 4;

      document.save().lineWidth(1).strokeColor("#111111").roundedRect(margin, y, contentWidth, 39, 3).stroke().restore();
      document.font("DejaVuBold").fontSize(paper === 58 ? 11 : 14).fillColor("#000000")
        .text(`ПРИНЯТО: ${money(snapshot.payment.amount)}`, margin + 4, y + 12, {
          width: contentWidth - 8,
          align: "center",
          lineBreak: false,
          ellipsis: true,
        });
      y += 49;
      document.image(qr, (width - 70) / 2, y, { width: 70, height: 70 });
      y += 73;
      document.font("DejaVu").fontSize(6.2).fillColor("#333333")
        .text("Открыть эту квитанцию в ORDA", margin, y, { width: contentWidth, align: "center" });
      y = document.y + 2;
      document.fontSize(5.5).fillColor("#666666")
        .text(verificationUrl, margin, y, { width: contentWidth, align: "center", ellipsis: true, lineBreak: false });
    },
  );
}
