"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Banknote,
  CalendarDays,
  MapPin,
  MessageCircle,
  Phone,
} from "lucide-react";
import TrainingSummaryCard from "@/components/training/TrainingSummaryCard";

type Measurement = {
  id: number;
  visitDate: string;
  city: string;
  address: string;
  mapLink?: string | null;
  client: {
    name: string;
    phone: string;
    whatsapp: string;
    managerUser?: { name: string } | null;
  };
};

type Workspace = {
  nextMeasurement: Measurement | null;
  kpi: {
    today: number;
    upcoming: number;
    overdue: number;
    monthAssigned: number;
    monthCompleted: number;
    handed: number;
    monthOrders: number;
    conversion: number;
    monthBonus: number;
    bonusRate: number;
  };
};

const empty: Workspace = {
  nextMeasurement: null,
  kpi: {
    today: 0,
    upcoming: 0,
    overdue: 0,
    monthAssigned: 0,
    monthCompleted: 0,
    handed: 0,
    monthOrders: 0,
    conversion: 0,
    monthBonus: 0,
    bonusRate: 20_000,
  },
};
const money = (value: number) => `${value.toLocaleString("ru-RU")} ₸`;
const when = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));

export default function MeasurerHome() {
  const [data, setData] = useState<Workspace>(empty);
  const [payable, setPayable] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit" }).formatToParts(new Date());
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const [response, payrollResponse] = await Promise.all([
      fetch("/api/measurements?workspace=1", { cache: "no-store" }),
      fetch(`/api/payroll/self?year=${year}&month=${month}`, { cache: "no-store" }),
    ]);
    const body = await response.json().catch(() => ({}));
    const payroll = await payrollResponse.json().catch(() => ({})) as { totals?: { payable?: number } };
    if (!response.ok)
      setError(body.error ?? "Не удалось загрузить рабочий день");
    else setData(body);
    if (payrollResponse.ok) setPayable(Number(payroll.totals?.payable ?? 0));
    setLoading(false);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <main className="space-y-5 p-4 pb-24 md:p-8">
      <header>
        <p className="text-sm font-medium text-blue-300">Рабочий день</p>
        <h1 className="mt-1 text-2xl font-bold text-white md:text-3xl">
          Главная замерщика
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Ваши выезды, результат и бонусы — из текущих данных системы.
        </p>
      </header>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-red-300"
        >
          {error}
        </p>
      )}
      <TrainingSummaryCard />
      <section
        aria-busy={loading}
        className="grid grid-cols-2 gap-3 lg:grid-cols-3"
      >
        <Kpi title="Сегодня" value={data.kpi.today} />
        <Kpi title="Предстоящие" value={data.kpi.upcoming} />
        <Kpi title="Просрочено" value={data.kpi.overdue} alert />
        <Kpi title="Назначено за месяц" value={data.kpi.monthAssigned} />
        <Kpi title="Выполнено за месяц" value={data.kpi.monthCompleted} />
        <Kpi title="Передано менеджеру" value={data.kpi.handed} />
        <Kpi title="Успешных заказов" value={data.kpi.monthOrders} />
        <Kpi title="Конверсия в заказ" value={`${data.kpi.conversion}%`} />
        <Kpi title="Бонусов начислено" value={money(data.kpi.monthBonus)} />
        <Kpi title="Моя зарплата · к выплате" value={money(payable)} />
      </section>
      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 md:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">
              Следующий замер
            </p>
            <h2 className="mt-1 text-xl font-bold text-white">
              {data.nextMeasurement
                ? when(data.nextMeasurement.visitDate)
                : "Выездов пока нет"}
            </h2>
          </div>
          <CalendarDays className="text-blue-300" />
        </div>
        {data.nextMeasurement ? (
          <div className="mt-5 space-y-4">
            <div>
              <p className="text-lg font-semibold text-white">
                {data.nextMeasurement.client.name}
              </p>
              <p className="mt-1 text-sm text-slate-300">
                {data.nextMeasurement.client.phone}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {data.nextMeasurement.city} ·{" "}
                {data.nextMeasurement.address || "Локация по ссылке"}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Ответственный менеджер:{" "}
                {data.nextMeasurement.client.managerUser?.name ?? "не указан"}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Link
                href={`/measurements?measurement=${data.nextMeasurement.id}`}
                className="col-span-2 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 font-semibold"
              >
                Открыть <ArrowRight size={18} />
              </Link>
              <a
                href={`tel:${data.nextMeasurement.client.phone}`}
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-800 px-4"
              >
                <Phone size={18} />
                Позвонить
              </a>
              <a
                href={`https://wa.me/${(data.nextMeasurement.client.whatsapp || data.nextMeasurement.client.phone).replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-green-700 px-4"
              >
                <MessageCircle size={18} />
                WhatsApp
              </a>
              <a
                href={
                  data.nextMeasurement.mapLink ||
                  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${data.nextMeasurement.city} ${data.nextMeasurement.address}`)}`
                }
                target="_blank"
                rel="noreferrer"
                className="col-span-2 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-800 px-4"
              >
                <MapPin size={18} />
                Карта
              </a>
            </div>
          </div>
        ) : (
          <p className="mt-4 rounded-xl border border-dashed border-slate-700 p-5 text-center text-slate-400">
            Новый назначенный менеджером замер появится здесь автоматически.
          </p>
        )}
      </section>
      <section className="grid gap-3 sm:grid-cols-3">
        <Link
          href="/measurements"
          className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-blue-700 font-semibold"
        >
          <CalendarDays size={18} />
          Все замеры
        </Link>
        <Link
          href="/calendar"
          className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-slate-800 font-semibold"
        >
          <CalendarDays size={18} />
          Календарь
        </Link>
        <Link
          href="/payroll"
          className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-slate-800 font-semibold"
        >
          <Banknote size={18} />
          Моя зарплата
        </Link>
      </section>
      <section className="rounded-2xl border border-emerald-900 bg-emerald-950/20 p-4 text-sm text-emerald-100">
        <b>Мои показатели:</b> конверсия замер → заказ {data.kpi.conversion}% ·
        бонус за успешный заказ {money(data.kpi.bonusRate)}.
      </section>
    </main>
  );
}

function Kpi({
  title,
  value,
  alert = false,
}: {
  title: string;
  value: number | string;
  alert?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded-2xl border p-4 ${alert && Number(value) > 0 ? "border-red-800 bg-red-950/30" : "border-slate-800 bg-[#101827]"}`}
    >
      <p className="text-xs text-slate-400 sm:text-sm">{title}</p>
      <b className="mt-2 block break-words text-xl text-white sm:text-2xl">
        {value}
      </b>
    </div>
  );
}
