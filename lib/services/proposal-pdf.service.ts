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
  for (const variant of variants) {
    document
      .moveDown()
      .font("DejaVuBold")
      .fontSize(14)
      .text(String(variant.material ?? "Вариант"));
    document
      .font("DejaVu")
      .fontSize(12)
      .text(
        `Итоговая стоимость: ${Number(variant.total ?? 0).toLocaleString("ru-RU")} ₸`,
      );
    const composition = (variant.composition ?? []).filter(
      (line) => line?.name,
    );
    if (composition.length)
      document
        .fontSize(10)
        .text(
          `Комплектация: ${composition.map((line) => `${line.name}${line.quantity ? ` — ${line.quantity} ${line.unit ?? ""}` : ""}`).join("; ")}`,
        );
    document.text(
      `Срок: ${variant.executionTerm ?? "уточняется после замера"}`,
    );
    document.text(`Гарантия: ${variant.warranty ?? "согласно договору"}`);
    const services = variant.includedServices ?? {};
    document.text(
      `Замер: ${services.measurement ? "включён" : "не входит в стоимость"}`,
    );
    document.text(proposalDeliveryText(variant.deliveryOption, variant.deliveryCharge));
    document.text(
      `Монтаж: ${services.installation ? "включён" : "не входит в стоимость"}`,
    );
  }
  document
    .moveDown()
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
