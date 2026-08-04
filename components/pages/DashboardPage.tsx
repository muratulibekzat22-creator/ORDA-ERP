import StatCard from "@/components/dashboard/StatCard";
import OrdersTable from "@/components/dashboard/OrdersTable";

export default function DashboardPage() {
  const stats = [
    {
      title: "Новые заявки",
      value: "25",
      color: "text-blue-400",
    },
    {
      title: "Активные заказы",
      value: "18",
      color: "text-green-400",
    },
    {
      title: "В производстве",
      value: "12",
      color: "text-yellow-400",
    },
    {
      title: "Доход месяца",
      value: "42 500 000 ₸",
      color: "text-purple-400",
    },
  ];

  return (
    <section className="flex-1 p-8">
      <h1 className="text-3xl font-bold">
        Dashboard ORDA
      </h1>

      <p className="mt-2 text-slate-400">
        Добро пожаловать в систему управления компанией ALTYN SAPA
      </p>

      <div className="mt-8 grid grid-cols-4 gap-6">
        {stats.map((item) => (
          <StatCard
            key={item.title}
            title={item.title}
            value={item.value}
            color={item.color}
          />
        ))}
      </div>

      <OrdersTable />
    </section>
  );
}
