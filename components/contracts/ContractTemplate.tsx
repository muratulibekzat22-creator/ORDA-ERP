"use client";

interface Props {
  order: any;
}

export default function ContractTemplate({
  order,
}: Props) {
  return (
    <div className="mx-auto max-w-5xl rounded-2xl bg-white p-12 text-black">

      <div className="text-center">

        <h1 className="text-3xl font-bold">
          ДОГОВОР ПОДРЯДА
        </h1>

        <p className="mt-2 text-gray-500">
          № {order.number}
        </p>

      </div>

      <div className="mt-10 space-y-5 leading-8">

        <p>
          Исполнитель: <strong>ТОО ALTYN SAPA COMPANY</strong>
        </p>

        <p>
          Заказчик:
          {" "}
          <strong>{order.client.name}</strong>
        </p>

        <p>
          Телефон:
          {" "}
          {order.client.phone}
        </p>

        <p>
          Адрес объекта:
          {" "}
          {order.address}
        </p>

        <p>
          Тип лестницы:
          {" "}
          {order.staircase}
        </p>

        <p>
          Материал:
          {" "}
          {order.material}
        </p>

        <p>
          Стоимость заказа:
          {" "}
          <strong>
            {Number(order.amount).toLocaleString()} ₸
          </strong>
        </p>

        <p>
          Предоплата:
          {" "}
          {Number(order.prepayment).toLocaleString()} ₸
        </p>

        <p>
          Остаток:
          {" "}
          {Number(order.balance).toLocaleString()} ₸
        </p>

      </div>

      <div className="mt-12">

        <h2 className="mb-4 text-2xl font-bold">
          Обязанности сторон
        </h2>

        <ul className="list-disc space-y-2 pl-6">

          <li>
            Исполнитель обязуется изготовить и установить лестницу согласно проекту.
          </li>

          <li>
            Заказчик обязуется своевременно произвести оплату.
          </li>

          <li>
            Все изменения согласовываются письменно.
          </li>

          <li>
            Гарантия предоставляется согласно выбранному материалу.
          </li>

        </ul>

      </div>

      <div className="mt-20 grid grid-cols-2 gap-10">

        <div>

          <p className="mb-10 font-bold">
            Исполнитель
          </p>

          <div className="border-b border-black" />

          <p className="mt-3">
            ALTYN SAPA COMPANY
          </p>

        </div>

        <div>

          <p className="mb-10 font-bold">
            Заказчик
          </p>

          <div className="border-b border-black" />

          <p className="mt-3">
            {order.client.name}
          </p>

        </div>

      </div>

    </div>
  );
}