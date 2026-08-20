"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  CalendarDays,
  ClipboardList,
  Ruler,
  Factory,
  FileText,
  LayoutDashboard,
  Settings,
  UserCog,
  Users,
  Wallet,
  Banknote,
  GraduationCap,
  Handshake,
  Warehouse,
  BarChart3,
  Megaphone,
  X,
} from "lucide-react";
import Header from "@/components/Header";
import { hasDefaultPermission, type Permission } from "@/lib/permissions";
import { type Role } from "@/lib/roles";

const sections = [
  { title: "Главное", items: [["/", "Главная", LayoutDashboard]] },
  { title: "Продажи", items: [["/clients", "Заявки", Users], ["/orders", "Заказы", ClipboardList], ["/measurements", "Замеры", Ruler], ["/marketing", "Маркетинг", Megaphone]] },
  { title: "Работа", items: [["/calendar", "Календарь", CalendarDays], ["/production", "Производство", Factory], ["/warehouse", "Склад", Warehouse], ["/training", "Обучение", GraduationCap]] },
  { title: "Компания", items: [["/employees", "Сотрудники", UserCog], ["/payroll", "Зарплаты", Banknote], ["/finance", "Финансы", Wallet], ["/partner-management", "Партнёры", Handshake], ["/reports", "Отчёты", BarChart3], ["/documents", "Документы", FileText]] },
  { title: "Система", items: [["/settings", "Настройки", Settings]] },
] as const;

export default function RouteShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user.role as Role | undefined;
  const permissionByHref: Partial<Record<string, Permission>> = {
    "/clients": "clients",
    "/orders": "orders",
    "/measurements": "measurements",
    "/documents": "documents",
    "/production": "production",
    "/warehouse": "warehouse",
    "/finance": "finance",
    "/partner-management": "partners",
    "/reports": "reports",
    "/calendar": "calendar",
    "/employees": "employees",
    "/payroll": "payroll",
    "/settings": "settings",
    "/marketing": "marketing",
  };
  const visible = (href: string) => {
    if (href === "/partner-management") return role === "DIRECTOR";
    if (href === "/marketing") return role === "DIRECTOR" || role === "MARKETER";
    if (role === "MEASURER")
      return ["/", "/measurements", "/calendar", "/training", "/payroll"].includes(href);
    if (role === "MANAGER")
      return ["/", "/clients", "/orders", "/measurements", "/calendar", "/documents", "/payroll"].includes(href);
    if (role === "MARKETER") return ["/marketing", "/calendar"].includes(href);
    if (role === "DIRECTOR")
      return ["/", "/clients", "/orders", "/measurements", "/marketing", "/calendar", "/production", "/warehouse", "/employees", "/payroll", "/finance", "/partner-management", "/reports", "/documents", "/settings"].includes(href);
    if (href === "/training" || href === "/measurements") return false;
    return href === "/" ||
    (href === "/payroll" && Boolean(role && role !== "PARTNER")) ||
    Boolean(
      role &&
      !(role === "PARTNER" && href === "/finance") &&
      permissionByHref[href] &&
      hasDefaultPermission(role, permissionByHref[href]!),
    );
  };
  const [open, setOpen] = useState(false);
  const standalone = pathname === "/login" || pathname === "/partner";
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) =>
      event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  if (standalone) return children;
  const active = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <main className="flex h-screen flex-col overflow-hidden bg-slate-950 text-white">
      <Header onOpenMenu={() => setOpen(true)} />
      <div className="flex min-h-0 flex-1">
        {open && (
          <button
            type="button"
            aria-label="Закрыть меню"
            className="fixed inset-0 z-50 bg-black/60 lg:hidden"
            onClick={() => setOpen(false)}
          />
        )}
        <aside
          aria-label="Основная навигация"
          className={`fixed inset-y-0 left-0 z-[60] flex h-dvh w-[min(18rem,88vw)] flex-col border-r border-slate-800 bg-[#0f172a] transition-transform lg:static lg:h-full lg:w-72 lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
        >
          <div className="flex items-center justify-between border-b border-slate-800 p-5">
            <div>
              <p className="text-xl font-bold text-yellow-400">ORDA ERP</p>
              <p className="max-w-48 truncate text-xs text-slate-400">{session?.user.companyName || "ALTYN SAPA COMPANY"}</p>
              {session?.user.isDemo && <span className="mt-1 inline-flex rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">DEMO</span>}
            </div>
            <button
              type="button"
              aria-label="Закрыть меню"
              onClick={() => setOpen(false)}
              className="grid size-11 place-items-center rounded-xl hover:bg-slate-800 lg:hidden"
            >
              <X />
            </button>
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto p-4">
            {sections.map((section) => {
              const items = section.items.filter(([href]) => visible(href));
              if (!items.length) return null;
              return <div key={section.title} className="mb-6">
                <p className="mb-2 px-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{section.title}</p>
                <div className="space-y-1">{items.map(([href, title, Icon]) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  aria-current={active(href) ? "page" : undefined}
                  className={`flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 ${active(href) ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}
                >
                  <Icon size={20} />
                  {href === "/payroll" && role !== "DIRECTOR" && role !== "ACCOUNTANT"
                    ? "Моя зарплата"
                    : href === "/training" && role === "DIRECTOR"
                      ? "Обучение сотрудников"
                      : title}
                </Link>
                ))}</div>
              </div>;
            })}
          </nav>
        </aside>
        <div className="min-w-0 flex-1 overflow-auto">{children}</div>
      </div>
    </main>
  );
}
