"use client";

import {
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  FileText,
  Files,
  History,
  MapPin,
  Pencil,
  Phone,
  UserRound,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { type ReactNode, useState } from "react";

import ProjectPayments from "@/components/project/ProjectPayments";
import PaymentFollowUpPanel from "@/components/orders/PaymentFollowUpPanel";
import OrderBrassProcurementPanel from "@/components/orders/OrderBrassProcurementPanel";
import OrderWarehousePanel from "@/components/orders/OrderWarehousePanel";
import { orderBoardLabel } from "@/lib/orders/board";
import { orderDeadline } from "@/lib/orders/presentation";
import { PAYMENT_METHODS, paymentMethodLabel } from "@/lib/orders/registration";

import OrderActionsMenu from "./OrderActionsMenu";
import OrderEconomy from "./OrderEconomy";
import OrderProcess from "./OrderProcess";
import WorkshopSettlementPanel from "./WorkshopSettlementPanel";
import DocumentsTab from "./tabs/DocumentsTab";
import FilesTab from "./tabs/FilesTab";
import type { NumericValue, OrderTabData } from "./tabs/types";

type WorkspaceOrder = OrderTabData & {
  contractConfirmedAt?: Date | string | null;
  productionDeadline?: Date | string | null;
  workshopConfirmedAt?: Date | string | null;
  partnerPlannedReadyAt?: Date | string | null;
  partnerComment?: string;
  deletedAt?: Date | string | null;
  deletedBy?: { id: number; name: string } | null;
  deletionImpact?: { hasFinancialHistory: boolean };
  installation?: { scheduledAt?: Date | string | null } | null;
};

const panel = "rounded-2xl border border-slate-800 bg-[#101827] shadow-sm";
const fieldLabel = "text-xs font-medium uppercase tracking-wide text-slate-500";

function money(value: NumericValue | null | undefined) {
  return value === null || value === undefined
    ? "Недостаточно данных"
    : `${Number(value).toLocaleString("ru-RU")} ₸`;
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

function dateInput(value: Date | string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function todayForInput() {
  return new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function Field({ title, value }: { title: string; value?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-950/55 p-3">
      <p className={fieldLabel}>{title}</p>
      <div className="mt-1 break-words text-sm font-medium text-slate-100">
        {value || "—"}
      </div>
    </div>
  );
}

function Collapsible({
  id,
  icon,
  title,
  description,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode | (() => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  return (
    <section id={id} className={`${panel} scroll-mt-24 overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-16 w-full items-center gap-3 p-4 text-left md:px-5"
      >
        <span className="rounded-xl bg-blue-500/10 p-2 text-blue-300">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-white">{title}</span>
          <span className="block text-sm text-slate-400">{description}</span>
        </span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="border-t border-slate-800 p-4 md:p-5">
          {typeof children === "function" ? children() : children}
        </div>
      ) : null}
    </section>
  );
}

export default function OrderWorkspace({ order }: { order: WorkspaceOrder }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [editing, setEditing] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({
    clientName: order.client.name,
    address: order.address,
    material: order.material,
    staircase: order.staircase,
    manager: order.manager,
    orderReceivedAt: dateInput(order.orderReceivedAt),
    promisedAt: order.promisedAt ? dateInput(order.promisedAt) : "",
    amount: String(order.amount ?? ""),
    paymentMethod: order.paymentMethod || "KASPI_TRANSFER",
  });

  const role = session?.user.accountRole || session?.user.role || "";
  const archived = Boolean(order.deletedAt);
  const director = role === "DIRECTOR";
  const operationalManagement = ["DIRECTOR", "OPERATIONS_DIRECTOR"].includes(role);
  const canEdit = !archived && ["DIRECTOR", "OPERATIONS_DIRECTOR", "MANAGER"].includes(role);
  const canAddPayment =
    !archived && ["DIRECTOR", "OPERATIONS_DIRECTOR", "MANAGER", "ACCOUNTANT"].includes(role);
  const canSeeFinance = ["DIRECTOR", "OPERATIONS_DIRECTOR", "MANAGER", "ACCOUNTANT"].includes(role);
  const canManageWarehouse = ["DIRECTOR", "OPERATIONS_DIRECTOR", "MANAGER"].includes(role);
  const internalEmployee = Boolean(role && role !== "PARTNER");
  const deadline = orderDeadline({
    promisedAt: order.promisedAt,
    productionDeadline: order.productionDeadline,
    installation: order.installation ?? null,
  });
  const production = order.productions[0];
  const totalCost = order.economy?.profit.dataComplete
    ? Number(order.economy.profit.directExpenses) +
      Number(order.economy.profit.payrollAccrued)
    : null;

  async function saveEdit() {
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
        body: JSON.stringify({
          ...form,
          amount: Number(form.amount),
          expectedVersion: order.version,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? "Не удалось сохранить изменения");
      setEditing(false);
      setNotice("Изменения сохранены");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось сохранить изменения",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-4 p-3 pb-24 sm:p-5 lg:p-8">
      <header className="rounded-3xl border border-slate-800 bg-gradient-to-br from-[#111c2e] to-[#0c1320] p-4 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
              <Link href="/orders" className="hover:text-white">Заказы</Link>
              <span>/</span>
              <span>{order.number}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <h1 className="break-words text-2xl font-bold text-white sm:text-3xl">
                Заказ {order.number}
              </h1>
              <span className="rounded-full bg-blue-500/15 px-3 py-1 text-sm font-semibold text-blue-200">
                {orderBoardLabel(order.lifecycle)}
              </span>
            </div>
            <div className="mt-4 grid gap-x-6 gap-y-2 text-sm text-slate-300 sm:grid-cols-2 xl:grid-cols-3">
              <span className="flex min-w-0 items-center gap-2"><UserRound size={16} /> {order.client.name || "Клиент не указан"}</span>
              <a className="flex items-center gap-2 text-blue-200 hover:text-blue-100" href={`tel:${order.client.phone}`}><Phone size={16} /> {order.client.phone}</a>
              <span className="flex min-w-0 items-center gap-2"><MapPin size={16} /> {order.address || order.client.address}</span>
              <span>Срок: <strong className="text-white">{date(deadline)}</strong></span>
              <span>Дата заказа: <strong className={order.orderDateNeedsReview ? "text-amber-200" : "text-white"}>{order.orderDateNeedsReview ? "Нужно подтвердить" : date(order.orderReceivedAt)}</strong></span>
              <span>Ответственный: <strong className="text-white">{order.manager}</strong></span>
            </div>
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            <OrderProcess
              key={`${order.id}:${order.lifecycle}:${order.partner?.id ?? "none"}:${order.productionPrice ?? "none"}`}
              orderId={order.id}
              lifecycle={order.lifecycle}
              version={order.version}
              partnerId={order.partner?.id ?? null}
              productionPrice={order.productionPrice}
              readOnly={archived}
            />
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
              {!archived ? (
                <Link
                  href={`/orders/${order.id}/offer`}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  <FileText size={17} /> КП
                </Link>
              ) : null}
              {!archived && Number(order.balance) > 0 ? (
                <Link
                  href={`/orders/${order.id}/invoice`}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-700/60 bg-amber-500/10 px-4 text-sm font-semibold text-amber-100 hover:bg-amber-500/20"
                >
                  <WalletCards size={17} /> Счёт на остаток
                </Link>
              ) : null}
              {canAddPayment ? (
                <button type="button" onClick={() => setPaymentOpen((value) => !value)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-600">
                  <CircleDollarSign size={17} /> Принять оплату
                </button>
              ) : null}
              {canEdit ? (
                <button type="button" onClick={() => setEditing(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800">
                  <Pencil size={17} /> Редактировать
                </button>
              ) : null}
              <a href="#details" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800">
                <ClipboardList size={17} /> Подробнее
              </a>
              <OrderActionsMenu
                order={{ id: order.id, number: order.number, deletedAt: order.deletedAt, hasFinancialHistory: order.deletionImpact?.hasFinancialHistory }}
                canDelete={operationalManagement && !archived}
                canRestore={operationalManagement && archived}
                onChanged={() => { router.push("/orders"); router.refresh(); }}
              />
            </div>
          </div>
        </div>
        {archived ? (
          <p className="mt-5 rounded-xl border border-amber-700/50 bg-amber-500/10 p-3 text-sm text-amber-100">
            Заказ в архиве. История, файлы и финансовые операции сохранены.
          </p>
        ) : null}
        {order.orderDateNeedsReview ? (
          <p className="mt-5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm leading-6 text-amber-100">
            Укажите фактическую дату оформления заказа по договору. Пока дата не подтверждена, заказ не входит в продажи месяца и расчёт бонуса менеджера. Не ставьте дату внесения карточки в ORDA.
          </p>
        ) : null}
        {notice || error ? (
          <p role={error ? "alert" : "status"} className={`mt-4 rounded-xl border p-3 text-sm ${error ? "border-red-800 bg-red-950/40 text-red-300" : "border-emerald-800 bg-emerald-950/40 text-emerald-300"}`}>
            {error || notice}
          </p>
        ) : null}
      </header>

      {paymentOpen && !archived ? <ProjectPayments orderId={order.id} /> : null}

      {internalEmployee ? (
        <OrderBrassProcurementPanel
          orderId={order.id}
          readOnly={archived}
          canSeeCost
        />
      ) : null}

      {canSeeFinance ? (
        <section className={panel}>
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-7 md:p-5">
            <Field title="Сумма продажи" value={money(order.amount)} />
            <Field title="Получено от клиента" value={money(order.prepayment)} />
            <Field title="Остаток клиента" value={money(order.balance)} />
            {["DIRECTOR", "OPERATIONS_DIRECTOR", "MANAGER"].includes(role) ? <Field title="Цена производства" value={money(order.productionPrice)} /> : null}
            {director ? <Field title="Себестоимость" value={money(totalCost)} /> : null}
            {director ? <Field title="Чистая прибыль" value={money(order.economy?.profit.netProfit)} /> : null}
            {director ? <Field title="Маржа" value={order.economy?.profit.netMarginPercent == null ? "Недостаточно данных" : `${Number(order.economy.profit.netMarginPercent).toLocaleString("ru-RU")} %`} /> : null}
          </div>
        </section>
      ) : null}

      {canManageWarehouse && order.items?.length ? (
        <OrderWarehousePanel
          orderId={order.id}
          clientName={order.client.name}
          items={order.items}
          shipments={order.warehouseShipments ?? []}
          readOnly={archived}
          canReturn={operationalManagement}
        />
      ) : null}

      {["DIRECTOR", "OPERATIONS_DIRECTOR", "MANAGER"].includes(role) ? <PaymentFollowUpPanel orderId={order.id} balance={Number(order.balance)} clientName={order.client.name} clientPhone={order.client.phone} readOnly={archived} canCancelOverdue={operationalManagement} /> : null}

      {director ? <OrderEconomy order={order} /> : null}

      {["DIRECTOR", "OPERATIONS_DIRECTOR", "MANAGER", "ACCOUNTANT"].includes(role) ? (
        <WorkshopSettlementPanel
          key={`${order.id}:${order.partner?.id ?? "none"}:${order.productionPrice ?? "none"}`}
          order={order}
          readOnly={archived}
        />
      ) : null}

      <section className={panel}>
        <div className="border-b border-slate-800 p-4 md:p-5">
          <h2 className="text-lg font-semibold text-white">Исполнение</h2>
          <p className="mt-1 text-sm text-slate-400">Исполнитель, передача и текущий срок в одном блоке.</p>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6 md:p-5">
          <Field title="Договор" value={order.contractConfirmedAt ? `Подтверждён ${date(order.contractConfirmedAt)}` : "Не подтверждён"} />
          <Field title="Исполнитель" value={order.partner?.name ?? production?.master ?? "Не назначен"} />
          <Field title="Передано в цех" value={date(order.workshopConfirmedAt)} />
          <Field title="Срок готовности" value={date(order.partnerPlannedReadyAt ?? order.productionDeadline ?? production?.plannedEndAt)} />
          <Field title="Текущий статус" value={orderBoardLabel(order.lifecycle)} />
          <Field title="Комментарий" value={order.partnerComment || production?.comment || "Комментария нет"} />
        </div>
      </section>

      <div id="details" className="grid scroll-mt-24 gap-4 xl:grid-cols-2">
        <Collapsible id="technical" icon={<ClipboardList size={19} />} title="Технические параметры" description="Комплектация и дополнительные параметры">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field title="Каркас" value={order.staircase} />
            <Field title="Материал" value={order.material} />
            <Field title="Ограждение" value={order.railingType} />
            <Field title="Стойка / опора" value={order.supportType} />
            <Field title="Цвет" value={order.color} />
            <Field title="Подсветка" value={order.lighting ? order.lightingDetails || "Да" : "Нет"} />
            <Field title="Обшивка" value={order.cladding ? order.claddingDetails || "Да" : "Нет"} />
            <Field title="Комментарий" value={order.additionalDetails || order.frameComment} />
            <Field title="Способ оплаты" value={paymentMethodLabel(order.paymentMethod) || "Не указан"} />
          </div>
        </Collapsible>

        <Collapsible id="documents" icon={<WalletCards size={19} />} title="Документы" description="Договоры, акты и версии документов">
          {() => <DocumentsTab orderId={order.id} readOnly={archived} />}
        </Collapsible>

        <Collapsible id="files" icon={<Files size={19} />} title="Файлы и 3D-проект" description="Фото клиента, каркаса, референсы и быстрый промпт">
          {() => <FilesTab orderId={order.id} readOnly={archived} brief={{ number: order.number, address: order.address, staircase: order.staircase, material: order.material, railingType: order.railingType, color: order.color, lighting: order.lighting, lightingDetails: order.lightingDetails, cladding: order.cladding, claddingDetails: order.claddingDetails, designStyle: order.designStyle, designNotes: order.designNotes }} />}
        </Collapsible>

        <Collapsible id="history" icon={<History size={19} />} title="История" description="Статусы, действия и комментарии">
          {order.statusHistory.length + order.events.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-700 p-5 text-center text-slate-400">История появится после первого изменения заказа.</p>
          ) : (
            <ol className="space-y-3">
              {[
                ...order.statusHistory.map((item) => ({ id: `status-${item.id}`, createdAt: item.createdAt, author: item.changedByName, title: `${item.fromStatus ?? "Создание"} → ${item.toStatus}`, comment: item.comment })),
                ...order.events.map((item) => ({ id: `event-${item.id}`, createdAt: item.createdAt, author: item.user ?? "Система", title: item.title, comment: item.description })),
              ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((item) => (
                <li key={item.id} className="rounded-xl bg-slate-950/55 p-3">
                  <div className="flex flex-wrap justify-between gap-2"><strong className="text-white">{item.title}</strong><time className="text-xs text-slate-500">{date(item.createdAt, true)}</time></div>
                  {item.comment ? <p className="mt-1 text-sm text-slate-300">{item.comment}</p> : null}
                  <p className="mt-1 text-xs text-slate-500">{item.author}</p>
                </li>
              ))}
            </ol>
          )}
        </Collapsible>
      </div>

      {editing ? (
        <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/75 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl">
            <h2 className="text-xl font-bold text-white">Редактировать заказ</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-300">Фактическая дата заказа<input required type="date" max={todayForInput()} value={form.orderReceivedAt} onChange={(event) => setForm((value) => ({ ...value, orderReceivedAt: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white"/><span className="mt-1 block text-xs leading-5 text-slate-500">Дата договора или фактического оформления, а не дата ввода в ORDA.</span></label>
              <label className="text-sm text-slate-300">Срок заказа (обещанный клиенту)<input required type="date" min={form.orderReceivedAt || undefined} value={form.promisedAt} onChange={(event) => setForm((value) => ({ ...value, promisedAt: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white"/><span className="mt-1 block text-xs leading-5 text-slate-500">Дата, к которой заказ обещан клиенту. После сохранения предупреждение «Срок заказа» исчезнет.</span></label>
              {([
                ["clientName", "Имя клиента"],
                ["address", "Адрес"],
                ["manager", "Ответственный"],
                ["staircase", "Каркас"],
                ["material", "Материал"],
                ["amount", "Сумма продажи"],
              ] as const).map(([key, title]) => (
                <label key={key} className="text-sm text-slate-300">{title}<input type={key === "amount" ? "number" : "text"} value={form[key]} onChange={(event) => setForm((value) => ({ ...value, [key]: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white" /></label>
              ))}
              <label className="text-sm text-slate-300">Способ оплаты<select value={form.paymentMethod} onChange={(event) => setForm((value) => ({ ...value, paymentMethod: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white">{PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>
            </div>
            {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : null}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setEditing(false)} disabled={saving} className="min-h-11 rounded-xl bg-slate-800 px-4">Отмена</button>
              <button type="button" onClick={() => void saveEdit()} disabled={saving || !form.orderReceivedAt || !form.promisedAt || !form.clientName.trim() || !form.address.trim() || !Number(form.amount)} className="min-h-11 rounded-xl bg-blue-600 px-4 font-semibold disabled:opacity-50">{saving ? "Сохранение…" : order.orderDateNeedsReview ? "Подтвердить дату и сохранить" : "Сохранить"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
