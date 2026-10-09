import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type { PaymentReceiptLineSnapshot } from "@/lib/documents/payment-receipt-pdf";
import { paymentReceiptPublicProjection } from "@/lib/services/payment-receipt.service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Квитанция об оплате · ORDA",
  robots: { index: false, follow: false },
};

const money = (value: number) =>
  `${value.toLocaleString("ru-RU", { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 }).replaceAll(" ", " ")} ₸`;

export default async function PaymentReceiptVerificationPage({ params }: { params: Promise<{ token: string }> }) {
  const value = await paymentReceiptPublicProjection((await params).token);
  if (!value) notFound();
  const valid = value.status === "VALID";
  const items = value.items.map((item) => typeof item === "string" ? { name: item } : item as PaymentReceiptLineSnapshot);
  return (
    <main className="min-h-screen bg-slate-100 px-3 py-6 text-slate-950 print:bg-white print:p-0">
      <article className="mx-auto max-w-md rounded-2xl border border-slate-300 bg-white p-5 shadow-sm print:border-0 print:shadow-none">
        <header className="text-center">
          <p className="font-bold">{value.company.name}</p>
          <p className="mt-1 text-xs text-slate-600">БИН {value.company.bin}</p>
          {value.company.address ? <p className="text-xs text-slate-600">{value.company.address}</p> : null}
          <h1 className="mt-5 text-xl font-bold">Квитанция об оплате</h1>
          <p className="mt-1 font-semibold">{value.receiptNumber}</p>
        </header>

        <div className={`mt-5 rounded-xl border px-4 py-3 ${valid ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`}>
          <p className="text-xs uppercase tracking-wide text-slate-500">Статус</p>
          <strong>{valid ? "Действительна" : "Аннулирована"}</strong>
        </div>

        <dl className="mt-5 grid gap-3 border-y border-slate-200 py-4 sm:grid-cols-2">
          <Item label="Дата платежа" value={new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "medium", timeStyle: "short" }).format(new Date(value.dateTime))} />
          <Item label="Заказ" value={`№ ${value.orderNumber}`} />
          <Item label="Договор" value={value.contractNumber ? `№ ${value.contractNumber}` : "Не указан"} />
          <Item label="Клиент" value={value.maskedClientName} />
          <Item label="Менеджер" value={value.responsibleManager} />
          <Item label="Оплату принял" value={value.registeredBy} />
        </dl>

        <section className="mt-5">
          <h2 className="text-sm font-bold uppercase tracking-wide">Товары и услуги</h2>
          <ol className="mt-3 space-y-3">
            {items.map((item, index) => (
              <li key={index} className="border-b border-slate-100 pb-3 text-sm">
                <p className="font-medium">{index + 1}. {item.name}</p>
                {"quantity" in item ? <p className="mt-1 text-xs text-slate-600">{item.quantity} {item.unit} × {money(item.unitPrice)}{item.discount ? ` · скидка ${money(item.discount)}` : ""}</p> : null}
              </li>
            ))}
          </ol>
        </section>

        <dl className="mt-5 space-y-2 border-t border-slate-200 pt-4">
          <Total label="Оплачено ранее" value={money(value.totals.paidBefore)} />
          <Total label="Остаток после платежа" value={money(value.totals.remaining)} />
          <Total label="Способ оплаты" value={value.paymentMethod} />
        </dl>
        <p className="mt-5 rounded-xl border-2 border-slate-900 px-3 py-4 text-center text-xl font-bold">ПРИНЯТО: {money(value.paymentAmount)}</p>
      </article>
    </main>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-0.5 break-words text-sm font-semibold">{value}</dd></div>;
}

function Total({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 text-sm"><dt className="text-slate-600">{label}</dt><dd className="text-right font-semibold">{value}</dd></div>;
}
