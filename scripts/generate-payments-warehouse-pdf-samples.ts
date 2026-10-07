import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  buildPaymentReceiptPdf,
  PAYMENT_RECEIPT_TEMPLATE_VERSION,
  type PaymentReceiptSnapshot,
} from "@/lib/documents/payment-receipt-pdf";
import {
  buildRefundConfirmationPdf,
  REFUND_CONFIRMATION_TEMPLATE_VERSION,
  type RefundConfirmationSnapshot,
} from "@/lib/documents/refund-confirmation-pdf";
import {
  buildWarehouseShipmentPdf,
  WAREHOUSE_SHIPMENT_TEMPLATE_VERSION,
  type WarehouseShipmentSnapshot,
} from "@/lib/documents/warehouse-shipment-pdf";

const outputDir = join(process.cwd(), "output", "pdf");
const createdAt = "2026-10-07T09:15:00.000Z";
const company = {
  name: "ALTYN SAPA COMPANY",
  bin: "220540017969",
  address: "г. Алматы, ул. Муканова, 101",
  phones: ["+7 708 575 08 81", "+7 776 002 75 55"],
};

async function main() {
  await mkdir(outputDir, { recursive: true });

  const receipt: PaymentReceiptSnapshot = {
    templateVersion: PAYMENT_RECEIPT_TEMPLATE_VERSION,
    receiptNumber: 10256,
    displayNumber: "PAY-2026-010256",
    shiftNumber: 8001,
    createdAt,
    businessDate: "2026-10-07",
    company,
    client: { name: "Алиев Талгат Серикович", maskedName: "Алиев Т. С.", city: "Алматы" },
    order: { id: 9001, number: "ORD-2026-009001" },
    contract: { number: "AS-2026-009001", total: 285_000 },
    responsibleManager: { name: "Гульсим Нурбекова", employeeCode: "M-014" },
    registeredBy: { userId: 1, name: "Бекзат Нурланович" },
    payment: {
      id: 15001,
      amount: 165_000,
      method: "MIXED",
      methodLabel: "Смешанная оплата",
      basis: "Оплата розничного заказа",
      operationDate: createdAt,
      parts: [
        { method: "Наличные", methodLabel: "Наличные", amount: 65_000 },
        { method: "Kaspi перевод", methodLabel: "Kaspi перевод", amount: 100_000, reference: "KP-7012" },
      ],
    },
    totals: { paidBefore: 0, paidAfter: 165_000, remaining: 120_000, overpayment: 0 },
    items: [
      { sku: "MSP-200-GOLD", name: "Мини-стойка для стеклянного ограждения", variant: "200 мм · золотистая", unit: "шт.", quantity: 4, unitPrice: 45_000, discount: 0, total: 180_000 },
      { sku: "MSP-200-BLACK-MATTE", name: "Мини-стойка для стеклянного ограждения", variant: "200 мм · чёрная матовая", unit: "шт.", quantity: 3, unitPrice: 35_000, discount: 0, total: 105_000 },
    ],
    verificationPath: "/verify/payment-receipt/sample-token-not-active",
  };

  const invoiceItems = Array.from({ length: 34 }, (_, index) => {
    const quantity = index % 3 + 1;
    const unitPrice = 12_500 + index * 375;
    return {
      sku: `MSP-SAMPLE-${String(index + 1).padStart(3, "0")}`,
      name: "Мини-стойка для стеклянного ограждения",
      variant: `${200 + (index % 4) * 10} мм · ${["золотистая", "розовое золото", "белая", "чёрная матовая"][index % 4]}`,
      unit: "шт.",
      quantity,
      unitPrice,
      discount: 0,
      total: quantity * unitPrice,
    };
  });
  const invoiceTotal = invoiceItems.reduce((sum, item) => sum + item.total, 0);
  const invoice: WarehouseShipmentSnapshot = {
    templateVersion: WAREHOUSE_SHIPMENT_TEMPLATE_VERSION,
    number: "OUT-2026-000042",
    shippedAt: createdAt,
    company: { ...company, bankDetails: "ИИК KZ188562203118864809 · БИК KCJBKZKX" },
    buyer: { name: "ТОО «Демонстрационный покупатель»", iinBin: "123456789012", phone: "+7 700 000 00 00", address: "г. Алматы, пр. Абая, 125" },
    basis: "Заказ ORD-2026-009001 / договор AS-2026-009001",
    warehouse: { id: 1, name: "Офис / Шоурум", address: "г. Алматы, ул. Муканова, 101" },
    order: { id: 9001, number: "ORD-2026-009001", contractNumber: "AS-2026-009001" },
    issuedBy: { userId: 1, name: "Бекзат Нурланович" },
    recipientName: "Алиев Талгат Серикович",
    items: invoiceItems,
    totals: { amount: invoiceTotal, discount: 0 },
  };

  const refund: RefundConfirmationSnapshot = {
    templateVersion: REFUND_CONFIRMATION_TEMPLATE_VERSION,
    number: "REF-2026-000007",
    createdAt,
    company,
    client: { name: "Алиев Талгат Серикович" },
    order: { id: 9001, number: "ORD-2026-009001" },
    originalPayment: { id: 15001, receiptNumber: "PAY-2026-010256", paidAt: createdAt, amount: 165_000 },
    refund: {
      id: 7001,
      amount: 45_000,
      method: "MIXED",
      parts: [
        { method: "Наличные", amount: 15_000 },
        { method: "Kaspi перевод", amount: 30_000 },
      ],
      reason: "Частичный возврат оплаты по согласованию с клиентом",
      refundedAt: "2026-10-07T11:40:00.000Z",
    },
    processedBy: { userId: 1, name: "Бекзат Нурланович" },
  };

  const [receiptPdf, invoicePdf, refundPdf] = await Promise.all([
    buildPaymentReceiptPdf(receipt, "https://orda.example.invalid", 80),
    buildWarehouseShipmentPdf(invoice),
    buildRefundConfirmationPdf(refund),
  ]);
  await Promise.all([
    writeFile(join(outputDir, "ORDA-payment-receipt-sample.pdf"), receiptPdf),
    writeFile(join(outputDir, "ORDA-outgoing-invoice-sample.pdf"), invoicePdf),
    writeFile(join(outputDir, "ORDA-refund-confirmation-sample.pdf"), refundPdf),
  ]);
  console.log(`Created 3 PDF samples in ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
