"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ru">
      <body className="bg-slate-950 text-white">
        <main className="flex min-h-screen items-center justify-center p-6">
          <section className="max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center">
            <h1 className="text-2xl font-semibold">ORDA ERP временно недоступна</h1>
            <p className="mt-3 text-slate-300">Повторите попытку или сообщите поддержке код: <span className="font-mono">{error.digest ?? "CLIENT-RETRY"}</span></p>
            <button type="button" onClick={reset} className="mt-6 rounded-lg bg-blue-600 px-5 py-2 font-medium">Повторить</button>
          </section>
        </main>
      </body>
    </html>
  );
}
