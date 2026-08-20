import Link from "next/link";

export default function MarketingForbidden() {
  return <main className="mx-auto max-w-xl p-8">
    <div className="rounded-2xl border border-red-500/30 bg-red-950/30 p-6">
      <p className="text-sm font-bold uppercase tracking-widest text-red-300">403</p>
      <h1 className="mt-2 text-2xl font-bold">Доступ к маркетингу запрещён</h1>
      <p className="mt-2 text-slate-300">Раздел доступен только директору и маркетологу.</p>
      <Link href="/" className="mt-5 inline-flex rounded-xl bg-slate-800 px-4 py-3 font-semibold">На главную</Link>
    </div>
  </main>;
}
