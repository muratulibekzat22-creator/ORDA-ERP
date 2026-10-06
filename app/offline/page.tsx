export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-950 p-6 text-white">
      <div className="max-w-md rounded-2xl border border-amber-500/40 bg-slate-900 p-6 text-center">
        <h1 className="text-2xl font-bold">Нет интернета</h1>
        <p className="mt-3 text-slate-300">Авторизованные страницы и финансовые данные не сохраняются в кеш. Безопасные заметки, задачи и замеры синхронизируются после восстановления сети.</p>
      </div>
    </main>
  );
}
