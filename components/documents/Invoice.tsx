import { date, documentNumber, money, type DocumentOrder } from "./types";
import { DocumentBrandFooter, DocumentBrandHeader } from "./DocumentBrand";

export default function Invoice({ order }: { order: DocumentOrder }) {
  const company = order.company;
  const total = Number(order.amount);
  const remaining = Math.max(Number(order.balance), 0);
  const received = Math.max(total - remaining, 0);
  const invoiceNumber = documentNumber(order, "INVOICE");
  return (
    <div className="space-y-8 text-sm leading-6">
      <DocumentBrandHeader order={order} title="Счёт на оплату" documentNumber={invoiceNumber} />
      <section className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="font-bold">Поставщик</h2>
          <p>{company?.name || "ТОО «ALTYN SAPA COMPANY»"}</p>
          {company?.bin && <p>БИН: {company.bin}</p>}
          {company?.bank && <p>Банк: {company.bank}</p>}
          {company?.iik && <p>ИИК: {company.iik}</p>}
          {company?.bik && <p>БИК: {company.bik}</p>}
          {company?.bankDetails && <p className="whitespace-pre-wrap">{company.bankDetails}</p>}
        </div>
        <div>
          <h2 className="font-bold">Плательщик</h2>
          <p>{order.client.name}</p>
          <p>{order.client.phone}</p>
          <p>{order.client.city}</p>
        </div>
      </section>
      {(company?.kaspiGoldName || company?.kaspiGoldPhone) && (
        <section className="rounded-xl border-2 border-amber-400 bg-amber-50 p-5">
          <h2 className="font-bold text-slate-950">Оплата через Kaspi Gold</h2>
          {company.kaspiGoldName && <p>Получатель: {company.kaspiGoldName}</p>}
          {company.kaspiGoldPhone && <p>Телефон: {company.kaspiGoldPhone}</p>}
          <p className="mt-2 text-xs text-slate-600">В комментарии укажите заказ № {order.number}.</p>
        </section>
      )}
      <table className="w-full border-collapse">
        <thead className="bg-gray-100">
          <tr>
            <th className="border p-3 text-left">Назначение платежа</th>
            <th className="border p-3 text-right">Сумма</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border p-3">
              Оплата по заказу № {order.number}: лестница {order.staircase},{" "}
              {order.material}
            </td>
            <td className="border p-3 text-right">{money(total)}</td>
          </tr>
          <tr>
            <td className="border p-3">Ранее получено</td>
            <td className="border p-3 text-right">− {money(received)}</td>
          </tr>
          <tr className="bg-amber-50 text-lg font-bold">
            <td className="border p-3">Остаток к оплате</td>
            <td className="border p-3 text-right">{money(remaining)}</td>
          </tr>
        </tbody>
      </table>
      <p className="border-t border-black pt-5">
        Назначение платежа: оплата остатка по счёту № {invoiceNumber} от {date(order.createdAt)}, заказ № {order.number}.
        После оплаты направьте подтверждение менеджеру.
      </p>
      <DocumentBrandFooter order={order} />
    </div>
  );
}
