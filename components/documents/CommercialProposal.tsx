interface Props {
    order: any;
  }
  
  export default function CommercialProposal({ order }: Props) {
    return (
      <div className="mx-auto max-w-5xl bg-white p-12 text-black">
  
        <div className="border-b pb-8">
  
          <div className="flex items-start justify-between">
  
            <div>
  
              <h1 className="text-5xl font-bold tracking-wide">
                ALTYN SAPA
              </h1>
  
              <p className="mt-2 text-lg text-gray-500">
                Коммерческое предложение
              </p>
  
            </div>
  
            <div className="text-right text-sm">
  
              <p>
                <b>№ КП:</b> {order.number}
              </p>
  
              <p className="mt-2">
                <b>Дата:</b>{" "}
                {new Date(order.createdAt).toLocaleDateString("ru-RU")}
              </p>
  
            </div>
  
          </div>
  
        </div>
  
        <div className="mt-10 grid grid-cols-2 gap-10">
  
          <div>
  
            <h2 className="mb-4 text-lg font-bold">
              Заказчик
            </h2>
  
            <div className="space-y-2 text-gray-700">
  
              <p>
                <b>Имя:</b> {order.client?.name}
              </p>
  
              <p>
                <b>Телефон:</b> {order.client?.phone}
              </p>
  
              <p>
                <b>Адрес:</b> {order.address}
              </p>
  
            </div>
  
          </div>
  
          <div>
  
            <h2 className="mb-4 text-lg font-bold">
              Компания
            </h2>
  
            <div className="space-y-2 text-gray-700">
  
              <p>
                ALTYN SAPA
              </p>
  
              <p>
                Изготовление лестниц под ключ
              </p>
  
              <p>
                Казахстан
              </p>
  
            </div>
  
          </div>
  
        </div>
  
        <div className="mt-12 overflow-hidden rounded-xl border">
  
          <table className="w-full border-collapse">
  
            <thead className="bg-gray-100">
  
              <tr>
  
                <th className="border p-4 text-left">
                  Наименование
                </th>
  
                <th className="border p-4 text-center">
                  Значение
                </th>
  
              </tr>
  
            </thead>
  
            <tbody>
  
              <tr>
  
                <td className="border p-4">
                  Тип лестницы
                </td>
  
                <td className="border p-4 text-center">
                  {order.staircase}
                </td>
  
              </tr>
  
              <tr>
  
                <td className="border p-4">
                  Материал
                </td>
  
                <td className="border p-4 text-center">
                  {order.material}
                </td>
  
              </tr>
  
              <tr>
  
                <td className="border p-4">
                  Адрес монтажа
                </td>
  
                <td className="border p-4 text-center">
                  {order.address}
                </td>
  
              </tr>
  
              <tr className="bg-gray-50">
  
                <td className="border p-4 text-xl font-bold">
                  Общая стоимость
                </td>
  
                <td className="border p-4 text-center text-3xl font-bold text-green-600">
                  {Number(order.amount).toLocaleString()} ₸
                </td>
  
              </tr>
  
            </tbody>
  
          </table>
  
        </div>
  
        <div className="mt-12 rounded-xl border bg-gray-50 p-6">
  
          <h2 className="mb-5 text-2xl font-bold">
            В стоимость входит
          </h2>
  
          <ul className="space-y-3">
  
            <li>✔ Изготовление лестницы по индивидуальному проекту.</li>
  
            <li>✔ Подготовка и обработка древесины.</li>
  
            <li>✔ Покраска качественными материалами.</li>
  
            <li>✔ Доставка.</li>
  
            <li>✔ Монтаж под ключ.</li>
  
            <li>✔ Финальная проверка качества.</li>
  
            <li>✔ Гарантийное обслуживание.</li>
  
          </ul>
  
        </div>
  
        <div className="mt-12 grid grid-cols-2 gap-10">
  
          <div className="rounded-xl border p-6">
  
            <h2 className="mb-4 text-xl font-bold">
              Условия оплаты
            </h2>
  
            <ul className="space-y-2">
  
              <li>• Предоплата согласно договору.</li>
  
              <li>• Окончательный расчет после завершения монтажа.</li>
  
            </ul>
  
          </div>
  
          <div className="rounded-xl border p-6">
  
            <h2 className="mb-4 text-xl font-bold">
              Срок изготовления
            </h2>
  
            <p>
              До 40 календарных дней после подтверждения заказа.
            </p>
  
          </div>
  
        </div>
  
        <div className="mt-12 rounded-xl border p-6">
  
          <h2 className="mb-4 text-xl font-bold">
            Гарантия
          </h2>
  
          <p>
            Гарантия предоставляется согласно выбранному материалу и условиям договора.
          </p>
  
        </div>
  
        <div className="mt-16 border-t pt-8">
  
          <p className="text-center text-xl font-bold">
            Спасибо за доверие!
          </p>
  
          <p className="mt-3 text-center text-gray-600">
            ALTYN SAPA — лестницы премиального качества под ключ.
          </p>
  
        </div>
  
      </div>
    );
  }