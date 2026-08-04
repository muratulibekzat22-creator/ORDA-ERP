"use client";

import { useEffect, useState } from "react";

export default function ReportsPage() {
  const [report, setReport] = useState<any>(null);

  useEffect(() => {
    loadReport();
  }, []);

  async function loadReport() {
    const response = await fetch("/api/reports");

    if (!response.ok) return;

    const data = await response.json();

    setReport(data);
  }

  if (!report) {
    return (
      <section className="p-8">
        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-10 text-center text-white">
          Загрузка отчета...
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-8 p-8">

      <div>

        <h1 className="text-4xl font-bold text-white">
          Отчет директора
        </h1>

        <p className="text-slate-400">
          ORDA ERP • ALTYN SAPA COMPANY
        </p>

      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-6">

        <Card title="Клиенты" value={report.clients} color="text-blue-400" />
        <Card title="Заказы" value={report.orders} color="text-green-400" />
        <Card title="Выполнено" value={report.completedOrders} color="text-yellow-400" />
        <Card title="Доход" value={`${Number(report.finance.revenue).toLocaleString()} ₸`} color="text-green-400" />
        <Card title="Получено" value={`${Number(report.finance.received).toLocaleString()} ₸`} color="text-cyan-400" />
        <Card title="Прибыль" value={`${Number(report.finance.profit ?? 0).toLocaleString()} ₸`} color="text-purple-400" />

      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-6 text-2xl font-bold text-white">
            Финансы
          </h2>

          <div className="space-y-4">

            <Row
              title="Получено"
              value={`${Number(report.finance.received).toLocaleString()} ₸`}
              color="text-blue-400"
            />

            <Row
              title="Дебиторская задолженность"
              value={`${Number(report.finance.debt).toLocaleString()} ₸`}
              color="text-yellow-400"
            />

            <Row
              title="Средний чек"
              value={`${Number(report.finance.averageOrder).toLocaleString()} ₸`}
              color="text-green-400"
            />

          </div>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-6 text-2xl font-bold text-white">
            Производство
          </h2>

          <div className="space-y-4">

            <Row title="Всего заказов" value={report.production.total} />

            <Row
              title="В работе"
              value={report.production.inProgress}
              color="text-yellow-400"
            />

            <Row
              title="Завершено"
              value={report.production.completed}
              color="text-green-400"
            />

          </div>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-6 text-2xl font-bold text-white">
            KPI
          </h2>

          <div className="space-y-4">

            <Row
              title="План"
              value={report.monthlyGoal}
            />

            <Row
              title="Выполнено"
              value={report.completedOrders}
              color="text-green-400"
            />

            <Row
              title="Выполнение"
              value={`${report.progress}%`}
              color="text-cyan-400"
            />

          </div>

        </div>

      </div>

      <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

        <div className="mb-6 flex items-center justify-between">

          <h2 className="text-2xl font-bold text-white">
            Выполнение месячного плана
          </h2>

          <span className="rounded-lg bg-slate-800 px-4 py-2 text-white">
            {report.progress}%
          </span>

        </div>

        <div className="h-5 overflow-hidden rounded-full bg-slate-800">

          <div
            className="h-full rounded-full bg-green-500 transition-all"
            style={{
              width: `${report.progress}%`,
            }}
          />

        </div>

        <p className="mt-4 text-slate-300">
          {report.completedOrders} из {report.monthlyGoal} договоров
        </p>

      </div>

    </section>
  );
}

function Card({
  title,
  value,
  color,
}: {
  title: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">
      <p className="text-slate-400">
        {title}
      </p>

      <h2 className={`mt-3 text-3xl font-bold ${color}`}>
        {value}
      </h2>
    </div>
  );
}

function Row({
  title,
  value,
  color = "text-white",
}: {
  title: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">
        {title}
      </span>

      <span className={`font-bold ${color}`}>
        {value}
      </span>
    </div>
  );
}