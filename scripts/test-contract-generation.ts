import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import PizZip from "pizzip";

import { amountToRussianWords, calculatePayment, type ContractSnapshot } from "@/lib/contracts/domain";
import { generateContractDocx } from "@/lib/contracts/docx";

async function main() {
const documentsUi = readFileSync("components/pages/DocumentsPage.tsx", "utf8");
const orderDocumentsUi = readFileSync("components/orders/tabs/DocumentsTab.tsx", "utf8");
assert(documentsUi.includes("ContractComposer") && documentsUi.includes("Сформировать договор") && documentsUi.includes("Выберите заказ"), "ContractComposer is not reachable from Documents");
assert(orderDocumentsUi.includes("ContractComposer"), "ContractComposer is not reachable from Order Documents");
assert(documentsUi.includes("PAYMENT_RECEIPT") && documentsUi.includes("Без Payment — только файл подтверждения"), "payment confirmation workflow is missing");
assert.equal(amountToRussianWords(1_500_000), "один миллион пятьсот тысяч");
assert.equal(amountToRussianWords(150_000), "сто пятьдесят тысяч");
assert.deepEqual(calculatePayment(1_000_000, { mode: "AMOUNT", prepaymentAmount: 150_000 }), { prepaymentAmount: 150_000, prepaymentPercent: "15", balanceAmount: 850_000, balancePercent: "85", isFullPayment: false });
assert.deepEqual(calculatePayment(1_000_000, { mode: "PERCENT", prepaymentPercent: 70 }), { prepaymentAmount: 700_000, prepaymentPercent: "70", balanceAmount: 300_000, balancePercent: "30", isFullPayment: false });
assert.equal(calculatePayment(1_000_000, { mode: "PERCENT", prepaymentPercent: 100 }).isFullPayment, true);
assert.throws(() => calculatePayment(1_000_000, { mode: "PERCENT", prepaymentPercent: 101 }), /INVALID_PAYMENT/);

const base: ContractSnapshot = {
  contractNumber: "ДОГ-000001", contractDateIso: "2026-08-09T07:00:00.000Z", contractTime: "12:00", contractDay: "09", contractMonth: "августа", contractYear: "2026", contractCity: "Алматы",
  clientFullName: "Иванов Иван Иванович", clientIin: "990101300001", clientPhone: "+7 700 000 00 00", clientAddress: "Алматы", installationAddress: "Алматы, Абая 1", stairMaterial: "Сосна", balusterType: "Классика",
  contractAmount: "1 000 000", contractAmountWords: "один миллион", contractAmountNumeric: 1_000_000, prepaymentPercent: "70", prepaymentAmount: "700 000", prepaymentAmountWords: "семьсот тысяч", prepaymentAmountNumeric: 700_000,
  balancePercent: "30", balanceAmount: "300 000", balanceAmountWords: "триста тысяч", balanceAmountNumeric: 300_000, isFullPayment: false, prepaymentDueText: "в день подписания настоящего Договора", balanceDueText: "после завершения монтажа", fullPaymentDueText: "в день подписания настоящего Договора",
  termCalendarDays: "45", termStartCondition: "с даты внесения первого платежа", plannedCompletionDate: "23.09.2026", warrantyText: "6 месяцев", directorFullName: "Директор Директоров", productionContactName: "Мастер", productionContactPhone: "+7 700 111 22 33",
  companyName: "Тестовая компания", companyBin: "123456789012", companyIik: "KZ001", companyBank: "Тест Банк", companyBik: "TESTKZ", companyPhone: "+7 700 999 8877", companyPhones: ["+7 700 999 8877", "+7 776 002 7555"], companyAddress: "Алматы, Тестовая 1",
};

function xml(buffer: Buffer) { const zip = new PizZip(buffer); return zip.file("word/document.xml")?.asText() ?? ""; }
const splitXml = xml(await generateContractDocx(base));
assert(!splitXml.includes("{{"), "unresolved placeholder");
assert(splitXml.includes("700 000") && splitXml.includes("300 000"), "split payment missing");
assert(!splitXml.includes("fullPaymentDueText"), "full payment marker leaked");
assert.equal((splitXml.match(/<w:tbl>/g) ?? []).length, 2, "template tables changed");
assert(splitXml.includes("<w:sectPr"), "section settings missing");
assert(splitXml.includes("Тестовая компания") && !splitXml.includes("220540017969"), "company settings were not substituted");
assert(splitXml.includes("+7 700 999 8877") && splitXml.includes("+7 776 002 7555"), "contract does not contain both canonical company phones");
assert(splitXml.includes("<w:br/>"), "contract company phones are not separated into readable lines");

const fullXml = xml(await generateContractDocx({ ...base, prepaymentPercent: "100", prepaymentAmount: "1 000 000", prepaymentAmountWords: "один миллион", prepaymentAmountNumeric: 1_000_000, balancePercent: "0", balanceAmount: "0", balanceAmountWords: "ноль", balanceAmountNumeric: 0, isFullPayment: true }));
assert(!fullXml.includes("balancePercent") && !fullXml.includes("balanceAmount"), "100% contract contains balance markers");
assert(fullXml.includes("100%"), "100% clause missing");
assert.equal((fullXml.match(/<w:tbl>/g) ?? []).length, 2, "100% template tables changed");

console.log("contract generation: amount words, 70/30, 15/85, 100%, placeholders and OOXML structure passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
