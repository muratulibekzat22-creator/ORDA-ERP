import ProjectMeasurement from "@/components/project/ProjectMeasurement";
import type { OrderTabData } from "./types";

export default function MeasurementsTab({ order }: { order: OrderTabData }) {
  return (
    <div className="space-y-6">
      <ProjectMeasurement orderId={order.id} />

      <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">
        <h2 className="text-xl font-bold text-white">Сохранённые замеры</h2>
        <div className="mt-5 space-y-4">
          {order.measurements.length === 0 ? (
            <p className="text-slate-400">Замеров пока нет.</p>
          ) : (
            order.measurements.map((measurement) => (
              <div key={measurement.id} className="rounded-xl bg-slate-900 p-4">
                <p className="font-semibold text-white">{measurement.measurer}</p>
                <p className="mt-1 text-sm text-slate-400">
                  {new Date(measurement.visitDate).toLocaleDateString("ru-RU")}
                </p>
                <p className="mt-2 text-sm text-slate-300">
                  Высота: {measurement.floorHeight ?? "—"} · Ширина: {measurement.staircaseWidth ?? "—"} · Ступени: {measurement.stepsCount ?? "—"}
                </p>
                {measurement.comment && <p className="mt-2 text-sm text-slate-400">{measurement.comment}</p>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
