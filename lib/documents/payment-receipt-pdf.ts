import QRCode from "qrcode";

import { amountToRussianWords } from "@/lib/contracts/domain";
import { cleanPdfText, DOCUMENT_COLORS, pdfBuffer } from "@/lib/documents/pdf-utils";

export const PAYMENT_RECEIPT_TEMPLATE_VERSION = "ALTYN_SAPA_PAYMENT_RECEIPT_V1";

export type PaymentReceiptSnapshot = {
  templateVersion: string;
  receiptNumber: number;
  shiftNumber: number;
  createdAt: string;
  businessDate: string;
  company: {
    name: string;
    bin: string;
    address: string;
    phones: string[];
  };
  client: { name: string; maskedName: string; city: string };
  order: { id: number; number: string };
  contract: { number: string | null; total: number };
  responsibleManager: { name: string; employeeCode: string };
  registeredBy: { userId: number; name: string };
  payment: {
    id: number;
    amount: number;
    method: string;
    methodLabel: string;
    basis: string;
    operationDate: string;
  };
  totals: {
    paidBefore: number;
    paidAfter: number;
    remaining: number;
    overpayment: number;
  };
  items: string[];
  verificationPath: string;
};

const A5 = { width: 419.53, height: 595.28, margin: 25 };
const money = (value: number) =>
  `${value.toLocaleString("ru-RU", { maximumFractionDigits: 0 }).replaceAll(" ", " ")} ₸`;

function sentenceCase(value: string) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function divider(document: PDFKit.PDFDocument, y: number) {
  document
    .save()
    .strokeColor(DOCUMENT_COLORS.line)
    .lineWidth(0.8)
    .dash(3, { space: 3 })
    .moveTo(A5.margin, y)
    .lineTo(A5.width - A5.margin, y)
    .stroke()
    .undash()
    .restore();
}

function row(document: PDFKit.PDFDocument, label: string, value: string, y: number, bold = false) {
  const width = A5.width - A5.margin * 2;
  document
    .font("DejaVu")
    .fontSize(7.8)
    .fillColor(DOCUMENT_COLORS.muted)
    .text(label, A5.margin, y, { width: width * 0.47 });
  document
    .font(bold ? "DejaVuBold" : "DejaVu")
    .fontSize(bold ? 9 : 8.2)
    .fillColor(DOCUMENT_COLORS.ink)
    .text(value, A5.margin + width * 0.47, y, {
      width: width * 0.53 - 5,
      align: "right",
    });
}

export async function buildPaymentReceiptPdf(
  snapshot: PaymentReceiptSnapshot,
  publicBaseUrl: string,
) {
  const verificationUrl = `${publicBaseUrl.replace(/\/+$/, "")}${snapshot.verificationPath}`;
  const qr = await QRCode.toBuffer(verificationUrl, {
    type: "png",
    width: 240,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#171717", light: "#FFFFFF" },
  });
  return pdfBuffer(
    {
      size: [A5.width, A5.height],
      margin: 0,
      autoFirstPage: true,
      info: {
        Title: `Квитанция об оплате №${snapshot.receiptNumber}`,
        Author: snapshot.company.name,
        Subject: "Нефискальное подтверждение оплаты по договору",
      },
    },
    (document) => {
      const width = A5.width - A5.margin * 2;
      document.rect(0, 0, A5.width, A5.height).fill(DOCUMENT_COLORS.paper);
      document.rect(A5.margin, 22, 3, 58).fill(DOCUMENT_COLORS.gold);
      document
        .font("DejaVuBold")
        .fontSize(8.5)
        .fillColor(DOCUMENT_COLORS.gold)
        .text(snapshot.company.name.toUpperCase(), A5.margin + 12, 22, {
          characterSpacing: 1,
          width: width - 12,
        });
      document
        .font("DejaVuBold")
        .fontSize(16)
        .fillColor(DOCUMENT_COLORS.ink)
        .text("КВИТАНЦИЯ ОБ ОПЛАТЕ", A5.margin + 12, 38, { width: width - 12 });
      document
        .font("DejaVuBold")
        .fontSize(7.5)
        .fillColor(DOCUMENT_COLORS.graphite)
        .text("НЕФИСКАЛЬНЫЙ ДОКУМЕНТ", A5.margin + 12, 61, {
          characterSpacing: 0.8,
        });
      document
        .font("DejaVu")
        .fontSize(7.5)
        .fillColor(DOCUMENT_COLORS.muted)
        .text(
          `БИН ${snapshot.company.bin}  ·  ${cleanPdfText(snapshot.company.address)}\n${snapshot.company.phones.join("  ·  ")}`,
          A5.margin,
          88,
          { width, align: "center", lineGap: 1 },
        );
      divider(document, 116);

      row(document, "Квитанция", `№${snapshot.receiptNumber}`, 124, true);
      row(document, "Внутренняя смена", `№${snapshot.shiftNumber}`, 139);
      const date = new Date(snapshot.payment.operationDate);
      row(
        document,
        "Дата и время",
        new Intl.DateTimeFormat("ru-RU", {
          timeZone: "Asia/Almaty",
          dateStyle: "short",
          timeStyle: "short",
        }).format(date),
        154,
      );
      row(document, "Ответственный менеджер / кассир", snapshot.responsibleManager.name, 169);
      row(document, "Код сотрудника", snapshot.responsibleManager.employeeCode, 184);
      divider(document, 202);

      row(document, "Клиент", cleanPdfText(snapshot.client.name), 210);
      row(document, "Заказ", snapshot.order.number, 225);
      row(document, "Договор", snapshot.contract.number ?? "Не указан", 240);
      row(document, "Город", cleanPdfText(snapshot.client.city), 255);
      document
        .font("DejaVu")
        .fontSize(7.8)
        .fillColor(DOCUMENT_COLORS.graphite)
        .text(`Основание: ${snapshot.payment.basis}`, A5.margin, 274, {
          width,
          align: "center",
        });
      divider(document, 290);

      document
        .font("DejaVuBold")
        .fontSize(8)
        .fillColor(DOCUMENT_COLORS.ink)
        .text("ТОВАРЫ И УСЛУГИ ПО ДОГОВОРУ", A5.margin, 299, { width });
      const items = snapshot.items.slice(0, 7);
      items.forEach((item, index) => {
        document
          .font("DejaVu")
          .fontSize(7.4)
          .fillColor(DOCUMENT_COLORS.graphite)
          .text(`${index + 1}. ${item}`, A5.margin, 315 + index * 11, {
            width,
            height: 10,
            ellipsis: true,
          });
      });
      divider(document, 395);

      document.roundedRect(A5.margin, 404, width, 91, 6).fill(DOCUMENT_COLORS.goldSoft);
      document
        .font("DejaVuBold")
        .fontSize(8)
        .fillColor(DOCUMENT_COLORS.gold)
        .text("ИТОГ", A5.margin + 12, 413);
      row(document, "Общая стоимость договора", money(snapshot.contract.total), 428);
      row(document, "Этот платёж", money(snapshot.payment.amount), 443, true);
      row(document, "Оплачено всего", money(snapshot.totals.paidAfter), 458);
      row(document, "Остаток", money(snapshot.totals.remaining), 473);
      if (snapshot.totals.overpayment > 0)
        row(document, "Переплата", money(snapshot.totals.overpayment), 488);
      document
        .font("DejaVu")
        .fontSize(7.2)
        .fillColor(DOCUMENT_COLORS.graphite)
        .text(
          `${sentenceCase(amountToRussianWords(Math.round(snapshot.payment.amount)))} тенге. · ${snapshot.payment.methodLabel} · Оплата подтверждена`,
          A5.margin,
          501,
          { width: width - 90, height: 25 },
        );

      document.image(qr, A5.width - A5.margin - 66, 504, { width: 66, height: 66 });
      document
        .font("DejaVuBold")
        .fontSize(7)
        .fillColor(DOCUMENT_COLORS.ink)
        .text("Проверить подлинность\nквитанции", A5.width - A5.margin - 146, 527, {
          width: 74,
          align: "right",
        });
      document
        .font("DejaVu")
        .fontSize(6.7)
        .fillColor(DOCUMENT_COLORS.muted)
        .text(
          "Нефискальное подтверждение оплаты по договору.\nНе является чеком контрольно-кассовой машины.",
          A5.margin,
          558,
          { width: width - 78, lineGap: 1 },
        );
    },
  );
}
