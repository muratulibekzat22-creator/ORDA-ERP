import ClientTable from "@/components/crm/ClientTable";

export default function CRMPage() {
  const clients = [
    {
      id: 1,
      name: "Алихан",
      phone: "+7 777 123 45 67",
      city: "Алматы",
      status: "🟢 Новая заявка",
    },
    {
      id: 2,
      name: "Ержан",
      phone: "+7 701 555 22 11",
      city: "Астана",
      status: "📅 Записан на замер",
    },
    {
      id: 3,
      name: "Нурсултан",
      phone: "+7 705 888 44 33",
      city: "Шымкент",
      status: "❌ Дорого",
    },
  ];

  return (
    <main className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">
            crm • Клиенты
          </h1>

          <p className="mt-2 text-gray-400">
            Управление заявками ALTYN SAPA
          </p>
        </div>

        <button className="rounded-xl bg-yellow-500 px-5 py-3 font-semibold text-black hover:bg-yellow-400">
          + Новая заявка
        </button>
      </div>

      <ClientTable clients={clients} />
    </main>
  );
}