import type { ContractSnapshot } from "@/lib/contracts/domain";
import {
  cleanPdfText,
  DOCUMENT_COLORS,
  pdfBuffer,
} from "@/lib/documents/pdf-utils";

export const CONTRACT_PDF_TEMPLATE_VERSION = "ALTYN_SAPA_CONTRACT_PDF_V1";
export const CONTRACT_PDF_PAGE_COUNT = 3;

const PAGE = { width: 595.28, height: 841.89, margin: 36 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const CONTENT_BOTTOM = 796;

type PdfDocument = PDFKit.PDFDocument;

function assertRoom(y: number, height: number) {
  if (y + height > CONTENT_BOTTOM) throw new Error("CONTRACT_PDF_LAYOUT_OVERFLOW");
}

function pageChrome(
  document: PdfDocument,
  snapshot: ContractSnapshot,
  page: number,
) {
  document
    .font("DejaVuBold")
    .fontSize(7.5)
    .fillColor(DOCUMENT_COLORS.gold)
    .text(snapshot.companyName.toUpperCase(), PAGE.margin, 22, {
      width: CONTENT_WIDTH,
      align: "right",
      characterSpacing: 0.8,
    });
  document
    .moveTo(PAGE.margin, 35)
    .lineTo(PAGE.width - PAGE.margin, 35)
    .lineWidth(0.6)
    .strokeColor(DOCUMENT_COLORS.line)
    .stroke();
  document
    .font("DejaVu")
    .fontSize(7)
    .fillColor(DOCUMENT_COLORS.muted)
    .text(
      `Договор №${snapshot.contractNumber} · Страница ${page} из ${CONTRACT_PDF_PAGE_COUNT}`,
      PAGE.margin,
      812,
      { width: CONTENT_WIDTH, align: "center" },
    );
}

function heading(document: PdfDocument, value: string, y: number) {
  assertRoom(y, 16);
  document
    .font("DejaVuBold")
    .fontSize(9)
    .fillColor(DOCUMENT_COLORS.gold)
    .text(value, PAGE.margin, y, { width: CONTENT_WIDTH });
  return y + 16;
}

function paragraph(
  document: PdfDocument,
  value: string,
  y: number,
  options: { bold?: boolean; size?: number; gap?: number } = {},
) {
  const size = options.size ?? 7.8;
  const gap = options.gap ?? 3;
  document.font(options.bold ? "DejaVuBold" : "DejaVu").fontSize(size);
  const height = document.heightOfString(value, {
    width: CONTENT_WIDTH,
    lineGap: 0.8,
  });
  assertRoom(y, height);
  document
    .fillColor(DOCUMENT_COLORS.ink)
    .text(value, PAGE.margin, y, {
      width: CONTENT_WIDTH,
      lineGap: 0.8,
      align: "justify",
    });
  return y + height + gap;
}

function textInBox(
  document: PdfDocument,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: { bold?: boolean; maxSize?: number; minSize?: number } = {},
) {
  const font = options.bold ? "DejaVuBold" : "DejaVu";
  const minSize = options.minSize ?? 6.5;
  let size = options.maxSize ?? 7.4;
  for (; size >= minSize; size -= 0.2) {
    document.font(font).fontSize(size);
    if (document.heightOfString(value, { width, lineGap: 0.4 }) <= height) {
      document
        .fillColor(DOCUMENT_COLORS.ink)
        .text(value, x, y, { width, height, lineGap: 0.4 });
      return;
    }
  }
  throw new Error("CONTRACT_PDF_LAYOUT_OVERFLOW");
}

function labelledCell(
  document: PdfDocument,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  accent = false,
) {
  document
    .rect(x, y, width, height)
    .fillAndStroke(
      accent ? DOCUMENT_COLORS.goldSoft : DOCUMENT_COLORS.neutral,
      accent ? DOCUMENT_COLORS.gold : DOCUMENT_COLORS.line,
    );
  document
    .font("DejaVuBold")
    .fontSize(5.8)
    .fillColor(accent ? DOCUMENT_COLORS.gold : DOCUMENT_COLORS.muted)
    .text(label, x + 7, y + 4, { width: width - 14, characterSpacing: 0.35 });
  textInBox(
    document,
    cleanPdfText(value),
    x + 7,
    y + 13,
    width - 14,
    height - 16,
    { bold: accent, maxSize: 7.4 },
  );
}

function projectGrid(document: PdfDocument, snapshot: ContractSnapshot, y: number) {
  const half = CONTENT_WIDTH / 2;
  const rowHeight = 32;
  const rows = [
    ["КЛИЕНТ", snapshot.clientFullName, "ИИН / ТЕЛЕФОН", `${snapshot.clientIin} · ${snapshot.clientPhone}`],
    ["ЗАКАЗ", `№ ${snapshot.orderNumber}`, "АДРЕС МОНТАЖА", snapshot.installationAddress],
    ["МАТЕРИАЛ", snapshot.stairMaterial, "КАРКАС", `${snapshot.frameType} ${snapshot.frameComment}`],
    ["ОГРАЖДЕНИЕ / БАЛЯСИНА", snapshot.balusterType, "СТОЙКА / ЦВЕТ", `${snapshot.supportType} · ${snapshot.color}`],
    ["ПОДСВЕТКА", snapshot.lightingText, "ОБШИВКА", snapshot.claddingText],
    ["ДОСТАВКА / МОНТАЖ", `${snapshot.deliveryText} · ${snapshot.installationText}`, "ДОПОЛНИТЕЛЬНО", snapshot.additionalDetails],
  ] as const;
  for (const [index, row] of rows.entries()) {
    labelledCell(document, row[0], row[1], PAGE.margin, y + index * rowHeight, half, rowHeight);
    labelledCell(document, row[2], row[3], PAGE.margin + half, y + index * rowHeight, half, rowHeight);
  }
  return y + rows.length * rowHeight + 7;
}

function paymentGrid(document: PdfDocument, snapshot: ContractSnapshot, y: number) {
  const half = CONTENT_WIDTH / 2;
  const rowHeight = 34;
  labelledCell(document, "ОБЩАЯ СТОИМОСТЬ", `${snapshot.contractAmount} ₸`, PAGE.margin, y, half, rowHeight, true);
  labelledCell(document, "СРОК", `${snapshot.termCalendarDays} календарных дней`, PAGE.margin + half, y, half, rowHeight, true);
  labelledCell(
    document,
    snapshot.isFullPayment ? "ОПЛАТА" : "ПЕРВЫЙ ПЛАТЁЖ",
    snapshot.paymentSchedulePrimary,
    PAGE.margin,
    y + rowHeight,
    half,
    rowHeight,
    true,
  );
  labelledCell(
    document,
    snapshot.isFullPayment ? "ГРАФИК" : "ОСТАТОК / ГРАФИК",
    snapshot.isFullPayment ? "Полная оплата" : snapshot.paymentScheduleBalance,
    PAGE.margin + half,
    y + rowHeight,
    half,
    rowHeight,
    true,
  );
  return y + rowHeight * 2 + 5;
}

function drawContractPageOne(document: PdfDocument, snapshot: ContractSnapshot) {
  pageChrome(document, snapshot, 1);
  document
    .font("DejaVuBold")
    .fontSize(9)
    .fillColor(DOCUMENT_COLORS.gold)
    .text(snapshot.companyName.toUpperCase(), PAGE.margin, 43, {
      width: CONTENT_WIDTH,
      align: "center",
      characterSpacing: 1,
    });
  document
    .font("DejaVuBold")
    .fontSize(16)
    .fillColor(DOCUMENT_COLORS.ink)
    .text(`ДОГОВОР № ${snapshot.contractNumber}`, PAGE.margin, 59, {
      width: CONTENT_WIDTH,
      align: "center",
    });
  document
    .font("DejaVu")
    .fontSize(8.2)
    .fillColor(DOCUMENT_COLORS.muted)
    .text("изготовления, поставки и монтажа лестницы", PAGE.margin, 80, {
      width: CONTENT_WIDTH,
      align: "center",
    });
  const half = CONTENT_WIDTH / 2;
  labelledCell(document, "ГОРОД", `г. ${snapshot.contractCity}`, PAGE.margin, 98, half, 29);
  labelledCell(
    document,
    "ДАТА И ВРЕМЯ",
    `«${snapshot.contractDay}» ${snapshot.contractMonth} ${snapshot.contractYear} г., ${snapshot.contractTime}`,
    PAGE.margin + half,
    98,
    half,
    29,
  );
  let y = paragraph(
    document,
    `${cleanPdfText(snapshot.clientFullName)}, ИИН ${cleanPdfText(snapshot.clientIin)}, именуемый(ая) в дальнейшем «Клиент», с одной стороны, и ТОО «${cleanPdfText(snapshot.companyName)}», БИН ${cleanPdfText(snapshot.companyBin)}, в лице директора ${cleanPdfText(snapshot.directorFullName)}, действующего на основании Устава, именуемое в дальнейшем «Исполнитель», с другой стороны, совместно именуемые «Стороны», заключили настоящий Договор о нижеследующем:`,
    134,
    { size: 7.3, gap: 5 },
  );
  y = projectGrid(document, snapshot, y);
  y = heading(document, "1. ПРЕДМЕТ ДОГОВОРА", y);
  y = paragraph(document, "1.1. Исполнитель обязуется изготовить, поставить Клиенту и выполнить монтаж лестницы (далее — «Лестница») в соответствии с согласованными параметрами заказа, замером и условиями настоящего Договора, а Клиент обязуется принять результат работ и оплатить его.", y);
  y = paragraph(document, `1.2. Материал лестницы: ${cleanPdfText(snapshot.stairMaterial)}.`, y);
  y = paragraph(document, `1.3. Тип ограждения / балясины: ${cleanPdfText(snapshot.balusterType)}.`, y);
  y = paragraph(document, `1.4. Адрес монтажа: ${cleanPdfText(snapshot.installationAddress)}.`, y, { gap: 5 });
  y = heading(document, "2. СТОИМОСТЬ ДОГОВОРА И ПОРЯДОК ОПЛАТЫ", y);
  y = paymentGrid(document, snapshot, y);
  y = paragraph(document, `2.1. Общая стоимость Договора составляет ${snapshot.contractAmount} (${snapshot.contractAmountWords}) тенге. Статус НДС указывается в соответствии с действующим налоговым статусом Исполнителя.`, y);
  y = paragraph(document, "2.2. В стоимость включаются согласованные Сторонами материалы, изготовление, доставка и монтаж в объеме, предусмотренном заказом.", y);
  y = paragraph(document, "2.3. Оплата производится банковским переводом на расчётный счёт Исполнителя либо иным согласованным и допустимым способом.", y);
  if (snapshot.isFullPayment) {
    y = paragraph(document, `2.4. Оплата производится в размере 100% стоимости Договора — ${snapshot.contractAmount} (${snapshot.contractAmountWords}) тенге — ${cleanPdfText(snapshot.fullPaymentDueText)}.`, y);
    y = paragraph(document, "2.5. При рассрочке через банк или иную финансовую организацию порядок оплаты определяется условиями одобренного финансирования и подтверждённым графиком платежей.", y);
    paragraph(document, "2.6. Изменение согласованного графика оплаты оформляется по соглашению Сторон и фиксируется в документах ORDA.", y);
  } else {
    y = paragraph(document, "2.4. Согласованный график оплаты:", y, { bold: true, gap: 1 });
    y = paragraph(document, `Первый платёж — ${snapshot.prepaymentPercent}% от стоимости Договора, что составляет ${snapshot.prepaymentAmount} (${snapshot.prepaymentAmountWords}) тенге — ${cleanPdfText(snapshot.prepaymentDueText)}.`, y);
    y = paragraph(document, `Оставшаяся сумма — ${snapshot.balancePercent}% от стоимости Договора, что составляет ${snapshot.balanceAmount} (${snapshot.balanceAmountWords}) тенге — ${cleanPdfText(snapshot.balanceDueText)}.`, y);
    y = paragraph(document, `2.5. При согласовании 100% оплаты ORDA формирует отдельную редакцию пункта 2.4: «Оплата производится в размере 100% стоимости Договора — ${snapshot.contractAmount} (${snapshot.contractAmountWords}) тенге — ${cleanPdfText(snapshot.fullPaymentDueText)}».`, y);
    y = paragraph(document, "2.6. При рассрочке через банк или иную финансовую организацию порядок оплаты определяется условиями одобренного финансирования и подтверждённым графиком платежей.", y);
    paragraph(document, "2.7. Изменение согласованного графика оплаты оформляется по соглашению Сторон и фиксируется в документах ORDA.", y);
  }
}

function requisites(document: PdfDocument, snapshot: ContractSnapshot, y: number) {
  const gap = 8;
  const half = (CONTENT_WIDTH - gap) / 2;
  const height = CONTENT_BOTTOM - y;
  assertRoom(y, height);
  for (const x of [PAGE.margin, PAGE.margin + half + gap]) {
    document
      .roundedRect(x, y, half, height, 5)
      .fillAndStroke(DOCUMENT_COLORS.neutral, DOCUMENT_COLORS.line);
  }
  const left = [
    "КЛИЕНТ",
    "",
    `ФИО: ${cleanPdfText(snapshot.clientFullName)}`,
    `ИИН: ${cleanPdfText(snapshot.clientIin)}`,
    `Телефон: ${cleanPdfText(snapshot.clientPhone)}`,
    `Адрес: ${cleanPdfText(snapshot.clientAddress)}`,
  ].join("\n");
  const phones = (snapshot.companyPhones?.length ? snapshot.companyPhones : [snapshot.companyPhone]).join("\n");
  const right = [
    "ИСПОЛНИТЕЛЬ",
    "",
    `ТОО «${cleanPdfText(snapshot.companyName)}»`,
    `БИН: ${cleanPdfText(snapshot.companyBin)}`,
    `ИИК: ${cleanPdfText(snapshot.companyIik)}`,
    `Банк: ${cleanPdfText(snapshot.companyBank)}`,
    `БИК: ${cleanPdfText(snapshot.companyBik)}`,
    `Телефон / WhatsApp:\n${phones}`,
    `Адрес: ${cleanPdfText(snapshot.companyAddress)}`,
    `Директор: ${cleanPdfText(snapshot.directorFullName)}`,
  ].join("\n");
  textInBox(document, left, PAGE.margin + 11, y + 11, half - 22, height - 58, { maxSize: 8.1, minSize: 7.1 });
  textInBox(document, right, PAGE.margin + half + gap + 11, y + 11, half - 22, height - 58, { maxSize: 7.8, minSize: 6.8 });
  document
    .font("DejaVu")
    .fontSize(8)
    .fillColor(DOCUMENT_COLORS.ink)
    .text("Подпись: ____________________", PAGE.margin + 11, y + height - 29, {
      width: half - 22,
    })
    .text(
      "Подпись: ____________________",
      PAGE.margin + half + gap + 11,
      y + height - 29,
      { width: half - 22 },
    );
}

function drawContractPageTwo(document: PdfDocument, snapshot: ContractSnapshot) {
  document.addPage({ size: "A4", margin: 0 });
  pageChrome(document, snapshot, 2);
  let y = 48;
  y = heading(document, "3. ОБЯЗАННОСТИ СТОРОН", y);
  y = paragraph(document, "3.1. Клиент обязуется обеспечить доступ на объект, предоставить необходимые исходные данные, принять выполненные работы и произвести оплату в согласованные сроки.", y);
  y = paragraph(document, "3.2. Исполнитель обязуется выполнить согласованный объём работ в соответствии с параметрами заказа и условиями настоящего Договора.", y);
  y = paragraph(document, "3.3. Права и обязанности Сторон, не урегулированные настоящим Договором, определяются законодательством Республики Казахстан.", y, { gap: 5 });
  y = heading(document, "4. СРОКИ И УСЛОВИЯ ВЫПОЛНЕНИЯ", y);
  const termStart = cleanPdfText(snapshot.termStartCondition);
  y = paragraph(document, `4.1. Срок изготовления и выполнения согласованного объёма работ: ${snapshot.termCalendarDays} календарных дней ${termStart.startsWith("с даты") ? termStart : `с даты ${termStart}`}.`, y);
  y = paragraph(document, `4.2. Плановая дата готовности / завершения: ${cleanPdfText(snapshot.plannedCompletionDate)}.`, y);
  y = paragraph(document, "4.3. Клиент обеспечивает готовность объекта к доставке и монтажу, включая свободный доступ, подготовленную площадку и необходимые коммуникации.", y);
  y = paragraph(document, "4.4. При возникновении обстоятельств, препятствующих выполнению работ и зависящих от Клиента, сроки могут быть перенесены на период устранения таких обстоятельств с соответствующей фиксацией.", y, { gap: 5 });
  y = heading(document, "5. ГАРАНТИЯ", y);
  y = paragraph(document, `5.1. Гарантия на Лестницу: ${cleanPdfText(snapshot.warrantyText)} с даты подписания акта приёмки-передачи / фактической приёмки результата работ.`, y);
  y = paragraph(document, "5.2. Гарантия не распространяется на повреждения, возникшие вследствие неправильной эксплуатации, механического воздействия, пожара, затопления, самостоятельной переделки либо иных действий, не связанных с качеством изготовления и монтажа Исполнителем.", y, { gap: 5 });
  y = heading(document, "6. ФОРС-МАЖОР И ПРОЧИЕ УСЛОВИЯ", y);
  y = paragraph(document, "6.1. При возникновении обстоятельств непреодолимой силы Сторона, для которой возникла невозможность исполнения обязательств, уведомляет другую Сторону в разумный срок.", y);
  y = paragraph(document, "6.2. Стороны руководствуются законодательством Республики Казахстан по вопросам, не урегулированным настоящим Договором.", y);
  y = paragraph(document, "6.3. Изменения и дополнения к настоящему Договору оформляются в письменной форме либо иным способом, позволяющим достоверно установить согласованную волю Сторон в соответствии с применимым законодательством.", y);
  y = paragraph(document, "6.4. Договор составлен в двух экземплярах, имеющих одинаковую юридическую силу, по одному для каждой из Сторон.", y, { gap: 5 });
  y = heading(document, "7. РЕКВИЗИТЫ И ПОДПИСИ СТОРОН", y);
  requisites(document, snapshot, y);
}

function drawMemoPage(document: PdfDocument, snapshot: ContractSnapshot) {
  document.addPage({ size: "A4", margin: 0 });
  pageChrome(document, snapshot, 3);
  document.rect(PAGE.margin, 48, 4, 82).fill(DOCUMENT_COLORS.gold);
  document
    .font("DejaVuBold")
    .fontSize(9)
    .fillColor(DOCUMENT_COLORS.gold)
    .text(snapshot.companyName.toUpperCase(), PAGE.margin + 16, 49, { characterSpacing: 1 });
  document
    .font("DejaVuBold")
    .fontSize(20)
    .fillColor(DOCUMENT_COLORS.ink)
    .text("ПАМЯТКА ЗАКАЗЧИКУ", PAGE.margin + 16, 69, { width: CONTENT_WIDTH - 16 });
  document
    .font("DejaVu")
    .fontSize(8)
    .fillColor(DOCUMENT_COLORS.muted)
    .text(
      `Заказ №${snapshot.orderNumber} · Договор №${snapshot.contractNumber}\nКлиент: ${cleanPdfText(snapshot.clientFullName)}\nАдрес объекта: ${cleanPdfText(snapshot.installationAddress)}`,
      PAGE.margin + 16,
      96,
      { width: CONTENT_WIDTH - 16, lineGap: 1.5 },
    );
  const sections = [
    ["1. Проживание мастеров", "Если объект находится дальше 50 км от г. Алматы и работы требуют проживания бригады, условия проживания согласовываются с Клиентом заранее."],
    ["2. Доступ и готовность объекта", "Клиент обеспечивает свободный доступ для доставки и монтажа. Помещение должно быть сухим, безопасным и готовым к проведению работ."],
    ["3. Электрика и подсветка", "При заказе лестницы с подсветкой необходимые кабели и точки подключения должны быть подготовлены заранее. Электромонтажные работы выполняются только при наличии отдельно согласованной услуги и соответствующего специалиста."],
    ["4. Контакт по производству и монтажу", `Контактное лицо: ${cleanPdfText(snapshot.productionContactName)}. Телефон / WhatsApp: ${cleanPdfText(snapshot.productionContactPhone)}.`],
    ["5. Оплата остатка", "Оставшаяся сумма оплачивается в порядке и сроки, указанные в разделе 2 Договора. Индивидуальный график применяется только если он зафиксирован в Договоре или приложении к нему."],
  ] as const;
  let y = 154;
  for (const [title, body] of sections) {
    const height = 78;
    document
      .roundedRect(PAGE.margin, y, CONTENT_WIDTH, height, 5)
      .fillAndStroke(DOCUMENT_COLORS.neutral, DOCUMENT_COLORS.line);
    document
      .font("DejaVuBold")
      .fontSize(8.6)
      .fillColor(DOCUMENT_COLORS.ink)
      .text(title, PAGE.margin + 12, y + 10, { width: CONTENT_WIDTH - 24 });
    textInBox(document, body, PAGE.margin + 12, y + 28, CONTENT_WIDTH - 24, 40, { maxSize: 7.6, minSize: 6.8 });
    y += 86;
  }
  document
    .moveTo(PAGE.margin, 594)
    .lineTo(PAGE.width - PAGE.margin, 594)
    .strokeColor(DOCUMENT_COLORS.gold)
    .lineWidth(1)
    .stroke();
  document
    .font("DejaVuBold")
    .fontSize(9)
    .fillColor(DOCUMENT_COLORS.ink)
    .text("С ПАМЯТКОЙ ОЗНАКОМЛЕН", PAGE.margin, 610);
  document
    .font("DejaVu")
    .fontSize(8.3)
    .fillColor(DOCUMENT_COLORS.graphite)
    .text(
      `ФИО клиента: ${cleanPdfText(snapshot.clientFullName)}\n\nПодпись: ______________________    Дата: _________________________\n\nМенеджер: __________________________________________________`,
      PAGE.margin,
      636,
      { width: CONTENT_WIDTH, lineGap: 2 },
    );
  document
    .font("DejaVu")
    .fontSize(7.5)
    .fillColor(DOCUMENT_COLORS.muted)
    .text((snapshot.companyPhones?.length ? snapshot.companyPhones : [snapshot.companyPhone]).join("  ·  "), PAGE.margin, 775, {
      width: CONTENT_WIDTH,
      align: "center",
    });
}

export async function buildContractPdf(snapshot: ContractSnapshot) {
  return pdfBuffer(
    {
      size: "A4",
      margin: 0,
      autoFirstPage: true,
      info: {
        Title: `Договор №${snapshot.contractNumber}`,
        Subject: "Изготовление, поставка и монтаж лестницы",
        Author: snapshot.companyName,
        Creator: `ORDA · ${CONTRACT_PDF_TEMPLATE_VERSION}`,
      },
    },
    (document) => {
      drawContractPageOne(document, snapshot);
      drawContractPageTwo(document, snapshot);
      drawMemoPage(document, snapshot);
    },
  );
}
