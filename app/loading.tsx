export default function Loading() {
  return (
    <section role="status" aria-live="polite" aria-label="Загрузка раздела" className="space-y-5 p-4 sm:p-6 md:p-8">
      <span className="sr-only">Загрузка раздела…</span>
      <div className="h-10 w-2/3 max-w-sm animate-pulse rounded-xl bg-slate-800" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-2xl border border-slate-800 bg-slate-900" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-2xl border border-slate-800 bg-slate-900" />
    </section>
  );
}
