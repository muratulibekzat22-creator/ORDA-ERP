"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

import Dashboard from "@/components/dashboard/Dashboard";
import { roleHome } from "@/lib/role-home";
import { type Role } from "@/lib/roles";

export default function Home() {
  const router = useRouter();
  const { data: session, status } = useSession();
  useEffect(() => { if (status === "authenticated") { const destination = roleHome[session.user.role as Role]; if (destination) router.replace(destination); } }, [router, session, status]);
  if (status === "loading" || status === "authenticated" && roleHome[session.user.role as Role]) return <div role="status" className="grid min-h-[50vh] place-items-center text-slate-300">Открываем рабочий раздел…</div>;
  return <Dashboard/>;
}
