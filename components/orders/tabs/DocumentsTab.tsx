import Link from "next/link";

export default function DocumentsTab({ orderId }: { orderId: number }) {
  const documents = [
    ["Коммерческое предложение", `/orders/${orderId}/offer`, "Предложение и условия заказа"],
    ["Договор", `/orders/${orderId}/contract`, "Договор подряда с заказчиком"],
    ["Акт выполненных работ", `/orders/${orderId}/act`, "Подтверждение сдачи работ"],
    ["Счёт", `/orders/${orderId}/invoice`, "Счёт на оплату заказа"],
    ["Печать", `/orders/${orderId}/print`, "Печатная версия предложения"],
  ];

  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{documents.map(([title, href, description]) => <div key={href} className="rounded-2xl border border-slate-700 bg-[#101827] p-6"><p className="text-lg font-semibold text-white">{title}</p><p className="mt-2 min-h-10 text-sm text-slate-400">{description}</p><Link href={href} className="mt-5 inline-flex rounded-xl bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700">Открыть</Link></div>)}</div>;
}
