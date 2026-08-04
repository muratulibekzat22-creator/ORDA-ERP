"use client";

import type { Order } from "@/lib/types";

interface Props {
  order: Order;
}

export default function CommercialOffer({
  order,
}: Props) {
  return (
    <div className="mx-auto max-w-5xl rounded-2xl bg-white p-10 text-black">

      <div className="mb-10 flex items-center justify-between">

        <div>

          <h1 className="text-4xl font-bold">
            ALTYN SAPA
          </h1>

          <p className="text-gray-500">
            Коммерческое предложение
          </p>

        </div>

        <div className="text-right">

          <p>
            № {order.number}
          </p>

          <p>
            {new Date().toLocaleDateString()}
          </p>

        </div>

      </div>

      <div className="grid grid-cols-2 gap-10">

        <div>

          <h2 className="mb-4 text-xl font-bold">
            Клиент
          </h2>

          <p>{order.client.name}</p>

          <p>{order.client.phone}</p>

          <p>{order.address}</p>

        </div>

        <div>

          <h2 className="mb-4 text-xl font-bold">
            Заказ
          </h2>

          <p>
            Тип:
            {" "}
            {order.staircase}
          </p>

          <p>
            Материал:
            {" "}
            {order.material}
          </p>

          <p>
            Менеджер:
            {" "}
            {order.manager}
          </p>

        </div>

      </div>

      <table className="mt-12 w-full border">

        <thead>

          <tr className="bg-gray-200">

            <th className="border p-3 text-left">
              Наименование
            </th>

            <th className="border p-3">
              Сумма
            </th>

          </tr>

        </thead>

        <tbody>

          <tr>

            <td className="border p-3">
              Изготовление лестницы
            </td>

            <td className="border p-3 text-center">
              {Number(order.amount).toLocaleString()} ₸
            </td>

          </tr>

        </tbody>

      </table>

      <div className="mt-10 text-right">

        <h2 className="text-3xl font-bold">

          Итого:

          {" "}

          <span className="text-green-600">

            {Number(order.amount).toLocaleString()} ₸

          </span>

        </h2>

      </div>

      <div className="mt-16">

        <h2 className="mb-3 text-xl font-bold">
          Гарантия
        </h2>

        <p>
          Компания ALTYN SAPA предоставляет официальную гарантию
          согласно выбранному материалу и условиям договора.
        </p>

      </div>

    </div>
  );
}
