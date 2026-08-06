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
      <section className="flex-1 p-4 sm:p-6 md:p-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white sm:text-3xl">
              Финансы
            </h1>
  
            <p className="mt-2 text-slate-400">
              Доходы, расходы и движение денежных средств
            </p>
          </div>
  
          <button type="button" className="min-h-11 w-full rounded-xl bg-blue-600 px-5 py-3 transition hover:bg-blue-700 sm:w-auto">
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
  
        <div data-scroll-region className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
          <table className="w-full min-w-[680px]">
            <thead>
              <tr className="border-b border-slate-700 text-left text-slate-400">
                <th scope="col" className="p-4">Дата</th>
                <th scope="col" className="p-4">Тип</th>
                <th scope="col" className="p-4">Описание</th>
                <th scope="col" className="p-4">Сумма</th>
              </tr>
            </thead>
  
            <tbody>
              {transactions.map((item, index) => (
                <tr
                  key={index}
                  className="border-b border-slate-800 hover:bg-slate-800/40"
                >
                  <td className="p-4">{item.date}</td>
                  <td className="p-4">{item.type}</td>
                  <td className="p-4">{item.description}</td>
                  <td
                    className={
                      item.type === "Доход"
                      ? "p-4 font-semibold text-green-400"
                        : "p-4 font-semibold text-red-400"
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
