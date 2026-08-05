import { date, documentNumber, money, type DocumentOrder } from "./types";
import { DocumentBrandFooter, DocumentBrandHeader } from "./DocumentBrand";

export default function WorkCompletionAct({ order }: { order: DocumentOrder }) {
  const completionDate =
    order.productions?.find(
      (production) => production.stage === "Сдано" && production.finishDate,
    )?.finishDate ?? order.createdAt;
  return (
    <div className="space-y-8 text-sm leading-6">
      <DocumentBrandHeader order={order} title="Акт выполненных работ" documentNumber={documentNumber(order, "ACT")} />
      <section className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="font-bold">Исполнитель</h2>
          <p>ТОО «ALTYN SAPA COMPANY»</p>
          <p>Изготовление лестниц под ключ</p>
        </div>
        <div>
          <h2 className="font-bold">Заказчик</h2>
          <p>{order.client.name}</p>
          <p>{order.client.phone}</p>
        </div>
      </section>
      <section>
        <p>
          <b>Объект:</b> {order.address}
        </p>
        <table className="mt-5 w-full border-collapse">
          <thead className="bg-gray-100">
            <tr>
              <th className="border p-3 text-left">Выполненные работы</th>
              <th className="border p-3 text-right">Стоимость</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border p-3">
                Изготовление и монтаж лестницы: {order.staircase}, материал —{" "}
                {order.material}
              </td>
              <td className="border p-3 text-right">{money(order.amount)}</td>
            </tr>
            <tr className="font-bold">
              <td className="border p-3">Итого</td>
              <td className="border p-3 text-right">{money(order.amount)}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section>
        <p>
          Работы выполнены в полном объёме. Заказчик претензий по объёму и
          качеству работ не имеет.
        </p>
        <p className="mt-3">
          <b>Дата сдачи:</b> {date(completionDate)}
        </p>
      </section>
      <Signatures client={order.client.name} />
      <DocumentBrandFooter order={order} />
    </div>
  );
}

function Signatures({ client }: { client: string }) {
  return (
    <div className="mt-16 grid grid-cols-2 gap-12">
      <div>
        <p className="mb-10 font-bold">Исполнитель</p>
        <div className="border-b border-black" />
        <p className="mt-2">ALTYN SAPA COMPANY</p>
      </div>
      <div>
        <p className="mb-10 font-bold">Заказчик</p>
        <div className="border-b border-black" />
        <p className="mt-2">{client}</p>
      </div>
    </div>
  );
}
