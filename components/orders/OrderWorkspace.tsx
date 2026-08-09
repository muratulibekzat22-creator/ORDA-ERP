"use client";

import {
  CalendarDays,
  CircleDollarSign,
  ClipboardList,
  ExternalLink,
  Factory,
  FilePlus2,
  Files,
  History,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Printer,
  UserRound,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState } from "react";

import StairCalculator from "@/components/calculator/StairCalculator";
import ProjectPayments from "@/components/project/ProjectPayments";
import OrderProcess from "./OrderProcess";
import OrderSettlementPanel from "./OrderSettlementPanel";
import { ORDER_STAGE_LABELS, projectOrderStage } from "@/lib/orders/presentation";
import { paymentMethodLabel } from "@/lib/orders/registration";

import DocumentsTab from "./tabs/DocumentsTab";
import FilesTab from "./tabs/FilesTab";
import type { NumericValue, OrderTabData } from "./tabs/types";

type WorkspaceOrder = OrderTabData & {
  partnerPlannedReadyAt?: Date | string | null;
  partnerComment?: string;
};

const panel =
  "scroll-mt-24 rounded-2xl border border-slate-800 bg-[#101827] shadow-sm";
const label = "text-xs font-medium uppercase tracking-wide text-slate-500";

function money(value: NumericValue) {
  return `${Number(value).toLocaleString("ru-RU")} ₸`;
}

function date(value?: Date | string | null, withTime = false) {
  if (!value) return "Не назначено";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Не назначено";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
  }).format(parsed);
}

function Field({ title, value }: { title: string; value?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-950/50 p-3">
      <p className={label}>{title}</p>
      <div className="mt-1 break-words text-sm font-medium text-slate-100">
        {value || "—"}
      </div>
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 p-4 md:p-5">
      <div className="flex min-w-0 gap-3">
        <span className="mt-0.5 rounded-xl bg-blue-500/10 p-2 text-blue-400">
          {icon}
        </span>
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="mt-0.5 text-sm text-slate-400">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

export default function OrderWorkspace({ order }: { order: WorkspaceOrder }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [editing, setEditing] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [form, setForm] = useState({
    address: order.address,
    material: order.material,
    staircase: order.staircase,
    manager: order.manager,
    amount: String(order.amount),
  });
  const canEdit = ["DIRECTOR", "MANAGER"].includes(session?.user.role ?? "");
  const canAddPayment = ["DIRECTOR", "MANAGER", "ACCOUNTANT"].includes(
    session?.user.role ?? "",
  );
  const canSeeClientFinance = ["DIRECTOR", "MANAGER", "ACCOUNTANT"].includes(
    session?.user.role ?? "",
  );
  const calculation = order.calculations[0];
  const production = order.productions[0];
  const nextMeasurement = [...order.measurements].sort(
    (first, second) =>
      new Date(first.visitDate).getTime() -
      new Date(second.visitDate).getTime(),
  )[0];
  const nextAction = nextMeasurement
    ? `Замер · ${date(nextMeasurement.visitDate)}`
    : production?.plannedEndAt
      ? `Плановая готовность · ${date(production.plannedEndAt)}`
      : "Добавьте ближайшее действие в календаре";

  async function patch(payload: Record<string, unknown>, success: string) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? "Не удалось сохранить изменения");
      setNotice(success);
      setEditing(false);
      setCommentOpen(false);
      setComment("");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось сохранить изменения",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-4 p-3 pb-24 sm:p-4 md:space-y-5 md:p-6 lg:p-8">
      <header className="rounded-2xl border border-slate-800 bg-gradient-to-br from-[#111c2e] to-[#0c1320] p-4 md:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
              <Link href="/orders" className="hover:text-white">
                Заказы
              </Link>
              <span aria-hidden="true">/</span>
              <span>{order.number}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1 className="break-all text-2xl font-bold text-white md:text-3xl">
                Заказ {order.number}
              </h1>
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-semibold text-emerald-300">
                {ORDER_STAGE_LABELS[projectOrderStage(order.lifecycle, order.productions[0]?.stage)]}
              </span>
            </div>
            <p className="mt-2 flex items-center gap-2 text-slate-300">
              <UserRound size={16} aria-hidden="true" /> {order.client.name}
              <span className="text-slate-600">·</span> {order.manager}
            </p>
          </div>

          <nav
            aria-label="Действия с заказом"
            className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap xl:max-w-3xl xl:justify-end"
          >
            {canEdit && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
              >
                <Pencil size={17} /> Редактировать
              </button>
            )}
            <Link
              href={`/orders/${order.id}/print`}
              target="_blank"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            >
              <Printer size={17} /> Печать
            </Link>
            <a
              href="#files"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            >
              <FilePlus2 size={17} /> Добавить файл
            </a>
            {canEdit && (
              <button
                type="button"
                onClick={() => setCommentOpen(true)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              >
                <MessageCircle size={17} /> Добавить комментарий
              </button>
            )}
            {canAddPayment && (
              <button
                type="button"
                onClick={() => setPaymentOpen((value) => !value)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
              >
                <CircleDollarSign size={17} /> Добавить оплату
              </button>
            )}
          </nav>
        </div>
        {(notice || error) && (
          <p
            role={error ? "alert" : "status"}
            className={`mt-4 rounded-xl border p-3 text-sm ${error ? "border-red-800 bg-red-950/40 text-red-300" : "border-emerald-800 bg-emerald-950/40 text-emerald-300"}`}
          >
            {error || notice}
          </p>
        )}
      </header>

      {paymentOpen && <ProjectPayments orderId={order.id} />}

      <OrderProcess orderId={order.id} lifecycle={order.lifecycle} version={order.version} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.85fr)] xl:gap-5">
        <div className="space-y-4 md:space-y-5">
          <section id="client" className={panel}>
            <SectionTitle
              icon={<UserRound size={20} />}
              title="Клиент"
              description="Контакты и основная информация по заказу"
            />
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 md:p-5">
              <Field title="ФИО" value={order.client.name} />
              <Field
                title="Телефон"
                value={
                  <a
                    className="inline-flex items-center gap-1 text-blue-300 hover:text-blue-200"
                    href={`tel:${order.client.phone}`}
                  >
                    <Phone size={14} />
                    {order.client.phone}
                  </a>
                }
              />
              <Field
                title="WhatsApp"
                value={
                  <a
                    className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"
                    target="_blank"
                    rel="noreferrer"
                    href={`https://wa.me/${(order.client.whatsapp || order.client.phone).replace(/\D/g, "")}`}
                  >
                    <MessageCircle size={14} />
                    {order.client.whatsapp || order.client.phone}
                  </a>
                }
              />
              <Field title="Город" value={order.client.city} />
              <Field
                title="Адрес"
                value={order.address || order.client.address}
              />
              <Field title="Ответственный менеджер" value={order.manager} />
              <Field title="Дата получения заказа" value={date(order.orderReceivedAt)} />
              <Field title="Срок" value={date(order.promisedAt)} />
              <Field title="Статус заказа" value={order.status} />
              <Field title="Зарегистрирован в ORDA" value={date(order.createdAt)} />
              {order.mapUrl ? <Field title="Карта" value={<a href={order.mapUrl} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200">Открыть карту</a>} /> : null}
            </div>
          </section>

          <section id="technical" className={panel}>
            <SectionTitle
              icon={<ClipboardList size={20} />}
              title="Технические параметры"
              description="Зафиксированная комплектация полученного заказа"
            />
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 md:p-5">
              <Field title="Каркас" value={order.staircase} />
              <Field title="Комментарий к каркасу" value={order.frameComment} />
              <Field title="Материал" value={order.material} />
              <Field title="Ограждение" value={order.railingType} />
              <Field title="Стойка / опора" value={order.supportType} />
              <Field title="Цвет" value={order.color} />
              <Field title="Подсветка" value={order.lighting ? order.lightingDetails || "Да" : "Нет"} />
              <Field title="Обшивка" value={order.cladding ? order.claddingDetails || "Да" : "Нет"} />
              <Field title="Дополнительно" value={order.additionalDetails} />
            </div>
          </section>

          {canSeeClientFinance && <section id="order-finance" className={panel}>
            <SectionTitle
              icon={<CircleDollarSign size={20} />}
              title="Финансы заказа"
              description="Клиентские суммы; расчёт с цехом остаётся отдельным"
            />
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 md:p-5">
              <Field title="Общая сумма" value={money(order.amount)} />
              <Field title="Получено" value={money(order.prepayment)} />
              <Field title="Остаток" value={money(order.balance)} />
              <Field title="Способ оплаты" value={paymentMethodLabel(order.paymentMethod) || "Не указан"} />
            </div>
          </section>}

          {canSeeClientFinance && <section id="calculation" className={panel}>
            <SectionTitle
              icon={<ClipboardList size={20} />}
              title="Расчёт"
              description="Для менеджера отображаются только клиентские цены"
              action={
                <a
                  href="#calculator-details"
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-800 px-3 text-sm text-slate-200 hover:bg-slate-700"
                >
                  Открыть расчёт <ExternalLink size={15} />
                </a>
              }
            />
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 md:p-5">
              <Field
                title="Материал"
                value={calculation?.material || order.material}
              />
              <Field
                title="Количество ступеней"
                value={calculation?.regularSteps ?? "—"}
              />
              <Field
                title="Площадки"
                value={
                  calculation?.platformEquivalents?.length
                    ? `${calculation.platformEquivalents.length} шт.`
                    : "Нет"
                }
              />
              <Field
                title="Монтаж"
                value={
                  calculation
                    ? calculation.installationRequired
                      ? "Включён"
                      : "Не включён"
                    : "Не рассчитан"
                }
              />
              <Field
                title="Доставка"
                value={
                  calculation
                    ? calculation.deliveryRequired
                      ? "Включена"
                      : "Не включена"
                    : "Не рассчитана"
                }
              />
              <Field
                title="Дополнительные позиции"
                value={
                  calculation?.lines?.filter(
                    (line) => line.enabled && line.kind !== "step",
                  ).length ?? 0
                }
              />
            </div>
            <div className="grid gap-3 border-t border-slate-800 p-4 sm:grid-cols-3 md:p-5">
              <div className="rounded-xl bg-emerald-500/10 p-4">
                <p className={label}>Стоимость клиенту</p>
                <p className="mt-1 text-xl font-bold text-emerald-300">
                  {money(calculation?.clientPrice ?? order.amount)}
                </p>
              </div>
              <div className="rounded-xl bg-blue-500/10 p-4">
                <p className={label}>Предоплата</p>
                <p className="mt-1 text-xl font-bold text-blue-300">
                  {money(order.prepayment)}
                </p>
              </div>
              <div className="rounded-xl bg-amber-500/10 p-4">
                <p className={label}>Остаток клиента</p>
                <p className="mt-1 text-xl font-bold text-amber-300">
                  {money(order.balance)}
                </p>
              </div>
            </div>
            <details
              id="calculator-details"
              className="border-t border-slate-800 p-4 md:p-5"
            >
              <summary className="cursor-pointer font-semibold text-blue-300">
                Изменить клиентский расчёт
              </summary>
              <div className="mt-5">
                <StairCalculator orderId={order.id} />
              </div>
            </details>
          </section>}

          <OrderSettlementPanel order={order} />

          <section id="documents" className={panel}>
            <SectionTitle
              icon={<WalletCards size={20} />}
              title="Документы"
              description="Все документы заказа доступны в одном месте"
            />
            <div className="p-4 md:p-5">
              <DocumentsTab orderId={order.id} />
            </div>
          </section>

          <section id="history" className={panel}>
            <SectionTitle
              icon={<History size={20} />}
              title="История заказа"
              description="Хронология статусов, действий и комментариев"
            />
            <div className="p-4 md:p-5">
              {order.statusHistory.length + order.events.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-slate-400">
                  История появится после первого изменения заказа.
                </p>
              ) : (
                <ol className="relative ml-2 space-y-5 border-l border-slate-700 pl-6">
                  {[
                    ...order.statusHistory.map((item) => ({
                      id: `status-${item.id}`,
                      createdAt: item.createdAt,
                      author: item.changedByName,
                      title: `${item.fromStatus ?? "Создание"} → ${item.toStatus}`,
                      comment: item.comment,
                    })),
                    ...order.events.map((item) => ({
                      id: `event-${item.id}`,
                      createdAt: item.createdAt,
                      author: item.user ?? "Система",
                      title: item.title,
                      comment: item.description,
                    })),
                  ]
                    .sort(
                      (a, b) =>
                        new Date(b.createdAt).getTime() -
                        new Date(a.createdAt).getTime(),
                    )
                    .map((item) => (
                      <li key={item.id} className="relative">
                        <span className="absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-[#101827] bg-blue-500" />
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="font-semibold text-white">
                            {item.title}
                          </p>
                          <time className="text-xs text-slate-500">
                            {date(item.createdAt, true)}
                          </time>
                        </div>
                        {item.comment && (
                          <p className="mt-1 text-sm text-slate-300">
                            {item.comment}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-slate-500">
                          {item.author}
                        </p>
                      </li>
                    ))}
                </ol>
              )}
            </div>
          </section>

          <section id="files" className={panel}>
            <SectionTitle
              icon={<Files size={20} />}
              title="Файлы"
              description="Фото, видео, PDF, чертежи и другие вложения заказа"
            />
            <div className="p-4 md:p-5">
              <FilesTab orderId={order.id} />
            </div>
          </section>
        </div>

        <aside className="space-y-4 md:space-y-5 xl:sticky xl:top-4">
          <section id="calendar" className={panel}>
            <SectionTitle
              icon={<CalendarDays size={20} />}
              title="Календарь"
              description="Ближайшие даты по заказу"
              action={
                <Link
                  href="/calendar"
                  className="text-sm text-blue-300 hover:text-blue-200"
                >
                  Открыть
                </Link>
              }
            />
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-1 md:p-5">
              <Field
                title="Замер"
                value={date(order.measurements[0]?.visitDate)}
              />
              <Field
                title="Контрольный замер"
                value={
                  order.measurements[1]
                    ? date(order.measurements[1].visitDate)
                    : "Не назначен"
                }
              />
              <Field
                title="Установка"
                value={
                  production?.stage === "Монтаж" || order.status === "Монтаж"
                    ? date(production?.plannedStartAt ?? production?.startDate)
                    : "Не назначена"
                }
              />
              <Field title="Следующее действие" value={nextAction} />
            </div>
          </section>

          <section id="production" className={panel}>
            <SectionTitle
              icon={<Factory size={20} />}
              title="Производство"
              description="Статус, понятный для общения с клиентом"
            />
            <div className="p-4 md:p-5">
              <div className="rounded-xl bg-blue-500/10 p-4">
                <p className={label}>Текущий клиентский статус</p>
                <p className="mt-2 text-lg font-bold text-blue-300">
                  {order.status}
                </p>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                Внутренние технические этапы производства здесь не показываются.
              </p>
            </div>
          </section>

          <section id="workshop" className={panel}>
            <SectionTitle
              icon={<Factory size={20} />}
              title="Цех"
              description="Исполнитель и плановая готовность"
            />
            <div className="grid gap-3 p-4 md:p-5">
              {order.partner ? (
                <>
                  <Field title="Название" value={order.partner.name} />
                  <Field
                    title="Ответственный"
                    value={
                      production?.master || order.partner.phone || "Не назначен"
                    }
                  />
                  <Field
                    title="Текущий этап"
                    value={production?.stage || "Не начат"}
                  />
                  <Field
                    title="Плановая дата"
                    value={date(
                      order.partnerPlannedReadyAt ??
                        production?.plannedEndAt ??
                        production?.finishDate,
                    )}
                  />
                  <Field
                    title="Комментарий"
                    value={
                      order.partnerComment ||
                      production?.comment ||
                      "Комментария нет"
                    }
                  />
                </>
              ) : (
                <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-slate-400">
                  Цех пока не назначен.
                </p>
              )}
            </div>
          </section>

          <section className={`${panel} hidden xl:block`}>
            <SectionTitle
              icon={<MapPin size={20} />}
              title="Навигация"
              description="Быстрый переход к блоку"
            />
            <nav className="grid grid-cols-2 gap-2 p-4 text-sm md:p-5">
              {[
                ["Клиент", "client"],
                ["Технические параметры", "technical"],
                ...(canSeeClientFinance ? [["Финансы заказа", "order-finance"]] : []),
                ["Расчёт", "calculation"],
                ["Документы", "documents"],
                ["История", "history"],
                ["Календарь", "calendar"],
                ["Производство", "production"],
                ["Цех", "workshop"],
                ["Файлы", "files"],
              ].map(([title, id]) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-slate-300 hover:bg-slate-800 hover:text-white"
                >
                  {title}
                </a>
              ))}
            </nav>
          </section>
        </aside>
      </div>

      {(editing || commentOpen) && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="order-dialog-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) {
              setEditing(false);
              setCommentOpen(false);
            }
          }}
        >
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-slate-700 bg-[#101827] p-5 sm:max-w-2xl sm:rounded-2xl sm:p-6">
            <h2
              id="order-dialog-title"
              className="text-xl font-bold text-white"
            >
              {editing ? "Редактировать заказ" : "Добавить комментарий"}
            </h2>
            {editing ? (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {[
                  ["address", "Адрес"],
                  ["material", "Материал"],
                  ["staircase", "Тип лестницы"],
                  ["manager", "Менеджер"],
                ].map(([key, title]) => (
                  <label key={key} className="text-sm text-slate-300">
                    {title}
                    <input
                      value={form[key as keyof typeof form]}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                      className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white"
                    />
                  </label>
                ))}
                <label className="text-sm text-slate-300">
                  Стоимость клиенту
                  <input
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        amount: event.target.value,
                      }))
                    }
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white"
                  />
                </label>
              </div>
            ) : (
              <label className="mt-5 block text-sm text-slate-300">
                Комментарий
                <textarea
                  autoFocus
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Например: клиент подтвердил цвет, перезвонить завтра"
                  className="mt-1 min-h-32 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white"
                />
              </label>
            )}
            {error && (
              <p role="alert" className="mt-4 text-sm text-red-300">
                {error}
              </p>
            )}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                disabled={saving}
                type="button"
                onClick={() => {
                  setEditing(false);
                  setCommentOpen(false);
                  setError("");
                }}
                className="min-h-11 rounded-xl bg-slate-700 px-5 font-semibold text-white disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                disabled={saving || (commentOpen && !comment.trim())}
                type="button"
                onClick={() => {
                  const editPayload: Record<string, unknown> = {
                    address: form.address,
                    material: form.material,
                    staircase: form.staircase,
                    manager: form.manager,
                    amount: Number(form.amount),
                  };
                  void patch(
                    editing ? editPayload : { comment },
                    editing ? "Заказ обновлён" : "Комментарий добавлен",
                  );
                }}
                className="min-h-11 rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
