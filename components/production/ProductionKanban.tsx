"use client";

const columns = [
  "Новая заявка",
  "Замер",
  "Проектирование",
  "Заготовка",
  "Покраска",
  "Заказ готов",
  "Монтаж",
  "Сдано",
];

export type ProductionKanbanItem = {
  id: number;
  stage: string;
  percent: number;
  master: string;
  order: {
    id: number;
    number: string;
    client: {
      name: string;
    };
  };
};

interface Props {
  productions: ProductionKanbanItem[];
  onStageChange: (id: number, stage: string) => void;
  updatingId?: number | null;
}

export default function ProductionKanban({
  productions,
  onStageChange,
  updatingId,
}: Props) {
  return (
    <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-4">
      {columns.map((column) => (
        <div
          key={column}
          className="rounded-2xl border border-slate-700 bg-[#101827] p-4"
        >
          <h2 className="mb-5 text-center text-xl font-bold text-white">
            {column}
          </h2>

          <div className="space-y-4">
            {productions
              .filter((item) => item.stage === column)
              .map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-slate-700 bg-slate-900 p-4"
                >
                  <h3 className="font-bold text-white">{item.order.number}</h3>
                  <p className="mt-1 text-slate-400">{item.order.client.name}</p>

                  <div className="mt-4">
                    <div className="mb-2 flex justify-between">
                      <span className="text-sm text-slate-400">Готовность</span>
                      <span className="text-yellow-400">{item.percent}%</span>
                    </div>

                    <div className="h-2 rounded-full bg-slate-700">
                      <div
                        className="h-2 rounded-full bg-green-500"
                        style={{ width: `${item.percent}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="text-sm text-slate-400">Мастер</p>
                    <p className="text-white">{item.master || "Не назначен"}</p>
                  </div>

                  <select
                    aria-label={`Этап заказа ${item.order.number}`}
                    value={item.stage}
                    disabled={updatingId === item.id}
                    onChange={(event) => onStageChange(item.id, event.target.value)}
                    className="mt-4 w-full rounded-lg bg-slate-800 p-2 text-sm text-white outline-none ring-1 ring-slate-700 focus:ring-blue-500 disabled:cursor-wait disabled:opacity-70"
                  >
                    {columns.map((stage) => (
                      <option key={stage} value={stage}>
                        {stage}
                      </option>
                    ))}
                  </select>
                </div>
              ))}

            {productions.every((item) => item.stage !== column) && (
              <p className="rounded-xl border border-dashed border-slate-700 py-6 text-center text-sm text-slate-500">
                Нет заказов
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
