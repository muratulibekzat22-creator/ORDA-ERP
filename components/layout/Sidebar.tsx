"use client";

import {
  LayoutDashboard,
  Users,
  ClipboardList,
  Factory,
  Wallet,
  Banknote,
  BarChart3,
  Settings,
  Handshake,
  FileText,
  CalendarDays,
  Warehouse,
  UserCog,
  ChevronRight,
  X,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { hasDefaultPermission, type Permission } from "@/lib/permissions";
import { type Role } from "@/lib/roles";

type SidebarProps = {
  page: string;
  setPage: (page: string) => void;
  onClose?: () => void;
};

const menu = [
  {
    section: "Главное",
    items: [
      {
        id: "dashboard",
        title: "Главная",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    section: "CRM",
    items: [
      {
        id: "clients",
        title: "Заявки",
        icon: Users,
      },
      {
        id: "orders",
        title: "Заказы",
        icon: ClipboardList,
      },
      {
        id: "partners",
        title: "Цех",
        icon: Handshake,
      },
    ],
  },
  {
    section: "Компания",
    items: [
      {
        id: "production",
        title: "Производство",
        icon: Factory,
      },
      {
        id: "warehouse",
        title: "Склад",
        icon: Warehouse,
      },
      {
        id: "payroll",
        title: "Зарплаты",
        icon: Banknote,
      },
      {
        id: "finance",
        title: "Финансы",
        icon: Wallet,
      },
      {
        id: "reports",
        title: "Отчеты",
        icon: BarChart3,
      },
      {
        id: "documents",
        title: "Документы",
        icon: FileText,
      },
      {
        id: "calendar",
        title: "Календарь",
        icon: CalendarDays,
      },
      {
        id: "employees",
        title: "Сотрудники",
        icon: UserCog,
      },
    ],
  },
  {
    section: "Система",
    items: [
      {
        id: "settings",
        title: "Настройки",
        icon: Settings,
      },
    ],
  },
];

export default function Sidebar({
  page,
  setPage,
  onClose,
}: SidebarProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const role = session?.user.role as Role | undefined;
  const permissionByPage: Partial<Record<string, Permission>> = { clients: "clients", orders: "orders", partners: "partners", production: "production", warehouse: "warehouse", payroll: "payroll", finance: "finance", reports: "reports", documents: "documents", calendar: "calendar", employees: "employees", settings: "settings" };
  const visible = (id: string) =>
    id === "dashboard" ||
    (id === "payroll" && Boolean(role && role !== "PARTNER")) ||
    Boolean(
      role &&
        !(
          role === "MANAGER" &&
          ["partners", "production", "warehouse"].includes(id)
        ) &&
        !(role === "PARTNER" && id === "finance") &&
        permissionByPage[id] &&
        hasDefaultPermission(role, permissionByPage[id]!),
    );
  return (
    <aside aria-label="Основная навигация" className="flex h-dvh w-[min(18rem,88vw)] flex-col border-r border-slate-800 bg-[#0f172a] lg:h-full lg:w-72">

      <div className="border-b border-slate-800 p-6">

        <div className="flex items-center gap-3">

          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-yellow-500 text-2xl font-bold text-black">
            O
          </div>

          <div className="min-w-0 flex-1">

            <h1 className="text-2xl font-bold text-yellow-400">
              ORDA ERP
            </h1>

            <p className="text-sm text-slate-400">
              ALTYN SAPA COMPANY
            </p>

          </div>
          <button type="button" aria-label="Закрыть меню" onClick={onClose} className="grid size-11 place-items-center rounded-xl text-slate-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 lg:hidden"><X /></button>

        </div>

      </div>

      <nav className="flex-1 overflow-y-auto px-4 py-5">

        {menu.map((group) => ({ ...group, items: group.items.filter((item) => visible(item.id)) })).filter((group) => group.items.length).map((group) => (

          <div
            key={group.section}
            className="mb-8"
          >

            <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
              {group.section}
            </p>

            <div className="space-y-1">

              {group.items.map((item) => {
                const Icon = item.icon;

                const active = page === item.id;

                return (
                  <button
                    key={item.id}
                    onClick={() => item.id === "payroll" ? router.push("/payroll") : setPage(item.id)}
                    aria-current={active ? "page" : undefined}
                    className={`group flex min-h-12 w-full items-center justify-between rounded-xl px-4 py-3 text-left transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 ${
                      active
                        ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                        : "text-slate-300 hover:bg-slate-800 hover:text-white"
                    }`}
                  >

                    <div className="flex items-center gap-3">

                      <Icon size={20} />

                      <span className="font-medium">
                        {item.title}
                      </span>

                    </div>

                    <ChevronRight
                      size={16}
                      className={`transition ${
                        active
                          ? "translate-x-1 opacity-100"
                          : "opacity-0 group-hover:opacity-100"
                      }`}
                    />

                  </button>
                );
              })}

            </div>

          </div>

        ))}

      </nav>

      <div className="border-t border-slate-800 p-5">

        <div className="rounded-2xl bg-slate-800 p-4">

          <div className="flex items-center justify-between">

            <div>

              <p className="text-xs uppercase tracking-wider text-slate-500">
                ORDA ERP
              </p>

              <p className="mt-2 font-semibold text-white">
                Версия 1.0.0
              </p>

            </div>

            <span className="rounded-full bg-green-500 px-2 py-1 text-xs font-semibold text-black">
              В СЕТИ
            </span>

          </div>

          <div className="mt-4 border-t border-slate-700 pt-4">

            <p className="text-sm text-slate-400">
              Компания
            </p>

            <p className="font-semibold text-white">
              ALTYN SAPA COMPANY
            </p>

          </div>

        </div>

      </div>

    </aside>
  );
}
