"use client";

import { useState } from "react";

import Header from "@/components/Header";
import Sidebar from "@/components/layout/Sidebar";

import Dashboard from "@/components/dashboard/Dashboard";
import ClientsPage from "@/components/pages/ClientsPage";
import OrdersPage from "@/components/pages/OrdersPage";
import PartnersPage from "@/components/pages/PartnersPage";
import ProductionPage from "@/components/pages/ProductionPage";
import WarehousePage from "@/components/pages/WarehousePage";
import FinancePage from "@/components/pages/FinancePage";
import ReportsPage from "@/components/pages/ReportsPage";
import DocumentsPage from "@/components/pages/DocumentsPage";
import CalendarPage from "@/components/pages/CalendarPage";
import EmployeesPage from "@/components/pages/EmployeesPage";

function StubPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="flex-1 overflow-auto p-8">

      <div className="rounded-2xl border border-slate-700 bg-[#101827] p-8">

        <h1 className="text-3xl font-bold text-white">
          {title}
        </h1>

        <p className="mt-3 text-slate-400">
          {description}
        </p>

      </div>

    </section>
  );
}

export default function Home() {
  const [page, setPage] = useState("dashboard");

  return (
    <main className="flex h-screen flex-col bg-slate-950 text-white">

      <Header />

      <div className="flex flex-1 overflow-hidden">

        <Sidebar
          page={page}
          setPage={setPage}
        />

        <div className="flex-1 overflow-auto">

          {page === "dashboard" && <Dashboard />}

          {page === "clients" && <ClientsPage />}

          {page === "orders" && <OrdersPage />}

          {page === "partners" && <PartnersPage />}

          {page === "production" && <ProductionPage />}

          {page === "warehouse" && <WarehousePage />}

          {page === "finance" && <FinancePage />}

          {page === "reports" && <ReportsPage />}

          {page === "documents" && <DocumentsPage />}

          {page === "calendar" && <CalendarPage />}

          {page === "employees" && <EmployeesPage />}

          {false && page === "employees" && (
            <StubPage
              title="Сотрудники"
              description="Менеджеры, мастера, партнеры, роли пользователей, KPI и заработная плата."
            />
          )}

          {page === "settings" && (
            <StubPage
              title="Настройки"
              description="Настройки ORDA ERP, материалов, цен, ролей пользователей и системных параметров."
            />
          )}

        </div>

      </div>

    </main>
  );
}
