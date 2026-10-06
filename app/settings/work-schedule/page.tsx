import WorkScheduleSettings from "@/components/settings/WorkScheduleSettings";

export default function WorkSchedulePage() {
  return (
    <section className="flex-1 overflow-auto p-5 md:p-8">
      <div className="mb-6">
        <p className="text-sm text-slate-400">Настройки → Рабочий календарь</p>
        <h1 className="mt-1 text-3xl font-bold text-white">Выходные и отчёты</h1>
      </div>
      <WorkScheduleSettings />
    </section>
  );
}
