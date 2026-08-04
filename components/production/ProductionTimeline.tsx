"use client";

interface TimelineItem {
  id: number;
  title: string;
  description: string;
  date: string;
  color: string;
}

interface Props {
  items: TimelineItem[];
}

export default function ProductionTimeline({
  items,
}: Props) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

      <h2 className="mb-8 text-2xl font-bold text-white">
        История производства
      </h2>

      <div className="space-y-8">

        {items.map((item, index) => (

          <div
            key={item.id}
            className="relative flex gap-5"
          >

            <div className="flex flex-col items-center">

              <div
                className={`h-5 w-5 rounded-full ${item.color}`}
              />

              {index !== items.length - 1 && (
                <div className="mt-2 h-full w-[2px] bg-slate-700" />
              )}

            </div>

            <div className="flex-1 rounded-xl border border-slate-700 bg-slate-900 p-5">

              <div className="flex items-center justify-between">

                <h3 className="text-lg font-bold text-white">
                  {item.title}
                </h3>

                <span className="text-sm text-slate-400">
                  {item.date}
                </span>

              </div>

              <p className="mt-3 text-slate-300">
                {item.description}
              </p>

            </div>

          </div>

        ))}

      </div>

    </div>
  );
}