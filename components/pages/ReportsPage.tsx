"use client";

import { useCallback, useEffect, useState } from "react";
import type { DirectorReport } from "@/lib/types";

export default function ReportsPage() {
  const [report, setReport] = useState<DirectorReport | null>(null);
  const loadReport = useCallback(async () => {
    try {
      const response = await fetch("/api/reports");

      if (!response.ok) {
        throw new Error("Ошибка загрузки отчета");
      }

      const data = await response.json() as DirectorReport;

      setReport(data);
    } catch {
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadReport(), 0);
    return () => window.clearTimeout(timer);
  }, [loadReport]);

  if (!report) {
    return (
      <section className="flex-1 p-8">
        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-10 text-center text-white">
          Загрузка отчета...
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-8 p-8">

      <div>

        <h1 className="text-3xl font-bold text-white">
          Отчеты
        </h1>

        <p className="mt-2 text-slate-400">
          Аналитика ORDA ERP
        </p>

      </div>

      <div className="grid grid-cols-2 gap-6 xl:grid-cols-4">

        <Card
          title="Клиенты"
          value={report.clients}
          color="text-blue-400"
        />

        <Card
          title="Заказы"
          value={report.orders}
          color="text-green-400"
        />

        <Card
          title="Выполнено"
          value={report.completedOrders}
          color="text-yellow-400"
        />

        <Card
          title="Доход"
          value={`${Number(report.finance.revenue).toLocaleString()} ₸`}
          color="text-purple-400"
        />

      </div>

      <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

        <h2 className="mb-6 text-2xl font-bold text-white">
          Финансовая сводка
        </h2>

        <div className="space-y-4">

          <Row
            title="Получено"
            value={`${Number(report.finance.received).toLocaleString()} ₸`}
          />

          <Row
            title="Дебиторская задолженность"
            value={`${Number(report.finance.debt).toLocaleString()} ₸`}
          />

          <Row
            title="Средний чек"
            value={`${Number(report.finance.averageOrder).toLocaleString()} ₸`}
          />

        </div>

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
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="flex justify-between border-b border-slate-700 pb-3">

      <span className="text-slate-400">
        {title}
      </span>

      <span className="font-semibold text-white">
        {value}
      </span>

    </div>
  );
}
