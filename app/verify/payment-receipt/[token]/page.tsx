import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { paymentReceiptPublicProjection } from "@/lib/services/payment-receipt.service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Проверка квитанции · ALTYN SAPA COMPANY",
  robots: { index: false, follow: false },
};

const money = (value: number) =>
  `${value.toLocaleString("ru-RU", { maximumFractionDigits: 0 }).replaceAll(" ", " ")} ₸`;

export default async function PaymentReceiptVerificationPage({ params }: { params: Promise<{ token: string }> }) {
  const value = await paymentReceiptPublicProjection((await params).token);
  if (!value) notFound();
  const valid = value.status === "VALID";
  return <main className="min-h-screen bg-[#0b111d] px-4 py-10 text-slate-100"><article className="mx-auto max-w-xl overflow-hidden rounded-3xl border border-slate-700 bg-[#101827] shadow-2xl"><div className="h-1.5 bg-[#b68a3a]"/><div className="p-6 sm:p-8"><p className="text-sm font-bold tracking-[0.18em] text-[#d8b873]">ALTYN SAPA COMPANY</p><h1 className="mt-3 text-2xl font-bold">Квитанция №{value.receiptNumber}</h1><div className={`mt-5 rounded-2xl border p-4 ${valid ? "border-emerald-700 bg-emerald-950/30 text-emerald-200" : "border-red-700 bg-red-950/30 text-red-200"}`}><p className="text-sm uppercase tracking-wide">Статус</p><strong className="mt-1 block text-xl">{valid ? "Действительна" : "Аннулирована"}</strong>{!valid && <p className="mt-2 text-sm">Квитанция аннулирована.</p>}</div><dl className="mt-6 grid gap-4 sm:grid-cols-2"><Item label="Дата и время" value={new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "medium", timeStyle: "short" }).format(new Date(value.dateTime))}/><Item label="Заказ" value={value.orderNumber}/><Item label="Договор" value={value.contractNumber ?? "Не указан"}/><Item label="Этот платёж" value={money(value.paymentAmount)}/><Item label="Способ оплаты" value={value.paymentMethod}/><Item label="Ответственный менеджер" value={value.responsibleManager}/><Item label="Клиент" value={value.maskedClientName}/></dl><div className="mt-6 rounded-xl bg-slate-950/60 p-4"><p className="text-xs text-slate-500">Проверочный checksum</p><p className="mt-1 break-all font-mono text-xs text-slate-300">{value.checksum}</p></div><p className="mt-6 border-t border-slate-700 pt-5 text-sm leading-6 text-slate-400">Нефискальное подтверждение оплаты.<br/>Не является чеком ККМ.</p></div></article></main>;
}

function Item({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 break-words font-semibold text-slate-100">{value}</dd></div>;
}
