"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

const menu = [
  { title: "🏠 Главная", href: "/" },
  { title: "👥 CRM", href: "/crm" },
  { title: "📋 Заказы", href: "/orders" },
  { title: "📏 Замеры", href: "/measurements" },
  { title: "💰 Финансы", href: "/finance" },
  { title: "🏭 Цех", href: "/partners" },
  { title: "📊 Аналитика", href: "/analytics" },
  { title: "⚙ Настройки", href: "/settings" },
];

export default function AppLayout({ children }: Props) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-gray-100">
      <aside className="w-64 bg-slate-900 text-white">
        <div className="p-6 text-2xl font-bold border-b border-slate-700">
          ORDA ERP
        </div>

        <nav className="flex flex-col p-3 gap-2">
          {menu.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-4 py-3 transition ${
                pathname === item.href
                  ? "bg-yellow-500 text-black font-semibold"
                  : "hover:bg-slate-700"
              }`}
            >
              {item.title}
            </Link>
          ))}
        </nav>
      </aside>

      <main className="flex-1">
        <header className="flex items-center justify-between border-b bg-white px-8 py-5">
          <div className="text-2xl font-bold">
            ALTYN SAPA • ORDA ERP
          </div>

          <div className="font-medium">
            Бекзат
          </div>
        </header>

        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
