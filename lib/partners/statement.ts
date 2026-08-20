import { Prisma } from "@prisma/client";

import { pdfBuffer } from "@/lib/documents/pdf-utils";
import { getManagedPartner } from "@/lib/services/partner-management.service";

type Statement = Awaited<ReturnType<typeof getManagedPartner>>;

const money = (value: Prisma.Decimal.Value) =>
  `${new Prisma.Decimal(value).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₸`;

const date = (value: Date | string) => new Intl.DateTimeFormat("ru-RU").format(new Date(value));

const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export function partnerStatementCsv(statement: Statement, from?: Date, to?: Date) {
  const operations = statement.operations.filter((item) =>
    (!from || item.operationDate >= from) && (!to || item.operationDate <= to));
  const rows: unknown[][] = [
    ["Выписка по партнёру", statement.partner.name],
    ["Период", from ? date(from) : "За всё время", to ? date(to) : ""],
    [],
    ["Заказ", "Клиент", "Сумма заказа", "Получено", "Начислено партнёру", "Выплачено", "Баланс"],
    ...statement.orders.map((item) => [
      item.order.number,
      item.order.client.name,
      item.metrics.orderAmount.toFixed(2),
      item.metrics.received.toFixed(2),
      item.metrics.partnerAccrued.toFixed(2),
      item.metrics.companyPaidPartner.toFixed(2),
      item.metrics.partnerBalance.toFixed(2),
    ]),
    [],
    ["Дата", "Операция", "Заказ", "Сумма", "Счёт", "Комментарий", "Статус"],
    ...operations.map((item) => [
      date(item.operationDate), item.type, item.orderNumber, item.amount.toFixed(2),
      item.account ?? "", item.comment ?? "", item.status,
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
}

export async function partnerStatementPdf(statement: Statement, from?: Date, to?: Date) {
  const operations = statement.operations.filter((item) =>
    (!from || item.operationDate >= from) && (!to || item.operationDate <= to));
  return pdfBuffer({ size: "A4", margin: 42, info: { Title: `Выписка ${statement.partner.name}` } }, (doc) => {
    const ensure = (height = 48) => {
      if (doc.y + height > doc.page.height - 50) doc.addPage();
    };
    doc.font("DejaVuBold").fontSize(18).text("ORDA ERP · ВЫПИСКА ПО ПАРТНЁРУ");
    doc.moveDown(0.45).font("DejaVu").fontSize(11)
      .text(`Партнёр: ${statement.partner.name}`)
      .text(`Период: ${from ? date(from) : "начало сотрудничества"} — ${to ? date(to) : date(new Date())}`)
      .text(`Сформировано: ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date())}`);
    doc.moveDown().font("DejaVuBold").fontSize(13).text("Итоги");
    const totals = statement.partner.totals;
    for (const [label, value] of [
      ["Заказов", String(totals.orders)], ["Сумма заказов", money(totals.orderAmount)],
      ["Получено от клиентов", money(totals.received)], ["Остаток клиентов", money(totals.clientRemaining)],
      ["Начислено партнёру", money(totals.partnerAccrued)], ["Выплачено партнёру", money(totals.partnerPaid)],
      ["Текущий баланс", money(totals.balance)], ["Прибыль компании", money(totals.profit)],
    ]) doc.font("DejaVu").fontSize(10).text(`${label}: ${value}`);
    doc.moveDown().font("DejaVuBold").fontSize(13).text("Заказы");
    for (const item of statement.orders) {
      ensure(68);
      doc.font("DejaVuBold").fontSize(10).text(`${item.order.number} · ${item.order.client.name}`);
      doc.font("DejaVu").fontSize(9).text(
        `Сумма ${money(item.metrics.orderAmount)} · получено ${money(item.metrics.received)} · ` +
        `начислено партнёру ${money(item.metrics.partnerAccrued)} · баланс ${money(item.metrics.partnerBalance)}`,
      );
      doc.moveDown(0.35);
    }
    doc.moveDown().font("DejaVuBold").fontSize(13).text("Операции");
    if (!operations.length) doc.font("DejaVu").fontSize(10).text("Операций за период нет.");
    for (const item of operations) {
      ensure(52);
      doc.font("DejaVuBold").fontSize(9).text(`${date(item.operationDate)} · ${item.orderNumber} · ${item.type}`);
      doc.font("DejaVu").fontSize(9).text(`${money(item.amount)}${item.account ? ` · ${item.account}` : ""}${item.comment ? ` · ${item.comment}` : ""}`);
      doc.moveDown(0.3);
    }
    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      doc.font("DejaVu").fontSize(8).fillColor("#71717A")
        .text(`Страница ${index + 1} из ${range.count}`, 42, doc.page.height - 35, { align: "right", width: doc.page.width - 84 });
    }
  });
}
