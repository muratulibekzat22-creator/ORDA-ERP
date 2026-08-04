"use client";

interface Production {
  id: number;
  stage: string;
  percent: number;
  master: string;

  order: {
    number: string;

    client: {
      name: string;
    };
  };
}

interface Props {
  productions: Production[];
}

const columns = [
  "Ожидание",
  "Производство",
  "Покраска",
  "Монтаж",
  "Готово",
];

export default function ProductionKanban({
  productions,
}: Props) {
  return (
    <div className="grid grid-cols-5 gap-5">

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

                  <h3 className="font-bold text-white">
                    {item.order.number}
                  </h3>

                  <p className="mt-1 text-slate-400">
                    {item.order.client.name}
                  </p>

                  <div className="mt-4">

                    <div className="mb-2 flex justify-between">

                      <span className="text-sm text-slate-400">
                        Готовность
                      </span>

                      <span className="text-yellow-400">
                        {item.percent}%
                      </span>

                    </div>

                    <div className="h-2 rounded-full bg-slate-700">

                      <div
                        className="h-2 rounded-full bg-green-500"
                        style={{
                          width: `${item.percent}%`,
                        }}
                      />

                    </div>

                  </div>

                  <div className="mt-4">

                    <p className="text-sm text-slate-400">
                      Мастер
                    </p>

                    <p className="text-white">
                      {item.master || "Не назначен"}
                    </p>

                  </div>

                </div>

              ))}

          </div>

        </div>

      ))}

    </div>
  );
}