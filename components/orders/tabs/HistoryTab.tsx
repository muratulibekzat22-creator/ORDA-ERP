import type { OrderTabData } from "./types";

export default function HistoryTab({ order }: { order: OrderTabData }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">
      <h2 className="text-xl font-bold text-white">История заказа</h2>
      <div className="mt-5 space-y-4">
        {order.events.length === 0 ? (
          <p className="text-slate-400">Событий пока нет.</p>
        ) : (
          order.events.map((event) => (
            <div key={event.id} className="border-b border-slate-700 pb-4 last:border-0">
              <p className="font-semibold text-white">{event.title}</p>
              {event.description && <p className="mt-1 text-sm text-slate-400">{event.description}</p>}
              <p className="mt-2 text-xs text-slate-500">
                {[event.user, new Date(event.createdAt).toLocaleString("ru-RU")].filter(Boolean).join(" · ")}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
