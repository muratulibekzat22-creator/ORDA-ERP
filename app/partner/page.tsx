"use client";

import { signOut } from "next-auth/react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { ORDER_STATUSES } from "@/lib/orders/lifecycle";
import { prepareOfflineLogout } from "@/lib/offline-outbox";

type Language = "uz" | "ru";
type Measurement = {
  id: number;
  status: string;
  completedAt: string | null;
  visitDate: string;
  stepsCount: number | null;
  measurer: string;
  isPartnerControl: boolean;
  sheetHref: string;
};
type PayoutAcknowledgement = {
  id: number;
  amount: number;
  operationDate: string;
  method: string | null;
  comment: string | null;
  status: string;
  createdAt: string;
};
type PartnerOrder = {
  id: number;
  number: string;
  status: string;
  lifecycle: string;
  client: { id: number; name: string; phone: string; city: string };
  address: string;
  staircase: string;
  material: string;
  mapUrl: string;
  orderReceivedAt: string;
  promisedAt: string | null;
  productionDeadline: string | null;
  frameComment: string;
  railingType: string;
  supportType: string;
  color: string;
  lighting: boolean;
  lightingDetails: string;
  cladding: boolean;
  claddingDetails: string;
  additionalDetails: string;
  designStyle: string;
  designNotes: string;
  partnerPrice: number;
  partnerAgreedAt: string | null;
  partnerPaid: number;
  partnerBalance: number;
  partnerPlannedReadyAt: string | null;
  partnerComment: string;
  readyForInstallation: boolean;
  installationCompleted: boolean;
  measurements: Measurement[];
  payoutAcknowledgements: PayoutAcknowledgement[];
};
type Dashboard = {
  partner: { id: number; name: string; phone: string };
  activeOrders: number;
  completedOrders: number;
  totals: { price: number; paid: number; balance: number };
  statuses: Record<string, number>;
  orders: PartnerOrder[];
  recentPayments: Array<{
    id: number;
    amount: number;
    method: string;
    comment: string | null;
    operationDate: string;
    order: { number: string };
  }>;
};
type ControlMeasurementPayload = {
  orderId: number;
  visitDate: string;
  floorHeight: number;
  staircaseWidth: number;
  stepsCount: number;
  sameSize: boolean;
  stepLength?: number;
  stepWidth?: number;
  stepHeight?: number;
  individualSteps?: Array<{ length?: number; width?: number; height?: number }>;
  riserHeight?: number;
  winderCount: number;
  platformsCount: number;
  platforms: Array<{ length?: number; width?: number }>;
  railingLength: number;
  railingComment?: string;
  objectNotes?: string;
  comment?: string;
};

const texts = {
  uz: {
    appTag: "ORDA · hamkor ishlab chiqarishi",
    title: "Hamkor kabineti",
    subtitle: "Sizga berilgan buyurtmalar, hujjatlar va kompaniya bilan hisob-kitoblar.",
    logout: "Chiqish",
    loadError: "Kabinetni yuklab bo‘lmadi",
    updateError: "Buyurtmani yangilab bo‘lmadi",
    connectionError: "Tizim bilan aloqa bo‘lmadi. Qayta urinib ko‘ring.",
    working: "Ish jarayonida",
    agreedTotal: "Kelishilgan",
    paidTotal: "To‘langan",
    remainingTotal: "Olish qolgan",
    completedTotal: "Yakunlangan",
    ordersTitle: "Sizning sexingizga berilgan buyurtmalar",
    ordersSubtitle: "Pastdagi har bir karta kompaniya tomonidan sizning sexingizga berilgan alohida buyurtma.",
    ordersGuide: "Nazorat o‘lchovi qilish uchun kerakli buyurtma kartasi ichidagi tugmani bosing. O‘lchov avtomatik shu buyurtmaga biriktiriladi.",
    transferredOrder: "Sizga berilgan buyurtma",
    active: "Ishda",
    completed: "Yakunlangan",
    all: "Barchasi",
    search: "Buyurtma raqami, mijoz, telefon, manzil yoki material",
    noOrders: "Mos buyurtmalar topilmadi.",
    recentPayments: "Kompaniyadan oxirgi to‘lovlar",
    noPayments: "Hozircha to‘lov yo‘q.",
    payoutTooHigh: "Summa tekshiruvdagi arizalarni hisobga olgan holda qoldiqdan katta.",
    priceNotAgreed: "Bu buyurtma bo‘yicha hamkorlik summasi hali kompaniya tomonidan tasdiqlanmagan.",
    payoutError: "To‘lov ma’lumotini yuborib bo‘lmadi",
    payoutNotice: "To‘lov direktor tasdig‘iga yuborildi. Tasdiqlangandan keyin to‘langan summa va qoldiq yangilanadi.",
    measurementError: "Nazorat o‘lchovini saqlab bo‘lmadi. Kiritilgan ma’lumotlarni tekshiring.",
    measurementNotice: "Nazorat o‘lchovi saqlandi. O‘lchov varaqasi buyurtmada, direktor va ta’sischi kabinetida ko‘rinadi.",
    staircase: "Zina",
    material: "Material",
    color: "Rang",
    productionDeadline: "Ishlab chiqarish muddati",
    railing: "Perila",
    support: "Tayanch",
    lighting: "Yoritish",
    cladding: "Qoplama",
    yes: "Ha",
    no: "Yo‘q",
    settlement: "Kompaniya bilan hisob-kitob",
    agreed: "Kelishilgan",
    paid: "To‘langan",
    remaining: "Qoldiq",
    review: "Tekshiruvda",
    showPayout: "Olingan to‘lovni kiritish",
    hideForm: "Formani yopish",
    available: "Tasdiqlash uchun mavjud",
    afterDirector: "Summa direktor tasdig‘idan keyin hisobga olinadi.",
    received: "Olingan summa, ₸",
    receivedDate: "Olingan sana",
    method: "To‘lov usuli",
    comment: "Izoh",
    cash: "Naqd pul",
    bank: "Bank o‘tkazmasi",
    other: "Boshqa",
    sendDirector: "Direktorga tasdiqlash uchun yuborish",
    history: "Tasdiqlash tarixi",
    methodMissing: "Ko‘rsatilmagan",
    approved: "Tasdiqlangan",
    rejected: "Rad etilgan",
    cancelled: "Bekor qilingan",
    pending: "Tekshiruvda",
    sheets: "Shu buyurtmaning o‘lchovlari va hujjatlari",
    sheet: "O‘lchov",
    controlSheet: "Nazorat o‘lchovi",
    stepsShort: "pog‘ona",
    noSheet: "Bu buyurtmaga yakunlangan o‘lchov hali biriktirilmagan.",
    measurementScope: "Yangi nazorat o‘lchovi faqat {number} buyurtmasiga saqlanadi. Bu yerda yangi buyurtma yoki alohida ariza yaratilmaydi.",
    newControl: "Shu buyurtmaga o‘lchov qo‘shish",
    hideControl: "O‘lchov formasini yopish",
    controlTitle: "{number} buyurtmasi bo‘yicha nazorat o‘lchovi",
    controlHint: "Siz aynan shu buyurtmaning haqiqiy o‘lchamlarini qayta tekshiryapsiz. Saqlangandan keyin tizim shu buyurtma uchun PDF o‘lchov varaqasini yaratadi.",
    visitDate: "O‘lchov sanasi",
    floorHeight: "Qavat balandligi, mm",
    staircaseWidth: "Zina kengligi, mm",
    stepsCount: "Pog‘onalar soni",
    sameSize: "Barcha to‘g‘ri pog‘onalar bir xil o‘lchamda",
    stepLength: "Pog‘ona uzunligi, mm",
    stepWidth: "Pog‘ona eni, mm",
    stepHeight: "Pog‘ona qalinligi, mm",
    individualSteps: "Har bir pog‘ona o‘lchami",
    individualHint: "Har qatorda: uzunlik x eni x qalinlik. Qatorlar soni pog‘onalar soniga teng bo‘lsin.",
    riserHeight: "Podstupenok balandligi, mm",
    winderCount: "Zabejniy pog‘onalar soni",
    platformsCount: "Maydonchalar soni",
    platforms: "Maydoncha o‘lchamlari",
    platformsHint: "Har qatorda: uzunlik x eni. Qatorlar soni maydonchalar soniga teng bo‘lsin.",
    railingLength: "Perila uzunligi, metr",
    railingComment: "Perila bo‘yicha izoh",
    objectNotes: "Obyekt va montaj bo‘yicha muhim ma’lumotlar",
    measurementComment: "O‘lchovchi izohi",
    createSheet: "Saqlash va o‘lchov varaqasini yaratish",
    saving: "Saqlanmoqda…",
    stage: "Bosqich",
    plannedReady: "Rejadagi tayyor sana",
    partnerComment: "Hamkor izohi",
    save: "Saqlash",
    readyInstall: "O‘rnatishga tayyor",
    installed: "O‘rnatish yakunlandi",
    map: "Xaritani ochish",
    unknownDate: "Ko‘rsatilmagan",
    russian: "Русский",
    uzbek: "O‘zbekcha",
  },
  ru: {
    appTag: "ORDA · производство партнёра",
    title: "Кабинет подрядчика",
    subtitle: "Заказы, переданные вашей команде, документы и расчёты с компанией.",
    logout: "Выйти",
    loadError: "Не удалось загрузить кабинет",
    updateError: "Не удалось обновить заказ",
    connectionError: "Не удалось связаться с системой. Повторите попытку.",
    working: "В работе",
    agreedTotal: "Согласовано с нами",
    paidTotal: "Выплачено",
    remainingTotal: "Осталось получить",
    completedTotal: "Завершено",
    ordersTitle: "Заказы, переданные вашему цеху",
    ordersSubtitle: "Каждая карточка ниже — отдельный заказ компании, назначенный вашему цеху.",
    ordersGuide: "Чтобы снять контрольные размеры, используйте кнопку внутри нужного заказа. Замер автоматически привяжется именно к этой карточке.",
    transferredOrder: "Переданный заказ",
    active: "В работе",
    completed: "Завершённые",
    all: "Все",
    search: "Номер, клиент, телефон, адрес или материал",
    noOrders: "Подходящих заказов нет.",
    recentPayments: "Последние выплаты от компании",
    noPayments: "Выплат пока нет.",
    payoutTooHigh: "Сумма больше доступного остатка с учётом заявок на проверке.",
    priceNotAgreed: "Согласованная стоимость по заказу ещё не подтверждена компанией.",
    payoutError: "Не удалось отправить подтверждение",
    payoutNotice: "Выплата отправлена на подтверждение директору. После подтверждения обновятся «Выплачено» и «Осталось».",
    measurementError: "Не удалось сохранить контрольный замер. Проверьте введённые данные.",
    measurementNotice: "Контрольный замер сохранён. Замерный лист доступен в заказе, кабинете директора и основателя.",
    staircase: "Лестница",
    material: "Материал",
    color: "Цвет",
    productionDeadline: "Срок производства",
    railing: "Ограждение",
    support: "Опора",
    lighting: "Подсветка",
    cladding: "Обшивка",
    yes: "Да",
    no: "Нет",
    settlement: "Расчёт между компанией и подрядчиком",
    agreed: "Согласовано",
    paid: "Выплачено",
    remaining: "Осталось",
    review: "На проверке",
    showPayout: "Сообщить о полученной выплате",
    hideForm: "Скрыть форму",
    available: "Доступно для подтверждения",
    afterDirector: "Сумма попадёт в расчёт после проверки директором.",
    received: "Получено, ₸",
    receivedDate: "Дата получения",
    method: "Способ",
    comment: "Комментарий",
    cash: "Наличные",
    bank: "Банковский перевод",
    other: "Другое",
    sendDirector: "Отправить директору на подтверждение",
    history: "История подтверждений",
    methodMissing: "Не указан",
    approved: "Подтверждено",
    rejected: "Отклонено",
    cancelled: "Отменено",
    pending: "На проверке",
    sheets: "Замеры и документы этого заказа",
    sheet: "Замер",
    controlSheet: "Контрольный замер",
    stepsShort: "ступ.",
    noSheet: "Завершённый замер пока не привязан.",
    measurementScope: "Новый контрольный замер будет сохранён только в заказе {number}. Новый заказ или отдельная заявка здесь не создаются.",
    newControl: "Добавить замер к этому заказу",
    hideControl: "Закрыть форму замера",
    controlTitle: "Контрольный замер по заказу {number}",
    controlHint: "Вы повторно проверяете фактические размеры именно по этому заказу. После сохранения система сформирует для него PDF замерного листа.",
    visitDate: "Дата замера",
    floorHeight: "Высота этажа, мм",
    staircaseWidth: "Ширина лестницы, мм",
    stepsCount: "Количество ступеней",
    sameSize: "Все прямые ступени одного размера",
    stepLength: "Длина ступени, мм",
    stepWidth: "Ширина ступени, мм",
    stepHeight: "Толщина ступени, мм",
    individualSteps: "Размеры каждой ступени",
    individualHint: "Одна строка: длина x ширина x толщина. Число строк должно совпадать с количеством ступеней.",
    riserHeight: "Высота подступенка, мм",
    winderCount: "Количество забежных ступеней",
    platformsCount: "Количество площадок",
    platforms: "Размеры площадок",
    platformsHint: "Одна строка: длина x ширина. Число строк должно совпадать с количеством площадок.",
    railingLength: "Длина ограждения, м",
    railingComment: "Комментарий по ограждению",
    objectNotes: "Важные сведения об объекте и монтаже",
    measurementComment: "Комментарий замерщика",
    createSheet: "Сохранить и сформировать замерный лист",
    saving: "Сохранение…",
    stage: "Этап",
    plannedReady: "Плановая готовность",
    partnerComment: "Комментарий подрядчика",
    save: "Сохранить",
    readyInstall: "Готово к установке",
    installed: "Установка завершена",
    map: "Открыть карту",
    unknownDate: "Не указана",
    russian: "Русский",
    uzbek: "O‘zbekcha",
  },
} as const;

const orderStatusesUz: Record<string, string> = {
  Заготовка: "Tayyorlash",
  Покраска: "Bo‘yash",
  "Заказ готов": "Buyurtma tayyor",
  "Ожидает установки": "O‘rnatish kutilmoqda",
  Установка: "O‘rnatish",
  "Заказ завершён": "Buyurtma yakunlangan",
};
const inputClass = "mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none focus:border-blue-500";
const localDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date());
const money = (value: number, language: Language) => `${Number(value).toLocaleString(language === "uz" ? "uz-UZ" : "ru-RU")} ₸`;
const day = (value: string | null | undefined, language: Language) => value
  ? new Date(value).toLocaleDateString(language === "uz" ? "uz-UZ" : "ru-RU")
  : texts[language].unknownDate;
const orderStatus = (value: string, language: Language) => language === "uz" ? orderStatusesUz[value] ?? value : value;
const payoutStatus = (value: string, language: Language) => {
  const t = texts[language];
  return value === "POSTED" ? t.approved : value === "REJECTED" ? t.rejected : value === "REVERSED" ? t.cancelled : t.pending;
};

export default function PartnerPage() {
  const [language, setLanguage] = useState<Language>("uz");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"active" | "completed" | "all">("active");
  const t = texts[language];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem("orda-partner-language");
      if (stored === "ru" || stored === "uz") setLanguage(stored);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const chooseLanguage = (value: Language) => {
    setLanguage(value);
    window.localStorage.setItem("orda-partner-language", value);
  };
  const load = useCallback(async () => {
    setError("");
    const response = await fetch("/api/partner/dashboard", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(texts[language].loadError);
    else setDashboard(body as Dashboard);
  }, [language]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const orders = useMemo(() => (dashboard?.orders ?? []).filter((order) => {
    const completed = order.lifecycle === "COMPLETED" || order.installationCompleted;
    const modeMatch = mode === "all" || (mode === "completed" ? completed : !completed);
    const needle = query.trim().toLocaleLowerCase(language === "uz" ? "uz" : "ru");
    return modeMatch && (!needle || [order.number, order.client.name, order.client.phone, order.address, order.material]
      .some((value) => value.toLocaleLowerCase(language === "uz" ? "uz" : "ru").includes(needle)));
  }), [dashboard, language, mode, query]);

  async function updateOrder(id: number, data: Record<string, unknown>) {
    setError("");
    const response = await fetch(`/api/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(data),
    });
    if (!response.ok) setError(t.updateError);
    else await load();
  }

  async function submitPayoutAcknowledgement(data: { orderId: number; amount: number; operationDate: string; method: string; comment: string }) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/partner/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(data),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(body.error === "PAYOUT_ACKNOWLEDGEMENT_EXCEEDS_BALANCE"
          ? t.payoutTooHigh
          : body.error === "PARTNER_COST_NOT_AGREED" ? t.priceNotAgreed : t.payoutError);
        return false;
      }
      setNotice(t.payoutNotice);
      await load();
      return true;
    } catch {
      setError(t.connectionError);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitControlMeasurement(data: ControlMeasurementPayload) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/partner/measurements", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        setError(t.measurementError);
        return false;
      }
      setNotice(t.measurementNotice);
      await load();
      return true;
    } catch {
      setError(t.connectionError);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return <main lang={language} className="min-h-screen bg-slate-950 p-4 text-white md:p-8">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-sm font-semibold uppercase tracking-wider text-blue-300">{t.appTag}</p><h1 className="mt-1 text-3xl font-bold">{t.title}</h1><p className="mt-1 text-slate-400">{t.subtitle}</p></div>
      <div className="flex flex-wrap gap-2"><div className="flex rounded-xl bg-slate-900 p-1"><button type="button" onClick={() => chooseLanguage("uz")} className={`rounded-lg px-3 py-2 text-sm ${language === "uz" ? "bg-blue-600" : "text-slate-300"}`}>{t.uzbek}</button><button type="button" onClick={() => chooseLanguage("ru")} className={`rounded-lg px-3 py-2 text-sm ${language === "ru" ? "bg-blue-600" : "text-slate-300"}`}>{t.russian}</button></div><button onClick={() => void prepareOfflineLogout().then((ready) => ready && signOut({ callbackUrl: "/login" }))} className="rounded-xl bg-slate-800 px-4 py-3">{t.logout}</button></div>
    </header>
    {error && <p role="alert" className="mt-4 rounded-xl border border-red-800 bg-red-950/40 p-3 text-red-200">{error}</p>}
    {notice && <p role="status" className="mt-4 rounded-xl border border-emerald-800 bg-emerald-950/40 p-3 text-emerald-200">{notice}</p>}
    {dashboard && <>
      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">{[[t.working, dashboard.activeOrders], [t.agreedTotal, money(dashboard.totals.price, language)], [t.paidTotal, money(dashboard.totals.paid, language)], [t.remainingTotal, money(dashboard.totals.balance, language)], [t.completedTotal, dashboard.completedOrders]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-sm text-slate-400">{label}</p><b className="mt-1 block text-lg">{value}</b></div>)}</section>
      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">{t.ordersTitle}</h2><p className="text-sm text-slate-400">{t.ordersSubtitle}</p></div><div className="flex gap-2">{(["active", "completed", "all"] as const).map((value) => <button key={value} onClick={() => setMode(value)} className={`min-h-10 rounded-lg px-3 text-sm ${mode === value ? "bg-blue-600" : "bg-slate-800"}`}>{value === "active" ? t.active : value === "completed" ? t.completed : t.all}</button>)}</div></div>
        <p className="mt-4 rounded-xl border border-blue-900/80 bg-blue-950/30 px-4 py-3 text-sm leading-6 text-blue-100">{t.ordersGuide}</p>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search} className="mt-4 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 outline-none focus:border-blue-500" />
        <div className="mt-4 space-y-4">{orders.map((order) => <PartnerOrderCard key={order.id} order={order} busy={busy} language={language} onUpdate={updateOrder} onPayout={submitPayoutAcknowledgement} onControlMeasurement={submitControlMeasurement} />)}{!orders.length && <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-slate-400">{t.noOrders}</p>}</div>
      </section>
      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-5"><h2 className="text-xl font-semibold">{t.recentPayments}</h2>{dashboard.recentPayments.length ? dashboard.recentPayments.map((payment) => <p key={payment.id} className="mt-3 text-sm text-slate-300"><b className="text-white">{payment.order.number}</b> · {money(payment.amount, language)} · {payment.method} · {day(payment.operationDate, language)}</p>) : <p className="mt-3 text-slate-400">{t.noPayments}</p>}</section>
    </>}
  </main>;
}

function PartnerOrderCard({ order, busy, language, onUpdate, onPayout, onControlMeasurement }: {
  order: PartnerOrder;
  busy: boolean;
  language: Language;
  onUpdate: (id: number, data: Record<string, unknown>) => Promise<void>;
  onPayout: (data: { orderId: number; amount: number; operationDate: string; method: string; comment: string }) => Promise<boolean>;
  onControlMeasurement: (data: ControlMeasurementPayload) => Promise<boolean>;
}) {
  const t = texts[language];
  const [status, setStatus] = useState(order.status);
  const [dateValue, setDateValue] = useState(order.partnerPlannedReadyAt?.slice(0, 10) ?? "");
  const [comment, setComment] = useState(order.partnerComment ?? "");
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutDate, setPayoutDate] = useState(localDate());
  const [payoutMethod, setPayoutMethod] = useState("Kaspi");
  const [payoutComment, setPayoutComment] = useState("");
  const [controlOpen, setControlOpen] = useState(false);
  const statuses = ORDER_STATUSES.filter((value) => ["Заготовка", "Покраска", "Заказ готов", "Ожидает установки", "Установка", "Заказ завершён"].includes(value));
  const pendingAmount = order.payoutAcknowledgements.filter((item) => item.status === "PENDING").reduce((sum, item) => sum + item.amount, 0);
  const available = Math.max(order.partnerBalance - pendingAmount, 0);
  const submitPayout = async (event: FormEvent) => {
    event.preventDefault();
    if (await onPayout({ orderId: order.id, amount: Number(payoutAmount), operationDate: payoutDate, method: payoutMethod, comment: payoutComment })) {
      setPayoutAmount(""); setPayoutComment(""); setPayoutOpen(false);
    }
  };

  return <article className="rounded-2xl border border-slate-700 border-l-4 border-l-blue-500 bg-slate-950/70 p-4 shadow-lg shadow-black/10">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="mb-1 text-xs font-bold uppercase tracking-wider text-blue-300">{t.transferredOrder}</p><h3 className="text-lg font-bold">{order.number}</h3><p className="text-sm text-slate-400">{order.client.name} · <a href={`tel:${order.client.phone}`} className="text-blue-300">{order.client.phone}</a></p><p className="mt-1 text-sm text-slate-400">{order.client.city} · {order.address}</p></div><span className="rounded-full bg-blue-950 px-3 py-1 text-sm text-blue-200">{orderStatus(order.status, language)}</span></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Info label={t.staircase} value={order.staircase}/><Info label={t.material} value={order.material}/><Info label={t.color} value={order.color}/><Info label={t.productionDeadline} value={day(order.productionDeadline, language)}/><Info label={t.railing} value={order.railingType}/><Info label={t.support} value={order.supportType}/><Info label={t.lighting} value={order.lighting ? order.lightingDetails || t.yes : t.no}/><Info label={t.cladding} value={order.cladding ? order.claddingDetails || t.yes : t.no}/></div>
    {[order.frameComment, order.additionalDetails, order.designStyle, order.designNotes].some(Boolean) && <div className="mt-3 rounded-lg bg-slate-900 p-3 text-sm text-slate-300">{[order.frameComment, order.additionalDetails, order.designStyle, order.designNotes].filter(Boolean).join(" · ")}</div>}
    <div className="mt-4 rounded-xl border border-emerald-900 bg-emerald-950/20 p-3"><h4 className="font-semibold text-white">{t.settlement}</h4><div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4"><Info label={t.agreed} value={money(order.partnerPrice, language)}/><Info label={t.paid} value={money(order.partnerPaid, language)}/><Info label={t.remaining} value={money(order.partnerBalance, language)}/><Info label={t.review} value={money(pendingAmount, language)}/></div>
      {order.partnerAgreedAt && order.partnerBalance > 0 ? <div className="mt-3"><button type="button" disabled={busy || available <= 0} onClick={() => setPayoutOpen((value) => !value)} className="min-h-10 rounded-lg border border-emerald-700 bg-emerald-950 px-3 text-sm text-emerald-100 disabled:opacity-50">{payoutOpen ? t.hideForm : t.showPayout}</button><p className="mt-2 text-xs text-slate-400">{t.available}: {money(available, language)}. {t.afterDirector}</p></div> : null}
      {payoutOpen ? <form onSubmit={submitPayout} className="mt-3 grid gap-3 rounded-xl border border-slate-700 bg-slate-950/70 p-3 sm:grid-cols-2 lg:grid-cols-4"><Field label={t.received}><input required min="1" max={available} step="0.01" type="number" value={payoutAmount} onChange={(event) => setPayoutAmount(event.target.value)} className={inputClass}/></Field><Field label={t.receivedDate}><input required type="date" value={payoutDate} onChange={(event) => setPayoutDate(event.target.value)} className={inputClass}/></Field><Field label={t.method}><select value={payoutMethod} onChange={(event) => setPayoutMethod(event.target.value)} className={inputClass}><option value="Kaspi">Kaspi</option><option value="Наличные">{t.cash}</option><option value="Банковский перевод">{t.bank}</option><option value="Другое">{t.other}</option></select></Field><Field label={t.comment}><input value={payoutComment} onChange={(event) => setPayoutComment(event.target.value)} className={inputClass}/></Field><button disabled={busy || Number(payoutAmount) <= 0 || Number(payoutAmount) > available} className="min-h-11 rounded-lg bg-emerald-700 px-4 font-semibold disabled:opacity-50 sm:col-span-2 lg:col-span-4">{t.sendDirector}</button></form> : null}
      {order.payoutAcknowledgements.length ? <div className="mt-3 space-y-2"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t.history}</p>{order.payoutAcknowledgements.slice(0, 5).map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-950/70 px-3 py-2 text-sm"><span>{money(item.amount, language)} · {day(item.operationDate, language)} · {item.method || t.methodMissing}</span><span className={item.status === "POSTED" ? "text-emerald-300" : item.status === "PENDING" ? "text-amber-300" : "text-red-300"}>{payoutStatus(item.status, language)}</span>{item.comment ? <span className="w-full text-xs text-slate-500">{item.comment}</span> : null}</div>)}</div> : null}
    </div>
    <div className="mt-4 rounded-xl border border-blue-800 bg-blue-950/20 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-semibold text-blue-100">{t.sheets}</h4><p className="mt-1 max-w-3xl text-sm leading-5 text-slate-400">{t.measurementScope.replace("{number}", order.number)}</p></div><button type="button" disabled={busy} onClick={() => setControlOpen((value) => !value)} className="min-h-10 rounded-lg bg-blue-700 px-3 text-sm font-semibold disabled:opacity-50">{controlOpen ? t.hideControl : t.newControl}</button></div>{order.measurements.length ? <div className="mt-3 flex flex-wrap gap-2">{order.measurements.map((measurement) => <a key={measurement.id} href={`${measurement.sheetHref}?lang=${language}`} target="_blank" rel="noreferrer" className="rounded-lg bg-blue-800 px-3 py-2 text-sm">{measurement.isPartnerControl ? t.controlSheet : t.sheet} №{measurement.id} · {measurement.stepsCount ?? "—"} {t.stepsShort}</a>)}</div> : <p className="mt-3 text-sm text-slate-500">{t.noSheet}</p>}
      {controlOpen && <ControlMeasurementForm orderId={order.id} orderNumber={order.number} language={language} busy={busy} onSubmit={async (payload) => { const saved = await onControlMeasurement(payload); if (saved) setControlOpen(false); return saved; }}/>}</div>
    <div className="mt-4 grid gap-3 md:grid-cols-2"><Field label={t.stage}><select value={status} onChange={(event) => setStatus(event.target.value)} className={inputClass}>{!statuses.includes(status as never) && <option value={status}>{orderStatus(status, language)}</option>}{statuses.map((value) => <option key={value} value={value}>{orderStatus(value, language)}</option>)}</select></Field><Field label={t.plannedReady}><input type="date" value={dateValue} onChange={(event) => setDateValue(event.target.value)} className={inputClass}/></Field><Field label={t.partnerComment} wide><textarea value={comment} onChange={(event) => setComment(event.target.value)} className={`${inputClass} min-h-20`}/></Field></div>
    <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => void onUpdate(order.id, { status, partnerPlannedReadyAt: dateValue || null, partnerComment: comment })} className="min-h-11 rounded-lg bg-blue-600 px-4">{t.save}</button><button onClick={() => void onUpdate(order.id, { readyForInstallation: true, partnerComment: comment })} className="min-h-11 rounded-lg bg-green-700 px-4">{t.readyInstall}</button><button onClick={() => void onUpdate(order.id, { installationCompleted: true, status: "Заказ завершён", partnerComment: comment })} className="min-h-11 rounded-lg bg-emerald-800 px-4">{t.installed}</button>{order.mapUrl && <a href={order.mapUrl} target="_blank" rel="noreferrer" className="min-h-11 rounded-lg bg-slate-800 px-4 py-3">{t.map}</a>}</div>
  </article>;
}

type ControlForm = {
  visitDate: string;
  floorHeight: string;
  staircaseWidth: string;
  stepsCount: string;
  sameSize: boolean;
  stepLength: string;
  stepWidth: string;
  stepHeight: string;
  individualSteps: string;
  riserHeight: string;
  winderCount: string;
  platformsCount: string;
  platforms: string;
  railingLength: string;
  railingComment: string;
  objectNotes: string;
  comment: string;
};
const initialControlForm = (): ControlForm => ({
  visitDate: localDate(), floorHeight: "", staircaseWidth: "", stepsCount: "", sameSize: true,
  stepLength: "", stepWidth: "", stepHeight: "", individualSteps: "", riserHeight: "",
  winderCount: "0", platformsCount: "0", platforms: "", railingLength: "", railingComment: "",
  objectNotes: "", comment: "",
});
function dimensionRows(value: string) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [length, width, height] = line.split(/[xх×]/i).map((part) => Number(part.trim()));
    return {
      ...(Number.isFinite(length) ? { length } : {}),
      ...(Number.isFinite(width) ? { width } : {}),
      ...(Number.isFinite(height) ? { height } : {}),
    };
  });
}

function ControlMeasurementForm({ orderId, orderNumber, language, busy, onSubmit }: {
  orderId: number;
  orderNumber: string;
  language: Language;
  busy: boolean;
  onSubmit: (payload: ControlMeasurementPayload) => Promise<boolean>;
}) {
  const t = texts[language];
  const [form, setForm] = useState(initialControlForm);
  const patch = <K extends keyof ControlForm>(key: K, value: ControlForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const payload: ControlMeasurementPayload = {
      orderId,
      visitDate: form.visitDate,
      floorHeight: Number(form.floorHeight),
      staircaseWidth: Number(form.staircaseWidth),
      stepsCount: Number(form.stepsCount),
      sameSize: form.sameSize,
      ...(form.sameSize ? {
        stepLength: Number(form.stepLength),
        stepWidth: Number(form.stepWidth),
        ...(form.stepHeight ? { stepHeight: Number(form.stepHeight) } : {}),
      } : { individualSteps: dimensionRows(form.individualSteps) }),
      ...(form.riserHeight ? { riserHeight: Number(form.riserHeight) } : {}),
      winderCount: Number(form.winderCount || 0),
      platformsCount: Number(form.platformsCount || 0),
      platforms: dimensionRows(form.platforms).map(({ length, width }) => ({ length, width })),
      railingLength: Number(form.railingLength),
      railingComment: form.railingComment,
      objectNotes: form.objectNotes,
      comment: form.comment,
    };
    if (await onSubmit(payload)) setForm(initialControlForm());
  };
  return <form onSubmit={submit} className="mt-4 grid gap-3 rounded-xl border border-blue-800 bg-slate-950/80 p-4 sm:grid-cols-2 lg:grid-cols-3">
    <div className="sm:col-span-2 lg:col-span-3"><h5 className="font-bold text-white">{t.controlTitle.replace("{number}", orderNumber)}</h5><p className="mt-1 text-sm text-slate-400">{t.controlHint}</p></div>
    <Field label={t.visitDate}><input required type="date" value={form.visitDate} onChange={(event) => patch("visitDate", event.target.value)} className={inputClass}/></Field>
    <Field label={t.floorHeight}><input required min="1" step="1" type="number" value={form.floorHeight} onChange={(event) => patch("floorHeight", event.target.value)} className={inputClass}/></Field>
    <Field label={t.staircaseWidth}><input required min="1" step="1" type="number" value={form.staircaseWidth} onChange={(event) => patch("staircaseWidth", event.target.value)} className={inputClass}/></Field>
    <Field label={t.stepsCount}><input required min="1" max="500" step="1" type="number" value={form.stepsCount} onChange={(event) => patch("stepsCount", event.target.value)} className={inputClass}/></Field>
    <label className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-200 sm:col-span-2"><input type="checkbox" checked={form.sameSize} onChange={(event) => patch("sameSize", event.target.checked)}/>{t.sameSize}</label>
    {form.sameSize ? <><Field label={t.stepLength}><input required min="1" step="0.1" type="number" value={form.stepLength} onChange={(event) => patch("stepLength", event.target.value)} className={inputClass}/></Field><Field label={t.stepWidth}><input required min="1" step="0.1" type="number" value={form.stepWidth} onChange={(event) => patch("stepWidth", event.target.value)} className={inputClass}/></Field><Field label={t.stepHeight}><input min="1" step="0.1" type="number" value={form.stepHeight} onChange={(event) => patch("stepHeight", event.target.value)} className={inputClass}/></Field></> : <Field label={t.individualSteps} wide><textarea required rows={5} value={form.individualSteps} onChange={(event) => patch("individualSteps", event.target.value)} placeholder="1000 x 300 x 40" className={inputClass}/><small className="mt-1 block text-slate-500">{t.individualHint}</small></Field>}
    <Field label={t.riserHeight}><input min="1" step="0.1" type="number" value={form.riserHeight} onChange={(event) => patch("riserHeight", event.target.value)} className={inputClass}/></Field>
    <Field label={t.winderCount}><input min="0" max="500" step="1" type="number" value={form.winderCount} onChange={(event) => patch("winderCount", event.target.value)} className={inputClass}/></Field>
    <Field label={t.platformsCount}><input min="0" max="50" step="1" type="number" value={form.platformsCount} onChange={(event) => patch("platformsCount", event.target.value)} className={inputClass}/></Field>
    {Number(form.platformsCount) > 0 && <Field label={t.platforms} wide><textarea required rows={Math.min(6, Math.max(2, Number(form.platformsCount)))} value={form.platforms} onChange={(event) => patch("platforms", event.target.value)} placeholder="1200 x 1000" className={inputClass}/><small className="mt-1 block text-slate-500">{t.platformsHint}</small></Field>}
    <Field label={t.railingLength}><input required min="0" step="0.1" type="number" value={form.railingLength} onChange={(event) => patch("railingLength", event.target.value)} className={inputClass}/></Field>
    <Field label={t.railingComment}><input value={form.railingComment} onChange={(event) => patch("railingComment", event.target.value)} className={inputClass}/></Field>
    <Field label={t.objectNotes} wide><textarea rows={3} value={form.objectNotes} onChange={(event) => patch("objectNotes", event.target.value)} className={inputClass}/></Field>
    <Field label={t.measurementComment} wide><textarea rows={2} value={form.comment} onChange={(event) => patch("comment", event.target.value)} className={inputClass}/></Field>
    <button disabled={busy} className="min-h-12 rounded-xl bg-blue-600 px-4 font-semibold disabled:opacity-50 sm:col-span-2 lg:col-span-3">{busy ? t.saving : t.createSheet}</button>
  </form>;
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`text-sm text-slate-300 ${wide ? "sm:col-span-2 lg:col-span-3" : ""}`}>{label}{children}</label>;
}
function Info({ label, value }: { label: string; value: string }) {
  return <span className="min-w-0 text-sm text-slate-400">{label}<b className="block break-words text-white">{value || "—"}</b></span>;
}
