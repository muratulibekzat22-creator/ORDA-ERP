"use client";

import { useEffect, useState } from "react";

import Header from "@/components/Header";
import Sidebar from "@/components/layout/Sidebar";

import Dashboard from "@/components/dashboard/Dashboard";
import ClientsPage from "@/components/pages/ClientsPage";
import OrdersPage from "@/components/pages/OrdersPage";
import PartnersPage from "@/components/pages/PartnersPage";
import ProductionPage from "@/app/production/page";
import WarehousePage from "@/components/pages/WarehousePage";
import FinancePage from "@/components/pages/FinancePage";
import ReportsPage from "@/components/pages/ReportsPage";
import DocumentsPage from "@/components/pages/DocumentsPage";
import CalendarPage from "@/components/pages/CalendarPage";
import EmployeesPage from "@/components/pages/EmployeesPage";
import SettingsPage from "@/components/pages/SettingsPage";

export default function Home() {
  const [page, setPage] = useState("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [menuOpen]);

  return (
    <main className="flex h-screen flex-col bg-slate-950 text-white">

      <Header onOpenMenu={() => setMenuOpen(true)} />

      <div className="flex flex-1 overflow-hidden">

        {menuOpen && <button type="button" aria-label="Закрыть меню" className="fixed inset-0 z-50 bg-black/60 lg:hidden" onClick={() => setMenuOpen(false)} />}
        <div className={`fixed inset-y-0 left-0 z-[60] transition-transform lg:static lg:z-auto lg:translate-x-0 ${menuOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <Sidebar page={page} setPage={(next) => { setPage(next); setMenuOpen(false); }} onClose={() => setMenuOpen(false)} />
        </div>

        <div className="min-w-0 flex-1 overflow-auto">

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

          {page === "settings" && <SettingsPage />}

        </div>

      </div>

    </main>
  );
}
