"use client";

import {
  FileText,
  FileSpreadsheet,
  FileCheck,
  Download,
  Printer,
  Eye,
  Plus,
} from "lucide-react";

const documents = [
  {
    id: 1,
    number: "КП-00021",
    type: "Коммерческое предложение",
    client: "ТОО Астана Дом",
    status: "Отправлено",
    date: "04.08.2026",
  },
  {
    id: 2,
    number: "DOG-00018",
    type: "Договор",
    client: "Villa House",
    status: "Подписан",
    date: "03.08.2026",
  },
  {
    id: 3,
    number: "INV-00034",
    type: "Счет на оплату",
    client: "Restaurant Talgar",
    status: "Ожидает оплату",
    date: "02.08.2026",
  },
  {
    id: 4,
    number: "ACT-00009",
    type: "Акт выполненных работ",
    client: "Premium House",
    status: "Готов",
    date: "01.08.2026",
  },
];

function badge(status: string) {
  switch (status) {
    case "Подписан":
      return "bg-green-600";
    case "Отправлено":
      return "bg-blue-600";
    case "Ожидает оплату":
      return "bg-yellow-500 text-black";
    default:
      return "bg-slate-700";
  }
}

export default function DocumentsPage() {
  return (
    <section className="flex-1 overflow-auto p-8">

      <div className="mb-8 flex items-center justify-between">

        <div>

          <h1 className="text-3xl font-bold text-white">
            Документы
          </h1>

          <p className="mt-2 text-slate-400">
            КП, договоры, счета и акты
          </p>

        </div>

        <button className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-white hover:bg-blue-700">

          <Plus size={18} />

          Создать документ

        </button>

      </div>

      <div className="mb-8 grid gap-6 md:grid-cols-2 xl:grid-cols-4">

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <FileText className="mb-4 text-blue-400" />

          <p className="text-slate-400">
            КП
          </p>

          <h2 className="mt-2 text-4xl font-bold text-white">
            26
          </h2>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <FileCheck className="mb-4 text-green-400" />

          <p className="text-slate-400">
            Договоры
          </p>

          <h2 className="mt-2 text-4xl font-bold text-green-400">
            18
          </h2>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <FileSpreadsheet className="mb-4 text-yellow-400" />

          <p className="text-slate-400">
            Счета
          </p>

          <h2 className="mt-2 text-4xl font-bold text-yellow-400">
            14
          </h2>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <FileCheck className="mb-4 text-purple-400" />

          <p className="text-slate-400">
            Акты
          </p>

          <h2 className="mt-2 text-4xl font-bold text-purple-400">
            11
          </h2>

        </div>

      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-700 bg-[#101827]">

        <table className="w-full">

          <thead className="bg-slate-900">

            <tr>

              <th className="px-6 py-4 text-left text-slate-400">
                №
              </th>

              <th className="px-6 py-4 text-left text-slate-400">
                Тип
              </th>

              <th className="px-6 py-4 text-left text-slate-400">
                Клиент
              </th>

              <th className="px-6 py-4 text-left text-slate-400">
                Дата
              </th>

              <th className="px-6 py-4 text-left text-slate-400">
                Статус
              </th>

              <th className="px-6 py-4 text-center text-slate-400">
                Действия
              </th>

            </tr>

          </thead>

          <tbody>

            {documents.map((doc) => (

              <tr
                key={doc.id}
                className="border-t border-slate-800 hover:bg-slate-900"
              >

                <td className="px-6 py-5 font-semibold text-white">
                  {doc.number}
                </td>

                <td className="px-6 py-5 text-white">
                  {doc.type}
                </td>

                <td className="px-6 py-5 text-slate-300">
                  {doc.client}
                </td>

                <td className="px-6 py-5 text-slate-300">
                  {doc.date}
                </td>

                <td className="px-6 py-5">

                  <span className={`rounded-full px-3 py-1 text-sm text-white ${badge(doc.status)}`}>
                    {doc.status}
                  </span>

                </td>

                <td className="px-6 py-5">

                  <div className="flex justify-center gap-2">

                    <button className="rounded-lg bg-slate-800 p-2 hover:bg-slate-700">
                      <Eye size={18} />
                    </button>

                    <button className="rounded-lg bg-blue-600 p-2 hover:bg-blue-700">
                      <Download size={18} />
                    </button>

                    <button className="rounded-lg bg-green-600 p-2 hover:bg-green-700">
                      <Printer size={18} />
                    </button>

                  </div>

                </td>

              </tr>

            ))}

          </tbody>

        </table>

      </div>

    </section>
  );
}