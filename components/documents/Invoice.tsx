import { documentNumber, money, type DocumentOrder } from "./types";
import { DocumentBrandFooter, DocumentBrandHeader } from "./DocumentBrand";

export default function Invoice({ order }: { order: DocumentOrder }) {
  return (
    <div className="space-y-8 text-sm leading-6">
      <DocumentBrandHeader order={order} title="Счёт на оплату" documentNumber={documentNumber(order, "INVOICE")} />
      <section className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="font-bold">Поставщик</h2>
          <p>ТОО «ALTYN SAPA COMPANY»</p>
          <p>Реквизиты предоставляются в договоре.</p>
        </div>
        <div>
          <h2 className="font-bold">Плательщик</h2>
          <p>{order.client.name}</p>
          <p>{order.client.phone}</p>
          <p>{order.client.city}</p>
        </div>
      </section>
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
            <td className="border p-3 text-right">{money(order.amount)}</td>
          </tr>
          <tr className="font-bold">
            <td className="border p-3">К оплате</td>
            <td className="border p-3 text-right">{money(order.amount)}</td>
          </tr>
        </tbody>
      </table>
      <p className="border-t border-black pt-5">
        Назначение платежа: оплата по заказу № {order.number}. После оплаты
        направьте подтверждение менеджеру.
      </p>
      <DocumentBrandFooter order={order} />
    </div>
  );
}
