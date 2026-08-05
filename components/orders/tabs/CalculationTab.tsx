import StairCalculator from "@/components/calculator/StairCalculator";

export default function CalculationTab({ orderId }: { orderId: number }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-[#101827] p-4 md:p-6">
      <h2 className="mb-5 text-xl font-bold text-white">Расчёт лестницы</h2>
      <StairCalculator orderId={orderId} />
    </div>
  );
}
