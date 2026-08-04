import Link from "next/link";
import type { ReactNode } from "react";

import DocumentPrintButton from "./DocumentPrintButton";

export default function DocumentPreview({ children, title, orderId }: { children: ReactNode; title: string; orderId: number }) {
  return <main className="document-page min-h-screen bg-slate-200 p-6 md:p-10"><div className="print:hidden mx-auto mb-6 flex max-w-5xl items-center justify-between gap-4"><Link href={`/orders/${orderId}`} className="rounded-xl bg-slate-700 px-5 py-3 font-semibold text-white hover:bg-slate-600">К заказу</Link><div className="flex items-center gap-3"><p className="hidden text-slate-600 md:block">{title}</p><DocumentPrintButton /></div></div><article className="mx-auto max-w-5xl bg-white p-8 text-black shadow-sm md:p-12">{children}</article></main>;
}
