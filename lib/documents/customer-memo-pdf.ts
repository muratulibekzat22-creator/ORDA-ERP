import { cleanPdfText, DOCUMENT_COLORS, pdfBuffer } from "@/lib/documents/pdf-utils";

export const CUSTOMER_MEMO_TEMPLATE_VERSION = "ALTYN_SAPA_CUSTOMER_MEMO_V1";

export type CustomerMemoSnapshot = {
  templateVersion: string;
  orderNumber: string;
  contractNumber: string;
  clientFullName: string;
  installationAddress: string;
  productionContactName: string;
  productionContactPhone: string;
  companyName: string;
  companyPhones: string[];
  createdAt: string;
};

const PAGE = { width: 595.28, height: 841.89, margin: 42 };

export async function buildCustomerMemoPdf(snapshot: CustomerMemoSnapshot) {
  return pdfBuffer(
    {
      size: "A4",
      margin: 0,
      autoFirstPage: true,
      info: {
        Title: `Памятка заказчику · ${snapshot.contractNumber}`,
        Author: snapshot.companyName,
      },
    },
    (document) => {
      const width = PAGE.width - PAGE.margin * 2;
      document.rect(0, 0, PAGE.width, PAGE.height).fill(DOCUMENT_COLORS.paper);
      document.rect(PAGE.margin, 38, 4, 96).fill(DOCUMENT_COLORS.gold);
      document
        .font("DejaVuBold")
        .fontSize(10)
        .fillColor(DOCUMENT_COLORS.gold)
        .text(snapshot.companyName.toUpperCase(), PAGE.margin + 16, 40, {
          characterSpacing: 1.2,
        });
      document
        .font("DejaVuBold")
        .fontSize(22)
        .fillColor(DOCUMENT_COLORS.ink)
        .text("ПАМЯТКА ЗАКАЗЧИКУ", PAGE.margin + 16, 62, { width: width - 16 });
      document
        .font("DejaVu")
        .fontSize(9.5)
        .fillColor(DOCUMENT_COLORS.muted)
        .text(
          `Заказ №${snapshot.orderNumber}  ·  Договор №${snapshot.contractNumber}\nКлиент: ${cleanPdfText(snapshot.clientFullName)}\nАдрес объекта: ${cleanPdfText(snapshot.installationAddress)}`,
          PAGE.margin + 16,
          96,
          { width: width - 16, lineGap: 2 },
        );

      const sections = [
        [
          "1. Проживание мастеров",
          "Если объект находится дальше 50 км от г. Алматы и работы требуют проживания бригады, условия проживания согласовываются с Клиентом заранее.",
        ],
        [
          "2. Доступ и готовность объекта",
          "Клиент обеспечивает свободный доступ для доставки и монтажа. Помещение должно быть сухим, безопасным и готовым к проведению работ.",
        ],
        [
          "3. Электрика и подсветка",
          "При заказе лестницы с подсветкой необходимые кабели и точки подключения должны быть подготовлены заранее. Электромонтажные работы выполняются только при наличии отдельно согласованной услуги и соответствующего специалиста.",
        ],
        [
          "4. Контакт по производству и монтажу",
          `Контактное лицо: ${cleanPdfText(snapshot.productionContactName)}. Телефон / WhatsApp: ${cleanPdfText(snapshot.productionContactPhone)}.`,
        ],
        [
          "5. Оплата остатка",
          "Оставшаяся сумма оплачивается в порядке и сроки, указанные в разделе 2 Договора. Индивидуальный график применяется только если он зафиксирован в Договоре или приложении к нему.",
        ],
      ] as const;
      let y = 166;
      for (const [title, body] of sections) {
        document
          .roundedRect(PAGE.margin, y, width, 82, 6)
          .fillAndStroke(DOCUMENT_COLORS.neutral, DOCUMENT_COLORS.line);
        document
          .font("DejaVuBold")
          .fontSize(10)
          .fillColor(DOCUMENT_COLORS.ink)
          .text(title, PAGE.margin + 14, y + 12, { width: width - 28 });
        document
          .font("DejaVu")
          .fontSize(9.5)
          .fillColor(DOCUMENT_COLORS.graphite)
          .text(body, PAGE.margin + 14, y + 31, {
            width: width - 28,
            height: 43,
            lineGap: 1.5,
          });
        y += 91;
      }

      document
        .moveTo(PAGE.margin, 635)
        .lineTo(PAGE.width - PAGE.margin, 635)
        .strokeColor(DOCUMENT_COLORS.gold)
        .lineWidth(1)
        .stroke();
      document
        .font("DejaVuBold")
        .fontSize(10)
        .fillColor(DOCUMENT_COLORS.ink)
        .text("С ПАМЯТКОЙ ОЗНАКОМЛЕН", PAGE.margin, 650);
      document
        .font("DejaVu")
        .fontSize(9.5)
        .fillColor(DOCUMENT_COLORS.graphite)
        .text(
          "ФИО клиента: ______________________________________________\n\nПодпись: ______________________    Дата: _________________________\n\nМенеджер: __________________________________________________",
          PAGE.margin,
          676,
          { width, lineGap: 2 },
        );
      document
        .font("DejaVu")
        .fontSize(8)
        .fillColor(DOCUMENT_COLORS.muted)
        .text(snapshot.companyPhones.join("  ·  "), PAGE.margin, 798, {
          width,
          align: "center",
        });
    },
  );
}
