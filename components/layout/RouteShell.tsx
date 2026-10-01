"use client";

import { usePathname, useRouter } from "next/navigation";
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
  Images,
  TrendingUp,
  X,
} from "lucide-react";
import Header from "@/components/Header";
import ManagerFollowUpGate from "@/components/clients/ManagerFollowUpGate";
import MandatoryTaskGate from "@/components/tasks/MandatoryTaskGate";
import { hasDefaultPermission, type Permission } from "@/lib/permissions";
import { type Role } from "@/lib/roles";

const sections = [
  { title: "Главное", items: [["/", "Главная", LayoutDashboard]] },
  { title: "Продажи", items: [["/clients", "Заявки", Users], ["/orders", "Заказы", ClipboardList], ["/sales-plan", "План продаж", TrendingUp], ["/measurements", "Замеры", Ruler], ["/catalog", "Каталог лестниц", Images], ["/marketing", "Маркетинг", Megaphone]] },
  { title: "Работа", items: [["/calendar", "Календарь", CalendarDays], ["/production", "Производство", Factory], ["/warehouse", "Склад", Warehouse], ["/training", "Обучение", GraduationCap]] },
  { title: "Компания", items: [["/employees", "Сотрудники", UserCog], ["/payroll", "Зарплаты", Banknote], ["/finance", "Финансы", Wallet], ["/partner-management", "Цехи и расчёты", Handshake], ["/reports", "Отчёты", BarChart3], ["/documents", "Документы", FileText]] },
  { title: "Система", items: [["/settings", "Настройки", Settings]] },
] as const;

const founderSections = [
  { title: "Главное", items: [["/", "Картина бизнеса", LayoutDashboard]] },
  { title: "Контроль", items: [["/sales-plan", "План продаж", TrendingUp], ["/orders", "Заказы", ClipboardList], ["/clients", "Заявки", Users]] },
  { title: "Компания", items: [["/finance", "Финансы", Wallet], ["/reports", "Отчёты", BarChart3], ["/employees", "Сотрудники", UserCog], ["/marketing", "Маркетинг", Megaphone]] },
  { title: "Система", items: [["/settings", "Настройки", Settings]] },
] as const;

const founderSecondary = [
  ["/measurements", "Замеры", Ruler],
  ["/catalog", "Каталог лестниц", Images],
  ["/calendar", "Календарь", CalendarDays],
  ["/production", "Производство", Factory],
  ["/warehouse", "Склад", Warehouse],
  ["/training", "Обучение", GraduationCap],
  ["/payroll", "Зарплаты", Banknote],
  ["/partner-management", "Цехи и расчёты", Handshake],
] as const;

export default function RouteShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const role = session?.user.role as Role | undefined;
  const accountRole = (session?.user.accountRole || role) as Role | undefined;
  const founder = accountRole === "DIRECTOR";
  const [grantedPermissions, setGrantedPermissions] = useState<Permission[] | null>(null);
  const permissionByHref: Partial<Record<string, Permission>> = {
    "/clients": "clients",
    "/orders": "orders",
    "/measurements": "measurements",
    "/catalog": "measurements",
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
    "/sales-plan": "reports",
  };
  const visible = (href: string) => {
    if (href === "/documents" && ["DIRECTOR", "OPERATIONS_DIRECTOR", "MANAGER"].includes(accountRole ?? "")) return false;
    if (founder) return true;
    if (role === "MEASURER")
      return ["/", "/measurements", "/catalog", "/calendar", "/training", "/payroll"].includes(href);
    if (role === "MANAGER")
      return ["/", "/clients", "/orders", "/sales-plan", "/measurements", "/catalog", "/calendar", "/production", "/payroll"].includes(href);
    if (role === "MARKETER") return ["/", "/marketing", "/calendar", "/payroll"].includes(href);
    if (accountRole === "OPERATIONS_DIRECTOR")
      return href === "/" || Boolean(permissionByHref[href] && (
        grantedPermissions
          ? grantedPermissions.includes(permissionByHref[href]!)
          : hasDefaultPermission(accountRole, permissionByHref[href]!)
      ));
    if (href === "/training" || href === "/measurements" || href === "/marketing") return false;
    return href === "/" ||
    (href === "/payroll" && Boolean(role && role !== "PARTNER")) ||
    Boolean(
      role &&
      !(role === "PARTNER" && href === "/finance") &&
      permissionByHref[href] &&
      (grantedPermissions
        ? grantedPermissions.includes(permissionByHref[href]!)
        : hasDefaultPermission(accountRole ?? role, permissionByHref[href]!)),
    );
  };
  const [open, setOpen] = useState(false);
  const [secondaryOpen, setSecondaryOpen] = useState(() =>
    founderSecondary.some(([href]) => pathname.startsWith(href)),
  );
  const standalone = pathname === "/login" || pathname === "/partner";
  useEffect(() => {
    if (!session?.user) return;
    const controller = new AbortController();
    void fetch("/api/session/permissions", { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ permissions: Permission[] }> : null)
      .then((payload) => payload && setGrantedPermissions(payload.permissions))
      .catch(() => undefined);
    return () => controller.abort();
  }, [session?.user]);
  useEffect(() => {
    if (founder || !accountRole || grantedPermissions === null) return;
    const first = pathname.split("/").filter(Boolean)[0] ?? "";
    const required: Partial<Record<string, Permission>> = {
      clients: "clients", orders: "orders", calculator: "orders", measurements: "measurements", catalog: "measurements",
      calendar: "calendar", documents: "documents", production: "production", warehouse: "warehouse",
      finance: "finance", "company-finance": "finance", "personal-finance": "finance",
      partners: "partners", "partner-management": "partners", reports: "reports", analytics: "reports", "sales-plan": "reports",
      employees: "employees", payroll: "payroll", settings: "settings", "calculator-config": "settings",
      marketing: "marketing",
    };
    const permission = required[first];
    if (permission && !(first === "sales-plan" && role === "MANAGER") && !grantedPermissions.includes(permission)) router.replace("/");
  }, [accountRole, founder, grantedPermissions, pathname, role, router]);
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
            {(founder ? founderSections : sections).map((section) => {
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
                  {href === "/payroll" && accountRole !== "DIRECTOR" && accountRole !== "OPERATIONS_DIRECTOR" && role !== "ACCOUNTANT"
                    ? "Моя зарплата"
                    : href === "/training" && founder
                      ? "Обучение сотрудников"
                      : title}
                </Link>
                ))}</div>
              </div>;
            })}
            {founder ? <details className="mb-5 rounded-xl border border-slate-800 bg-slate-950/30" open={secondaryOpen} onToggle={(event) => setSecondaryOpen(event.currentTarget.open)}>
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-400">Другие разделы</summary>
              <div className="space-y-1 border-t border-slate-800 p-2">{founderSecondary.map(([href, title, Icon]) => <Link key={href} href={href} onClick={() => setOpen(false)} aria-current={active(href) ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm ${active(href) ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}><Icon size={18}/>{title}</Link>)}</div>
            </details> : null}
          </nav>
        </aside>
        <div className="min-w-0 flex-1 overflow-auto"><MandatoryTaskGate><ManagerFollowUpGate>{children}</ManagerFollowUpGate></MandatoryTaskGate></div>
      </div>
    </main>
  );
}
