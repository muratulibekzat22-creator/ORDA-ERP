import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { forbidden, notFound, redirect } from "next/navigation";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import { enterTenantFromSession } from "@/lib/tenant-context";

const label: Record<string, string> = {
  NEW: "Новое обращение", QUALIFIED: "Квалифицирована", CALCULATION_READY: "Расчёт готов",
  PROPOSAL_SENT: "КП отправлено", FOLLOW_UP: "Повторный контакт", MEASUREMENT_SCHEDULED: "Замер назначен",
  MEASUREMENT_COMPLETED: "Замер выполнен", NEGOTIATION: "Согласование", WON: "Выиграна", LOST: "Проиграна",
};

export default async function MarketingApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const role = session.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MARKETER) forbidden();
  if (!enterTenantFromSession(session)) redirect("/login");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const application = await prisma.client.findFirst({
    where: { id, active: true, deletedAt: null, leadAttribution: { isNot: null } },
    select: {
      id: true, name: true, phone: true, whatsapp: true, city: true, stage: true, estimateNotes: true, createdAt: true,
      managerUser: { select: { name: true } },
      leadAttribution: { select: { firstContactAt: true, primarySource: { select: { name: true } }, firstTouchSource: { select: { name: true } }, lastTouchSource: { select: { name: true } }, channel: { select: { name: true } }, campaign: { select: { name: true } }, adSet: { select: { name: true } }, ad: { select: { name: true } } } },
      measurements: { select: { id: true, status: true, visitDate: true }, orderBy: { visitDate: "desc" } },
      commercialProposals: { select: { id: true, number: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" } },
      leadConversion: { select: { order: { select: { id: true, number: true, lifecycle: true, status: true, createdAt: true } } } },
    },
  });
  if (!application?.leadAttribution) notFound();
  const attribution = application.leadAttribution;
  return <main className="mx-auto max-w-5xl p-4 md:p-8">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm uppercase tracking-widest text-blue-300">Маркетинговая заявка #{application.id}</p><h1 className="mt-1 text-3xl font-bold">{application.name}</h1></div><Link href="/marketing" className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 font-semibold">Вернуться в маркетинг</Link></div>
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><h2 className="text-lg font-bold">Контакт и статус</h2><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">Телефон</dt><dd>{application.phone}</dd></div><div><dt className="text-slate-500">WhatsApp</dt><dd>{application.whatsapp}</dd></div><div><dt className="text-slate-500">Город</dt><dd>{application.city}</dd></div><div><dt className="text-slate-500">Менеджер</dt><dd>{application.managerUser?.name ?? "Не назначен"}</dd></div><div><dt className="text-slate-500">Этап CRM</dt><dd>{label[application.stage] ?? application.stage}</dd></div><div><dt className="text-slate-500">Создана</dt><dd>{application.createdAt.toLocaleDateString("ru-RU")}</dd></div></dl>{application.estimateNotes && <p className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-950 p-3 text-sm text-slate-300">{application.estimateNotes}</p>}</section>
      <section className="rounded-2xl border border-blue-500/20 bg-blue-950/20 p-5"><h2 className="text-lg font-bold">Атрибуция</h2><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">Основной источник</dt><dd>{attribution.primarySource.name}</dd></div><div><dt className="text-slate-500">Канал обращения</dt><dd>{attribution.channel.name}</dd></div><div><dt className="text-slate-500">Первое касание</dt><dd>{attribution.firstTouchSource.name}</dd></div><div><dt className="text-slate-500">Последнее касание</dt><dd>{attribution.lastTouchSource.name}</dd></div><div><dt className="text-slate-500">Кампания</dt><dd>{attribution.campaign?.name ?? "—"}</dd></div><div><dt className="text-slate-500">Группа / объявление</dt><dd>{[attribution.adSet?.name, attribution.ad?.name].filter(Boolean).join(" · ") || "—"}</dd></div></dl></section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><h2 className="text-lg font-bold">Замеры</h2>{application.measurements.length ? <ul className="mt-3 space-y-2">{application.measurements.map((item) => <li key={item.id} className="rounded-xl bg-slate-950 p-3 text-sm">#{item.id} · {item.status} · {item.visitDate.toLocaleDateString("ru-RU")}</li>)}</ul> : <p className="mt-3 text-sm text-slate-500">Замеров пока нет</p>}</section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><h2 className="text-lg font-bold">КП и заказ</h2><p className="mt-3 text-sm text-slate-300">Коммерческих предложений: {application.commercialProposals.length}</p>{application.leadConversion?.order ? <div className="mt-3 rounded-xl bg-emerald-950/30 p-3 text-sm text-emerald-200">Заказ №{application.leadConversion.order.number} · {application.leadConversion.order.status}</div> : <p className="mt-2 text-sm text-slate-500">Заказ ещё не заключён</p>}</section>
    </div>
    <p className="mt-5 text-xs text-slate-500">Для роли MARKETER скрыты оплаты, себестоимость, партнёрские расчёты и прибыль заказа.</p>
  </main>;
}
