"use client";

import { ArrowLeft, Building2, Clock3, LogOut, Menu, UserCircle } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { roleNames, type Role } from "@/lib/roles";

export default function Header({ onOpenMenu }: { onOpenMenu?: () => void }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [time, setTime] = useState("");

  useEffect(() => {
    const update = () => setTime(new Date().toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }));
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  const role = session?.user?.role as Role | undefined;
  const companyName = session?.user.isDemo
    ? "ALTYN SAPA COMPANY — ДЕМО"
    : session?.user.companyName || "ALTYN SAPA COMPANY";

  return (
    <header className="sticky top-0 z-40 flex min-h-16 items-center justify-between gap-3 border-b border-slate-800 bg-[#0f172a]/95 px-3 py-2 backdrop-blur md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" aria-label="Открыть меню" onClick={onOpenMenu} className="grid size-11 shrink-0 place-items-center rounded-xl border border-slate-700 text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 lg:hidden"><Menu /></button>
        {pathname !== "/" && <button type="button" aria-label="Назад" onClick={() => router.back()} className="grid size-11 shrink-0 place-items-center rounded-xl border border-slate-700 text-white hover:bg-slate-800 lg:hidden"><ArrowLeft size={20}/></button>}
        <div className="hidden min-w-0 items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 sm:flex">
          <Building2 size={20} className="shrink-0 text-yellow-400" />
          <div className="min-w-0"><p className="hidden text-xs text-slate-400 sm:block">Организация</p><span className="block max-w-52 truncate text-sm font-semibold text-white sm:text-base">{companyName}</span>{session?.user.isDemo && <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">ДЕМО</span>}</div>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <div className="hidden items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 xl:flex"><Clock3 size={18}/><span className="text-sm text-slate-300">{time}</span></div>
        <div className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-2 py-2 sm:px-3">
          <UserCircle size={30} className="shrink-0 text-blue-400" />
          <div className="hidden min-w-0 sm:block"><p className="max-w-36 truncate text-sm font-semibold text-white">{session?.user?.name ?? "Гость"}</p><p className="truncate text-xs text-slate-400">{role ? roleNames[role] : "Не авторизован"}</p></div>
        </div>
        {session && <button type="button" aria-label="Выйти из системы" title="Выйти" onClick={() => signOut({ callbackUrl: "/login" })} className="grid size-11 shrink-0 place-items-center rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"><LogOut size={20}/></button>}
      </div>
    </header>
  );
}
