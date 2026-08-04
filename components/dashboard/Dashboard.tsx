import DashboardStats from "@/components/dashboard/DashboardStats";
import OrdersTable from "@/components/dashboard/OrdersTable";
import RevenueChart from "@/components/dashboard/RevenueChart";
import CalendarAgenda from "@/components/dashboard/CalendarAgenda";
import WarehouseStats from "@/components/dashboard/WarehouseStats";

export default function Dashboard() {
  const totalClients = 148;
  const totalOrders = 37;
  const totalProduction = 18;
  const totalRevenue = 84250000;

  return (
    <section className="flex-1 overflow-auto bg-slate-950 p-8">

      <div className="mb-8 flex items-center justify-between">

        <div>

          <h1 className="text-4xl font-bold text-white">
            ORDA ERP
          </h1>

          <p className="mt-2 text-slate-400">
            Панель управления ALTYN SAPA COMPANY
          </p>

        </div>

        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 px-6 py-4">

          <p className="text-sm text-slate-400">
            Выполнение плана
          </p>

          <h2 className="mt-1 text-3xl font-bold text-blue-400">
            40%
          </h2>

        </div>

      </div>

      <div className="mb-8 rounded-2xl border border-slate-700 bg-gradient-to-r from-slate-900 via-[#13233f] to-slate-900 p-6">

        <h2 className="text-2xl font-bold text-white">
          ORDA AI
        </h2>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">

          <div className="rounded-xl bg-slate-900/60 p-4">
            <p className="text-slate-400">
              Новые заявки
            </p>

            <p className="mt-2 text-3xl font-bold text-blue-400">
              12
            </p>

          </div>

          <div className="rounded-xl bg-slate-900/60 p-4">
            <p className="text-slate-400">
              Замеры сегодня
            </p>

            <p className="mt-2 text-3xl font-bold text-yellow-400">
              5
            </p>

          </div>

          <div className="rounded-xl bg-slate-900/60 p-4">
            <p className="text-slate-400">
              Монтаж
            </p>

            <p className="mt-2 text-3xl font-bold text-orange-400">
              3
            </p>

          </div>

          <div className="rounded-xl bg-slate-900/60 p-4">
            <p className="text-slate-400">
              Передать партнеру
            </p>

            <p className="mt-2 text-3xl font-bold text-green-400">
              4
            </p>

          </div>

          <div className="rounded-xl bg-slate-900/60 p-4">
            <p className="text-slate-400">
              Просроченные оплаты
            </p>

            <p className="mt-2 text-3xl font-bold text-red-400">
              2
            </p>

          </div>

        </div>

      </div>

      <DashboardStats
        totalClients={totalClients}
        totalOrders={totalOrders}
        totalProduction={totalProduction}
        totalRevenue={totalRevenue}
      />

      <RevenueChart />

      <CalendarAgenda />

      <WarehouseStats />

      <OrdersTable />

    </section>
  );
}
