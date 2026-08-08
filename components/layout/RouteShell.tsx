"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  CalendarDays,
  Calculator,
  ClipboardList,
  Ruler,
  Factory,
  FileText,
  Handshake,
  LayoutDashboard,
  Settings,
  UserCog,
  Users,
  Wallet,
  Banknote,
  Landmark,
  LockKeyhole,
  Warehouse,
  X,
} from "lucide-react";
import Header from "@/components/Header";
import { hasDefaultPermission, type Permission } from "@/lib/permissions";
import { type Role } from "@/lib/roles";

const links = [
  ["/", "Главная", LayoutDashboard],
  ["/clients", "Заявки", Users],
  ["/orders", "Заказы", ClipboardList],
  ["/measurements", "Замеры", Ruler],
  ["/calculator", "Калькулятор", Calculator],
  ["/documents", "Документы и КП", FileText],
  ["/partners", "Цех", Handshake],
  ["/production", "Производство", Factory],
  ["/warehouse", "Склад", Warehouse],
  ["/finance", "Финансы", Wallet],
  ["/calendar", "Календарь", CalendarDays],
  ["/employees", "Сотрудники", UserCog],
  ["/payroll", "Зарплаты", Banknote],
  ["/settings", "Настройки", Settings],
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
    "/calculator": "orders",
    "/documents": "documents",
    "/partners": "partners",
    "/production": "production",
    "/warehouse": "warehouse",
    "/finance": "finance",
    "/calendar": "calendar",
    "/employees": "employees",
    "/payroll": "payroll",
    "/settings": "settings",
  };
  const visible = (href: string) =>
    href === "/" || (href === "/payroll" && role !== "PARTNER") ||
    Boolean(
      role &&
      !(role === "PARTNER" && href === "/finance") &&
      permissionByHref[href] &&
      hasDefaultPermission(role, permissionByHref[href]!),
    );
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
              <p className="text-xs text-slate-400">ALTYN SAPA COMPANY</p>
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
            {links
              .filter(([href]) => visible(href))
              .map(([href, title, Icon]) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  aria-current={active(href) ? "page" : undefined}
                  className={`flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 ${active(href) ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}
                >
                  <Icon size={20} />
                  {href === "/payroll" && role !== "DIRECTOR" && role !== "ACCOUNTANT" ? "Моя зарплата" : title}
                </Link>
              ))}
            {(session?.user.role === "DIRECTOR" ||
              session?.user.role === "ACCOUNTANT") && (
              <Link
                href="/company-finance"
                onClick={() => setOpen(false)}
                aria-current={active("/company-finance") ? "page" : undefined}
                className={`flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 ${active("/company-finance") ? "bg-blue-600" : "text-slate-300 hover:bg-slate-800"}`}
              >
                <Landmark size={20} />
                Финансы компании
              </Link>
            )}
            {session?.user.role === "DIRECTOR" && (
              <Link
                href="/personal-finance"
                onClick={() => setOpen(false)}
                aria-current={active("/personal-finance") ? "page" : undefined}
                className={`flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 ${active("/personal-finance") ? "bg-blue-600" : "text-slate-300 hover:bg-slate-800"}`}
              >
                <LockKeyhole size={20} />
                Личные финансы
              </Link>
            )}
            {session?.user.role === "DIRECTOR" && (
              <Link
                href="/calculator-config"
                onClick={() => setOpen(false)}
                aria-current={active("/calculator-config") ? "page" : undefined}
                className={`flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 ${active("/calculator-config") ? "bg-blue-600" : "text-slate-300 hover:bg-slate-800"}`}
              >
                <Settings size={20} />
                Конфигурация калькулятора
              </Link>
            )}
          </nav>
        </aside>
        <div className="min-w-0 flex-1 overflow-auto">{children}</div>
      </div>
    </main>
  );
}
