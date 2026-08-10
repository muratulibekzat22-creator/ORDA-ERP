import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildCustomerMemoPdf, CUSTOMER_MEMO_TEMPLATE_VERSION } from "@/lib/documents/customer-memo-pdf";
import { buildPaymentReceiptPdf, PAYMENT_RECEIPT_TEMPLATE_VERSION } from "@/lib/documents/payment-receipt-pdf";

async function main() {
  const output = path.resolve(process.argv[2] ?? ".tmp/contract-package-visuals");
  await mkdir(output, { recursive: true });
  const createdAt = "2026-08-10T08:30:00.000Z";
  const memo = await buildCustomerMemoPdf({
    templateVersion: CUSTOMER_MEMO_TEMPLATE_VERSION,
    orderNumber: "ORD-000125",
    contractNumber: "ДОГ-000125",
    clientFullName: "Алиев Талгат Серикович",
    installationAddress: "г. Алматы, ул. Абая, 125",
    productionContactName: "Ответственный по производству",
    productionContactPhone: "+7 700 000 00 00",
    companyName: "ALTYN SAPA COMPANY",
    companyPhones: ["+7 708 575 0881", "+7 776 002 7555"],
    createdAt,
  });
  const receipt = await buildPaymentReceiptPdf({
    templateVersion: PAYMENT_RECEIPT_TEMPLATE_VERSION,
    receiptNumber: 10256,
    shiftNumber: 8001,
    createdAt,
    businessDate: "2026-08-10",
    company: {
      name: "ALTYN SAPA COMPANY",
      bin: "220540017969",
      address: "г. Алматы",
      phones: ["+7 708 575 0881", "+7 776 002 7555"],
    },
    client: { name: "Алиев Талгат Серикович", maskedName: "А*** Т*** С***", city: "Алматы" },
    order: { id: 125, number: "ORD-000125" },
    contract: { number: "ДОГ-000125", total: 3_000_000 },
    responsibleManager: { name: "Гулсим", employeeCode: "MGR-0001" },
    registeredBy: { userId: 1, name: "Бекзат" },
    payment: {
      id: 1,
      amount: 1_000_000,
      method: "KASPI_TRANSFER",
      methodLabel: "Kaspi перевод",
      basis: "Авансовый платёж по договору №ДОГ-000125",
      operationDate: createdAt,
    },
    totals: { paidBefore: 500_000, paidAfter: 1_500_000, remaining: 1_500_000, overpayment: 0 },
    items: [
      "Изготовление лестницы · дуб ламель",
      "Металлический каркас",
      "Стеклянное ограждение",
      "Монтажные работы",
      "Подсветка · LED",
      "Обшивка · дуб",
    ],
    verificationPath: "/verify/payment-receipt/visual-test-token-not-for-production",
  }, "https://orda.test.invalid");
  await Promise.all([
    writeFile(path.join(output, "customer-memo.pdf"), memo),
    writeFile(path.join(output, "payment-receipt.pdf"), receipt),
  ]);
  console.log(output);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
