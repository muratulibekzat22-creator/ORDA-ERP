import BrassProcurementsPanel from "@/components/warehouse/BrassProcurementsPanel";

export default function BrassProcurementsPage() {
  return (
    <section className="min-h-screen flex-1 overflow-auto bg-[#0b1120] p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-white">Латунь</h1>
        <p className="mt-2 text-slate-400">
          Полный цикл заявки: заказ, поставщик, оплата, карго, приёмка и итоговая себестоимость.
        </p>
      </header>
      <BrassProcurementsPanel
        canOperate
        canPay
        canAddSupplier
        readOnly={false}
      />
    </section>
  );
}
