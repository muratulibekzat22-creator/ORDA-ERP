import path from "node:path";

import PDFDocument from "pdfkit";

import { companyDisplayPhones } from "@/lib/company-contacts";
import { publicCalculationSnapshot } from "@/lib/lead-calculation-view";
import {
  COMPANY_EXPERIENCE_FALLBACK,
  COMPANY_PITCH,
  INCLUDED_IN_PRICE,
  MATERIAL_PRESENTATION,
  PROPOSAL_VALIDITY_DAYS,
} from "@/lib/proposals/presentation";

type Variant = {
  material?: string;
  total?: number;
  executionTerm?: string;
  warranty?: string;
};

const COLORS = {
  ink: "#171717",
  graphite: "#3F3F46",
  muted: "#71717A",
  gold: "#B68A3A",
  goldSoft: "#F4E9D3",
  paper: "#FFFFFF",
  neutral: "#F7F6F3",
  line: "#DEDAD2",
};
const PAGE = { width: 595.28, height: 841.89, margin: 38 };

function clean(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function money(value: unknown) {
  return `${Number(value ?? 0).toLocaleString("ru-RU", {
    maximumFractionDigits: 0,
  }).replaceAll(" ", " ")} ₸`;
}

function proposalDate(value: unknown) {
  const date = new Date(String(value ?? Date.now()));
  return date.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty" });
}

function fallbackWarranty(material: string) {
  if (material === "Сосна") return "6 месяцев";
  if (material === "Карагач") return "1 год";
  if (material === "Дуб ламель") return "5 лет";
  return "по материалу";
}

function line(
  document: PDFKit.PDFDocument,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color = COLORS.line,
  width = 1,
) {
  document
    .save()
    .strokeColor(color)
    .lineWidth(width)
    .moveTo(x1, y1)
    .lineTo(x2, y2)
    .stroke()
    .restore();
}

function text(
  document: PDFKit.PDFDocument,
  value: string,
  x: number,
  y: number,
  options: PDFKit.Mixins.TextOptions & {
    font?: "DejaVu" | "DejaVuBold";
    size?: number;
    color?: string;
  } = {},
) {
  const {
    font = "DejaVu",
    size = 9,
    color = COLORS.ink,
    ...textOptions
  } = options;
  document
    .font(font)
    .fontSize(size)
    .fillColor(color)
    .text(value, x, y, textOptions);
}

function drawHeader(
  document: PDFKit.PDFDocument,
  snapshot: Record<string, unknown>,
  company: Record<string, unknown>,
  client: Record<string, unknown>,
) {
  const x = PAGE.margin;
  const width = PAGE.width - PAGE.margin * 2;
  document.rect(x, 34, 4, 85).fill(COLORS.gold);
  text(document, clean(company.name, "ALTYN SAPA COMPANY").toUpperCase(), x + 16, 35, {
    font: "DejaVuBold",
    size: 11,
    color: COLORS.ink,
    characterSpacing: 1.8,
    width: 320,
  });
  text(document, "КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ", x + 16, 55, {
    font: "DejaVuBold",
    size: 20,
    color: COLORS.ink,
    width: 410,
  });
  text(document, `№ ${clean(snapshot.number, "-")}`, x + 16, 83, {
    font: "DejaVuBold",
    size: 9,
    color: COLORS.gold,
    width: 120,
  });
  text(document, `Дата: ${proposalDate(snapshot.createdAt)}`, x + 140, 83, {
    size: 9,
    color: COLORS.muted,
    width: 170,
  });

  const clientParts = [
    client.name ? `Клиент: ${clean(client.name)}` : "",
    client.phone ? `Телефон: ${clean(client.phone)}` : "",
    client.city ? `Город: ${clean(client.city)}` : "",
  ].filter(Boolean);
  text(document, clientParts.join("   |   "), x + 16, 102, {
    size: 8.5,
    color: COLORS.graphite,
    width: width - 16,
    lineBreak: false,
  });
  line(document, x, 134, x + width, 134, COLORS.gold, 1.2);
}

function drawVariants(document: PDFKit.PDFDocument, variants: Variant[]) {
  const items = variants.slice(0, 3);
  const count = Math.max(items.length, 1);
  const x = PAGE.margin;
  const y = 151;
  const gap = 10;
  const width = PAGE.width - PAGE.margin * 2;
  const cardWidth = (width - gap * (count - 1)) / count;
  const cardHeight = 163;

  items.forEach((variant, index) => {
    const material = clean(variant.material, "Вариант");
    const cardX = x + index * (cardWidth + gap);
    document
      .roundedRect(cardX, y, cardWidth, cardHeight, 7)
      .fillAndStroke(COLORS.neutral, COLORS.line);
    document.rect(cardX, y, cardWidth, 4).fill(COLORS.gold);
    text(document, material.toLocaleUpperCase("ru"), cardX + 12, y + 16, {
      font: "DejaVuBold",
      size: 11,
      color: COLORS.ink,
      width: cardWidth - 24,
      height: 17,
      ellipsis: true,
    });
    text(
      document,
      MATERIAL_PRESENTATION[material]?.description ??
        "Индивидуальное решение для вашего интерьера",
      cardX + 12,
      y + 39,
      {
        size: 7.7,
        color: COLORS.graphite,
        width: cardWidth - 24,
        height: 34,
        lineGap: 1,
        ellipsis: true,
      },
    );
    text(document, "ИТОГОВАЯ ЦЕНА", cardX + 12, y + 79, {
      font: "DejaVuBold",
      size: 6.5,
      color: COLORS.muted,
      characterSpacing: 0.6,
      width: cardWidth - 24,
    });
    text(document, money(variant.total), cardX + 12, y + 91, {
      font: "DejaVuBold",
      size: 14,
      color: COLORS.ink,
      width: cardWidth - 24,
      height: 22,
      ellipsis: true,
    });
    document
      .roundedRect(cardX + 10, y + 121, cardWidth - 20, 30, 5)
      .fill(COLORS.goldSoft);
    text(document, "ГАРАНТИЯ", cardX + 17, y + 126, {
      font: "DejaVuBold",
      size: 5.8,
      color: COLORS.gold,
      characterSpacing: 0.7,
      width: cardWidth - 34,
    });
    text(
      document,
      clean(variant.warranty, fallbackWarranty(material)).toLocaleUpperCase(
        "ru",
      ),
      cardX + 17,
      y + 136,
      {
        font: "DejaVuBold",
        size: 8.5,
        color: COLORS.ink,
        width: cardWidth - 34,
        height: 12,
        ellipsis: true,
      },
    );
  });
}

function drawIncludedAndTerms(
  document: PDFKit.PDFDocument,
  snapshot: Record<string, unknown>,
  variants: Variant[],
) {
  const x = PAGE.margin;
  const y = 330;
  const width = PAGE.width - PAGE.margin * 2;
  const leftWidth = 314;
  document
    .roundedRect(x, y, width, 102, 7)
    .fillAndStroke(COLORS.paper, COLORS.line);
  text(document, "В СТОИМОСТЬ ВХОДИТ", x + 16, y + 13, {
    font: "DejaVuBold",
    size: 9,
    color: COLORS.ink,
    characterSpacing: 0.8,
    width: leftWidth - 32,
  });
  INCLUDED_IN_PRICE.forEach((item, index) => {
    const rowY = y + 35 + index * 18;
    document.circle(x + 20, rowY + 4, 2.2).fill(COLORS.gold);
    text(document, item, x + 30, rowY, {
      size: 8.5,
      color: COLORS.graphite,
      width: leftWidth - 48,
    });
  });
  line(document, x + leftWidth, y + 13, x + leftWidth, y + 89);
  text(document, "СРОК ИЗГОТОВЛЕНИЯ", x + leftWidth + 16, y + 14, {
    font: "DejaVuBold",
    size: 6.5,
    color: COLORS.muted,
    characterSpacing: 0.7,
    width: width - leftWidth - 32,
  });
  text(
    document,
    clean(variants[0]?.executionTerm, "40-50 календарных дней"),
    x + leftWidth + 16,
    y + 28,
    {
      font: "DejaVuBold",
      size: 11,
      color: COLORS.ink,
      width: width - leftWidth - 32,
      height: 32,
    },
  );
  text(document, "СРОК ДЕЙСТВИЯ КП", x + leftWidth + 16, y + 66, {
    font: "DejaVuBold",
    size: 6.5,
    color: COLORS.muted,
    characterSpacing: 0.7,
    width: width - leftWidth - 32,
  });
  text(
    document,
    `${PROPOSAL_VALIDITY_DAYS} календарных дня - до ${proposalDate(snapshot.validUntil)}`,
    x + leftWidth + 16,
    y + 79,
    {
      font: "DejaVuBold",
      size: 8.2,
      color: COLORS.gold,
      width: width - leftWidth - 32,
      height: 14,
      ellipsis: true,
    },
  );
}

function drawBrand(document: PDFKit.PDFDocument, companyName: string) {
  const x = PAGE.margin;
  const y = 448;
  const width = PAGE.width - PAGE.margin * 2;
  document.roundedRect(x, y, width, 151, 7).fill(COLORS.neutral);
  text(document, companyName.toUpperCase(), x + 18, y + 15, {
    font: "DejaVuBold",
    size: 9,
    color: COLORS.gold,
    characterSpacing: 1.2,
    width: width - 36,
  });
  text(document, COMPANY_PITCH[0], x + 18, y + 36, {
    font: "DejaVuBold",
    size: 12,
    color: COLORS.ink,
    width: width - 36,
    height: 35,
    lineGap: 2,
  });
  text(document, COMPANY_PITCH[1], x + 18, y + 76, {
    size: 8.4,
    color: COLORS.graphite,
    width: width - 36,
    height: 38,
    lineGap: 1.5,
  });
  text(document, COMPANY_EXPERIENCE_FALLBACK, x + 18, y + 119, {
    size: 8,
    color: COLORS.muted,
    width: width - 36,
  });
  text(document, "КАЧЕСТВО.  ОТВЕТСТВЕННОСТЬ.  РЕЗУЛЬТАТ.", x + 18, y + 135, {
    font: "DejaVuBold",
    size: 7.5,
    color: COLORS.gold,
    characterSpacing: 0.8,
    width: width - 36,
  });
}

function drawCta(
  document: PDFKit.PDFDocument,
  company: Record<string, unknown>,
) {
  const x = PAGE.margin;
  const y = 620;
  const width = PAGE.width - PAGE.margin * 2;
  text(document, "ГОТОВЫ ОБСУДИТЬ ВАШ ПРОЕКТ?", x, y, {
    font: "DejaVuBold",
    size: 14,
    color: COLORS.ink,
    width,
    align: "center",
  });
  text(document, clean(company.name, "ALTYN SAPA COMPANY").toUpperCase(), x, y + 29, {
    font: "DejaVuBold",
    size: 9,
    color: COLORS.gold,
    characterSpacing: 1,
    width,
    align: "center",
  });
  text(document, "ОФИЦИАЛЬНЫЕ ТЕЛЕФОНЫ", x, y + 49, {
    font: "DejaVuBold",
    size: 6.5,
    color: COLORS.muted,
    characterSpacing: 0.8,
    width,
    align: "center",
  });
  companyDisplayPhones(company).slice(0, 2).forEach((phone, index) =>
    text(document, phone, x, y + 61 + index * 15, {
      font: "DejaVuBold",
      size: 10.5,
      color: COLORS.ink,
      width,
      align: "center",
    }),
  );
  const contacts = [
    company.whatsapp ? `WhatsApp: ${clean(company.whatsapp)}` : "",
    company.email ? clean(company.email) : "",
  ].filter(Boolean);
  if (contacts.length)
    text(document, contacts.join("   |   "), x, y + 94, {
      size: 8,
      color: COLORS.muted,
      width,
      align: "center",
    });
  line(document, x, 752, x + width, 752, COLORS.gold, 1);
  text(document, "Индивидуальное предложение. Все цены указаны в тенге.", x, 762, {
    size: 6.8,
    color: COLORS.muted,
    width,
    align: "center",
  });
}

export async function buildProposalPdf(snapshotValue: unknown) {
  const snapshot = publicCalculationSnapshot(snapshotValue) as Record<
    string,
    unknown
  >;
  const company = (snapshot.company ?? {}) as Record<string, unknown>;
  const client = (snapshot.client ?? {}) as Record<string, unknown>;
  const variants = Array.isArray(snapshot.variants)
    ? (snapshot.variants as Variant[])
    : [];
  const chunks: Buffer[] = [];
  const document = new PDFDocument({
    size: "A4",
    margin: 0,
    autoFirstPage: true,
    compress: true,
    info: {
      Title: `Коммерческое предложение №${clean(snapshot.number)}`,
      Author: clean(company.name, "ALTYN SAPA COMPANY"),
      Subject: "Изготовление интерьерной лестницы",
    },
  });
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  const fontRoot = path.join(
    process.cwd(),
    "node_modules",
    "dejavu-fonts-ttf",
    "ttf",
  );
  document.registerFont("DejaVu", path.join(fontRoot, "DejaVuSans.ttf"));
  document.registerFont(
    "DejaVuBold",
    path.join(fontRoot, "DejaVuSans-Bold.ttf"),
  );
  document.rect(0, 0, PAGE.width, PAGE.height).fill(COLORS.paper);
  drawHeader(document, snapshot, company, client);
  drawVariants(document, variants);
  drawIncludedAndTerms(document, snapshot, variants);
  drawBrand(document, clean(company.name, "ALTYN SAPA COMPANY"));
  drawCta(document, company);
  document.end();
  return complete;
}
