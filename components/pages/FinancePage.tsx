export default function FinancePage() {
    const transactions = [
      {
        date: "31.07.2026",
        type: "Доход",
        description: "Предоплата — ТОО Астана Дом",
        amount: "+4 800 000 ₸",
      },
      {
        date: "30.07.2026",
        type: "Расход",
        description: "Закупка материалов",
        amount: "-1 250 000 ₸",
      },
      {
        date: "29.07.2026",
        type: "Доход",
        description: "Оплата — Villa House",
        amount: "+6 200 000 ₸",
      },
    ];
  
    return (
      <section className="flex-1 p-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">
              Финансы
            </h1>
  
            <p className="mt-2 text-slate-400">
              Доходы, расходы и движение денежных средств
            </p>
          </div>
  
          <button className="rounded-xl bg-blue-600 px-5 py-3 transition hover:bg-blue-700">
            + Добавить операцию
          </button>
        </div>
  
        <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <p className="text-slate-400">Доходы</p>
            <h2 className="mt-2 text-3xl font-bold text-green-400">
              13 650 000 ₸
            </h2>
          </div>
  
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <p className="text-slate-400">Расходы</p>
            <h2 className="mt-2 text-3xl font-bold text-red-400">
              1 250 000 ₸
            </h2>
          </div>
  
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <p className="text-slate-400">Баланс</p>
            <h2 className="mt-2 text-3xl font-bold text-blue-400">
              12 400 000 ₸
            </h2>
          </div>
        </div>
  
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700 text-left text-slate-400">
                <th className="pb-4">Дата</th>
                <th className="pb-4">Тип</th>
                <th className="pb-4">Описание</th>
                <th className="pb-4">Сумма</th>
              </tr>
            </thead>
  
            <tbody>
              {transactions.map((item, index) => (
                <tr
                  key={index}
                  className="border-b border-slate-800 hover:bg-slate-800/40"
                >
                  <td className="py-4">{item.date}</td>
                  <td>{item.type}</td>
                  <td>{item.description}</td>
                  <td
                    className={
                      item.type === "Доход"
                        ? "font-semibold text-green-400"
                        : "font-semibold text-red-400"
                    }
                  >
                    {item.amount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }