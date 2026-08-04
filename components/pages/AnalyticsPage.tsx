export default function AnalyticsPage() {
    return (
      <section className="flex-1 p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">
            Аналитика
          </h1>
  
          <p className="mt-2 text-slate-400">
            Статистика компании ALTYN SAPA
          </p>
        </div>
  
        <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6">
            <p className="text-slate-400">Договоров</p>
            <h2 className="mt-2 text-3xl font-bold text-blue-400">15</h2>
          </div>
  
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6">
            <p className="text-slate-400">Выручка</p>
            <h2 className="mt-2 text-3xl font-bold text-green-400">
              42 500 000 ₸
            </h2>
          </div>
  
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6">
            <p className="text-slate-400">Замеры</p>
            <h2 className="mt-2 text-3xl font-bold text-yellow-400">28</h2>
          </div>
  
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6">
            <p className="text-slate-400">Конверсия</p>
            <h2 className="mt-2 text-3xl font-bold text-purple-400">36%</h2>
          </div>
        </div>
  
        <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-8">
          <h3 className="text-xl font-semibold text-white">
            Графики появятся на следующем этапе
          </h3>
  
          <p className="mt-2 text-slate-400">
            Здесь будут отображаться графики Recharts по продажам,
            заявкам, прибыли и эффективности менеджеров.
          </p>
        </div>
      </section>
    );
}
