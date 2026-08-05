import type { ReactNode } from "react";
import { DocumentBrandFooter, DocumentBrandHeader } from "./DocumentBrand";
import { date, documentNumber, money, type DocumentOrder } from "./types";

export default function CommercialProposal({
  order,
}: {
  order: DocumentOrder;
}) {
  const calculation = order.calculations?.[0];
  return (
    <div className="text-sm leading-6">
      <DocumentBrandHeader order={order} title="Коммерческое предложение" documentNumber={documentNumber(order, "OFFER")} />
      <section className="mt-8 rounded-xl bg-slate-50 p-6">
        <p className="text-lg">
          Уважаемый(-ая) <b>{order.client.name}</b>!
        </p>
        <p className="mt-3">
          Предлагаем изготовление лестницы для вашего объекта по адресу{" "}
          <b>{order.address}</b>. Решение будет выполнено под размеры объекта с
          учётом выбранного материала и согласованной комплектации.
        </p>
      </section>
      <section className="mt-7 grid grid-cols-2 gap-5">
        <Info title="Материал">{order.material}</Info>
        <Info title="Тип лестницы">{order.staircase}</Info>
        {calculation && (
          <>
            <Info title="Ступени">{calculation.regularSteps} обычных</Info>
            <Info title="Площадки">
              {calculation.platformEquivalents.length
                ? calculation.platformEquivalents
                    .map((value) => `${value} экв.`)
                    .join(", ")
                : "Нет"}
            </Info>
            <Info title="Итого">
              {calculation.equivalentSteps} эквивалентных ступеней
            </Info>
          </>
        )}
      </section>
      <table className="mt-7 w-full border-collapse">
        <thead className="bg-slate-950 text-white">
          <tr>
            <th className="border border-slate-300 p-3 text-left">
              Предлагаемое решение
            </th>
            <th className="border border-slate-300 p-3 text-right">
              Стоимость
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border p-3">
              Изготовление лестницы: {order.staircase}, материал —{" "}
              {order.material}. Комплектация уточняется и фиксируется в заказе.
            </td>
            <td className="border p-3 text-right font-bold">
              {money(calculation?.clientPrice ?? order.amount)}
            </td>
          </tr>
          <tr className="bg-amber-50 text-lg font-bold">
            <td className="border p-3">Итого</td>
            <td className="border p-3 text-right">
              {money(calculation?.clientPrice ?? order.amount)}
            </td>
          </tr>
        </tbody>
      </table>
      <section className="mt-7 grid grid-cols-3 gap-4">
        <Info title="Оплата">
          Предоплата {money(order.prepayment)}. Остаток {money(order.balance)} —
          согласно условиям договора.
        </Info>
        <Info title="Сроки">
          Срок уточняется менеджером после замера и фиксируется в договоре.
        </Info>
        <Info title="Гарантия">
          Гарантия действует согласно условиям подписанного договора и выбранной
          комплектации.
        </Info>
      </section>
      <section className="mt-7 rounded-xl bg-amber-50 p-5 text-center">
        <p className="text-lg font-bold">Готовы обсудить детали проекта</p>
        <p>
          Свяжитесь с менеджером ALTYN SAPA:{" "}
          {order.company?.phone || "+7 708 575 0881"}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Предложение подготовлено {date(order.createdAt)} для заказа{" "}
          {order.number}.
        </p>
      </section>
      <DocumentBrandFooter order={order} />
    </div>
  );
}

function Info({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-300 p-4">
      <h2 className="mb-1 font-bold text-slate-950">{title}</h2>
      <div>{children}</div>
    </div>
  );
}
