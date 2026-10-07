import { cleanPdfText, pdfBuffer } from "@/lib/documents/pdf-utils";

export const REFUND_CONFIRMATION_TEMPLATE_VERSION = "ALTYN_SAPA_REFUND_CONFIRMATION_V1";

export type RefundConfirmationSnapshot = {
  templateVersion: string;
  number: string;
  createdAt: string;
  company: { name: string; bin: string; address: string; phones: string[] };
  client: { name: string };
  order: { id: number; number: string };
  originalPayment: { id: number; receiptNumber?: string | null; paidAt: string; amount: number };
  refund: { id: number; amount: number; method: string; parts: Array<{ method: string; amount: number }>; reason: string; refundedAt: string };
  processedBy: { userId: number; name: string };
};

const WIDTH = 80 * 72 / 25.4;
const money = (value: number) => `${value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replaceAll(" ", " ")} ₸`;
const date = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "short", timeStyle: "short" }).format(new Date(value));

export async function buildRefundConfirmationPdf(snapshot: RefundConfirmationSnapshot) {
  const height = 420 + snapshot.refund.parts.length * 12;
  return pdfBuffer({ size: [WIDTH, height], margin: 0, info: { Title: `Подтверждение возврата ${snapshot.number}`, Author: snapshot.company.name } }, (document) => {
    const margin = 10, content = WIDTH - margin * 2;
    document.rect(0, 0, WIDTH, height).fill("#FFFFFF");
    let y = 15;
    document.font("DejaVuBold").fontSize(9).fillColor("#111111").text(cleanPdfText(snapshot.company.name), margin, y, { width: content, align: "center" });
    y = document.y + 2;
    document.font("DejaVu").fontSize(6.5).fillColor("#555555").text(`БИН ${snapshot.company.bin}`, margin, y, { width: content, align: "center" });
    y = document.y + 12;
    document.moveTo(margin, y).lineTo(WIDTH - margin, y).lineWidth(0.5).strokeColor("#AAAAAA").stroke();
    y += 12;
    document.font("DejaVuBold").fontSize(12).fillColor("#000000").text("ПОДТВЕРЖДЕНИЕ ВОЗВРАТА", margin, y, { width: content, align: "center" });
    y = document.y + 4;
    document.fontSize(8).text(snapshot.number, margin, y, { width: content, align: "center" });
    y = document.y + 14;
    const rows: Array<[string, string]> = [
      ["Дата возврата", date(snapshot.refund.refundedAt)],
      ["Клиент", snapshot.client.name],
      ["Заказ", `№ ${snapshot.order.number}`],
      ["Исходная квитанция", snapshot.originalPayment.receiptNumber ?? `Платёж № ${snapshot.originalPayment.id}`],
      ["Дата исходной оплаты", date(snapshot.originalPayment.paidAt)],
      ["Причина", snapshot.refund.reason],
      ["Оформил", snapshot.processedBy.name],
    ];
    rows.forEach(([label, value]) => {
      document.font("DejaVu").fontSize(6.7).fillColor("#666666").text(label, margin, y, { width: 75 });
      document.font("DejaVuBold").fontSize(7.1).fillColor("#111111").text(cleanPdfText(value), margin + 77, y, { width: content - 77, align: "right" });
      y = Math.max(document.y + 6, y + 13);
    });
    document.moveTo(margin, y).lineTo(WIDTH - margin, y).lineWidth(0.5).strokeColor("#AAAAAA").stroke();
    y += 10;
    document.font("DejaVuBold").fontSize(7).fillColor("#111111").text("СПОСОБ ВОЗВРАТА", margin, y);
    y += 11;
    snapshot.refund.parts.forEach((part) => {
      document.font("DejaVu").fontSize(7).text(part.method, margin, y, { width: content * 0.6 });
      document.font("DejaVuBold").text(money(part.amount), margin + content * 0.6, y, { width: content * 0.4, align: "right" });
      y += 12;
    });
    y += 6;
    document.rect(margin, y, content, 42).lineWidth(1).strokeColor("#111111").stroke();
    const totalLabel = `ВОЗВРАЩЕНО: ${money(snapshot.refund.amount)}`;
    const totalFontSize = totalLabel.length > 26 ? 9.5 : totalLabel.length > 22 ? 10.5 : 12;
    document.font("DejaVuBold").fontSize(totalFontSize).fillColor("#000000").text(totalLabel, margin + 4, y + 14, { width: content - 8, align: "center", lineBreak: false, ellipsis: true });
    y += 58;
    document.font("DejaVu").fontSize(6.3).fillColor("#555555").text("Возврат товара и возврат денег учитываются как отдельные связанные операции.", margin, y, { width: content, align: "center" });
  });
}
