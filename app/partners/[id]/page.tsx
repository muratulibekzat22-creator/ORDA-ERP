import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import PartnerPaymentForm from "@/components/partners/PartnerPaymentForm";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getPartner } from "@/lib/services/partner.service";

interface Props {
  params: Promise<{
    id: string;
  }>;
}

export default async function PartnerPage({
  params,
}: Props) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (session?.user.role !== Role.DIRECTOR && session?.user.role !== Role.ACCOUNTANT) notFound();

  const partner = await getPartner(Number(id));

  if (!partner) {
    notFound();
  }

  const partnerPayments = partner.orders.flatMap((order) =>
    order.payments
      .filter((payment) => payment.type === "PARTNER_PAYOUT")
      .map((payment) => ({ ...payment, orderNumber: order.number }))
  );

  return (
    <main className="space-y-6 p-4 sm:p-6 md:space-y-8 md:p-8">

      <div className="flex items-center justify-between">

        <div>

          <h1 className="text-3xl font-bold text-white">
            {partner.name}
          </h1>

          <p className="mt-2 text-slate-400">
            Карточка цеха
          </p>

        </div>

        <span
          className={`rounded-xl px-4 py-2 ${
            partner.active
              ? "bg-green-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {partner.active ? "Активен" : "Неактивен"}
        </span>

      </div>

      <div className="grid gap-6 xl:grid-cols-4">

        <Card
          title="Заказы"
          value={partner.stats.totalOrders}
          color="text-cyan-400"
        />

        <Card
          title="Согласовано"
          value={`${partner.stats.partnerAgreed.toLocaleString()} ₸`}
          color="text-green-400"
        />

        <Card
          title="Выплачено"
          value={`${partner.stats.partnerPaid.toLocaleString()} ₸`}
          color="text-blue-400"
        />

        <Card
          title="Осталось"
          value={`${partner.stats.partnerBalance.toLocaleString()} ₸`}
          color="text-yellow-400"
        />

      </div>

      <div className="grid gap-6 xl:grid-cols-2">

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-6 text-xl font-bold text-white">
            Информация
          </h2>

          <div className="space-y-4">

            <Info
              title="Телефон"
              value={partner.phone || "—"}
            />

            <Info
              title="E-mail"
              value={partner.email || "—"}
            />

            <Info
              title="Город"
              value={partner.city || "—"}
            />

            {session?.user.role === Role.DIRECTOR && <Info
              title="Валовая маржа заказов"
              value={`${partner.stats.grossMargin.toLocaleString()} ₸`}
            />}

          </div>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-6 text-xl font-bold text-white">
            Заказы
          </h2>

          <div className="space-y-4">

            {partner.orders.length === 0 ? (
              <p className="text-slate-400">
                Заказов пока нет
              </p>
            ) : (
              partner.orders.map((order) => (
                <div
                  key={order.id}
                  className="rounded-xl bg-slate-900 p-4"
                >

                  <div className="flex flex-wrap justify-between gap-3">

                    <div>

                      <p className="font-semibold text-white">
                        {order.number}
                      </p>

                      <p className="text-sm text-slate-400">
                        {order.client.name}
                      </p>

                    </div>

                    <span className="font-bold text-white">{Number(order.amount).toLocaleString()} ₸</span>

                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-400">
                    <span>Цена партнёра: {order.partnerAgreedAt ? `${Number(order.partnerPrice).toLocaleString()} ₸` : "не указана"}</span>
                    <span>Выплачено: {Number(order.partnerPaid).toLocaleString()} ₸</span>
                    <span>Остаток: {order.partnerAgreedAt ? `${Math.max(Number(order.partnerBalance), 0).toLocaleString()} ₸` : "—"}</span>
                    <span>Производство: {order.productions[0]?.stage ?? order.status}</span>
                  </div>

                </div>
              ))
            )}

          </div>

        </div>

      </div>

      <div className="grid gap-6 xl:grid-cols-2">

        <PartnerPaymentForm
          orders={partner.orders.filter((order) => order.partnerAgreedAt).map((order) => ({
            id: order.id,
            number: order.number,
            partnerBalance: Number(order.partnerBalance),
          }))}
        />

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-6 text-xl font-bold text-white">
            История выплат
          </h2>

          <div className="space-y-3">
            {partnerPayments.length === 0 ? (
              <p className="text-slate-400">Выплат пока нет</p>
            ) : (
              partnerPayments.map((payment) => (
                <div key={payment.id} className="rounded-xl bg-slate-900 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-white">{payment.orderNumber}</p>
                      <p className="text-sm text-slate-400">
                        {payment.method}{payment.comment ? ` • ${payment.comment}` : ""}
                      </p>
                    </div>
                    <p className="font-bold text-green-400">
                      {Number(payment.amount).toLocaleString()} ₸
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

        </div>

      </div>

    </main>
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

function Info({
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

      <span className="font-medium text-white">
        {value}
      </span>

    </div>
  );
}
