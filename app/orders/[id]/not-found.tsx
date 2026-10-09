import Link from "next/link";

export default function OrderNotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl p-4 md:p-8">
      <section
        aria-labelledby="order-not-found-title"
        className="rounded-2xl border border-slate-800 bg-slate-950/70 p-6 shadow-xl md:p-8"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Заказы
        </p>
        <h1
          id="order-not-found-title"
          className="mt-3 text-2xl font-semibold text-white"
        >
          Заказ не найден или больше недоступен.
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Проверьте ссылку или вернитесь к списку заказов.
        </p>
        <Link
          href="/orders"
          className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-500"
        >
          Вернуться к заказам
        </Link>
      </section>
    </main>
  );
}
