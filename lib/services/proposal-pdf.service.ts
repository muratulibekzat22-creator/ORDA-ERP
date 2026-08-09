import PDFDocument from "pdfkit";
import path from "node:path";

import { publicCalculationSnapshot } from "@/lib/lead-calculation-view";

type Variant = {
  material?: string;
  total?: number;
  composition?: Array<{ name?: string; quantity?: number; unit?: string }>;
  executionTerm?: string;
  warranty?: string;
  includedServices?: {
    measurement?: boolean;
    delivery?: boolean;
    installation?: boolean;
  };
  deliveryOption?: "NONE" | "OPTION_1" | "OPTION_2";
  deliveryCharge?: number;
};

export function proposalDeliveryText(option: Variant["deliveryOption"], amount = 0) {
  if (option === "OPTION_1" || option === "OPTION_2")
    return `Доставка в другой город — ${Number(amount).toLocaleString("ru-RU")} ₸`;
  return "Доставка не входит в стоимость";
}

export async function buildProposalPdf(snapshotValue: unknown) {
  const snapshot = publicCalculationSnapshot(snapshotValue) as Record<
    string,
    unknown
  >;
  const company = (snapshot.company ?? {}) as Record<string, unknown>,
    client = (snapshot.client ?? {}) as Record<string, unknown>;
  const variants = Array.isArray(snapshot.variants)
    ? (snapshot.variants as Variant[])
    : [];
  const chunks: Buffer[] = [];
  const document = new PDFDocument({
    size: "A4",
    margin: 46,
    info: {
      Title: `Коммерческое предложение №${String(snapshot.number ?? "")}`,
      Author: "ALTYN SAPA COMPANY",
    },
  });
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  const fontRoot = path.join(process.cwd(), "node_modules", "dejavu-fonts-ttf", "ttf");
  document.registerFont("DejaVu", path.join(fontRoot, "DejaVuSans.ttf"));
  document.registerFont("DejaVuBold", path.join(fontRoot, "DejaVuSans-Bold.ttf"));
  document
    .font("DejaVuBold")
    .fontSize(18)
    .text(String(company.name ?? "ALTYN SAPA COMPANY"), { align: "center" });
  document
    .moveDown(0.5)
    .fontSize(15)
    .text(`Коммерческое предложение №${String(snapshot.number ?? "")}`, {
      align: "center",
    });
  document
    .font("DejaVu")
    .fontSize(10)
    .text(
      `Дата: ${new Date(String(snapshot.createdAt ?? Date.now())).toLocaleDateString("ru-RU")}`,
      { align: "center" },
    );
  document.moveDown().fontSize(11);
  if (client.name) document.text(`Клиент: ${String(client.name)}`);
  document.text(`Телефон: ${String(client.phone ?? "—")}`);
  document.text(`Город: ${String(client.city ?? "—")}`);
  document
    .moveDown(0.7)
    .font("DejaVuBold")
    .fontSize(11)
    .text(
      String(
        snapshot.introduction ??
          "Предлагаем изготовление лестницы по индивидуальным размерам объекта. Выберите подходящий материал — итоговая стоимость, срок и гарантия указаны для каждого варианта.",
      ),
    );
  for (const variant of variants) {
    const composition = (variant.composition ?? []).filter(
      (line) => line?.name,
    );
    const services = variant.includedServices ?? {};
    const compositionText = composition.length
      ? `Комплектация: ${composition.map((line) => `${line.name}${line.quantity ? ` — ${line.quantity} ${line.unit ?? ""}` : ""}`).join("; ")}`
      : "";
    document.font("DejaVu").fontSize(9);
    const compositionHeight = compositionText
      ? document.heightOfString(compositionText, { width: 475 }) + 7
      : 0;
    const cardHeight = 142 + compositionHeight;
    if (document.y + cardHeight > document.page.height - 70) document.addPage();
    const cardY = document.y + 10;
    document
      .roundedRect(46, cardY, 503, cardHeight, 10)
      .fillAndStroke("#F8FAFC", "#CBD5E1");
    document
      .fillColor("#0F172A")
      .font("DejaVuBold")
      .fontSize(15)
      .text(String(variant.material ?? "Вариант"), 61, cardY + 15, {
        width: 473,
      });
    document
      .fillColor("#1D4ED8")
      .fontSize(16)
      .text(
        `${Number(variant.total ?? 0).toLocaleString("ru-RU")} ₸`,
        61,
        document.y + 5,
        { width: 473 },
      );
    document
      .fillColor("#334155")
      .font("DejaVu")
      .fontSize(10)
      .text(`Срок изготовления: ${variant.executionTerm ?? "уточняется после замера"}`, 61, document.y + 8, { width: 473 })
      .text(`Гарантия: ${variant.warranty ?? "согласно договору"}`, 61, document.y + 3, { width: 473 });
    if (compositionText)
      document
        .fillColor("#475569")
        .fontSize(9)
        .text(compositionText, 61, document.y + 6, { width: 473 });
    document
      .fillColor("#475569")
      .fontSize(9)
      .text(
        [
          `Замер: ${services.measurement ? "включён" : "не входит"}`,
          proposalDeliveryText(variant.deliveryOption, variant.deliveryCharge),
          `Монтаж: ${services.installation ? "включён" : "не входит"}`,
        ].join("  •  "),
        61,
        document.y + 7,
        { width: 473 },
      );
    document.y = cardY + cardHeight + 2;
  }
  document
    .moveDown()
    .fillColor("#0F172A")
    .fontSize(10)
    .text(
      `Условия оплаты: ${String(snapshot.paymentTerms ?? "согласовываются при оформлении заказа")}`,
    );
  document.text(
    `КП действительно до: ${new Date(String(snapshot.validUntil ?? Date.now())).toLocaleDateString("ru-RU")}`,
  );
  document
    .moveDown()
    .text(
      `Контакты: ${String(company.phone ?? "")} ${String(company.email ?? "")}`,
    );
  document.end();
  return complete;
}
