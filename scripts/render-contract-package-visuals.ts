import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ContractSnapshot } from "@/lib/contracts/domain";
import { buildContractPdf } from "@/lib/documents/contract-pdf";
import { buildCustomerMemoPdf, CUSTOMER_MEMO_TEMPLATE_VERSION } from "@/lib/documents/customer-memo-pdf";
import { buildPaymentReceiptPdf, PAYMENT_RECEIPT_TEMPLATE_VERSION } from "@/lib/documents/payment-receipt-pdf";

async function main() {
  const output = path.resolve(process.argv[2] ?? ".tmp/contract-package-visuals");
  await mkdir(output, { recursive: true });
  const createdAt = "2026-08-10T08:30:00.000Z";
  const contractSnapshot: ContractSnapshot = {
    contractNumber: "ДОГ-000125",
    orderNumber: "ORD-000125",
    contractDateIso: createdAt,
    contractTime: "13:30",
    contractDay: "10",
    contractMonth: "августа",
    contractYear: "2026",
    contractCity: "Алматы",
    clientFullName: "Алиев Талгат Серикович",
    clientIin: "900101300001",
    clientPhone: "+7 700 000 00 01",
    clientAddress: "г. Алматы, ул. Абая, 125, кв. 15",
    clientCity: "Алматы",
    installationAddress: "г. Алматы, мкр. Самал-2, дом 48",
    stairMaterial: "Дуб ламель премиального сорта",
    frameType: "Металлический каркас",
    frameComment: "закрытый косоур",
    balusterType: "Стеклянное ограждение с поручнем из дуба",
    supportType: "Нержавеющая сталь",
    color: "Орех",
    lightingText: "Предусмотрена · LED-подсветка ступеней",
    claddingText: "Предусмотрена · дуб",
    deliveryText: "Включена",
    installationText: "Включён",
    additionalDetails: "Защитная обработка и финишное покрытие",
    contractAmount: "3 000 000",
    contractAmountWords: "три миллиона",
    contractAmountNumeric: 3_000_000,
    prepaymentPercent: "70",
    prepaymentAmount: "2 100 000",
    prepaymentAmountWords: "два миллиона сто тысяч",
    prepaymentAmountNumeric: 2_100_000,
    balancePercent: "30",
    balanceAmount: "900 000",
    balanceAmountWords: "девятьсот тысяч",
    balanceAmountNumeric: 900_000,
    isFullPayment: false,
    paymentSchedulePrimary: "2 100 000 ₸ · 70%",
    paymentScheduleBalance: "900 000 ₸ · 30%",
    prepaymentDueText: "в день подписания настоящего Договора",
    balanceDueText: "после завершения монтажа",
    fullPaymentDueText: "в день подписания настоящего Договора",
    termCalendarDays: "45",
    termStartCondition: "внесения первого платежа",
    plannedCompletionDate: "24.09.2026",
    warrantyText: "5 лет",
    directorFullName: "Бекзат Нурланович",
    productionContactName: "Ответственный по производству",
    productionContactPhone: "+7 700 000 00 00",
    companyName: "ALTYN SAPA COMPANY",
    companyBin: "220540017969",
    companyIik: "KZ188562203118864809",
    companyBank: "АО Банк ЦентрКредит",
    companyBik: "KCJBKZKX",
    companyPhone: "+7 708 575 0881",
    companyPhones: ["+7 708 575 0881", "+7 776 002 7555"],
    companyAddress: "г. Алматы, ул. Муканова, 101",
  };
  const contract = await buildContractPdf(contractSnapshot);
  const fullPaymentContract = await buildContractPdf({
    ...contractSnapshot,
    prepaymentPercent: "100",
    prepaymentAmount: contractSnapshot.contractAmount,
    prepaymentAmountWords: contractSnapshot.contractAmountWords,
    prepaymentAmountNumeric: contractSnapshot.contractAmountNumeric,
    balancePercent: "0",
    balanceAmount: "0",
    balanceAmountWords: "ноль",
    balanceAmountNumeric: 0,
    isFullPayment: true,
    paymentSchedulePrimary: `100% · ${contractSnapshot.contractAmount} ₸`,
    paymentScheduleBalance: "Полная оплата",
  });
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
    writeFile(path.join(output, "contract.pdf"), contract),
    writeFile(path.join(output, "contract-100-percent.pdf"), fullPaymentContract),
    writeFile(path.join(output, "customer-memo.pdf"), memo),
    writeFile(path.join(output, "payment-receipt.pdf"), receipt),
  ]);
  console.log(output);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
