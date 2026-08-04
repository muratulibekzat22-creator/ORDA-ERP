"use client";

import {
  UserCog,
  Plus,
  Star,
  BadgeDollarSign,
  Briefcase,
} from "lucide-react";

const employees = [
  {
    id: 1,
    name: "Бекзат",
    role: "Director",
    salary: "1 200 000 ₸",
    orders: 32,
    completed: 18,
    kpi: 98,
    online: true,
  },
  {
    id: 2,
    name: "Айбек",
    role: "Manager",
    salary: "450 000 ₸",
    orders: 15,
    completed: 8,
    kpi: 91,
    online: true,
  },
  {
    id: 3,
    name: "Ержан",
    role: "Production",
    salary: "550 000 ₸",
    orders: 12,
    completed: 11,
    kpi: 95,
    online: false,
  },
  {
    id: 4,
    name: "Азамат",
    role: "Partner",
    salary: "По договору",
    orders: 9,
    completed: 9,
    kpi: 100,
    online: true,
  },
];

export default function EmployeesPage() {
  return (
    <section className="flex-1 overflow-auto p-8">

      <div className="mb-8 flex items-center justify-between">

        <div>

          <h1 className="text-3xl font-bold text-white">
            Сотрудники
          </h1>

          <p className="mt-2 text-slate-400">
            Пользователи ORDA ERP и KPI
          </p>

        </div>

        <button className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-white hover:bg-blue-700">

          <Plus size={18} />

          Добавить сотрудника

        </button>

      </div>

      <div className="mb-8 grid gap-6 md:grid-cols-2 xl:grid-cols-4">

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <UserCog className="mb-4 text-blue-400" />

          <p className="text-slate-400">
            Всего сотрудников
          </p>

          <h2 className="mt-2 text-4xl font-bold text-white">
            {employees.length}
          </h2>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <Briefcase className="mb-4 text-yellow-400" />

          <p className="text-slate-400">
            Активных
          </p>

          <h2 className="mt-2 text-4xl font-bold text-yellow-400">
            {employees.filter((e) => e.online).length}
          </h2>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <Star className="mb-4 text-green-400" />

          <p className="text-slate-400">
            Средний KPI
          </p>

          <h2 className="mt-2 text-4xl font-bold text-green-400">
            {Math.round(
              employees.reduce((a, b) => a + b.kpi, 0) / employees.length
            )}
            %
          </h2>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <BadgeDollarSign className="mb-4 text-purple-400" />

          <p className="text-slate-400">
            Отделов
          </p>

          <h2 className="mt-2 text-4xl font-bold text-purple-400">
            5
          </h2>

        </div>

      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-700 bg-[#101827]">

        <table className="w-full">

          <thead className="bg-slate-900">

            <tr>

              <th className="px-6 py-4 text-left text-slate-400">
                Сотрудник
              </th>

              <th className="px-6 py-4 text-left text-slate-400">
                Роль
              </th>

              <th className="px-6 py-4 text-left text-slate-400">
                Заказы
              </th>

              <th className="px-6 py-4 text-left text-slate-400">
                Выполнено
              </th>

              <th className="px-6 py-4 text-left text-slate-400">
                KPI
              </th>

              <th className="px-6 py-4 text-left text-slate-400">
                Зарплата
              </th>

              <th className="px-6 py-4 text-left text-slate-400">
                Статус
              </th>

            </tr>

          </thead>

          <tbody>

            {employees.map((employee) => (

              <tr
                key={employee.id}
                className="border-t border-slate-800 hover:bg-slate-900"
              >

                <td className="px-6 py-5 font-semibold text-white">
                  {employee.name}
                </td>

                <td className="px-6 py-5 text-cyan-400">
                  {employee.role}
                </td>

                <td className="px-6 py-5 text-white">
                  {employee.orders}
                </td>

                <td className="px-6 py-5 text-green-400">
                  {employee.completed}
                </td>

                <td className="px-6 py-5">

                  <span className="rounded-full bg-blue-600 px-3 py-1 text-white">
                    {employee.kpi}%
                  </span>

                </td>

                <td className="px-6 py-5 text-yellow-400">
                  {employee.salary}
                </td>

                <td className="px-6 py-5">

                  <span
                    className={`rounded-full px-3 py-1 text-white ${
                      employee.online
                        ? "bg-green-600"
                        : "bg-slate-700"
                    }`}
                  >
                    {employee.online ? "Онлайн" : "Оффлайн"}
                  </span>

                </td>

              </tr>

            ))}

          </tbody>

        </table>

      </div>

    </section>
  );
}