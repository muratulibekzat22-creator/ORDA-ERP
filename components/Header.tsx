"use client";

import { ArrowLeft, Bell, Building2, CalendarDays, ChevronDown, Clock3, KeyRound, LogOut, Menu, Settings, SlidersHorizontal, UserCircle } from "lucide-react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { roleNames, type Role } from "@/lib/roles";

export default function Header({
  onOpenMenu,
  canManageSettings = false,
  canManageWorkSchedule = false,
}: {
  onOpenMenu?: () => void;
  canManageSettings?: boolean;
  canManageWorkSchedule?: boolean;
}) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [time, setTime] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [handoverNotices, setHandoverNotices] = useState<{ id: number; text: string }[]>([]);

  useEffect(() => {
    const update = () => setTime(new Date().toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }));
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  const role = session?.user?.role as Role | undefined;
  const accountRole = (session?.user?.accountRole || role) as Role | undefined;

  useEffect(() => {
    if (accountRole !== "MANAGER") return;
    void fetch("/api/employee-handover-notices", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ id: number; text: string }[]> : [])
      .then(setHandoverNotices).catch(() => undefined);
  }, [accountRole]);

  return (
    <header className="sticky top-0 z-40 flex min-h-16 items-center justify-between gap-3 border-b border-slate-800 bg-[#0f172a]/95 px-3 py-2 backdrop-blur md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" aria-label="Открыть меню" onClick={onOpenMenu} className="grid size-11 shrink-0 place-items-center rounded-xl border border-slate-700 text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 lg:hidden"><Menu /></button>
        {pathname !== "/" && <button type="button" aria-label="Назад" onClick={() => router.back()} className="grid size-11 shrink-0 place-items-center rounded-xl border border-slate-700 text-white hover:bg-slate-800 lg:hidden"><ArrowLeft size={20}/></button>}
        <div className="hidden min-w-0 items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 sm:flex">
          <Building2 size={20} className="shrink-0 text-yellow-400" />
          <div className="min-w-0"><p className="hidden text-xs text-slate-400 sm:block">Организация</p><span className="block max-w-52 truncate text-sm font-semibold text-white sm:text-base">{session?.user.companyName || "ALTYN SAPA"}</span>{session?.user.isDemo && <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">DEMO</span>}</div>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {handoverNotices.length > 0 && <div className="relative group"><button type="button" aria-label="Уведомления о передаче дел" className="grid size-11 place-items-center rounded-xl border border-amber-500/50 bg-amber-950/30 text-amber-200"><Bell size={19} /></button><div className="invisible absolute right-0 top-full z-50 w-72 rounded-xl border border-amber-700 bg-slate-900 p-3 text-sm text-white shadow-xl group-focus-within:visible group-hover:visible">{handoverNotices.map((notice) => <div key={notice.id} className="border-b border-slate-700 py-2"><p>{notice.text}</p><button type="button" className="mt-2 text-blue-300" onClick={() => { void fetch("/api/employee-handover-notices", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: notice.id }) }).then((response) => { if (response.ok) setHandoverNotices((current) => current.filter((item) => item.id !== notice.id)); }); }}>Прочитано</button></div>)}</div></div>}
        <div className="hidden items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 xl:flex"><Clock3 size={18}/><span className="text-sm text-slate-300">{time}</span></div>
        <div className="relative">
          <button type="button" aria-expanded={profileOpen} onClick={() => setProfileOpen((value) => !value)} className="flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-2 py-2 text-left sm:px-3">
            <UserCircle size={30} className="shrink-0 text-blue-400" />
            <div className="hidden min-w-0 sm:block"><p className="max-w-36 truncate text-sm font-semibold text-white">{session?.user?.name ?? "Гость"}</p><p className="truncate text-xs text-slate-400">{accountRole ? roleNames[accountRole] : "Не авторизован"}</p></div>
            <ChevronDown size={15} className="hidden text-slate-400 sm:block" />
          </button>
          {profileOpen && <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-56 rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-2xl">
            <Link href="/change-password" onClick={() => setProfileOpen(false)} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-slate-200 hover:bg-slate-800"><KeyRound size={17}/>Настройки аккаунта</Link>
            {canManageSettings && <Link href="/settings" onClick={() => setProfileOpen(false)} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-slate-200 hover:bg-slate-800"><Settings size={17}/>Настройки компании</Link>}
            {canManageSettings && <Link href="/calculator-config" onClick={() => setProfileOpen(false)} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-slate-200 hover:bg-slate-800"><SlidersHorizontal size={17}/>Настройки калькулятора</Link>}
            {canManageWorkSchedule && <Link href="/settings/work-schedule" onClick={() => setProfileOpen(false)} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-slate-200 hover:bg-slate-800"><CalendarDays size={17}/>Выходные и отчёты</Link>}
          </div>}
        </div>
        {session && <button type="button" aria-label="Выйти из системы" title="Выйти" onClick={() => signOut({ callbackUrl: "/login" })} className="grid size-11 shrink-0 place-items-center rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"><LogOut size={20}/></button>}
      </div>
    </header>
  );
}
