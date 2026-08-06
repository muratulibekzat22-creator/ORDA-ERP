"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const supportCode = error.digest ?? "CLIENT-RETRY";
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <section className="max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center text-white">
        <h1 className="text-2xl font-semibold">Не удалось открыть раздел</h1>
        <p className="mt-3 text-slate-300">Повторите попытку. Если ошибка сохранится, сообщите поддержке код обращения.</p>
        <p className="mt-3 font-mono text-xs text-slate-400">Код: {supportCode}</p>
        <button type="button" onClick={reset} className="mt-6 rounded-lg bg-blue-600 px-5 py-2 font-medium hover:bg-blue-500">Повторить</button>
      </section>
    </main>
  );
}
