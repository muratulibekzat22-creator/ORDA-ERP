import { documentNumber, money, type DocumentOrder } from "./types";
import { DocumentBrandFooter, DocumentBrandHeader } from "./DocumentBrand";

export default function Contract({ order }: { order: DocumentOrder }) {
  return (
    <div className="space-y-7 text-sm leading-6">
      <DocumentBrandHeader order={order} title="Договор подряда" documentNumber={documentNumber(order, "CONTRACT")} />
      <section className="space-y-3">
        <p>
          Исполнитель: <b>ТОО «ALTYN SAPA COMPANY»</b>.
        </p>
        <p>
          Заказчик: <b>{order.client.name}</b>, телефон: {order.client.phone}.
        </p>
        <p>
          <b>Предмет договора:</b> изготовление, доставка и монтаж лестницы (
          {order.staircase}, материал — {order.material}) по адресу:{" "}
          {order.address}.
        </p>
      </section>
      <section className="grid gap-4 border-y border-gray-300 py-5 md:grid-cols-3">
        <p>
          <b>Стоимость:</b>
          <br />
          {money(order.amount)}
        </p>
        <p>
          <b>Предоплата:</b>
          <br />
          {money(order.prepayment)}
        </p>
        <p>
          <b>Остаток:</b>
          <br />
          {money(order.balance)}
        </p>
      </section>
      <section>
        <h2 className="mb-2 text-lg font-bold">Сроки и гарантия</h2>
        <p>
          Срок изготовления — до 40 календарных дней после подтверждения заказа.
          Гарантия предоставляется на условиях договора и в соответствии с
          выбранным материалом.
        </p>
      </section>
      <section>
        <h2 className="mb-2 text-lg font-bold">Ответственность сторон</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Исполнитель обязуется выполнить работы качественно и в согласованный
            срок.
          </li>
          <li>
            Заказчик обязуется своевременно вносить платежи и обеспечить доступ
            на объект.
          </li>
          <li>Все изменения к заказу согласовываются сторонами письменно.</li>
        </ol>
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
